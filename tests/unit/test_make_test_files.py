"""F11.6 / F11.8: the fictional drag-in test set is reproducible, covers every kind of file, and VAULT agrees with
the manifest about each one: read, stored with details, refused or held."""

import json

from backend.ingest.media import is_media, probe
from backend.ingest.service import extract_pages
from backend.security.active_content import detect
from backend.security.files import FileRejected, validate_upload
from scripts.make_test_files import DEMO_AT_LEAST, KIND_SHARES, OUTCOMES, SIZES, generate

LIMIT = 50 * 1024 * 1024


def test_same_seed_same_manifest_and_every_kind(tmp_path):
    first = generate(tmp_path / "a", count=20, seed=7, use_ffmpeg=False, large=False)
    second = generate(tmp_path / "b", count=20, seed=7, use_ffmpeg=False, large=False)
    assert first == second
    assert json.loads((tmp_path / "a" / "manifest.json").read_text("utf-8")) == first
    assert (tmp_path / "a" / "README.txt").read_text("utf-8").startswith("VAULT FICTIONAL TEST FILES")

    assert set(first["kinds"]) == set(KIND_SHARES) | {"edge_cases"}
    assert all(n >= 1 for n in first["kinds"].values())
    assert first["files_total"] == len(first["files"])
    for entry in first["files"]:
        assert (tmp_path / "a" / entry["file"]).exists()
        assert entry["outcome"] in OUTCOMES
    assert sum(first["outcomes"].values()) == first["files_total"]

    planted = {c["type"] for c in first["conflicts"]}
    assert {"rating_conflict", "quantity_conflict", "material_conflict", "part_number_reused"} <= planted
    assert all(c["planted_in"] for c in first["conflicts"])
    assert any("prompt_injection" in e["planted"] for e in first["files"])

    other = generate(tmp_path / "c", count=20, seed=8, use_ffmpeg=False, large=False)
    assert other["files"] != first["files"]


def test_vault_agrees_with_every_expected_outcome(tmp_path):
    m = generate(tmp_path, count=20, seed=7, use_ffmpeg=False, large=False)
    seen = set()
    for entry in m["files"]:
        data = (tmp_path / entry["file"]).read_bytes()
        name = entry["file"].rsplit("/", 1)[-1]
        try:
            _, media_type = validate_upload(name, data[:4096], len(data), LIMIT)
            if is_media(media_type):
                got, outcome = probe(data, media_type), "stored-with-metadata"
            else:
                pages = extract_pages(data, media_type, 500)
                got, outcome = None, "held" if detect(data, media_type) else "read"
                assert pages
        except FileRejected:
            got, outcome = None, "refused"
        if entry["outcome"] == "refused" and outcome != "refused":
            # Some refusals happen in the Office reader at upload (macros, no document body), not in these checks.
            assert entry["format"] in ("docx",), entry["file"]
            continue
        assert outcome == entry["outcome"], entry["file"]
        seen.add(outcome)
        # The details VAULT reads match what the generator wrote into the file.
        for key, want in entry["media"].items():
            if isinstance(want, float):
                assert abs(got[key] - want) < 0.05, (entry["file"], key)
            else:
                assert got[key] == want, (entry["file"], key)
    assert seen == set(OUTCOMES)


def test_demo_size_is_small_and_has_plenty_of_media(tmp_path):
    m = generate(tmp_path, count=SIZES["demo"]["count"], seed=7, use_ffmpeg=False, large=False, size="demo")
    assert m["size"] == "demo"
    assert 100 <= m["files_total"] <= 140
    assert m["bytes_total"] < 60 * 1024 * 1024
    for kind, at_least in DEMO_AT_LEAST.items():
        assert m["kinds"][kind] >= at_least
    stamped = [e for e in m["files"] if e["kind"] == "pdf_stamped"]
    words = {w for e in stamped for w in ("APPROVED", "QC PASSED", "REJECTED") if w in e["contains"]}
    assert words == {"APPROVED", "QC PASSED", "REJECTED"}
    text = extract_pages((tmp_path / stamped[0]["file"]).read_bytes(), "application/pdf", 10)[0]
    assert "APPROVED" in text  # the seal is real text, so VAULT reads it
    years = {e["media"]["taken"][:4] for e in m["files"] if e["kind"] == "photos_site"}
    assert {"2023", "2024", "2025"} <= years
