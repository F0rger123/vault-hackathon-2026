#!/usr/bin/env sh
# Start VAULT (F12.9). Usage: ./start.sh   or   ./start.sh --real
set -e
cd "$(dirname "$0")"
PY=.venv/bin/python
[ -x "$PY" ] || PY=$(command -v python3 || command -v python)
[ -n "$PY" ] || { echo "Python 3.11 or newer is needed: https://www.python.org/downloads/"; exit 1; }
exec "$PY" scripts/start.py "$@"
