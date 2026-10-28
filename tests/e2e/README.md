# Browser tests (F11.5)

Playwright tests for every screen of the VAULT UI, run against a freshly seeded demo.

```bash
cd tests/e2e
npm install
npx playwright install chromium   # once
npm test
```

`npm test` does everything:

1. Reset `data/e2e/` with `scripts/demo_reset.py`. This uses the rule-based provider and fictional data only.
2. Start the API on `127.0.0.1:8100`.
3. Build the UI into `frontend/.next-e2e` and serve it on `localhost:3100`.
4. Run the specs.

Every run starts from the same state. The dev servers on ports 8000 and 3000 are left alone. Set `VAULT_E2E_API_PORT`, `VAULT_E2E_WEB_PORT` or `VAULT_PYTHON` to change the defaults.

| Spec | Covers |
|---|---|
| `01-sign-in` | A bad token is refused, a good token signs in, overview counts and privacy posture, sign out (F10.1, F10.2) |
| `02-investigate` | Findings with verified quotes, filtered search, one document of each type in the drawer, Ask panel citations (F10.4–F10.6, F10.10) |
| `03-security` | Remote inference is off and viewers cannot change it. A viewer upload is refused by the server and shows in the audit log (F10.9) |
| `04-setup-run` | Upload, analyst run with the rules lane, live board to completion, admin measurement (F10.3, F10.7) |
| `05-approvals` | An analyst cannot approve; an admin approves and copies are exported (F10.8) |
| `phone` | The menu works at phone width, with no sideways scrolling |

Specs run in order with one worker, because later specs change the shared database. CI runs the same suite (job `e2e`).
