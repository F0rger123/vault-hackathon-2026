"""F11.8: photos, video and sound are stored with their details, found and sorted by them, and never read."""

import io
from datetime import datetime
from random import Random

from PIL import Image

from backend.storage.db import connect
from scripts.make_test_files import exif_bytes, mjpeg_avi, photo_jpeg_mov, silent_mp3, wav
from tests.conftest import auth, wait_job

API = "/api/v1"
JPEG = b"\xff\xd8\xff\xe0" + b"\0" * 40 + b"\xff\xd9"


def _photo(taken: datetime, color: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (120, 80), (color, 90, 60)).save(buf, "JPEG", exif=exif_bytes(taken, ("FictionCam", "FC-2")))
    return buf.getvalue()


def _files() -> dict[str, bytes]:
    rng = Random(3)
    return {
        "ALP-site-2023.jpg": _photo(datetime(2023, 6, 1, 9, 0), 10),
        "ALP-site-2024-early.jpg": _photo(datetime(2024, 2, 3, 9, 0), 20),
        "ALP-site-2024-late.jpg": _photo(datetime(2024, 11, 20, 16, 30), 30),
        "gauge-short.mov": photo_jpeg_mov([JPEG] * 20, 320, 240, 10, datetime(2024, 4, 1)),
        "gauge-long.avi": mjpeg_avi([JPEG] * 70, 640, 480, 10),
        "voice-memo-short.wav": wav(rng, [(440, 1.0, 0.3)], 0.0),
        "voice-memo-long.wav": wav(rng, [(440, 3.0, 0.3)], 0.0),
        "site-walk.mp3": silent_mp3(2),
        "valve-notes.txt": b"Project: Alpha\nPV-1001 gate valve rated 600 psi, hydrostatic test PASS.\n",
    }


def _upload(client, a, cid, files):
    r = client.post(f"{API}/collections/{cid}/documents", headers=a, files=[("files", kv) for kv in files.items()])
    assert r.status_code == 200, r.text
    return r.json()


def _job(client, tokens, cid):
    body = {"collection_id": cid, "provider": "heuristic", "workers": 2, "only_new": True}
    job = client.post(f"{API}/jobs", json=body, headers=auth(tokens["analyst"])).json()
    return wait_job(client, tokens["analyst"], job["id"])


