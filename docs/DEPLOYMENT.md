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

**Next.js usage data:** Next.js sends anonymous usage data unless it is turned off. The one-command start (`start.ps1`, `start.sh`) and the Docker image turn it off for you. When you run `npm` yourself, turn it off once per machine with `npx next telemetry disable`, or set `NEXT_TELEMETRY_DISABLED=1`.

## Desktop app (Windows and Linux)

VAULT can open in its own window instead of a browser tab:

```powershell
.\start.ps1 -App              # Windows (also: .\start.ps1 --app --real)
```

```bash
./start.sh --app              # Linux
```

**How it works.** The launcher starts the same two private servers as always (the API on `127.0.0.1:8000`, the interface on `127.0.0.1:3000`) and shows the interface in a native window titled "VAULT" instead of a browser tab. The window comes from [pywebview](https://pywebview.flowrl.com/): Microsoft Edge WebView2 on Windows (already part of Windows 11), GTK + WebKit2 or Qt on Linux. There is no Electron and no bundled browser. Nothing is opened to the network, and sign-in, permissions and the security headers are exactly the same as in a browser. The window keeps nothing on disk (private mode), so you sign in each time you open it, and developer tools are switched off. **Closing the window stops both servers.**

**Install.** The first `--app` start installs pywebview into `.venv` for you. If that cannot happen (no network, or a venv made by `uv`, which has no `pip`), the launcher prints one line with the command and opens your browser instead:

```bash
uv pip install -e ".[desktop]"        # or: .venv/Scripts/python -m pip install -e ".[desktop]"  (Windows)
                                      #     .venv/bin/python -m pip install -e ".[desktop]"      (Linux)
```

**Linux system packages.** pywebview needs a web view from your distribution. Pick one:

- GTK + WebKit2 (GNOME and most desktops). Install the libraries, then the Python bindings into the venv:

  ```bash
  sudo apt install libgirepository-2.0-dev libcairo2-dev pkg-config python3-dev gir1.2-webkit2-4.1   # Debian/Ubuntu
  sudo dnf install gobject-introspection-devel cairo-gobject-devel pkg-config python3-devel webkit2gtk4.1   # Fedora
  .venv/bin/python -m pip install -e ".[desktop]" "pywebview[gtk]"
  ```

  On older releases use `libgirepository1.0-dev` instead of `libgirepository-2.0-dev`.
- Qt (KDE, or when GTK is not wanted): `.venv/bin/python -m pip install -e ".[desktop]" "pywebview[qt]"`.

If the window cannot open (for example no web view is installed), the launcher says so and opens your browser instead, so VAULT still starts.

**Check it works.** `start.ps1 --smoke-test` (or `./start.sh --smoke-test`) opens the window, prints the page title once the sign-in page has loaded, closes the window and stops the servers. If another VAULT already uses ports 8000 and 3000, add `--api-port 8100 --ui-port 3100`. The interface is then built once into its own folder (`frontend/.next-api8100`), so the normal build is left alone.

**Later: one installer.** A single `VAULT-Setup.exe` (and a Linux AppImage) can be made with PyInstaller, bundling Python and the launcher, with Node.js and the built interface shipped alongside. That is not done yet; for now the desktop app runs from a checkout.

## Demo environment (reset and rehearse)

One command rebuilds the demo from nothing: a fresh database in `data/demo/` (git-ignored), the admin, analyst and viewer users, all 150 synthetic files in the "Halvern Engineering Archive" collection, a finished processing run, and one organization proposal waiting for an administrator.

```bash
./scripts/demo_reset.sh                       # macOS/Linux/Git Bash; heuristic provider, about 12 s
./scripts/demo_reset.sh --provider ollama     # local Llama 3: about 13 minutes on an RTX 5070 Laptop
```

```powershell
.\scripts\demo_reset.ps1                      # Windows PowerShell; same arguments
```

Then serve it with `VAULT_DATA_DIR=data/demo VAULT_DEMO_LOGIN=true vault serve`, and sign in with the **Demo: admin / analyst / viewer** buttons. A token from `data/demo/dev_tokens.json` also works. Run the reset again before every rehearsal. The script only deletes a directory it created (marked by a `.vault-demo` file) and refuses anything else, including `data/runtime/`.

## Signing in with a password

```bash
vault set-password admin        # asks twice; at least 10 characters
```

The sign-in screen then accepts that username and password. Sessions last 12 hours (`VAULT_SESSION_TTL_HOURS`). No Meta API key or internet account is needed: VAULT uses Meta Llama locally through Ollama.

## Moving VAULT to a new computer

Use this when you move to a bigger machine. The whole VAULT goes into one encrypted file: every collection, every reading, the brains, rules, users, the audit log and every original document. Nothing goes over a network.

**On the old computer**, with VAULT's data folder in `VAULT_DATA_DIR`:

```bash
vault transfer export --out E:/vault-move.vaultpack
```

You are asked for a passphrase twice. Use at least 12 characters; a few random words is best. The Meta API key stays behind unless you add `--include-api-key`.

**Carry the file** on an encrypted USB drive or any other route you trust. **Never send the passphrase with the file.**

**On the new computer**, after installing VAULT:

```bash
vault transfer verify E:/vault-move.vaultpack            # optional: checks it opens and nothing changed
vault transfer import E:/vault-move.vaultpack --data-dir D:/vault-data
```

Then start VAULT with `VAULT_DATA_DIR=D:/vault-data`.

**What protects the move:**
- **Encryption:** the pack is encrypted with AES-256-GCM, using a key derived from the passphrase with scrypt.
- **Tampering:** changing, dropping, reordering or cutting off any part makes the import refuse.
- **Fingerprints:** every file's SHA-256 is checked.
- **No overwriting:** the import writes only into an empty folder, and only moves files into place after every check passes.

**Keep the old copy until** the new computer is confirmed working. Then delete the old data folder and the pack.

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
