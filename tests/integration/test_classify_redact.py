"""F09.23: Keeper's Classifier helper proposes labels and redactions, an admin approves, every read path obeys them."""

import hashlib
import json

from pypdf import PdfReader

from backend.security import classification as cls
from backend.storage.db import connect
from tests.conftest import auth, wait_job

API = "/api/v1"

# Fictional people, companies and numbers only.
FILES = {
    "alpha-contract.txt": (
        "SUPPLY AGREEMENT - Contract No ALP-C-9 - Project: Alpha - 2026-01-10\nBetween Acme Valves Ltd and Halvern Engineering.\n"
        "Contact: Jane Doe, jane.doe@acme.example or +1 555 010 2030. Unit price $12,400.00 for PV-1001.\n"
    ),
    "alpha-memo.txt": "PROJECT MEMO - Project: Alpha - 2026-02-01\nCONFIDENTIAL. Budget overrun on PV-1001.\n",
    "alpha-export.txt": "INSPECTION REPORT - Project: Alpha\nEXPORT-CONTROLLED design data for PV-1001 torque.\n",
    "bravo-report.txt": (
        "INSPECTION REPORT - Project: Bravo - 2026-03-03\nInspector: Omar Reyes (omar.reyes@bravo.example).\n"
        "PV-2002 tested at 300 psi. PASS.\n"
    ),
}
SECRETS = ("jane.doe@acme.example", "555 010 2030", "12,400", "omar.reyes@bravo.example", "Omar Reyes")


def _setup(client, tokens):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "labels"}, headers=a).json()["id"]
    payload = [("files", (n, t.encode())) for n, t in FILES.items()]
    assert client.post(f"{API}/collections/{cid}/documents", headers=a, files=payload).status_code == 200
    job = client.post(f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 2}, headers=a)
    assert wait_job(client, tokens["analyst"], job.json()["id"])["status"] == "completed"
    docs = client.get(f"{API}/documents", params={"collection_id": cid}, headers=auth(tokens["admin"])).json()
    return cid, {d["filename"]: d["id"] for d in docs}


def _stream(client, token, cid, message):
    body = {"message": message, "use_model": False}
    with client.stream("POST", f"{API}/collections/{cid}/agent", json=body, headers=auth(token)) as r:
        assert r.status_code == 200
        return [json.loads(line) for line in r.iter_lines() if line]


