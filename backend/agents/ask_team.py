"""Ask VAULT (F10.20): a coordinator reads one message, hands the work to helpers, and reports each step as it runs.

Every event in the stream stands for a real call: the coordinator's plan comes from the chat rules (or, when they
understand nothing, from the local model), and each helper wraps one existing function. The timings are measured
around those calls; nothing waits for show. Helpers that do not depend on each other run at the same time on their
own threads, each with its own database connection, and the plan event says which ones those are.

Only the Answer writer (and the optional model planning) uses a language model. The other helpers are plain code.
Each helper that looks at documents records which ones (in the order it produced) in the collection's activity feed
(F10.22), under this run's id, so the live brain can show the same work.
The message is data: it fills the chat command's fixed fields and the investigation's plan, and is never run.
"""

from __future__ import annotations

import logging
import queue
import secrets
import threading
import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from backend.core.config import Settings
from backend.core.hardware import profile_hardware
from backend.core.local_models import local_models
from backend.core.runtime import effective_settings
from backend.indexing import assistant
from backend.indexing.investigate import (
    check_sentences,
    matching_findings,
    number_sources,
    plan_question,
    search_hits,
    write_answer,
)
from backend.providers import get_provider
from backend.providers.base import Provider, ProviderError
from backend.security import audit
from backend.security.auth import Principal
from backend.storage.db import connect
from backend.workers import activity

log = logging.getLogger("vault.ask")

HELPERS = {
    "finder": ("Finder", "Searches the index"),
    "sorter": ("Sorter", "Puts the results in the order you asked for"),
    "conflicts": ("Conflict checker", "Looks up conflicts VAULT has already recorded"),
    "answer": ("Answer writer", "Writes the answer from the numbered source lines"),
    "facts": ("Fact checker", "Checks every number in the answer against the lines it cites"),
    "models": ("Models helper", "Asks Ollama which models are on this computer"),
    "navigator": ("Navigator", "Finds the page to open"),
}
PAGE_NAMES = {
    "/": "Overview",
    "/setup": "Set up",
    "/run": "Run board",
    "/investigate": "Investigate",
    "/training": "Training",
    "/brain": "Brain",
    "/approvals": "Approvals",
    "/security": "Security",
    "/models": "Models",
}
PREVIEW = 5
ORDER_WORDS = {
    ("date", "desc"): "newest first",
    ("date", "asc"): "oldest first",
    ("name", "asc"): "A to Z",
    ("name", "desc"): "Z to A",
    ("duration", "desc"): "longest first",
    ("duration", "asc"): "shortest first",
    ("size", "desc"): "largest first",
    ("size", "asc"): "smallest first",
}


class HelperFailed(Exception):
    """A helper could not finish. The message is written by VAULT and safe to show."""

    def __init__(self, detail: str, status: int = 400) -> None:
        super().__init__(detail)
        self.status = status


@dataclass
class Step:
    helper: str
    why: str
    run: Callable[[object, Callable[[str], None]], tuple[str, dict]]
    uses_model: bool = False


