"""Sign-in steps each person picks (F09.20).

A person can require any mix of four steps: their password, a passkey (this computer's Windows Hello, a security
key, or a phone), the face check, and a spoken key phrase. Signing in starts with a password or a passkey; each
correct step returns a short-lived ticket naming the next one, and a session exists only after the last.

Rules, so the choice stays understandable:
- Nothing ticked: a password or a passkey is enough.
- "Passkey" ticked without "Password": a password cannot start sign-in (the old "require my passkey").
- Both ticked: either one first, then the other.
- Face and key phrase always come after, in that order.
"""

from __future__ import annotations

import secrets
import threading
import time

FACTORS = ("password", "passkey", "face", "voice")
ENTRY = ("password", "passkey")
EXTRA = ("face", "voice")
LABELS = {"password": "password", "passkey": "passkey", "face": "face check", "voice": "key phrase"}
TICKET_SECONDS = 180
WRONG_TRIES = 3

_tickets: dict[str, dict] = {}
_lock = threading.Lock()


class StepError(ValueError):
    pass


def required(row) -> list[str]:
    return [f for f in FACTORS if row[f"require_{f}"]]


def can_start_with(row, method: str) -> bool:
    req = required(row)
    return not (method == "password" and "passkey" in req and "password" not in req)


def remaining(row, done: list[str]) -> list[str]:
    req = required(row)
    return [f for f in ENTRY if f in req and f not in done] + [f for f in EXTRA if f in req and f not in done]


def start(user_id: int, done: list[str]) -> str:
    handle = secrets.token_urlsafe(24)
    t = time.monotonic()
    with _lock:
        for k in [k for k, v in _tickets.items() if v["expires"] < t]:
            _tickets.pop(k, None)
        _tickets[handle] = {"user_id": user_id, "done": list(done), "expires": t + TICKET_SECONDS, "wrong": 0}
    return handle


def peek(handle: str) -> dict:
    with _lock:
        ticket = _tickets.get(handle)
        if not ticket or ticket["expires"] < time.monotonic():
            _tickets.pop(handle, None)
            raise StepError("this sign-in took too long; start again")
        return {**ticket, "done": list(ticket["done"])}


def wrong(handle: str) -> None:
    """Count a failed step. After WRONG_TRIES the whole sign-in has to start again."""
    with _lock:
        ticket = _tickets.get(handle)
        if ticket:
            ticket["wrong"] += 1
            if ticket["wrong"] >= WRONG_TRIES:
                _tickets.pop(handle, None)


def passed(handle: str, factor: str) -> list[str]:
    """Record a correct step and give the ticket fresh time for the next one. Returns the steps done so far."""
    with _lock:
        ticket = _tickets.get(handle)
        if not ticket:
            raise StepError("this sign-in took too long; start again")
        if factor not in ticket["done"]:
            ticket["done"].append(factor)
        ticket["expires"] = time.monotonic() + TICKET_SECONDS
        return list(ticket["done"])


def finish(handle: str) -> None:
    with _lock:
        _tickets.pop(handle, None)


def method_label(done: list[str]) -> str:
    return "+".join(done)
