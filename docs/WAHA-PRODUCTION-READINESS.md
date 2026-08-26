# Medini CRM — WAHA Production Readiness (Tier 1)

**Status:** PRODUCTION-READY (config) · DISABLED by default · **No real numbers contacted, no messages sent.**

WAHA (WhatsApp HTTP API) is the transport for the WhatsApp Hub. It is
**opt-in**: the production service ships commented-out in
`docker-compose.prod.yml` and is only enabled when WhatsApp is in launch scope.

---

## 1. Anti-ban / safety architecture (enforced in the BACKEND, not WAHA)

The WhatsApp safety mechanisms are **application-level**, implemented and tested
in the backend — they are independent of the WAHA container config:

| Mechanism | Where | Value |
|---|---|---|
| Daily send cap | `whatsapp-lifecycle.ts` `WA_DAILY_CAP_DEFAULT` | **50 / day** |
| Per-channel cooldown | `whatsapp-lifecycle.ts` `WA_SEND_DELAY_MIN/MAX_MS` | **30–60s randomized** before every send |
| Warming / health band | `whatsapp-lifecycle.ts` `WaHealthBand` | `healthy/ready/warming/critical` |
| Lifecycle gates | `whatsapp-lifecycle.ts` | `DAILY_CAP_REACHED`, `RATE_LIMIT`, consent, etc. |
| Randomized send delay | `whatsapp-transport.worker.ts` | sleeps 30–60s pre-send (D18 governance) |

> These are **already covered by tests** (`s8-send-delay.spec.ts`,
> marketing-lifecycle, etc.). WAHA production config does not weaken them.

## 2. Production service hardening (`docker-compose.prod.yml`, commented block)

| Setting | Value | Why |
|---|---|---|
| `WAHA_API_KEY` | `${WAHA_API_KEY}` (secret manager) | authenticated API; never committed |
| `WAHA_DASHBOARD_ENABLED` | `false` | no admin UI in prod (smaller surface) |
| `WHATSAPP_SWAGGER_ENABLED` | `false` | no public API docs in prod |
| `WAHA_PRINT_QR` | `false` | QR delivered via authenticated API, never to logs |
| `WHATSAPP_FILES_LIFETIME` | `0` | delete media immediately (PHI minimisation) |
| `WAHA_LOG_FORMAT` | `JSON` | structured, parseable, no message bodies at info level |
| `WHATSAPP_DEFAULT_ENGINE` | `NOWEB` | lightest engine (matches dev) |
| volumes | `waha_sessions:/app/.sessions` | session persists across restarts |
| networks | `medini-internal` only | **NO public port** — backend calls internally |
| healthcheck | authenticated `GET /api/sessions` | liveness via the real API |
| restart | `unless-stopped` | matches other prod services |

## 3. What is already verified (dev smoke — see S0–S10 Phase 7/8)

- ✅ Container starts; **API authentication enforced** (401 without key)
- ✅ Session creation works; **QR state** retrievable via authenticated API
- ✅ Session **persistence** across restart (sessions volume)
- ✅ **Cleanup** works (session stop/logout)
- ✅ Internal topology: backend → WAHA over the Docker network only

## 4. Secure production deployment procedure (no secrets here)

Do this **at deploy time** on the production server:

1. **Generate a strong API key** (never commit):
   ```bash
   openssl rand -hex 32   # → WAHA_API_KEY
   ```
2. Put it in `backend/.env` (secret manager): `WAHA_API_KEY=<generated>` and
   `WAHA_BASE_URL=http://waha:3000`.
3. Uncomment the `waha:` service block in `docker-compose.prod.yml` and the
   `waha_sessions` volume.
4. `docker compose -f docker-compose.prod.yml up -d waha`
5. **Create + authenticate a session** (operator action, verified channel):
   ```bash
   curl -s -X POST http://localhost:3000/api/sessions \
     -H "X-Api-Key: $WAHA_API_KEY" -H 'content-type: application/json' \
     -d '{"name":"default"}'
   # fetch QR via the authenticated endpoint, scan with the clinic's WhatsApp device
   curl -s "http://localhost:3000/api/sessions/default/qr" -H "X-Api-Key: $WAHA_API_KEY"
   ```
6. Verify session reaches `WORKING` state; confirm the backend `WahaDown`
   blackbox alert is green.
7. Confirm **no public port** is mapped: `docker compose ps waha` → no `0.0.0.0:…`.

## 5. Hard rules (do not violate)

- ❌ Never connect or message real customer numbers during readiness testing.
- ❌ Never send unsolicited/bulk messages (anti-ban + consent gates stay on).
- ❌ Never bypass the daily cap / cooldown / warming logic.
- ❌ Never commit `WAHA_API_KEY` or dashboard credentials.
- ✅ Readiness = **technical** verification only (container, auth, session, QR,
  persistence, topology, monitoring) — already done in dev smoke.

## 6. Remaining prerequisite

`WAHA_API_KEY` cannot be "configured" in this offline environment (it is a
real secret). The **exact secure procedure is §4 above**. The production key is
injected via the secret manager at deploy time — this is documented, not faked.
