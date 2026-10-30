"""Serve the exported web interface from the API process (F12.12, the installable app).

Used only when VAULT_UI_DIR is set. Browser and API then share one origin, so the Content-Security-Policy can stay
at 'self'. Every path goes through safe_join, and API routes are registered first so nothing here can shadow them.
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from backend.security.files import FileRejected, safe_join

# Same policy as frontend/next.config.ts, without the separate API origin. tests/security/test_ui_serving.py
# compares the two lists, so a header changed in one place fails the tests until it changes in the other.
CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)
COMMON_HEADERS = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}
UI_HEADERS = {"Content-Security-Policy": CSP, **COMMON_HEADERS}
# API responses now share the interface's origin. They are data, so a response opened directly can never run anything.
API_HEADERS = {"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox", **COMMON_HEADERS}

# Spelled out because Windows takes these from the registry, and a .js served as text/plain is refused under nosniff.
MEDIA_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    # Next.js fetches its page data as .txt in an export and expects text/plain.
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".woff2": "font/woff2",
}
PAGE_SEGMENT = ".__PAGE__.txt"


def find_file(root: Path, path: str) -> Path | None:
    """The exported file for a URL path, or None. `/run` is run.html, `/` is index.html."""
    parts = path.rstrip("/").split("/") if path.rstrip("/") else ["index.html"]
    # A colon names an NTFS alternate data stream (index.html::$DATA). No exported file has one.
    if any(":" in part for part in parts):
        return None
    attempts = [parts, [*parts[:-1], f"{parts[-1]}.html"]]
    # The router prefetches /run/__next.run.__PAGE__.txt, but the export writes /run/__next.run/__PAGE__.txt.
    if parts[-1].startswith("__next.") and parts[-1].endswith(PAGE_SEGMENT):
        attempts.append([*parts[:-1], parts[-1].removesuffix(PAGE_SEGMENT), PAGE_SEGMENT[1:]])
    try:
        for attempt in attempts:
            candidate = safe_join(root, *attempt)
            if candidate.is_file():
                return candidate
    except (FileRejected, ValueError, OSError):
        # Traversal, an empty segment, a NUL byte or a name the file system refuses: all simply not found.
        return None
    return None


def _response(root: Path, file: Path, status_code: int = 200) -> FileResponse:
    # File names under _next/static contain a content hash, so they never change. Pages must be rechecked.
    hashed = root / "_next" / "static" in file.parents
    return FileResponse(
        file,
        status_code=status_code,
        media_type=MEDIA_TYPES.get(file.suffix.lower(), "application/octet-stream"),
        headers={**UI_HEADERS, "Cache-Control": "public, max-age=31536000, immutable" if hashed else "no-cache"},
    )


def mount_ui(app: FastAPI, ui_dir: Path) -> None:
    """Add the catch-all route. Call after every API router, because the first matching route wins."""
    root = ui_dir.resolve()
    if not (root / "index.html").is_file():
        raise RuntimeError(f"VAULT_UI_DIR has no index.html: {root}")

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def serve_ui(path: str) -> FileResponse:
        # An API address that does not exist is an API error, never a web page.
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        file = find_file(root, path)
        if file is not None:
            return _response(root, file)
        not_found = root / "404.html"
        if not_found.is_file():
            return _response(root, not_found, status_code=404)
        raise HTTPException(status_code=404, detail="Not Found")
