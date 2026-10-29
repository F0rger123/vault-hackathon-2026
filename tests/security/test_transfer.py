"""F12.11: an encrypted pack moves a whole VAULT to another computer, and refuses anything tampered with."""

import io
import json
import sqlite3
import struct
import tarfile
from contextlib import closing

import pytest

from backend.core import transfer
from backend.core.transfer import TransferError, export_pack, import_pack
from backend.ingest.service import ensure_collection, ingest_bytes
from backend.storage.db import connect, migrate

PASS = "correct horse battery staple"


@pytest.fixture
def source(settings, monkeypatch):
    # Cheaper scrypt for tests only; the real setting is checked in its own test below.
    monkeypatch.setattr(transfer, "SCRYPT", {"n": 2**12, "r": 8, "p": 1})
    migrate(settings.db_path)
    with connect(settings.db_path) as conn:
        cid = ensure_collection(conn, "nuclear", None)
        for i in range(3):
            ingest_bytes(conn, settings, cid, f"doc{i}.txt", f"Valve ZV-100{i} rated {150 + i} psi".encode())
        conn.execute(
            "INSERT INTO knowledge (collection_id, kind, term, text, created_at) VALUES (?, 'meaning', 'QA-7', 'ok', 1)",
            (cid,),
        )
    secrets_dir = settings.data_dir / "secrets"
    secrets_dir.mkdir()
    (secrets_dir / "meta_api_key").write_text("LLM_test_not_real")
    return settings


def test_round_trip_restores_everything_into_an_empty_folder(source, tmp_path):
    pack = tmp_path / "move.vaultpack"
    summary = export_pack(source.data_dir, pack, PASS)
    assert summary == {**summary, "originals": 3, "includes_api_key": False}
    raw = pack.read_bytes()
    assert b"ZV-1001" not in raw and b"QA-7" not in raw, "contents must be encrypted"

    target = tmp_path / "new-computer"
    assert import_pack(pack, PASS, target)["originals"] == 3
    assert not (target / "secrets").exists(), "the API key stays behind unless asked for"
    with closing(sqlite3.connect(target / "vault.db")) as db:
        assert db.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 3
        assert db.execute("SELECT term FROM knowledge").fetchone()[0] == "QA-7"
    originals = sorted(p for p in (target / "originals").rglob("*") if p.is_file())
    assert len(originals) == 3 and all(oct(p.stat().st_mode)[-3:-1] != "66" for p in originals)
    assert not target.with_name("new-computer.importing").exists()


def test_api_key_travels_only_when_asked(source, tmp_path):
    pack = tmp_path / "with-key.vaultpack"
    assert export_pack(source.data_dir, pack, PASS, include_secrets=True)["includes_api_key"] is True
    import_pack(pack, PASS, tmp_path / "t")
    assert (tmp_path / "t" / "secrets" / "meta_api_key").read_text() == "LLM_test_not_real"


def test_wrong_passphrase_and_tampering_are_refused_and_leave_nothing(source, tmp_path):
    pack = tmp_path / "p.vaultpack"
    export_pack(source.data_dir, pack, PASS)
    with pytest.raises(TransferError, match="wrong passphrase"):
        import_pack(pack, "not the passphrase!", tmp_path / "a")
    assert not (tmp_path / "a").exists() or not any((tmp_path / "a").iterdir())
    assert not (tmp_path / "a.importing").exists()

    data = bytearray(pack.read_bytes())
    data[-40] ^= 1  # flip one bit inside the last encrypted chunk
    flipped = tmp_path / "flipped.vaultpack"
    flipped.write_bytes(bytes(data))
    with pytest.raises(TransferError):
        import_pack(flipped, PASS, tmp_path / "b")

    cut = tmp_path / "cut.vaultpack"
    cut.write_bytes(pack.read_bytes()[:-100])
    with pytest.raises(TransferError):
        import_pack(cut, PASS, tmp_path / "c")

    with pytest.raises(TransferError, match="not a VAULT"):
        bad = tmp_path / "bad.vaultpack"
        bad.write_bytes(b"PK\x03\x04 not a pack")
        import_pack(bad, PASS, tmp_path / "d")


def test_never_overwrites_existing_data(source, tmp_path):
    pack = tmp_path / "p.vaultpack"
    export_pack(source.data_dir, pack, PASS)
    busy = tmp_path / "busy"
    busy.mkdir()
    (busy / "vault.db").write_text("someone's data")
    with pytest.raises(TransferError, match="not empty"):
        import_pack(pack, PASS, busy)
    assert (busy / "vault.db").read_text() == "someone's data"


def test_short_passphrase_refused(source, tmp_path):
    with pytest.raises(TransferError, match="at least 12"):
        export_pack(source.data_dir, tmp_path / "x", "short")


def _evil_pack(tmp_path, entries: dict[str, bytes], manifest: dict | None = None):
    """A correctly encrypted pack with hand-made contents, as an attacker who knows the passphrase could build."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        m = json.dumps(manifest or {"files": {}}).encode()
        info = tarfile.TarInfo("manifest.json")
        info.size = len(m)
        tar.addfile(info, io.BytesIO(m))
        for name, body in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(body)
            tar.addfile(info, io.BytesIO(body))
    salt, prefix = b"s" * 16, b"p" * 8
    header = (
        transfer.MAGIC
        + json.dumps({"salt": salt.hex(), "nonce_prefix": prefix.hex(), "kdf": transfer.SCRYPT}).encode()
        + b"\n"
    )
    out = io.BytesIO()
    out.write(header)
    w = transfer._EncryptingWriter(out, transfer._key(PASS, salt, transfer.SCRYPT), prefix, header)
    w.write(buf.getvalue())
    w.finish()
    path = tmp_path / "evil.vaultpack"
    path.write_bytes(out.getvalue())
    return path


@pytest.mark.parametrize(
    "name", ["../escape.txt", "/etc/passwd", "originals/../../x", "C:\\x", "bin/run.exe", "originals/a/b/c"]
)
def test_entries_outside_the_expected_names_are_refused(source, tmp_path, name):
    pack = _evil_pack(tmp_path, {name: b"x"}, {"files": {name: {"sha256": "0", "size": 1}}})
    with pytest.raises(TransferError, match="unexpected entry"):
        import_pack(pack, PASS, tmp_path / "t")
    assert not (tmp_path / "escape.txt").exists()


def test_files_must_match_the_manifest(source, tmp_path):
    pack = _evil_pack(tmp_path, {"vault.db": b"tampered"}, {"files": {"vault.db": {"sha256": "0" * 64, "size": 8}}})
    with pytest.raises(TransferError, match="fingerprint"):
        import_pack(pack, PASS, tmp_path / "t")
    pack = _evil_pack(tmp_path, {}, {"files": {"vault.db": {"sha256": "0" * 64, "size": 8}}})
    with pytest.raises(TransferError, match="missing"):
        import_pack(pack, PASS, tmp_path / "u")


def test_header_cannot_demand_unsafe_key_settings(tmp_path):
    bad = tmp_path / "x.vaultpack"
    bad.write_bytes(
        transfer.MAGIC
        + json.dumps({"salt": "00" * 16, "nonce_prefix": "00" * 8, "kdf": {"n": 2**30, "r": 8, "p": 1}}).encode()
        + b"\n"
    )
    with pytest.raises(TransferError, match="unsafe"):
        import_pack(bad, PASS, tmp_path / "t")


def test_real_key_settings_are_strong():
    assert transfer.SCRYPT["n"] >= 2**17 and transfer.MIN_PASSPHRASE >= 12
    assert struct.calcsize(">I?") == 5
