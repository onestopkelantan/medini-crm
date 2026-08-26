# SETTINGS DOMAIN — ARCHITECTURE LOCK v1.0

**Status:** LOCKED · **Phase:** Blueprint Lock Program — Phase 2 (Group A: System Foundation)
**Date:** 13 August 2026 · **Author:** Neo (Senior Architect)
**Depends on:** Phase 1 Administration (LOCKED)

---

## 1. Business Purpose

Settings menjawab: **"Bagaimana sistem ini dikonfigurasi, di setiap level, oleh siapa — tanpa mendedahkan rahsia?"**

Domain ini memisahkan dengan tegas:
- **Configuration** (boleh diubah, versioned, audited)
- **Operational data** (milik domain lain — Settings TIDAK pegang)
- **Secrets** (server-side vault dalam production; prototype = masked placeholder sahaja)

## 2. Domain Scope

**DALAM scope:**
- Configuration hierarchy: System → Organization → Branch → User/Role → Feature/Module
- Clinic/organization profile
- Notification configuration
- AI behaviour configuration (config sahaja — logic milik AI Manager)
- Security configuration (password policy, session policy)
- Integration configuration (non-secret): Bukku subdomain, base URL, connection status
- Branch-level overrides dengan inheritance
- Settings versioning + audit

**LUAR scope:**
- User/role management — Administration (Phase 1, locked)
- Commission rules, alert thresholds, payment methods — Finance config engine (locked)
- AI decision logic — AI Manager (Phase 6)
- WhatsApp templates/messages — WhatsApp Hub (Phase 5)
- Secret vault implementation — production backend (selepas Phase 9)

## 3. Domain Boundary

| Benda | Pemilik | Nota |
|---|---|---|
| Config hierarchy + inheritance | **Settings** | — |
| Clinic profile | **Settings** | Organization-level |
| Notification toggles/timing | **Settings** | WhatsApp Hub consume untuk hantar |
| AI toggles | **Settings** | AI Manager consume untuk behave |
| Bukku API key (secret) | Production vault | Prototype: masked placeholder + disclosure |
| Bukku subdomain/base URL | **Settings** | Non-secret integration config |
| Permission matrix | Administration | Jangan duplicate |
| Commission % | Finance | Locked domain |

## 4. Responsibilities

1. Menyimpan semua configuration dalam satu registry canonical
2. Mengurus inheritance: value di level bawah override level atas
3. Memastikan secrets TIDAK PERNAH disimpan plain-text di frontend
4. Versioning setiap perubahan config (macam Finance config engine)
5. Audit semua perubahan — siapa, apa, bila, level mana
6. Menjadi pembekal config kepada semua domain lain

## 5. Subdomains / Modules

| Module | Fungsi |
|---|---|
| Clinic Profile | Organization identity (nama, reg, alamat, currency, timezone) |
| Notifications | Toggle + timing (reminder 24h/2h, digest, alerts) |
| AI Behaviour | Toggle AI features (config — bukan logic) |
| Security | Password change, session policy view |
| Integrations | Bukku connection (status, subdomain, base URL, masked key) |
| Branch Defaults | Per-branch override management |

## 6. Entities

| Entity | Medan | Nota |
|---|---|---|
| `ConfigEntry` | key, level (system/org/branch/role/feature), scopeId, value, version, updatedBy, updatedAt | Canonical registry |
| `ConfigVersion` | configKey, oldValue, newValue, version, changedBy, reason, when | Historical protection |
| `SecretRef` | key, vaultPath, lastFour, status | HANYA reference — nilai sebenar di server vault |
| `IntegrationStatus` | service, status, lastChecked, latency | Read model untuk UI |

**Existing:** `settings` table dalam schema.ts (akan diperluas ke model level-based masa production).

## 7. Entity Relationships

```
Organization (1) ──< (n) ConfigEntry (level=org)
Branch (1) ──< (n) ConfigEntry (level=branch)
Role (1) ──< (n) ConfigEntry (level=role)
ConfigEntry (1) ──< (n) ConfigVersion
SecretRef (n) ──> (1) IntegrationStatus (derived)
```

## 8. State Machines / Lifecycles

