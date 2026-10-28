"""F08.4: POST /proposals/interpret suggests a pattern, enforces permissions and the remote gate."""

from tests.conftest import auth

URL = "/api/v1/proposals/interpret"


def test_interpret_suggests_pattern_and_audits_without_the_instruction(client, tokens):
    body = {"instruction": "Group by year, then project", "provider": "heuristic"}
    r = client.post(URL, json=body, headers=auth(tokens["analyst"]))
    assert r.status_code == 200, r.text
    assert r.json()["pattern"] == "{year}/{project}" and r.json()["is_ai_model"] is False
    log = client.get("/api/v1/audit", headers=auth(tokens["admin"])).json()
    entry = next(e for e in log if e["action"] == "proposal.interpret")
    assert "Group by year" not in str(entry)


def test_interpret_denials(client, tokens):
    body = {"instruction": "Group by year", "provider": "heuristic"}
    assert client.post(URL, json=body).status_code == 401
    assert client.post(URL, json=body, headers=auth(tokens["viewer"])).status_code == 403
    remote = {**body, "provider": "meta_api", "confirm_remote": True}
    assert client.post(URL, json=remote, headers=auth(tokens["analyst"])).status_code == 403
    assert client.post(URL, json={"instruction": "x"}, headers=auth(tokens["analyst"])).status_code == 422