def _originals(settings) -> dict[str, str]:
    with connect(settings.db_path) as conn:
        rows = conn.execute("SELECT filename, sha256, stored_path FROM main.documents").fetchall()
    out = {}
    for r in rows:
        data = (settings.data_dir / r["stored_path"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == r["sha256"]
        out[r["filename"]] = r["sha256"]
    return out


def test_classify_and_redact_end_to_end(client, tokens, settings):
    cid, ids = _setup(client, tokens)
    admin, analyst, viewer = auth(tokens["admin"]), auth(tokens["analyst"]), auth(tokens["viewer"])
    before = _originals(settings)
    assert before == {n: hashlib.sha256(t.encode()).hexdigest() for n, t in FILES.items()}

    # Unlabelled documents count as internal, and the label is on every row.
    row = client.get(f"{API}/documents", params={"collection_id": cid}, headers=viewer).json()[0]
    assert row["classification"]["level"] == "internal" and row["classification"]["labelled"] is False

    # Viewers cannot ask for a scan; analysts can, and nothing is applied yet.
    assert client.post(f"{API}/collections/{cid}/classify", json={}, headers=viewer).status_code == 403
    prop = client.post(f"{API}/collections/{cid}/classify", json={}, headers=analyst)
    assert prop.status_code == 201, prop.text
    prop = prop.json()
    assert prop["kind"] == "classify_redact" and prop["status"] == "pending"
    items = {i["filename"]: i for i in prop["plan"]["items"]}
    assert items["alpha-export.txt"]["suggested"] == "restricted"
    assert items["alpha-memo.txt"]["suggested"] == "confidential"
    assert items["alpha-contract.txt"]["suggested"] == "confidential"
    assert items["bravo-report.txt"]["suggested"] == "internal"
    kinds = {r["kind"] for r in items["alpha-contract.txt"]["redactions"]}
    assert {"emails", "phone_numbers", "money", "people"} <= kinds
    assert {r["kind"] for r in items["bravo-report.txt"]["redactions"]} >= {"emails", "people"}
    plan_text = json.dumps(prop["plan"])
    assert not any(s in plan_text for s in SECRETS), "the plan must never repeat a hidden value"
    page = client.get(f"{API}/documents/{ids['bravo-report.txt']}/pages/1", headers=viewer).json()
    assert "omar.reyes@bravo.example" in page["text"] and page["redactions"] == []  # proposed is not applied

    # Only an administrator approves.
    assert client.post(f"{API}/proposals/{prop['id']}/approve", json={}, headers=analyst).status_code == 403
    done = client.post(f"{API}/proposals/{prop['id']}/approve", json={"note": "ok"}, headers=admin).json()
    assert done["status"] == "executed" and done["result"]["labelled"] == 4 and done["result"]["redactions"] >= 6

    # Viewers: restricted and confidential documents are gone from lists and refused when opened, without detail.
    names = {d["filename"] for d in client.get(f"{API}/documents", params={"collection_id": cid}, headers=viewer).json()}
    assert names == {"bravo-report.txt"}
    for path in ("", "/pages/1", "/original", "/screening"):
        r = client.get(f"{API}/documents/{ids['alpha-export.txt']}{path}", headers=viewer)
        assert r.status_code == 403 and "alpha-export" not in r.text and "EXPORT" not in r.text
    hits = client.get(f"{API}/search", params={"q": "PV-1001", "collection_id": cid}, headers=viewer).json()
    assert hits["count"] == 0
    hits = client.get(f"{API}/search", params={"q": "PV-1001", "collection_id": cid}, headers=analyst).json()
    assert {h["filename"] for h in hits["results"]} == {"alpha-contract.txt", "alpha-memo.txt"}

    # Redacted spans: viewers and analysts get the label in place of the value, everywhere.
    page = client.get(f"{API}/documents/{ids['bravo-report.txt']}/pages/1", headers=viewer).json()
    assert page["redacted"] and "[REDACTED email]" in page["text"] and "[REDACTED name]" in page["text"]
    assert "omar.reyes" not in page["text"] and "Omar Reyes" not in page["text"]
    for span in page["redactions"]:
        assert page["text"][span["start"] : span["end"]] == f"[REDACTED {span['label']}]"
    hits = client.get(f"{API}/search", params={"q": "inspector", "collection_id": cid}, headers=viewer).json()
    assert hits["count"] == 1 and "omar.reyes" not in json.dumps(hits) and "Omar Reyes" not in json.dumps(hits)
    doc = client.get(f"{API}/documents/{ids['bravo-report.txt']}", headers=viewer).json()
    assert not any(s in json.dumps(doc) for s in SECRETS)
    assert doc["can_open_original"] is False and all("hint" not in r for r in doc["redactions"])
    r = client.get(f"{API}/documents/{ids['bravo-report.txt']}/original", headers=viewer)
    assert r.status_code == 403 and "omar" not in r.text.lower()
    page = client.get(f"{API}/documents/{ids['alpha-contract.txt']}/pages/1", headers=analyst).json()
    assert "[REDACTED amount]" in page["text"] and "12,400" not in page["text"] and "PV-1001" in page["text"]
    assert client.get(f"{API}/documents/{ids['alpha-export.txt']}", headers=analyst).status_code == 403
    csv = client.get(f"{API}/collections/{cid}/records", params={"format": "csv"}, headers=viewer).text
    assert not any(s in csv for s in SECRETS) and "alpha-export" not in csv

    # Keeper's answers: the viewer's helpers never see restricted documents or redacted values.
    events = _stream(client, tokens["viewer"], cid, "What does the Bravo inspection report say about the inspector?")
    blob = json.dumps(events)
    assert not any(s in blob for s in SECRETS) and "alpha-export" not in blob
    assert events[-2]["type"] == "answer"
    events = _stream(client, tokens["viewer"], cid, "What is the torque for PV-1001?")
    assert "alpha-export" not in json.dumps(events) and "EXPORT-CONTROLLED" not in json.dumps(events)

    # Administrators see everything, with the spans marked, and may open the original.
    page = client.get(f"{API}/documents/{ids['alpha-contract.txt']}/pages/1", headers=admin).json()
    assert "12,400" in page["text"] and {s["status"] for s in page["redactions"]} == {"applied"}
    assert client.get(f"{API}/documents/{ids['alpha-export.txt']}/original", headers=admin).status_code == 200
    doc = client.get(f"{API}/documents/{ids['alpha-contract.txt']}", headers=admin).json()
    assert doc["classification"]["level"] == "confidential" and doc["classification"]["set_by"] == "agent"
    assert doc["classification"]["by_user"] == "admin" and all(r["hint"] for r in doc["redactions"])

    # Exports: restricted left out, redacted documents written as redacted copies, never the original.
    org = client.post(f"{API}/proposals", json={"collection_id": cid}, headers=analyst).json()
    done = client.post(f"{API}/proposals/{org['id']}/approve", json={}, headers=admin).json()
    by_name = {i["filename"]: i for i in done["result"]["items"]}
    assert by_name["alpha-export.txt"]["copied"] is False and "restricted" in by_name["alpha-export.txt"]["reason"]
    assert by_name["alpha-contract.txt"]["redacted"] and by_name["alpha-contract.txt"]["target"].endswith(".pdf")
    root = settings.data_dir / done["result"]["export_dir"]
    pdf = root / by_name["alpha-contract.txt"]["target"]
    text = "".join(pg.extract_text() for pg in PdfReader(pdf).pages)
    assert "[REDACTED email]" in text and not any(s in text for s in SECRETS)
    assert (root / by_name["alpha-memo.txt"]["target"]).read_bytes() == FILES["alpha-memo.txt"].encode()

    # Share packs honour the labels too.
    share = client.post(
        f"{API}/share-packs", json={"collection_id": cid, "recipient": "Buyer", "criteria": {}}, headers=analyst
    ).json()
    reasons = {i["filename"]: i.get("reason") for i in share["plan"]["items"]}
    assert reasons["alpha-export.txt"] == "Labelled restricted: never shared"
    assert reasons["alpha-contract.txt"] == "Labelled confidential"

    # Admin-only controls, audited: relabel and unredact.
    rid = next(r["id"] for r in doc["redactions"] if r["kind"] == "money")
    url = f"{API}/documents/{ids['alpha-contract.txt']}/redactions/{rid}/remove"
    assert client.post(url, headers=analyst).status_code == 403
    assert client.post(url, headers=admin).json() == {"id": rid, "status": "removed"}
    assert client.post(url, headers=admin).status_code == 409
    page = client.get(f"{API}/documents/{ids['alpha-contract.txt']}/pages/1", headers=analyst).json()
    assert "12,400" in page["text"] and "jane.doe" not in page["text"]
    label_url = f"{API}/documents/{ids['bravo-report.txt']}/classification"
    assert client.put(label_url, json={"level": "restricted"}, headers=analyst).status_code == 403
    assert client.put(label_url, json={"level": "top secret"}, headers=admin).status_code == 422
    assert client.put(label_url, json={"level": "restricted", "reason": "Site access"}, headers=admin).json()[
        "set_by"
    ] == "user"
    assert client.get(f"{API}/documents", params={"collection_id": cid}, headers=viewer).json() == []
    actions = {e["action"] for e in client.get(f"{API}/audit", headers=admin).json()}
    assert {"classification.propose", "classification.set", "redaction.remove", "proposal.approve"} <= actions
    denied = client.get(f"{API}/audit", params={"outcome": "denied"}, headers=admin).json()
    assert any(e["detail"].get("reason") == "classification" for e in denied)
    assert not any(s in json.dumps(denied) for s in SECRETS)

    # Through all of this, the stored originals never changed by a byte.
    assert _originals(settings) == before


def test_keeper_proposes_labels_from_chat(client, tokens):
    cid, ids = _setup(client, tokens)
    events = _stream(client, tokens["analyst"], cid, "mark the pricing contracts as confidential")
    plan = next(e for e in events if e["type"] == "plan")
    assert plan["command"]["kind"] == "classify" and plan["command"]["level"] == "confidential"
    assert plan["steps"] == [["finder"], ["classifier"]]
    answer = events[-2]
    assert answer["type"] == "answer" and answer["kind"] == "classify" and answer["route"] == "/approvals"
    pid = answer["proposal"]["proposal_id"]
    prop = client.get(f"{API}/proposals/{pid}", headers=auth(tokens["admin"])).json()
    assert prop["kind"] == "classify_redact" and prop["status"] == "pending"
    assert [i["filename"] for i in prop["plan"]["items"]] == ["alpha-contract.txt"]
    assert prop["plan"]["items"][0]["suggested"] == "confidential"
    # Keeper only proposed: nothing is labelled until an administrator approves.
    doc = client.get(f"{API}/documents/{ids['alpha-contract.txt']}", headers=auth(tokens["admin"])).json()
    assert doc["classification"]["labelled"] is False

    # A viewer may ask, but Keeper says only analysts and administrators can suggest labels.
    events = _stream(client, tokens["viewer"], cid, "mark the contracts as restricted")
    failed = [e for e in events if e["type"] == "helper" and e["status"] == "failed"]
    assert failed and "analysts and administrators" in failed[0]["detail"]
    assert events[-2]["proposal"] is None

    # Rejecting the proposal leaves nothing applied.
    client.post(f"{API}/proposals/{pid}/reject", json={}, headers=auth(tokens["admin"]))
    with connect(client.app.state.settings.db_path) as conn:
        statuses = {r[0] for r in conn.execute("SELECT status FROM main.redactions WHERE proposal_id = ?", (pid,))}
    assert statuses == {"rejected"}


def test_render_fails_closed_when_text_changed():
    span = {"start": 0, "end": 4, "kind": "emails", "value_sha": cls.value_sha("abcd")}
    assert cls.render("abcd efg", [span])[0] == "[REDACTED email] efg"
    assert cls.render("wxyz efg", [span]) == (cls.PAGE_CHANGED, [])
    assert cls.may_open("viewer", None) and not cls.may_open("viewer", "confidential")
    assert cls.may_open("analyst", "confidential") and not cls.may_open("analyst", "restricted")
    assert cls.may_open("admin", "restricted") and not cls.may_open("nobody", "internal")