### Config value lifecycle
```
DEFAULT (system) → OVERRIDDEN (branch/role) → RESET (kembali inherit)
```
### Integration status
```
NOT_CONFIGURED → CONFIGURED → TESTED_OK → ERROR → DISABLED
```
### Secret lifecycle
```
ABSENT → REGISTERED (vault ref) → ROTATED → REVOKED
```

## 9. Business Rules

1. **Inheritance**: branch override menang atas org; org menang atas system. Reset = inherit semula.
2. **HQ** boleh edit semua level. **Branch Manager** boleh override branch-level own branch sahaja (kalau config `branchOverridable=true`). **Doctor/Receptionist** = view own scope sahaja.
3. **Locked config** (cth: canonical branch count, currency MYR) — hanya HQ boleh ubah, dengan reason wajib.
4. **Secrets TIDAK PERNAH** disimpan dalam frontend localStorage atau HTML source. Prototype: simpan `lastFour` + status sahaja; full value kekal dalam memori session semata-mata bila user masukkan (demo boundary), production = server vault.
5. Setiap perubahan config = version baru + audit entry. Historical versions TIDAK boleh diubah.
6. Config yang affect kiraan kewangan (cth: timezone, currency) mesti warning: "changes apply prospectively".
7. Notification/AI toggles adalah CONFIG — domain consumer (WhatsApp Hub/AI Manager) wajib baca dari sini, tak boleh simpan copy sendiri.

## 10. RBAC / Permission Model

Ikut permissionMatrix (Administration, locked):
- `settings`: HQ = ALL; branch_manager = view + edit (own-branch override); branch_admin/doctor = view sahaja
- Integrations section: HQ sahaja (walaupun permissionMatrix settings view terbuka — section-level gate)
- Security (password change): semua role untuk diri sendiri; reset password orang lain = Administration (HQ)

## 11. Branch / Data Scope

- HQ: semua config, semua level, semua branch
- Branch Manager: org-level view + own-branch override
- Doctor/Receptionist: view effective config (resolved inheritance) untuk own branch sahaja
- Tiada cross-branch config leak — server state layer enforce

## 12. Cross-Domain Dependencies

| Settings perlukan | Settings berikan kepada |
|---|---|
| Administration: roles, branch list, actor identity | Finance: currency/timezone, integration status |
| — | WhatsApp Hub: notification config, template defaults |
| — | AI Manager: AI behaviour toggles |
| — | Operations: operational defaults |
| — | Reports: aggregation timezone |

## 13. Events Produced

- `config.updated` (key, level, scope, oldValue→newValue)
- `config.reset` (inherit semula)
- `integration.configured / tested / error / disabled`
- `secret.registered / rotated / revoked` (reference sahaja)
- `security.password_changed`

## 14. Events Consumed

- `staff.deactivated` (Administration) → disable user-level overrides
- `branch.closed` → freeze branch overrides (historical preserved)

## 15. Actions / Commands

| Command | Actor | Gate |
|---|---|---|
| Update clinic profile | HQ | Audit + version |
| Toggle notification/AI | HQ (any level); Manager (own branch kalau overridable) | Version + audit |
| Set branch override | HQ / Manager (own) | branchOverridable check |
| Reset to inherit | HQ / Manager (own) | Audit |
| Change own password | Semua | Current password verification |
| Register/rotate secret | HQ | Masked display; production = vault |
| Test integration | HQ | Read-only ping (Bukku: REAL GET) |

## 16. Audit Requirements

Setiap config change: actor, key, level, scope, old→new, reason (kalau locked config), timestamp.
Secret events: reference sahaja — nilai TIDAK PERNAH masuk audit.
Audit immutable; retention kekal (production: append-only table).

## 17. Notification Requirements

- Locked config diubah → alert HQ feed
- Integration ERROR → alert HQ
- Secret rotation due → reminder (production)
- Branch override created → visible dalam HQ settings review

## 18. Search Requirements

Config search by key/level/scope. Integration status filter. Audit search by actor/key/date.

## 19. AI Interaction Boundaries

| AI boleh | AI TIDAK boleh |
|---|---|
| READ effective config | Ubah config |
| RECOMMEND ("Reminder 24h off di 3 branch — nak on?") | Sentuh secrets |
| DRAFT config change proposal untuk HQ approve | Execute perubahan |
| — | Baca nilai secret |

