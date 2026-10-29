"use client";

import { useState } from "react";
import { errorText, vault, type ProviderName, type SharePlan, type ShareCriteria } from "@/lib/api";
import { Button, cx, Field, inputClass, Notice, Panel } from "./ui";

const REDACT: { id: ShareCriteria["redact"][number]; label: string }[] = [
  { id: "emails", label: "Email addresses" },
  { id: "phone_numbers", label: "Phone numbers" },
  { id: "id_numbers", label: "ID numbers (SSN)" },
  { id: "people_and_companies", label: "People and company names" },
  { id: "money", label: "Prices and amounts" },
];
const LABEL: Record<string, string> = {
  emails: "email",
  phone_numbers: "phone",
  id_numbers: "ID",
  people_and_companies: "name",
  money: "amount",
  terms: "custom",
};

/** F08.6: describe what to share in plain words; VAULT plans a redacted pack an admin approves. */
export function SharePanel({ collectionId, suggester, onPlanned }: { collectionId: number; suggester: ProviderName; onPlanned: () => void }) {
  const [recipient, setRecipient] = useState("");
  const [instruction, setInstruction] = useState("");
  const [criteria, setCriteria] = useState<ShareCriteria>({
    projects: [],
    doc_types: [],
    include_confidential: false,
    redact: ["emails", "phone_numbers", "id_numbers"],
    terms: [],
  });
  const [terms, setTerms] = useState("");
  const [explanation, setExplanation] = useState<string | null>(null);
  const [busy, setBusy] = useState<"suggest" | "plan" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: ShareCriteria["redact"][number]) =>
    setCriteria((c) => ({ ...c, redact: c.redact.includes(id) ? c.redact.filter((r) => r !== id) : [...c.redact, id] }));

  return (
    <Panel title="Share with someone outside" className="self-start">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy("plan");
          setError(null);
          try {
            const list = terms.split(",").map((t) => t.trim()).filter(Boolean);
            await vault.planShare({ collection_id: collectionId, recipient, instruction, criteria: { ...criteria, terms: list } });
            onPlanned();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(null);
          }
        }}
      >
        <p className="text-sm text-muted">
          VAULT makes new, redacted copies for the recipient and a report of everything left out and why. Nothing is
          written until an administrator approves.
        </p>
        <Field label="Who is it for?" htmlFor="share-recipient">
          <input id="share-recipient" className={inputClass} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Buyer Co due diligence" maxLength={120} required />
        </Field>
        <Field label="What should they get? (plain words)" htmlFor="share-instruction">
          <textarea
            id="share-instruction"
            className={cx(inputClass, "min-h-16")}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder='Everything on project Alpha, but hide names, prices and "unit cost"'
            maxLength={500}
          />
        </Field>
        <Button
          type="button"
          disabled={instruction.trim().length < 3 || busy !== null}
          busy={busy === "suggest"}
          onClick={async () => {
            setBusy("suggest");
            setError(null);
            try {
              const r = await vault.interpretShare(collectionId, instruction, suggester);
              setCriteria(r.criteria);
              setTerms(r.criteria.terms.join(", "));
              setExplanation(`${r.explanation} (${r.by === "rules" ? "simple rules, not AI" : r.by})`);
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(null);
            }
          }}
        >
          Fill in the settings from my words
        </Button>
        {explanation && <p className="text-xs text-muted">{explanation}</p>}
        <p className="text-sm">
          {criteria.projects.length ? `Projects: ${criteria.projects.join(", ")}` : "All projects"} ·{" "}
          {criteria.doc_types.length ? `Types: ${criteria.doc_types.join(", ")}` : "all document types"}
        </p>
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 text-[13px] font-medium">Black out</legend>
          {REDACT.map((r) => (
            <label key={r.id} className="flex items-center gap-2">
              <input type="checkbox" checked={criteria.redact.includes(r.id)} onChange={() => toggle(r.id)} />
              {r.label}
            </label>
          ))}
        </fieldset>
        <Field label="Also black out these words (comma separated)" htmlFor="share-terms">
          <input id="share-terms" className={inputClass} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="unit cost, Plant 4" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={criteria.include_confidential}
            onChange={(e) => setCriteria((c) => ({ ...c, include_confidential: e.target.checked }))}
          />
          Include documents marked CONFIDENTIAL
        </label>
        <p className="text-xs text-muted">Documents marked RESTRICTED, EXPORT-CONTROLLED, CUI or NUCLEAR are never shared.</p>
        <Button type="submit" variant="primary" busy={busy === "plan"} disabled={!recipient.trim() || busy !== null}>
          Plan the share pack
        </Button>
        {error && <Notice>{error}</Notice>}
      </form>
    </Panel>
  );
}

/** The plan inside a share-pack proposal: what goes, what stays out and why, and what gets blacked out. */
export function SharePlanView({ plan }: { plan: SharePlan }) {
  const shared = plan.items.filter((i) => i.action === "shared");
  const out = plan.items.filter((i) => i.action !== "shared");
  return (
    <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
      <div className="rounded-control border border-line p-3">
        <p className="mb-2 font-medium">
          Shared: {shared.length} · blacked out: {plan.summary.redactions}
        </p>
        <ul className="flex max-h-64 flex-col gap-1 overflow-auto">
          {shared.map((i) => {
            const red = Object.entries(i.redactions ?? {}).map(([k, v]) => `${v} ${LABEL[k] ?? k}`).join(", ");
            return (
              <li key={i.document_id}>
                {i.filename}
                <span className="text-muted"> {red ? `· ${red}` : "· nothing to black out"}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="rounded-control border border-line p-3">
        <p className="mb-2 font-medium">Left out: {out.length}</p>
        <ul className="flex max-h-64 flex-col gap-1 overflow-auto">
          {out.map((i) => (
            <li key={i.document_id}>
              {i.filename}
              <span className="text-muted"> · {i.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
