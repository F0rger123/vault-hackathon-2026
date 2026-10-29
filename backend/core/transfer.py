"""Move a whole VAULT to another computer, encrypted end to end (F12.11).

A transfer pack holds everything that makes a VAULT itself: the database (collections, readings, findings, the brain,
rules, users, the audit log) and every original document. The Meta API key is left out unless asked for. Nothing
goes through a network or a third party: the pack is a file you carry, for example on an encrypted USB drive.

Format: a short plain header, then the payload encrypted in 1 MiB chunks with AES-256-GCM.
- The key comes from a passphrase through scrypt, so the pack is useless without it.
- Each chunk's nonce is a random prefix plus its number. Each chunk is bound to the header, its position, and whether
  it is the last one, so a chunk cannot be changed, dropped, reordered or cut off without the import refusing.
- The payload is a tar stream whose first entry is a manifest with every file's SHA-256. Import writes only plain
  files, only under the expected names, into an empty folder, and checks every hash before it reports success.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import secrets
import shutil
import sqlite3
import stat
import struct
import tarfile
import tempfile
import time
from contextlib import closing
from pathlib import Path, PurePosixPath

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.security.files import safe_join

MAGIC = b"VAULTPACK1\n"
CHUNK = 1024 * 1024
SCRYPT = {"n": 2**17, "r": 8, "p": 1}
MIN_PASSPHRASE = 12


class TransferError(ValueError):
    """A message that is safe to show: never a path, a key or document text."""


def _key(passphrase: str, salt: bytes, kdf: dict) -> bytes:
    return hashlib.scrypt(
        passphrase.encode("utf-8"), salt=salt, n=kdf["n"], r=kdf["r"], p=kdf["p"], maxmem=2**30, dklen=32
    )


class _EncryptingWriter(io.RawIOBase):
    """File-like sink that encrypts everything written to it, chunk by chunk."""

    def __init__(self, out, key: bytes, prefix: bytes, header: bytes):
        self.out, self.aead, self.prefix, self.header = out, AESGCM(key), prefix, header
        self.buf, self.counter = bytearray(), 0

    def writable(self) -> bool:
        return True

    def write(self, data) -> int:
        self.buf += data
        while len(self.buf) > CHUNK:
            self._emit(bytes(self.buf[:CHUNK]), last=False)
            del self.buf[:CHUNK]
        return len(data)

    def _emit(self, plain: bytes, last: bool) -> None:
        nonce = self.prefix + struct.pack(">I", self.counter)
        aad = self.header + struct.pack(">I?", self.counter, last)
        sealed = self.aead.encrypt(nonce, plain, aad)
        self.out.write(struct.pack(">I?", len(sealed), last) + sealed)
        self.counter += 1

    def finish(self) -> None:
        self._emit(bytes(self.buf), last=True)
        self.buf.clear()


def _decrypted_chunks(f, key: bytes, prefix: bytes, header: bytes):
    aead, counter = AESGCM(key), 0
    while True:
        head = f.read(5)
        if len(head) < 5:
            raise TransferError("the pack is cut off; copy it again")
        size, last = struct.unpack(">I?", head)
        if size > CHUNK + 64:
            raise TransferError("the pack is damaged")
        sealed = f.read(size)
        nonce = prefix + struct.pack(">I", counter)
        try:
            yield aead.decrypt(nonce, sealed, header + struct.pack(">I?", counter, last))
        except InvalidTag as exc:
            raise TransferError("wrong passphrase, or the pack was changed or damaged") from exc
        counter += 1
        if last:
            if f.read(1):
                raise TransferError("the pack has extra data after its end")
            return


class _ChunkReader(io.RawIOBase):
    def __init__(self, chunks):
        self.chunks, self.buf = chunks, b""

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:
        while not self.buf:
            try:
                self.buf = next(self.chunks)
            except StopIteration:
                return 0
        n = min(len(b), len(self.buf))
        b[:n], self.buf = self.buf[:n], self.buf[n:]
        return n


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def export_pack(data_dir: Path, out_path: Path, passphrase: str, include_secrets: bool = False) -> dict:
    """Write an encrypted pack of this VAULT. Returns the manifest summary (no secrets)."""
    if len(passphrase) < MIN_PASSPHRASE:
        raise TransferError(f"use a passphrase of at least {MIN_PASSPHRASE} characters")
    db = data_dir / "vault.db"
    if not db.is_file():
        raise TransferError("no VAULT database found in this data folder")
    with tempfile.TemporaryDirectory() as tmp:
        # SQLite's backup API takes a consistent copy even while VAULT is running.
        snap = Path(tmp) / "vault.db"
        # closing(): sqlite3's own context manager only commits; Windows cannot delete a file still open.
        with closing(sqlite3.connect(db)) as src, closing(sqlite3.connect(snap)) as dst:
            src.backup(dst)
        files: list[tuple[str, Path]] = [("vault.db", snap)]
        originals = data_dir / "originals"
        if originals.is_dir():
            files += [(p.relative_to(data_dir).as_posix(), p) for p in sorted(originals.rglob("*")) if p.is_file()]
        key_file = data_dir / "secrets" / "meta_api_key"
        if include_secrets and key_file.is_file():
            files.append(("secrets/meta_api_key", key_file))
        manifest = {
            "format": 1,
            "created_at": time.time(),
            "files": {name: {"sha256": _sha256(p), "size": p.stat().st_size} for name, p in files},
        }
        manifest_bytes = json.dumps(manifest, indent=1).encode()

        salt, prefix = secrets.token_bytes(16), secrets.token_bytes(8)
        header = MAGIC + json.dumps({"salt": salt.hex(), "nonce_prefix": prefix.hex(), "kdf": SCRYPT}).encode() + b"\n"
        key = _key(passphrase, salt, SCRYPT)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        partial = out_path.with_name(out_path.name + ".partial")
        with partial.open("wb") as out:
            out.write(header)
            writer = _EncryptingWriter(out, key, prefix, header)
            with tarfile.open(fileobj=writer, mode="w|", format=tarfile.PAX_FORMAT) as tar:
                info = tarfile.TarInfo("manifest.json")
                info.size, info.mtime = len(manifest_bytes), int(manifest["created_at"])
                tar.addfile(info, io.BytesIO(manifest_bytes))
                for name, path in files:
                    info = tarfile.TarInfo(name)
                    info.size, info.mtime, info.mode = path.stat().st_size, int(path.stat().st_mtime), 0o600
                    with path.open("rb") as f:
                        tar.addfile(info, f)
            writer.finish()
        os.replace(partial, out_path)
    return _summary(manifest, include_secrets)


def _summary(manifest: dict, include_secrets: bool) -> dict:
    names = manifest["files"]
    return {
        "files": len(names),
        "originals": sum(n.startswith("originals/") for n in names),
        "bytes": sum(v["size"] for v in names.values()),
        "includes_api_key": "secrets/meta_api_key" in names if include_secrets else False,
    }


def _read_header(f) -> tuple[bytes, dict]:
    if f.read(len(MAGIC)) != MAGIC:
        raise TransferError("this is not a VAULT transfer pack")
    line = f.readline(4096)
    try:
        meta = json.loads(line)
        kdf = {k: int(meta["kdf"][k]) for k in ("n", "r", "p")}
        salt, prefix = bytes.fromhex(meta["salt"]), bytes.fromhex(meta["nonce_prefix"])
    except (ValueError, KeyError, TypeError) as exc:
        raise TransferError("the pack header is damaged") from exc
    if kdf["n"] > 2**20 or kdf["r"] > 16 or kdf["p"] > 4 or len(salt) != 16 or len(prefix) != 8:
        raise TransferError("the pack header asks for unsafe settings")
    return MAGIC + line, {"kdf": kdf, "salt": salt, "prefix": prefix}


def _allowed(name: str) -> bool:
    p = PurePosixPath(name)
    if p.is_absolute() or ".." in p.parts or "\\" in name or not name:
        return False
    return name in ("vault.db", "manifest.json", "secrets/meta_api_key") or (
        name.startswith("originals/") and len(p.parts) == 3
    )


def import_pack(pack: Path, passphrase: str, target_dir: Path, verify_only: bool = False) -> dict:
    """Restore a pack into an empty folder (or only check it). Every file's hash must match the manifest.

    Files are written to a new folder beside the target and moved into place only after every check passes, so a
    wrong passphrase or a damaged pack never leaves a half-restored VAULT behind.
    """
    if verify_only:
        return _restore(pack, passphrase, None)
    if target_dir.exists() and any(target_dir.iterdir()):
        raise TransferError("the target folder is not empty; VAULT never overwrites existing data")
    staging = target_dir.with_name(target_dir.name + ".importing")
    if staging.exists():
        raise TransferError("an earlier import was interrupted; remove the .importing folder first")
    staging.mkdir(parents=True)
    try:
        summary = _restore(pack, passphrase, staging)
    except BaseException:
        shutil.rmtree(staging, onerror=_make_writable)  # onerror: Python 3.11 has no onexc
        raise
    if target_dir.exists():
        target_dir.rmdir()  # checked empty above
    os.replace(staging, target_dir)
    return summary


def _make_writable(func, path, _exc) -> None:
    # Restored originals are read-only; the staging folder is ours, so make them removable and retry.
    os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
    func(path)


def _restore(pack: Path, passphrase: str, target_dir: Path | None) -> dict:
    verify_only = target_dir is None
    with pack.open("rb") as f:
        header, meta = _read_header(f)
        key = _key(passphrase, meta["salt"], meta["kdf"])
        stream = io.BufferedReader(_ChunkReader(_decrypted_chunks(f, key, meta["prefix"], header)), CHUNK)
        manifest, seen = None, set()
        with tarfile.open(fileobj=stream, mode="r|") as tar:
            for member in tar:
                if not member.isfile() or not _allowed(member.name) or member.name in seen:
                    raise TransferError("the pack contains an unexpected entry")
                seen.add(member.name)
                src = tar.extractfile(member)
                if member.name == "manifest.json":
                    if manifest is not None or member.size > 64 * 1024 * 1024:
                        raise TransferError("the pack manifest is not valid")
                    manifest = json.loads(src.read())
                    continue
                if manifest is None:
                    raise TransferError("the pack manifest must come first")
                want = manifest["files"].get(member.name)
                if not want or want["size"] != member.size:
                    raise TransferError("the pack contains a file its manifest does not list")
                h = hashlib.sha256()
                out = None if verify_only else safe_join(target_dir, *member.name.split("/"))
                if out:
                    out.parent.mkdir(parents=True, exist_ok=True)
                with out.open("xb") if out else io.BytesIO() as dst:
                    while chunk := src.read(CHUNK):
                        h.update(chunk)
                        dst.write(chunk)
                if h.hexdigest() != want["sha256"]:
                    raise TransferError("a file in the pack does not match its fingerprint")
                if out and member.name.startswith("originals/"):
                    out.chmod(stat.S_IREAD | stat.S_IRGRP | stat.S_IROTH)
                if out and member.name.startswith("secrets/"):
                    out.chmod(0o600)
            # Read to the very end, so a pack cut short after the tar data is still caught.
            while stream.read(CHUNK):
                pass
        if manifest is None or set(manifest["files"]) != seen - {"manifest.json"}:
            raise TransferError("the pack is missing files its manifest lists")
    return _summary(manifest, True)