def say(client, token, cid, message, previous=None):
    r = client.post(
        f"{API}/collections/{cid}/chat",
        json={"message": message, "previous": previous, "use_model": False},
        headers=auth(token),
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_media_upload_find_sort_and_never_read(client, tokens, settings):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "media"}, headers=a).json()["id"]
    up = _upload(client, a, cid, _files())
    assert not up["rejected"], up["rejected"]
    types = {d["filename"]: d["media_type"] for d in up["accepted"]}
    assert types["gauge-short.mov"] == "video/quicktime" and types["gauge-long.avi"] == "video/x-msvideo"
    assert types["voice-memo-long.wav"] == "audio/wav" and types["site-walk.mp3"] == "audio/mpeg"

    # Wrong bytes for the name are refused, with a reason, and nothing is stored.
    bad = _upload(
        client,
        a,
        cid,
        {"fake.mp4": b"just text\n", "sound.mp4": _files()["voice-memo-short.wav"], "prog.mov": b"MZ\x90\0" * 50},
    )
    assert not bad["accepted"] and len(bad["rejected"]) == 3
    assert "does not match detected type" in bad["rejected"][0]["reason"]

    # Details are stored with the document and shown on it.
    ids = {d["filename"]: d["document_id"] for d in up["accepted"]}
    mov = client.get(f"{API}/documents/{ids['gauge-short.mov']}", headers=a).json()
    assert mov["kind"] == "video"
    assert mov["media_info"] == {
        "kind": "video",
        "format": "mov",
        "duration_s": 2.0,
        "width": 320,
        "height": 240,
        "taken": "2024-04-01T00:00:00",
    }
    photo = client.get(f"{API}/documents/{ids['ALP-site-2024-late.jpg']}", headers=a).json()
    assert photo["media_info"]["taken"] == "2024-11-20T16:30:00" and photo["media_info"]["camera"] == "FictionCam FC-2"
    rows = client.get(f"{API}/documents", params={"collection_id": cid}, headers=a).json()
    assert {r["kind"] for r in rows} == {"photo", "video", "audio", "document"}

    # Reading: media are recorded as not read, by no model; only the text file goes to the reader.
    first = _job(client, tokens, cid)
    assert first["status"] == "completed" and first["total"] == 9
    with connect(settings.db_path) as conn:
        got = {
            r["filename"]: (r["provider"], r["model"], r["doc_date"])
            for r in conn.execute(
                "SELECT d.filename, x.provider, x.model, x.doc_date FROM documents d "
                "JOIN extractions x ON x.document_id = d.id WHERE d.collection_id = ?",
                (cid,),
            )
        }
    assert got["gauge-long.avi"] == ("none", "not read: video", None)
    assert got["voice-memo-long.wav"] == ("none", "not read: audio", None)
    assert got["ALP-site-2023.jpg"] == ("none", "not read: photo", "2023-06-01")
    assert got["valve-notes.txt"][0] == "heuristic"
    # Nothing new to read: no media file is queued again, even with a newer rule version.
    again = _job(client, tokens, cid)
    assert again["total"] == 0 and again["params"]["skipped_already_read"] == 9

    def hits(**params):
        r = client.get(f"{API}/search", params={"collection_id": cid, "limit": 50, **params}, headers=a)
        assert r.status_code == 200, r.text
        return r.json()

    videos = hits(media="video", sort="duration")["results"]
    assert [v["filename"] for v in videos] == ["gauge-long.avi", "gauge-short.mov"]
    assert videos[0]["kind"] == "video" and videos[0]["media_info"]["duration_s"] == 7.0
    shortest = hits(media="audio", sort="duration", order="asc")["results"]
    assert [x["filename"] for x in shortest] == ["voice-memo-short.wav", "site-walk.mp3", "voice-memo-long.wav"]
    photos = hits(media="photo", year="2024", sort="date")["results"]
    assert [p["filename"] for p in photos] == ["ALP-site-2024-late.jpg", "ALP-site-2024-early.jpg"]
    assert [d["filename"] for d in hits(media="document")["results"]] == ["valve-notes.txt"]
    assert hits(sort="size")["results"][0]["filename"] == "voice-memo-long.wav"
    # A word search over media says plainly what it can and cannot find.
    named = hits(q="gauge", media="video")
    assert named["count"] == 2 and "not by what is in them" in named["note"]
    assert "note" not in hits(q="valve")
    assert client.get(f"{API}/search", params={"media": "movies"}, headers=a).status_code == 422
    assert client.get(f"{API}/search", params={"sort": "rank; DROP"}, headers=a).status_code == 422

    # The chat box understands the everyday words.
    t = tokens["analyst"]
    r = say(client, t, cid, "find videos")
    assert r["command"]["media"] == "video" and r["count"] == 2 and r["reply"].startswith("2 videos")
    r = say(client, t, cid, "photos from 2024 sorted by date")
    assert r["command"]["media"] == "photo" and r["command"]["year"] == "2024" and r["command"]["sort"] == "date"
    assert [x["filename"] for x in r["results"]] == ["ALP-site-2024-late.jpg", "ALP-site-2024-early.jpg"]
    r = say(client, t, cid, "longest audio first")
    assert (r["command"]["media"], r["command"]["sort"], r["command"]["order"]) == ("audio", "duration", "desc")
    assert r["results"][0]["filename"] == "voice-memo-long.wav" and "longest first" in r["reply"]
    r = say(client, t, cid, "show me pictures")
    assert r["command"]["media"] == "photo" and r["count"] == 3 and r["reply"].startswith("3 photos")
    r = say(client, t, cid, "find voice memos")
    assert r["command"]["media"] == "audio" and r["command"]["doc_type"] is None and r["count"] == 3
    r = say(client, t, cid, "shortest first", previous=r["command"])
    assert r["results"][0]["filename"] == "voice-memo-short.wav"
    r = say(client, t, cid, "biggest videos")
    assert r["command"]["sort"] == "size" and r["results"][0]["filename"] == "gauge-long.avi"
