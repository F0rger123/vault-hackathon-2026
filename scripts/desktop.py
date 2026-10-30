"""The native VAULT window (F12.9). Started by `scripts/start.py --app`; not meant to be run by hand.

    python scripts/desktop.py http://localhost:3000 [--smoke-test]

It shows the local interface in a native window: WebView2 (Microsoft Edge) on Windows, GTK + WebKit2 or Qt on
Linux, through pywebview. It is only a window over the same private servers the browser would use, so sign-in,
CSP and every server-side check stay exactly as they are. The process returns when the window is closed; the
launcher then stops both servers.

--smoke-test opens the window, prints the page title once the page has loaded, then closes the window itself.
It lets a person (or a check script) confirm the desktop app works without clicking anything.
"""

from __future__ import annotations

import argparse
import sys
import time
from urllib.parse import urlsplit

TITLE = "VAULT"
SIZE = (1280, 860)
MIN_SIZE = (900, 600)


def open_window(url: str, smoke_test: bool = False) -> int:
    # The window only ever shows the interface on this computer.
    parts = urlsplit(url)
    if parts.scheme != "http" or parts.hostname not in ("localhost", "127.0.0.1") or "@" in parts.netloc:
        print(f"desktop: refusing to open {url!r}; only the local VAULT interface is allowed.", file=sys.stderr)
        return 2
    import webview  # optional dependency: pip install -e ".[desktop]"

    window = webview.create_window(TITLE, url, width=SIZE[0], height=SIZE[1], min_size=MIN_SIZE, resizable=True)
    if smoke_test:

        def report_and_close() -> None:
            # The sign-in form appears once the interface has asked the API how sign-in works, so wait for it.
            sign_in = False
            for _ in range(40):
                sign_in = bool(window.evaluate_js("document.body.innerText.includes('Sign in')"))
                if sign_in:
                    break
                time.sleep(0.25)
            title = window.evaluate_js("document.title")
            path = window.evaluate_js("location.pathname")
            print(f"desktop smoke test: loaded {url}{path}, title {title!r}, sign-in shown: {sign_in}", flush=True)
            window.destroy()

        window.events.loaded += report_and_close
    # debug=False keeps the developer tools and right-click "Inspect" off. private_mode keeps the web view from
    # writing cookies, storage or cache to disk, so closing the window leaves no session behind.
    webview.start(debug=False, private_mode=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Open VAULT in a native window")
    ap.add_argument("url")
    ap.add_argument("--smoke-test", action="store_true")
    args = ap.parse_args(argv)
    return open_window(args.url, args.smoke_test)


if __name__ == "__main__":
    sys.exit(main())
