#!/usr/bin/env sh
# Reset the demo environment (F12.6). Arguments pass through, e.g. --provider ollama.
set -e
cd "$(dirname "$0")/.."
if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=.venv/Scripts/python; fi
exec "$PY" scripts/demo_reset.py "$@"
