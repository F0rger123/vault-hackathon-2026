"""F09.19 audit: the Overview's counts can be limited to one collection, so others never mix in."""

from tests.conftest import auth

API = "/api/v1"


def test_stats_for_one_collection(client, tokens):
    a = auth(tokens["analyst"])
    one = client.post(f"{API}/collections", json={"name": "one"}, headers=a).json()["id"]
    two = client.post(f"{API}/collections", json={"name": "two"}, headers=a).json()["id"]
    client.post(f"{API}/collections/{one}/documents", headers=a, files=[("files", ("a.txt", b"alpha valve 300 psi"))])
    client.post(
        f"{API}/collections/{two}/documents",
        headers=a,
        files=[("files", ("b.txt", b"beta pump")), ("files", ("c.txt", b"gamma pipe"))],
    )
    everything = client.get(f"{API}/stats", headers=a).json()
    first = client.get(f"{API}/stats", params={"collection_id": one}, headers=a).json()
    second = client.get(f"{API}/stats", params={"collection_id": two}, headers=a).json()
    assert everything["documents"] == 3 and first["documents"] == 1 and second["documents"] == 2
    assert first["pages"] == 1 and second["pages"] == 2
    assert first["collections"] == everything["collections"]
