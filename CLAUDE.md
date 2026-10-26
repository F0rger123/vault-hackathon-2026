# CLAUDE.md

All project rules live in [`AGENTS.md`](AGENTS.md). Read it first, including section 0 (if someone just wants to understand or install VAULT, follow `docs/AI_GUIDE.md` instead).

@AGENTS.md

## Claude Code notes

- **Platform:** Luke develops on Windows 11. Both a PowerShell tool and a Git Bash tool may be available; use bash syntax in Bash and PowerShell syntax in PowerShell. Do not mix them.
- **Virtual environment:** on Windows the tools are under `.venv/Scripts/` (`.venv/Scripts/python`, `.venv/Scripts/vault`, `.venv/Scripts/ruff`); on macOS/Linux under `.venv/bin/`.
- **Line endings:** the repo stores text as LF (`.gitattributes`). When writing files from Python on Windows, pass `newline="\n"`. Never let tools rewrite `data/synthetic/v1/`.
- **sed on Windows Git Bash** mangles backslashes in regular expressions. Use the Edit tool for code changes containing `\d`, `\s`, `\n`.
- **Runtime data** defaults to `data/runtime/` (git-ignored). Use `VAULT_DATA_DIR` pointing at a temporary folder for experiments so the working copy stays clean.
- **Ollama** runs on the host at `http://127.0.0.1:11434`. Model downloads are large; ask Luke before `ollama pull`.
- **Subscription:** Luke uses Claude Max for development. Do not add Anthropic API calls or other billable services to VAULT.
- **Commits:** author `F0rger <drummerforger@gmail.com>` is configured in the repo. Docs-only commits by Luke's agent may go straight to `main` with `[skip ci]`.
