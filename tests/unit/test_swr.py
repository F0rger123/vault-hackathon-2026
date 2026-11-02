"""F12.13: slow checks answer at once from a recent result and refresh behind the scenes."""

import threading
import time

from backend.core.swr import cached


def test_fresh_result_does_not_fetch_again():
    calls, store = [], {}
    fetch = lambda: calls.append(1) or len(calls)  # noqa: E731
    assert cached(store, "k", fetch, 60, 600) == 1
    assert cached(store, "k", fetch, 60, 600) == 1
    assert len(calls) == 1


def test_stale_result_returns_at_once_and_refreshes_once():
    store = {"k": (time.monotonic() - 100, "old")}
    release, done = threading.Event(), threading.Event()
    calls = []

    def fetch():
        calls.append(1)
        release.wait(5)
        done.set()
        return "new"

    assert cached(store, "k", fetch, 60, 600) == "old"
    assert cached(store, "k", fetch, 60, 600) == "old"  # a second caller does not start a second refresh
    release.set()
    assert done.wait(5)
    for _ in range(100):
        if store["k"][1] == "new":
            break
        time.sleep(0.01)
    assert store["k"][1] == "new" and len(calls) == 1


def test_too_old_result_waits_for_a_real_answer():
    store = {"k": (time.monotonic() - 1000, "old")}
    assert cached(store, "k", lambda: "new", 60, 600) == "new"


def test_failed_refresh_keeps_the_old_answer():
    store = {"k": (time.monotonic() - 100, "old")}

    def fail():
        raise RuntimeError("down")

    assert cached(store, "k", fail, 60, 600) == "old"
    time.sleep(0.05)
    assert store["k"][1] == "old"
