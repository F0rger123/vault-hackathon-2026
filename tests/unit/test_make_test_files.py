"""F11.6: the fictional drag-in test set is reproducible and covers every kind of file."""

import json

from backend.ingest.service import extract_pages
from backend.security.files import FileRejected, validate_upload
from scripts.make_test_files import KIND_SHARES, generate


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

    planted = {c["type"] for c in first["conflicts"]}
    assert {"rating_conflict", "quantity_conflict", "material_conflict", "part_number_reused"} <= planted
    assert all(c["planted_in"] for c in first["conflicts"])
    assert any("prompt_injection" in e["planted"] for e in first["files"])

    other = generate(tmp_path / "c", count=20, seed=8, use_ffmpeg=False, large=False)
    assert other["files"] != first["files"]


def test_vault_accepts_documents_and_rejects_media(tmp_path):
    m = generate(tmp_path, count=20, seed=7, use_ffmpeg=False, large=False)
    for entry in m["files"]:
        if entry["kind"] == "edge_cases":
            continue
        data = (tmp_path / entry["file"]).read_bytes()
        name = entry["file"].rsplit("/", 1)[-1]
        if entry["kind"] in ("audio", "video"):
            try:
                validate_upload(name, data[:4096], len(data), 50 * 1024 * 1024)
            except FileRejected:
                continue
            raise AssertionError(f"{name} should be rejected")
        _, media_type = validate_upload(name, data[:4096], len(data), 50 * 1024 * 1024)
        assert extract_pages(data, media_type, 500)
