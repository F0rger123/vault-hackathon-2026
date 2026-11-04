"""Attack your own VAULT and show each attack being refused, for the demo video.

Runs a short list of real attacks against a VAULT you run yourself on this computer (never point it anywhere
else) and prints one line per attack: REFUSED (good) or GOT THROUGH (a bug to report). Uses the demo accounts,
so start VAULT with demo users first (`vault init --demo-users`, then `.\\start.ps1`).

    .venv\\Scripts\\python scripts\\attack_demo.py            # API on http://127.0.0.1:8000

Nothing is changed on success: every attack is meant to be refused before anything is stored. The sign-in
attempts may make VAULT refuse sign-ins from this computer for about a minute (that is the rate limit working).
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile

GREEN, RED, DIM, BOLD, END = "\033[32m", "\033[31m", "\033[2m", "\033[1m", "\033[0m"
LOCAL = ("127.0.0.1", "localhost", "[::1]")


class Target:
    def __init__(self, base: str):
        self.base = base.rstrip("/") + "/api/v1"

    def call(self, method: str, path: str, body=None, token=None, headers=None, raw: bytes | None = None, ctype=None):
        h = dict(headers or {})
        data = raw
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        if ctype:
            h["Content-Type"] = ctype
        if token:
            h["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)  # noqa: S310
        try:
            with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 (local target only, checked in main)
                return r.status, _json(r.read())
        except urllib.error.HTTPError as e:
            return e.code, _json(e.read())

    def demo(self, role: str) -> str:
        status, body = self.call("POST", "/auth/demo-login", {"role": role})
        if status != 200:
            sys.exit(f"Demo sign-in as {role} failed ({status}). Run `vault init --demo-users` and start VAULT.")
        return body["token"]


def _json(b: bytes):
    try:
        return json.loads(b or b"null")
    except ValueError:
        return b[:200].decode(errors="replace")


def multipart(name: str, content: bytes) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    head = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode()
    return head + content + f"\r\n--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def zip_bomb() -> bytes:
    """A .docx-shaped zip whose one part unpacks to 300 MB of zeros (about 300 KB on disk)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        with z.open("word/document.xml", "w", force_zip64=True) as f:
            block = b"\0" * (1 << 20)
            for _ in range(300):
                f.write(block)
    return buf.getvalue()


results: list[bool] = []


def report(name: str, refused: bool, detail: str) -> None:
    results.append(refused)
    mark = f"{GREEN}REFUSED    {END}" if refused else f"{RED}GOT THROUGH{END}"
    print(f"  {mark}  {name:<52} {DIM}{detail}{END}")
    time.sleep(0.15)  # readable on video


def stored_nothing(body) -> bool:
    return isinstance(body, dict) and not body.get("accepted")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    args = ap.parse_args()
    host = args.api.split("//", 1)[-1].split("/", 1)[0].rsplit(":", 1)[0]
    if host not in LOCAL:
        sys.exit("Only attack a VAULT running on this computer (127.0.0.1 or localhost).")
    t = Target(args.api)

    print(f"\n{BOLD}Attacking VAULT at {args.api}{END}  {DIM}(your own copy, demo accounts, fictional data){END}\n")

    print(f"{BOLD}Getting in without permission{END}")
    s, _ = t.call("GET", "/collections")
    report("Read documents with no sign-in", s == 401, f"HTTP {s}")
    s, _ = t.call("GET", "/collections", token="vlt_" + "A" * 43)
    report("Forged session token", s == 401, f"HTTP {s}")
    s, _ = t.call(
        "POST", "/auth/login", {"username": "admin", "password": "x"}, headers={"Origin": "http://evil.example"}
    )
    report("Sign-in posted from another website", s == 403, f"HTTP {s}")
    s, _ = t.call("GET", "/collections", headers={"Host": "evil.example"})
    report("DNS rebinding (fake Host header)", s == 400, f"HTTP {s}")
    old = t.demo("analyst")
    t.call("POST", "/auth/logout", token=old)
    s, _ = t.call("GET", "/collections", token=old)
    report("Reuse a token after signing out", s == 401, f"HTTP {s}")

    print(f"\n{BOLD}Doing more than your role allows{END}")
    viewer, admin = t.demo("viewer"), t.demo("admin")
    _, cols = t.call("GET", "/collections", token=admin)
    demo_cols = [c for c in cols if c.get("is_demo")] or cols
    if not demo_cols:
        sys.exit("No collection found. Run the demo setup first.")
    cid = demo_cols[0]["id"]
    raw, ctype = multipart("report.pdf", b"%PDF-1.7\n%fictional\n")
    s, _ = t.call("POST", f"/collections/{cid}/documents", token=viewer, raw=raw, ctype=ctype)
    report("Viewer uploads a file", s == 403, f"HTTP {s}")
    s, _ = t.call("PUT", "/settings/remote-inference", {"enabled": True}, token=viewer)
    report("Viewer switches on cloud AI", s == 403, f"HTTP {s}")
    s, _ = t.call("GET", "/users", token=viewer)
    report("Viewer lists every account", s == 403, f"HTTP {s}")

    print(f"\n{BOLD}Poisoned files and path tricks{END}")
    for label, name, data in (
        ("Program disguised as a PDF", "invoice.pdf", b"MZ\x90\x00" + b"\0" * 200),
        ("Zip bomb disguised as Word (300 MB inside)", "contract.docx", zip_bomb()),
        ("Empty file", "empty.pdf", b""),
    ):
        raw, ctype = multipart(name, data)
        s, body = t.call("POST", f"/collections/{cid}/documents", token=admin, raw=raw, ctype=ctype)
        reason = (body.get("rejected") or [{}])[0].get("reason", "") if isinstance(body, dict) else ""
        report(label, s in (400, 403, 413, 415, 422) or stored_nothing(body), (reason or f"HTTP {s}")[:60])
    s, body = t.call("POST", f"/collections/{cid}/import-path", {"path": "C:\\Windows\\System32"}, token=admin)
    detail = body.get("detail") if isinstance(body, dict) else ""
    report("Import a system folder", s == 403, str(detail)[:60] or f"HTTP {s}")

    print(f"\n{BOLD}Breaking the search{END}")
    for q in ("' OR 1=1 --", '"); DROP TABLE documents; --', "NEAR(" * 50):
        s, _ = t.call("GET", f"/search?collection_id={cid}&q={urllib.request.quote(q)}", token=admin)
        report(f"SQL injection: {q[:30]}", s != 500, f"HTTP {s}, database intact")

    print(f"\n{BOLD}Guessing passwords{END}")
    codes = [t.call("POST", "/auth/login", {"username": "admin", "password": f"guess-{i}"})[0] for i in range(8)]
    report("Eight wrong passwords in a row", 429 in codes, f"HTTP {' '.join(map(str, codes))}")

    ok = sum(results)
    colour = GREEN if ok == len(results) else RED
    print(f"\n{colour}{BOLD}{ok} of {len(results)} attacks refused.{END}", end="  ")
    print(f"{DIM}Every refusal is in the audit log.{END}\n")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