@dataclass
class Team:
    settings: Settings
    collection_id: int
    message: str
    previous: assistant.Command | None
    use_model: bool
    principal: Principal
    # Resolves the provider for the Answer writer under the same remote-inference rules as /investigations.
    # Returns (provider, info, note): the note says when the default local model was not running.
    resolve_provider: Callable[[object], tuple[Provider, object, str | None]]
    started: float = field(default_factory=time.perf_counter)
    run: str = field(default_factory=lambda: "ask-" + secrets.token_hex(6))

    def _t(self) -> int:
        return round((time.perf_counter() - self.started) * 1000)

    def _event(self, event_type: str, /, **data) -> dict:
        return {"type": event_type, "t_ms": self._t(), **data}

    # ---------- the stream ----------

    def events(self) -> Iterator[dict]:
        with connect(self.settings.db_path) as conn:
            try:
                yield from self._events(conn)
            except Exception:  # noqa: BLE001 - the stream must end with an event, never a stack trace
                log.exception("ask stream failed")
                yield self._event("error", status=500, detail="internal error")

    def _events(self, conn) -> Iterator[dict]:
        yield self._event("start", collection_id=self.collection_id, run=self.run)
        t0 = time.perf_counter()
        cmd = assistant.interpret(conn, self.collection_id, self.message, self.previous)
        source, model = "rules", None
        if cmd.kind == "help" and self.use_model and len(self.message.split()) >= 3:
            # Only the local model plans, never a remote one: this box has no data-leaves-this-machine prompt.
            eff = effective_settings(conn, self.settings)
            local = get_provider("ollama", eff)
            info = local.info()
            if info.available and info.locality == "local":
                yield self._event(
                    "coordinator",
                    status="asking_model",
                    text=f"The rules did not understand this, so {info.model} is reading it.",
                    model=info.model,
                )
                better = assistant.model_command(local, conn, self.collection_id, self.message)
                if better is not None:
                    cmd, source, model = better, "model", info.model
        plan_ms = round((time.perf_counter() - t0) * 1000)

        if cmd.kind == "ask":
            yield from self._ask(conn, cmd, source, model, plan_ms)
        elif cmd.kind == "find":
            yield from self._find(conn, cmd, source, model, plan_ms)
        elif cmd.kind == "models":
            yield from self._models(conn, cmd, source, model, plan_ms)
        elif cmd.kind == "open":
            yield from self._open(cmd, source, model, plan_ms)
        else:
            yield self._plan(cmd, source, model, plan_ms, [], "Nothing to hand off: this message needs a hint.")
            yield self._event("answer", kind="help", command=cmd.model_dump(), text=assistant.HELP)
        yield self._event("done", duration_ms=self._t())

    def _plan(self, cmd, source, model, plan_ms, steps: list[list[Step]], reason: str, **extra) -> dict:
        helpers = []
        for n, group in enumerate(steps):
            for s in group:
                name, does = HELPERS[s.helper]
                helpers.append(
                    {
                        "id": s.helper,
                        "name": name,
                        "does": does,
                        "why": s.why,
                        "step": n,
                        "uses_model": s.uses_model,
                        "with": [o.helper for o in group if o is not s],
                    }
                )
        together = [[s.helper for s in g] for g in steps if len(g) > 1]
        note = " ".join(
            " and ".join(HELPERS[h][0] for h in g) + " do not need each other, so they run at the same time."
            for g in together
        )
        return self._event(
            "plan",
            source=source,
            model=model,
            duration_ms=plan_ms,
            command=cmd.model_dump(),
            reason=reason,
            helpers=helpers,
            steps=[[s.helper for s in g] for g in steps],
            parallel_note=note or None,
            **extra,
        )

    def _run(self, group: list[Step], results: dict) -> Iterator[dict]:
        """Run one step's helpers, together when there are several, and pass their events on as they happen."""
        events: queue.Queue = queue.Queue()

        def work(step: Step) -> None:
            name = HELPERS[step.helper][0]
            began = time.perf_counter()
            events.put(
                self._event(
                    "helper", id=step.helper, name=name, status="started", thread=threading.current_thread().name
                )
            )

            def progress(text: str) -> None:
                events.put(self._event("helper", id=step.helper, name=name, status="progress", text=text))

            try:
                with connect(self.settings.db_path) as own:
                    summary, result = step.run(own, progress)
            except HelperFailed as exc:
                events.put(self._failed(step, began, str(exc)))
            except ProviderError as exc:
                events.put(self._failed(step, began, f"The model did not answer: {str(exc)[:200]}"))
            except Exception:  # noqa: BLE001
                log.exception("helper %s failed", step.helper)
                events.put(self._failed(step, began, "internal error"))
            else:
                results[step.helper] = result
                self._record(step, result.get("touched"))
                events.put(
                    self._event(
                        "helper",
                        id=step.helper,
                        name=name,
                        status="finished",
                        duration_ms=round((time.perf_counter() - began) * 1000),
                        summary=summary,
                        result=result.get("shown", {}),
                    )
                )
            finally:
                events.put(None)

        with ThreadPoolExecutor(max_workers=len(group), thread_name_prefix="vault-helper") as pool:
            for step in group:
                pool.submit(work, step)
            left = len(group)
            while left:
                ev = events.get()
                if ev is None:
                    left -= 1
                else:
                    yield ev

    def _record(self, step: Step, touched: dict | None) -> None:
        """Write what the helper looked at to the activity feed. A failed write never fails the answer."""
        if not touched:
            return
        try:
            with connect(self.settings.db_path) as own:
                activity.record(own, self.collection_id, HELPERS[step.helper][0], run=self.run, **touched)
        except Exception:  # noqa: BLE001
            log.exception("could not record activity for %s", step.helper)

    def _failed(self, step: Step, began: float, detail: str) -> dict:
        return self._event(
            "helper",
            id=step.helper,
            name=HELPERS[step.helper][0],
            status="failed",
            duration_ms=round((time.perf_counter() - began) * 1000),
            detail=detail,
        )

    # ---------- questions ----------

    def _ask(self, conn, cmd, source, model, plan_ms) -> Iterator[dict]:
        question = cmd.q or self.message
        plan = plan_question(conn, self.collection_id, question)
        t_check = time.perf_counter()
        try:
            provider, info, note = self.resolve_provider(conn)
        except HelperFailed as exc:
            yield self._event("error", status=exc.status, detail=str(exc))
            return
        if note:
            # Finding out that the model is not there can take seconds on some machines; show that time too.
            checked_ms = round((time.perf_counter() - t_check) * 1000)
            yield self._event("coordinator", status="fallback", text=note, duration_ms=checked_ms)
        remote = info.locality == "remote"
        cid = self.collection_id

        def find(c, progress):
            words = plan["terms"] or ["(every document)"]
            progress(
                f"Searching for {', '.join(words)}"
                + (f" with part {', '.join(plan['part_numbers'])}" if plan["part_numbers"] else "")
            )
            hits = search_hits(c, cid, plan)
            shown = [{"document_id": h["document_id"], "filename": h["filename"], "page": h["page"]} for h in hits]
            return f"{len(hits)} matching document{'s' if len(hits) != 1 else ''}", {
                "hits": hits,
                "shown": {"count": len(hits), "documents": shown[:PREVIEW]},
                "touched": {
                    "action": "looked_at",
                    "document_ids": activity.unique_ids(h["document_id"] for h in hits),
                    "count": len(hits),
                    "words": words[:8],
                },
            }

        def conflicts(c, progress):
            progress("Reading the conflicts recorded for this collection")
            matched = matching_findings(c, cid, plan)
            shown = [{"id": f["id"], "key": f["key"], "summary": f["summary"]} for f in matched]
            return f"{len(matched)} recorded conflict{'s' if len(matched) != 1 else ''} match", {
                "matched": matched,
                "shown": {"count": len(matched), "findings": shown},
                "touched": {
                    "action": "checked_conflicts",
                    "document_ids": activity.unique_ids(
                        e.get("document_id") for f in matched for e in f.get("evidence", [])
                    ),
                    "count": len(matched),
                    "keys": [f["key"] for f in matched][:10],
                },
            }

        first = [Step("finder", "to find documents that mention the question's words", find)]
        if plan["conflicts"] or plan["part_numbers"]:
            why = "the question asks about conflicts" if plan["conflicts"] else "the question names a part number"
            first.append(Step("conflicts", why, conflicts))
        state: dict = {}

        def answer(c, progress):
            progress(
                f"Writing with {info.model}"
                if info.is_ai_model and state["sources"]
                else "Restating what was found (no model needed)"
            )
            raw = write_answer(c, cid, question, provider, plan, state["sources"], state["findings"])
            state["raw"] = raw
            by = info.model if info.is_ai_model and state["sources"] else "VAULT's rules"
            return f"{len(raw)} sentence{'s' if len(raw) != 1 else ''} by {by}", {
                "shown": {"sentences": len(raw), "by": by, "provider": info.name},
                "touched": {
                    "action": "cited",
                    "document_ids": activity.unique_ids(src["document_id"] for src in state["sources"]),
                    "count": len(state["sources"]),
                    "by": by,
                },
            }

        def facts(c, progress):
            progress("Comparing each number with the cited lines")
            checked = check_sentences(state["raw"], state["sources"])
            state["checked"] = checked
            ok = sum(1 for s in checked if s["verified"])
            cited = sum(1 for s in checked if s["kind"] == "cited")
            rows = [
                {"sentence": i + 1, "verified": s["verified"], "unsupported_numbers": s["unsupported_numbers"]}
                for i, s in enumerate(checked)
            ]
            by_id = {src["id"]: src["document_id"] for src in state["sources"]}
            return f"{ok} of {cited} cited sentence{'s' if cited != 1 else ''} verified", {
                "shown": {"verified": ok, "cited": cited, "sentences": rows},
                "touched": {
                    "action": "fact_checked",
                    "document_ids": activity.unique_ids(by_id.get(n) for s in checked for n in s["sources"]),
                    "verified": ok,
                    "cited": cited,
                },
            }

        model_use = info.is_ai_model
        steps = [
            first,
            [
                Step(
                    "answer",
                    f"to write the answer ({info.model})" if model_use else "to restate the facts with VAULT's rules",
                    answer,
                    model_use,
                )
            ],
            [Step("facts", "so no number is shown that the sources do not contain", facts)],
        ]
        yield self._plan(
            cmd,
            source,
            model,
            plan_ms,
            steps,
            "A question: find the evidence, answer it, check it.",
            question_plan=plan,
        )

        results: dict = {}
        yield from self._run(first, results)
        if "finder" not in results:
            yield self._event(
                "answer",
                kind="ask",
                command=cmd.model_dump(),
                text="The search failed, so there is nothing to answer from.",
                sentences=[],
                sources=[],
            )
            return
        t0 = time.perf_counter()
        matched = results.get("conflicts", {}).get("matched", [])
        sources, findings, withheld = number_sources(conn, matched, results["finder"]["hits"], remote)
        state.update(sources=sources, findings=findings)
        yield self._event(
            "coordinator",
            status="merged",
            text=f"Numbered {len(sources)} source line{'s' if len(sources) != 1 else ''} for the Answer writer",
            duration_ms=round((time.perf_counter() - t0) * 1000),
        )
        yield from self._run(steps[1], results)
        if "answer" not in results:
            yield self._event(
                "answer",
                kind="ask",
                command=cmd.model_dump(),
                text="The Answer writer could not finish. The sources it was given are below.",
                sentences=[],
                sources=sources,
                findings=findings,
            )
            return
        yield from self._run(steps[2], results)
        checked = state.get("checked") or []
        audit.record(
            conn,
            self.principal.username,
            "ask.run",
            "allowed",
            target=f"collection:{cid}",
            detail={"provider": info.name, "sources": len(sources), "sentences": len(checked)},
        )
        yield self._event(
            "answer",
            kind="ask",
            command=cmd.model_dump(),
            text=" ".join(s["text"] for s in checked),
            sentences=checked,
            sources=sources,
            findings=findings,
            withheld_local_only=withheld,
            answered_by={
                "provider": info.name,
                "model": info.model,
                "locality": info.locality,
                "is_ai_model": info.is_ai_model,
            },
        )

    # ---------- lists ----------

    def _find(self, conn, cmd, source, model, plan_ms) -> Iterator[dict]:
        cid, state = self.collection_id, {}

        def find(c, progress):
            # describe() of an empty result names exactly what is being looked for: "No drawings in Alpha. Try..."
            wanted = assistant.describe(cmd.model_copy(update={"sort": "relevance"}), 0).split(". Try")[0]
            progress("Looking for " + wanted.removeprefix("No "))
            docs, dropped = assistant.find_documents(c, cid, cmd)
            state.update(docs=docs, dropped=dropped)
            shown = [{"document_id": d["document_id"], "filename": d["filename"]} for d in docs[:PREVIEW]]
            text = f"{len(docs)} document{'s' if len(docs) != 1 else ''}"
            return text + (" (without the words, which matched nothing)" if dropped else ""), {
                "shown": {"count": len(docs), "documents": shown, "dropped_words": dropped},
                "touched": {
                    "action": "looked_at",
                    "document_ids": activity.unique_ids(d["document_id"] for d in docs),
                    "count": len(docs),
                    "words": (cmd.q or "").split()[:8] or None,
                },
            }

        def sort(c, progress):
            order = ORDER_WORDS.get((cmd.sort, cmd.order), cmd.order)
            progress(f"Sorting {len(state['docs'])} rows by {cmd.sort}, {order}")
            state["docs"] = assistant.sort_rows(state["docs"], cmd)
            shown = [
                {"document_id": d["document_id"], "filename": d["filename"], "doc_date": d.get("doc_date")}
                for d in state["docs"][:PREVIEW]
            ]
            return f"Sorted by {cmd.sort} ({cmd.order})", {
                "shown": {"first": shown},
                "touched": {
                    "action": "sorted",
                    "document_ids": activity.unique_ids(d["document_id"] for d in state["docs"]),
                    "count": len(state["docs"]),
                    "sort": cmd.sort,
                    "order": order,
                },
            }

        steps = [[Step("finder", "to list the documents you described", find)]]
        if cmd.sort != "relevance":
            steps.append([Step("sorter", f"you asked for them by {cmd.sort}", sort)])
        yield self._plan(cmd, source, model, plan_ms, steps, "A list: search, then order the rows.")
        results: dict = {}
        for group in steps:
            yield from self._run(group, results)
        docs = state.get("docs", [])
        yield self._event(
            "answer",
            kind="find",
            command=cmd.model_dump(),
            text=assistant.describe(cmd, len(docs), state.get("dropped", False))
            if "finder" in results
            else "The search failed.",
            rows=docs[: assistant.SHOWN],
            count=len(docs),
        )

    def _models(self, conn, cmd, source, model, plan_ms) -> Iterator[dict]:
        eff = effective_settings(conn, self.settings)
        state: dict = {}

        def ask_ollama(c, progress):
            progress("Asking the local Ollama server for its model list")
            lm = local_models(eff, profile_hardware(self.settings.data_dir))
            state["lm"] = lm
            rows = [
                {"name": m["name"], "size_gb": m["size_gb"], "used_by_vault": m["used_by_vault"], "loaded": m["loaded"]}
                for m in lm["models"]
            ]
            state["rows"] = rows
            if not lm["reachable"]:
                raise HelperFailed("Ollama is not running, so VAULT cannot see your models.")
            return f"{len(rows)} model{'s' if len(rows) != 1 else ''} downloaded", {"shown": {"models": rows}}

        steps = [[Step("models", "the message asks about models", ask_ollama)]]
        yield self._plan(cmd, source, model, plan_ms, steps, "A question about this computer's models.")
        results: dict = {}
        yield from self._run(steps[0], results)
        lm, rows = state.get("lm") or {}, state.get("rows", [])
        if not lm.get("reachable"):
            text = "Ollama is not running, so VAULT cannot see your models. Start Ollama, then ask again."
        elif not rows:
            text = "No models are downloaded yet. Open Models to download Llama 3."
        else:
            active = any(m["used_by_vault"] for m in rows)
            text = f"{len(rows)} model{'s' if len(rows) != 1 else ''} downloaded on this computer." + (
                "" if active else f" The model VAULT is set to use, {eff.ollama_model}, is not one of them."
            )
        yield self._event("answer", kind="models", command=cmd.model_dump(), text=text, models=rows)

    def _open(self, cmd, source, model, plan_ms) -> Iterator[dict]:
        def navigate(c, progress):
            page = cmd.page if cmd.page in PAGE_NAMES else None
            if page is None:
                raise HelperFailed("That page does not exist.")
            return f"{PAGE_NAMES[page]} ({page})", {"shown": {"route": page, "name": PAGE_NAMES[page]}}

        steps = [[Step("navigator", "the message asks to open a page", navigate)]]
        yield self._plan(cmd, source, model, plan_ms, steps, "A page to open.")
        results: dict = {}
        yield from self._run(steps[0], results)
        route = cmd.page if "navigator" in results else None
        name = PAGE_NAMES.get(route or "", "")
        yield self._event(
            "answer",
            kind="open",
            command=cmd.model_dump(),
            text=f"Open {name}." if route else "There is no page by that name.",
            route=route,
        )