## 20. Reporting / Analytics Implications

Settings produce: `config_change_count`, `override_count_by_branch`, `integration_health`, `secret_rotation_age`.
Reports consume — tak kira sendiri.

## 21. UX / Workspace Architecture

Page: **Settings** (System section). Sections:
1. Clinic Profile (form, save functional)
2. Notifications (toggles + timing, persist)
3. AI Behaviour (toggles, persist)
4. Security (password change functional + session info)
5. Integrations (Bukku: status, subdomain, base URL, masked key, test connection — pindah reference dari Finance page; Finance kekal ada connector view)
6. Branch Defaults (HQ: per-branch override table; Manager: own branch)

Setiap section ada "Updated by/when" + version indicator. Locked config ada 🔒 + reason prompt.

## 22. Prototype Implementation Requirements

Upgrade dari dummy ke functional:
- `SETTINGS` state: config registry dengan level + version
- Save Clinic Profile → persist state + audit + version++
- Toggles → persist + audit (bukan class toggle je)
- Branch override UI (HQ: pilih branch; Manager: own branch auto)
- Password change: validate current (demo: `medini123`), min length, audit — tanpa expose
- Integrations: Bukku status dari `BUKKU.status` (Phase 4), masked key `••••XXXX`, base URL editable, test button link ke `bukkuTestConn()`
- Inheritance indicator: "Inherited from Organization" vs "Branch override"
- Disclosure jelas: "Secrets disimpan server-side vault dalam production"

## 23. Smoke Test Requirements

S-01..S-25:
- Settings page renders semua sections
- Clinic profile save → state + version + audit
- Toggle persist (off→on state proof)
- Branch override: HQ boleh mana-mana branch; Manager own sahaja; cross-branch blocked
- Reset to inherit berfungsi
- Locked config 🔒 prompt reason
- Password: current salah reject; betul accept + audit
- Secrets masked (tiada plain key dalam DOM)
- Integrations status reflect BUKKU.status
- Non-HQ blocked dari system/org-level edit
- Existing 559 tests kekal PASS
- Zero JS errors

## 24. Production Backend Implications

- Schema: `config_entries` (key, level, scope_id, value, version), `config_versions`, `secret_refs`, `integration_status`
- tRPC router: `settings.ts` — `permProc('settings', ...)`, section gates
- Secret vault: server env/KMS; `secret_refs` simpan vaultPath + lastFour sahaja
- Inheritance resolution: server-side resolver (branch→org→system)
- Migration: prototype `SETTINGS` state → seed defaults

## 25. Risks / Open Decisions

| Item | Status |
|---|---|
| Session policy editing (TTL, force logout) | OPEN — sebahagian mungkin kekal Administration; decide Phase 8 |
| Secret rotation schedule automation | DEFER — production phase |
| Per-user preferences (theme, language) | DEFER — User-level config v2 |
| Config export/import (backup) | DEFER — production phase |
| Payment gateway credentials | FUTURE — ikut Integration Hub bila dibina |

---

## DOMAIN CONTRACT — SETTINGS

**OWNS:** ConfigEntry, ConfigVersion, SecretRef (reference sahaja), IntegrationStatus, configuration hierarchy & inheritance rules.
**SOURCE OF TRUTH:** config registry (satu-satunya tempat config hidup).
**CONSUMES:** `staff.deactivated`, `branch.closed` (Administration).
**PRODUCES:** `config.*`, `integration.*`, `secret.*` (ref), `security.password_changed`.
**COMMANDS:** update profile, toggle, override, reset, change password, register/rotate secret (HQ), test integration.
**AUDIT:** semua perubahan versioned + immutable audit.
**AI:** READ + RECOMMEND + DRAFT sahaja. EXECUTE = human (HQ/Manager ikut scope).

## LOCK GATE CHECKLIST

- [x] 25 gates documented
- [x] Hierarchy 5 level defined
- [x] Secrets boundary tegas (no frontend storage rule)
- [x] Inheritance + versioning modelled
- [x] RBAC ikut Administration matrix (locked)
- [x] Prototype upgrade path clear
- [x] Production path no-redesign

**LOCK GATE: PASS (architecture)** — prototype upgrade + smoke tests dalam sesi ini sebelum final LOCKED.
