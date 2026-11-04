"""F10.24: view-only browsing of approval requests, discarding requests, and removing the copies VAULT wrote.

Originals are never deleted. Only files inside data/exports/proposal-N can go, and only an administrator may do it.
"""

import hashlib
import os

import pytest

from tests.conftest import auth

API = "/api/v1"
FILES = {
    "alpha-report.txt": b"INSPECTION REPORT - Project: Alpha - 2026-01-10\nPV-1001 tested at 300 psi.\n",
    "bravo-memo.txt": b"PROJECT MEMO - Project: Bravo - 2026-02-01\nSchedule for PV-2002.\n",
}


def _originals(settings) -> dict[str, str]:
    return {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in settings.originals_dir.rglob("*") if p.is_file()
    }


def _proposal(client, tokens) -> dict:
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "yard"}, headers=a).json()["id"]
    payload = [("files", (n, t)) for n, t in FILES.items()]
    assert client.post(f"{API}/collections/{cid}/documents", headers=a, files=payload).status_code == 200
    r = client.post(f"{API}/proposals", json={"collection_id": cid, "pattern": "{doc_type}/{year}"}, headers=a)
    assert r.status_code == 201, r.text
    return r.json()


def _approved(client, tokens) -> dict:
    prop = _proposal(client, tokens)
    r = client.post(f"{API}/proposals/{prop['id']}/approve", json={}, headers=auth(tokens["admin"]))
    assert r.status_code == 200, r.text
    return r.json()


def _audit(client, tokens, action: str) -> list[dict]:
    rows = client.get(f"{API}/audit?limit=200", headers=auth(tokens["admin"])).json()
    return [r for r in rows if r["action"] == action]


def test_viewer_browses_requests_but_cannot_decide_or_delete(client, tokens):
    prop = _proposal(client, tokens)
    v = auth(tokens["viewer"])
    listed = client.get(f"{API}/proposals", headers=v)
    assert listed.status_code == 200
    assert [p["id"] for p in listed.json()] == [prop["id"]]
    assert client.get(f"{API}/proposals/{prop['id']}", headers=v).json()["plan"]["items"]
    for who in ("viewer", "analyst"):
        h = auth(tokens[who])
        assert client.post(f"{API}/proposals/{prop['id']}/approve", json={}, headers=h).status_code == 403
        assert client.post(f"{API}/proposals/{prop['id']}/reject", json={}, headers=h).status_code == 403
        assert client.delete(f"{API}/proposals/{prop['id']}", headers=h).status_code == 403
        assert client.delete(f"{API}/proposals/{prop['id']}/copies", headers=h).status_code == 403
    assert client.get(f"{API}/proposals/{prop['id']}", headers=v).json()["status"] == "pending"


def test_admin_discards_a_pending_request(client, tokens, settings):
    prop = _proposal(client, tokens)
    before = _originals(settings)
    r = client.delete(f"{API}/proposals/{prop['id']}", headers=auth(tokens["admin"]))
    assert r.status_code == 200
    assert r.json() == {"deleted": prop["id"], "copies_removed": 0}
    assert client.get(f"{API}/proposals/{prop['id']}", headers=auth(tokens["admin"])).status_code == 404
    assert _originals(settings) == before
    entry = _audit(client, tokens, "proposal.delete")[0]
    assert entry["target"] == f"proposal:{prop['id']}" and entry["detail"]["status"] == "pending"


def test_removing_copies_leaves_originals_untouched(client, tokens, settings):
    prop = _approved(client, tokens)
    before = _originals(settings)
    folder = settings.exports_dir / f"proposal-{prop['id']}"
    written = [p for p in folder.rglob("*") if p.is_file()]
    assert len(written) == len(FILES)

    # One copy by its path inside the export folder.
    one = prop["result"]["items"][0]["target"]
    r = client.delete(f"{API}/proposals/{prop['id']}/copies", params={"target": one}, headers=auth(tokens["admin"]))
    assert r.status_code == 200, r.text
    assert r.json()["removed"] == 1
    assert not (folder / one).exists()
    assert [i.get("removed") for i in r.json()["proposal"]["result"]["items"]].count(True) == 1

    # Then the rest, with the request itself.
    r = client.delete(f"{API}/proposals/{prop['id']}", params={"copies": "true"}, headers=auth(tokens["admin"]))
    assert r.status_code == 200
    assert r.json()["copies_removed"] == len(FILES) - 1
    assert not folder.exists()
    assert _originals(settings) == before
    assert len(_originals(settings)) == len(FILES)
    assert _audit(client, tokens, "proposal.copies.delete")[0]["detail"] == {"removed": 1, "one": True}
    assert _audit(client, tokens, "proposal.delete")[0]["detail"]["copies_removed"] == len(FILES) - 1


@pytest.mark.parametrize(
    "target",
    ["../../originals", "../proposal-999/x.txt", "..\\..\\vault.db", "/etc/passwd", "C:/Windows/win.ini", "a/../../b"],
)
def test_path_traversal_is_refused(client, tokens, settings, target):
    prop = _approved(client, tokens)
    before = _originals(settings)
    r = client.delete(f"{API}/proposals/{prop['id']}/copies", params={"target": target}, headers=auth(tokens["admin"]))
    assert r.status_code in (400, 404), r.text
    assert settings.db_path.exists()
    assert _originals(settings) == before
    assert len([p for p in (settings.exports_dir / f"proposal-{prop['id']}").rglob("*") if p.is_file()]) == len(FILES)


def test_a_link_to_an_original_is_never_followed(client, tokens, settings):
    prop = _approved(client, tokens)
    folder = settings.exports_dir / f"proposal-{prop['id']}"
    original = next(p for p in settings.originals_dir.rglob("*") if p.is_file())
    try:
        os.symlink(original, folder / "sneaky.txt")
    except (OSError, NotImplementedError):
        pytest.skip("this system does not allow symbolic links")
    before = _originals(settings)
    for params in ({"target": "sneaky.txt"}, {}):
        r = client.delete(f"{API}/proposals/{prop['id']}/copies", params=params, headers=auth(tokens["admin"]))
        assert r.status_code == 400
    assert _originals(settings) == before
    assert _audit(client, tokens, "proposal.copies.delete")[0]["outcome"] == "denied"


def test_copies_can_only_be_removed_from_an_approved_request(client, tokens):
    prop = _proposal(client, tokens)
    r = client.delete(f"{API}/proposals/{prop['id']}/copies", headers=auth(tokens["admin"]))
    assert r.status_code == 409
    assert client.delete(f"{API}/proposals/9999", headers=auth(tokens["admin"])).status_code == 404
