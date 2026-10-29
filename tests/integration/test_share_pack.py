"""F08.6: share packs carry clean redacted copies of chosen documents and say what was left out and why."""

import json

from pypdf import PdfReader

from backend.workers.share_pack import clean_criteria, redact
from tests.conftest import auth, wait_job

API = "/api/v1"

FILES = {
    "alpha-contract.txt": (
        "CONTRACT - Project: Alpha - 2026-01-10\nBetween Acme Valves Ltd and Halvern Engineering.\n"
        "Contact jane.doe@acme.example or +1 555 010 2030. Unit price $12,400.00 for PV-1001.\n"
    ),
    "alpha-memo.txt": "PROJECT MEMO - Project: Alpha - 2026-02-01\nCONFIDENTIAL. Budget overrun on PV-1001.\n",
    "alpha-export.txt": "INSPECTION REPORT - Project: Alpha\nEXPORT-CONTROLLED design data for PV-1001.\n",
    "bravo-report.txt": "INSPECTION REPORT - Project: Bravo - 2026-03-03\nPV-2002 tested at 300 psi. PASS.\n",
}


def _collection(client, tokens):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "deal"}, headers=a).json()["id"]
    payload = [("files", (n, t.encode())) for n, t in FILES.items()]
    assert client.post(f"{API}/collections/{cid}/documents", headers=a, files=payload).status_code == 200
    job = client.post(f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 2}, headers=a)
    assert wait_job(client, tokens["analyst"], job.json()["id"])["status"] == "completed"
    return cid


def test_share_pack_plans_redacts_and_reports(client, tokens, settings):
    cid = _collection(client, tokens)
    a, admin = auth(tokens["analyst"]), auth(tokens["admin"])
    body = {
        "collection_id": cid,
        "recipient": "Buyer Co due diligence",
        "criteria": {
            "projects": ["alpha"],
            "redact": ["emails", "phone_numbers", "money", "terms"],
            "terms": ["Acme Valves Ltd"],
        },
    }
    prop = client.post(f"{API}/share-packs", json=body, headers=a)
    assert prop.status_code == 201, prop.text
    prop = prop.json()
    assert prop["kind"] == "share_pack" and prop["status"] == "pending"
    by_name = {i["filename"]: i for i in prop["plan"]["items"]}
    assert by_name["alpha-contract.txt"]["action"] == "shared"
    assert by_name["alpha-contract.txt"]["redactions"] == {"emails": 1, "phone_numbers": 1, "money": 1, "terms": 1}
    assert by_name["alpha-memo.txt"] == {
        **by_name["alpha-memo.txt"],
        "action": "left_out",
        "reason": "Marked CONFIDENTIAL",
    }
    assert "EXPORT-CONTROLLED" in by_name["alpha-export.txt"]["reason"]
    assert by_name["bravo-report.txt"]["reason"] == "Not in the projects you chose"

    # Nothing is written until an administrator approves.
    assert not (settings.exports_dir / f"share-{prop['id']}").exists()
    assert client.post(f"{API}/proposals/{prop['id']}/approve", json={"note": ""}, headers=a).status_code == 403
    done = client.post(f"{API}/proposals/{prop['id']}/approve", json={"note": "ok"}, headers=admin).json()
    assert done["status"] == "executed" and done["result"]["copied"] == 1 and done["result"]["left_out"] == 3

    root = settings.data_dir / done["result"]["export_dir"]
    pdfs = list((root / "documents").glob("*.pdf"))
    assert [p.name for p in pdfs] == ["alpha-contract.pdf"]
    text = "".join(page.extract_text() for page in PdfReader(pdfs[0]).pages)
    for secret in ("jane.doe@acme.example", "555 010 2030", "12,400", "Acme Valves Ltd"):
        assert secret not in text
    assert "[REDACTED email]" in text and "PV-1001" in text
    meta = PdfReader(pdfs[0]).metadata
    assert meta.author == "VAULT share pack"

    report = json.loads((root / "share-report.json").read_text())
    assert report["shared"] == 1 and report["left_out"] == 3
    assert "jane.doe" not in (root / "share-report.json").read_text()
    md = (root / "SHARE-REPORT.md").read_text()
    assert "Left out, and why" in md and "Marked CONFIDENTIAL" in md
    # The originals were not copied anywhere in the pack.
    assert not list(root.rglob("*.txt"))


def test_confidential_only_when_asked_and_restricted_never(client, tokens):
    cid = _collection(client, tokens)
    a = auth(tokens["analyst"])
    body = {"collection_id": cid, "recipient": "Auditor", "criteria": {"include_confidential": True}}
    items = {i["filename"]: i for i in client.post(f"{API}/share-packs", json=body, headers=a).json()["plan"]["items"]}
    assert items["alpha-memo.txt"]["action"] == "shared"
    assert items["alpha-export.txt"]["action"] == "left_out"


def test_share_permissions_and_plain_words(client, tokens):
    cid = _collection(client, tokens)
    viewer = auth(tokens["viewer"])
    assert (
        client.post(f"{API}/share-packs", json={"collection_id": cid, "recipient": "x"}, headers=viewer).status_code
        == 403
    )
    assert client.post(f"{API}/share-packs", json={"collection_id": cid, "recipient": "x"}).status_code == 401
    assert (
        client.post(
            f"{API}/share-packs", json={"collection_id": 999, "recipient": "x"}, headers=auth(tokens["analyst"])
        ).status_code
        == 404
    )
    r = client.post(
        f"{API}/share-packs/interpret",
        json={
            "collection_id": cid,
            "instruction": 'Share project Alpha with the buyer, hide names, prices and "PV-1001"',
        },
        headers=auth(tokens["analyst"]),
    ).json()
    c = r["criteria"]
    assert r["by"] == "rules" and [p.casefold() for p in c["projects"]] == ["alpha"]
    assert {"people_and_companies", "money", "terms"} <= set(c["redact"]) and c["terms"] == ["PV-1001"]
    assert c["include_confidential"] is False


def test_redaction_and_criteria_cleaning():
    c = clean_criteria({"redact": ["emails", "rm -rf", "money"], "terms": ["x", "Secret Plant"], "evil": True})
    assert c["redact"] == ["emails", "money", "terms"] and c["terms"] == ["Secret Plant"] and "evil" not in c
    text, counts = redact("Mail a@b.co, price €900.00 at the Secret Plant, on 2026-01-10, part PV-1001", c, [])
    assert counts == {"emails": 1, "money": 1, "terms": 1}
    assert "2026-01-10" in text and "PV-1001" in text, "dates and part numbers are not phone numbers"
