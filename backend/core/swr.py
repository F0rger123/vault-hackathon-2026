"""Answer at once from a recent result, and refresh it in the background (F12.13).

Asking Ollama takes a second or more, and several seconds while it is busy reading documents. Screens ask often, and
none of them should wait for that. A result younger than `fresh` is returned as it is. One younger than `stale` is
returned too, while one background thread fetches the next. Anything older waits for a real answer.
"""

import threading
import time
from collections.abc import Callable, Hashable, MutableMapping
from typing import TypeVar

T = TypeVar("T")

_refreshing: set[tuple[int, Hashable]] = set()
_lock = threading.Lock()


def cached(
    store: MutableMapping[Hashable, tuple[float, T]], key: Hashable, fetch: Callable[[], T], fresh: float, stale: float
) -> T:
    hit = store.get(key)
    age = time.monotonic() - hit[0] if hit else None
    if hit and age < fresh:
        return hit[1]
    if hit and age < stale:
        _refresh_in_background(store, key, fetch)
        return hit[1]
    value = fetch()
    store[key] = (time.monotonic(), value)
    return value


def _refresh_in_background(store, key, fetch) -> None:
    token = (id(store), key)
    with _lock:
        if token in _refreshing:
            return
        _refreshing.add(token)

    def run() -> None:
        try:
            store[key] = (time.monotonic(), fetch())
        except Exception:  # noqa: S110 - the old answer stands; the next request tries again
            pass
        finally:
            with _lock:
                _refreshing.discard(token)

    threading.Thread(target=run, daemon=True, name="vault-refresh").start()
