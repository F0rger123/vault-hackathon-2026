"""Is there a newer VAULT? (F12.14)

The server asks GitHub's public release list for the newest published release, at most every few hours. The
request carries nothing about this machine or its documents, and the answer is only read: VAULT never downloads
or runs anything by itself. The person presses Download and their browser fetches the installer from GitHub.
Links are kept only when they point at this project's own releases.
"""

from __future__ import annotations

import re

import httpx

from backend.core.swr import cached

REPO = "F0rger123/vault-hackathon-2026"
LATEST = f"https://api.github.com/repos/{REPO}/releases/latest"
RELEASES = f"https://github.com/{REPO}/releases"
_VERSION = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
_cache: dict[str, tuple[float, dict]] = {}
FRESH_SECONDS = 6 * 3600
STALE_SECONDS = 24 * 3600


def parse_version(text: str) -> tuple[int, int, int] | None:
    m = _VERSION.match(text.strip())
    return (int(m[1]), int(m[2]), int(m[3])) if m else None


def _ours(url: object) -> str | None:
    return url if isinstance(url, str) and url.startswith(f"https://github.com/{REPO}/releases/") else None


def _fetch() -> dict:
    r = httpx.get(LATEST, timeout=5, headers={"Accept": "application/vnd.github+json"}, follow_redirects=False)
    if r.status_code == 404:
        return {"latest": None}
    if r.status_code in (403, 429):
        # GitHub allows 60 unsigned API calls an hour per network. Its plain "latest release" page has no such
        # limit and redirects to the release's tag, which is enough to name the files.
        return _from_redirect()
    r.raise_for_status()
    body = r.json()
    files = []
    for a in body.get("assets") or []:
        url = _ours(a.get("browser_download_url"))
        name = str(a.get("name", ""))[:120]
        if url and re.search(r"\.(exe|zip)$", name):
            files.append({"name": name, "url": url, "size_mb": round((a.get("size") or 0) / 2**20, 1)})
    return {
        "latest": str(body.get("tag_name", ""))[:40] or None,
        "page": _ours(body.get("html_url")) or RELEASES,
        "published_at": str(body.get("published_at", ""))[:40] or None,
        "files": files,
    }


def _from_redirect() -> dict:
    r = httpx.head(f"{RELEASES}/latest", timeout=5, follow_redirects=False)
    tag = re.search(r"/releases/tag/(v?\d+\.\d+\.\d+)$", r.headers.get("location", ""))
    if not tag:
        return {"latest": None}
    t, v = tag[1], tag[1].lstrip("v")
    base = f"{RELEASES}/download/{t}"
    return {
        "latest": t,
        "page": f"{RELEASES}/tag/{t}",
        "published_at": None,
        "files": [
            {"name": f"VAULT-Setup-{v}.exe", "url": f"{base}/VAULT-Setup-{v}.exe", "size_mb": 0},
            {"name": f"VAULT-{v}-windows-portable.zip", "url": f"{base}/VAULT-{v}-windows-portable.zip", "size_mb": 0},
        ],
    }


def check(current: str, enabled: bool) -> dict:
    out: dict = {"current": current, "enabled": enabled, "newer": False, "releases": RELEASES}
    if not enabled:
        return out
    try:
        found = cached(_cache, "latest", _fetch, FRESH_SECONDS, STALE_SECONDS)
    except (httpx.HTTPError, ValueError):
        return {**out, "error": "GitHub could not be reached, so VAULT could not check for updates."}
    have, latest = parse_version(current), parse_version(found.get("latest") or "")
    return {**out, **found, "newer": bool(have and latest and latest > have)}
