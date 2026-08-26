# REMEDIATION F11-1 — ALERTMANAGER CONFIG RUNTIME-SAFETY

**Date:** 2026-08-22 · **Baseline:** `5eb40fd` · **HEAD before fix:** `4cec363` · **HEAD after fix:** (see commit below)

---

## 1. Original Defect

`monitoring/alertmanager.yml` line 35 contained shell-style environment expansion:
```yaml
url: '${AM_WEBHOOK_URL:-http://localhost:9/alert-blackhole}'
```
Alertmanager does **not** perform shell-style `${VAR:-default}` expansion inside its YAML configuration. It parses the literal string, which is an invalid URL, causing Alertmanager to fail/crash-loop on startup.

## 2. Root Cause

The Tier 1 monitoring configuration was written with the assumption that Alertmanager would interpolate `${AM_WEBHOOK_URL:-...}` at runtime. This is incorrect — Alertmanager's YAML parser does not perform shell expansion. Docker Compose *does* perform environment expansion, but only for values in the Compose file itself, not for files mounted into containers.

## 3. Fix Implemented

**Option B — Deterministic/static configuration:**
- Removed all runtime environment interpolation from `alertmanager.yml`.
- Default receiver is now a hardcoded, harmless `http://localhost:9/alert-blackhole` — alerts still fire and are visible in the UI; they are simply not forwarded externally.
- Added an optional `webhook` receiver (also pointing to blackhole by default) so operators can override it at deploy time without modifying the committed file.
- Removed the `AM_WEBHOOK_URL` environment variable from `docker-compose.prod.yml` (no longer needed).
- Updated `docs/MONITORING.md` to document the new behaviour and override procedure.

## 4. Files Changed

| File | Change |
|---|---|
| `monitoring/alertmanager.yml` | Removed shell expansion; static config; added optional `webhook` receiver placeholder |
| `docker-compose.prod.yml` | Removed `AM_WEBHOOK_URL` environment variable from alertmanager service |
| `docs/MONITORING.md` | Updated secrets/fail-safe section to document F11-1 remediation |

## 5. Before/After Behaviour

| Scenario | Before | After |
|---|---|---|
| Alertmanager startup | Crash-loop (invalid URL literal) | Starts cleanly, healthy |
| Alerts when webhook unset | Silently broken (container down) | Fire + visible in UI (blackhole receiver) |
| Operator webhook override | Edit committed file (risky) | Copy → override → mount (safe, no commit) |
| Secrets in Git | None (but config broken) | None (and config works) |

## 6. Validation Performed

| Test | Result |
|---|---|
| A. Static YAML syntax (js-yaml) | ✅ PASS |
| B. Docker Compose config validation | ✅ PASS |
| C. Alertmanager config validation (`amtool check-config`) | ✅ PASS |
| D. Container startup | ✅ PASS (no crash-loop) |
| E. Container health/readiness (`/-/healthy`, `/-/ready`) | ✅ PASS |
| F. Restart test | ✅ PASS |
| G. Missing optional webhook scenario | ✅ PASS (default blackhole active) |
| H. Normal configured scenario (webhook URL override) | ✅ PASS |
| I. Prometheus → Alertmanager connectivity | ✅ PASS (same Docker network) |
| J. Existing alert-rule loading | ✅ PASS (all rules intact) |
| K. Secret scan | ✅ PASS (no secrets in monitoring/) |
| L. Regression — backend test suite | ✅ PASS (585/585 ×2) |

## 7. Security Impact

- **Positive:** Alertmanager no longer fails silently; monitoring remains fail-safe.
- **No new secrets introduced.** No hardcoded URLs, tokens, or passwords.
- **No existing controls weakened.** All S8/S9/S10 security controls preserved.

## 8. Regression Results

- Backend: **585/585 PASS ×2** (no change — fix is isolated to monitoring config)
- Frontend: lint 0, tsc 0, build PASS (no change)
- Docker Compose: config validates
- Alertmanager: starts healthy, passes `amtool check-config`, no crash-loop

## 9. Remaining Unverified Items

- **Live webhook delivery:** requires a real notification channel (Slack/Telegram/email) and production domain — marked UNVERIFIED until staging/production deploy.
- **Alertmanager UI access:** internal-only by design; no public port.

## 10. Commit Hash

`41cc415`
