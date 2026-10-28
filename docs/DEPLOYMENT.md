# Deployment

VAULT runs entirely on your own machine. Docker Compose publishes ports on `127.0.0.1` only, and `vault serve` binds to `127.0.0.1` by default.

## Requirements

You need:

- Python 3.11+, with `uv` recommended
- Node 24
- Ollama, for local Meta-model inference

Docker 29+ is optional.

A GPU is optional. On the dev laptop, `llama3:latest` runs on an 8 GB NVIDIA GPU. Without a GPU, Ollama uses the CPU, which is slower.

## Native setup (development)

```bash
git clone https://github.com/F0rger123/vault-hackathon-2026.git
cd vault-hackathon-2026
uv venv --python 3.11 .venv
uv pip install -e ".[dev]"            # or: python -m venv .venv && pip install -e ".[dev]"
cp .env.example .env                  # optional; defaults work
```

Activate the virtual environment:

- Windows: `.venv\Scripts\activate`
- macOS/Linux: `source .venv/bin/activate`

Then set up data, models and the server:

```bash
vault init --demo-users               # writes data/runtime/dev_tokens.json (local only)
vault ingest data/synthetic/v1/files --collection demo
ollama pull llama3:latest             # once; ~4.7 GB
vault providers                       # confirm the provider shows "ready"
vault estimate --collection demo --provider ollama
vault process  --collection demo --provider ollama
vault serve                           # API on http://127.0.0.1:8000 (docs at /docs)
```

Start the frontend in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The UI is at http://localhost:3000. Sign in by pasting a token from `data/runtime/dev_tokens.json`.

## Demo environment (reset and rehearse)

One command rebuilds the demo from nothing: a fresh database in `data/demo/` (git-ignored), the admin, analyst and viewer users, all 150 synthetic files in the "Halvern Engineering Archive" collection, a finished processing run, and one organization proposal waiting for an administrator.

```bash
./scripts/demo_reset.sh                       # macOS/Linux/Git Bash; heuristic provider, about 12 s
./scripts/demo_reset.sh --provider ollama     # local Llama 3: about 13 minutes on an RTX 5070 Laptop
```

```powershell
.\scripts\demo_reset.ps1                      # Windows PowerShell; same arguments
```

Then serve it with `VAULT_DATA_DIR=data/demo vault serve` and sign in with a token from `data/demo/dev_tokens.json`. Run the reset again before every rehearsal. The script only deletes a directory it created (marked by a `.vault-demo` file) and refuses anything else, including `data/runtime/`.

## Docker Compose

```bash
docker compose up --build            # backend :8000, frontend :3000 (localhost only)
docker compose --profile ollama up   # also runs Ollama in a container
```

The backend container:

- runs as a non-root user with a read-only root filesystem, a tmpfs at `/tmp`, and `no-new-privileges`
- keeps its data in the `vault-data` volume
- reaches Ollama on the host through `host.docker.internal`; override this with `VAULT_OLLAMA_URL_DOCKER`

Create tokens inside the container:

```bash
docker compose exec backend vault init --demo-users
```

This writes the tokens to `/data/dev_tokens.json` inside the volume.

## Enabling the Meta Model API (remote)

This sends document text to `api.meta.ai`. Only do it with data you are allowed to send.

1. Set `VAULT_META_API_KEY` in `.env`. Never commit it.
2. Turn on remote inference in one of two ways:
   - set `VAULT_ALLOW_REMOTE_INFERENCE=true`, or
   - have an admin call `PUT /api/v1/settings/remote-inference {"enabled": true}`
3. Start jobs with `confirm_remote: true` (API) or `--confirm-remote` (CLI).

Keep `VAULT_META_API_MODEL=muse-spark-1.3`. Avoid the `-contributor` models.

## Verifying an install

```bash
pytest -p no:warnings                  # about 50 tests
cd tests/e2e && npm install && npm test # browser tests: seeds a demo, starts both servers, runs Playwright
curl http://127.0.0.1:8000/api/v1/health
```

The health check should return `{"status":"ok", ...}`.

## Configuration reference

See `.env.example`. All backend settings use the `VAULT_*` prefix and are defined in `backend/core/config.py`.

## Hosted demo (optional)

A public demo would contain only fictional data and would use the heuristic or a Meta-hosted provider. Nothing is deployed yet. Cloudflare and Supabase are not required for anything.
