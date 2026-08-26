# SETTINGS DOMAIN — LOCKED

**Locked:** 13 August 2026 · **Blueprint Lock Program Phase 2 (Group A: System Foundation)**
**Authority:** docs/SETTINGS-ARCHITECTURE.md

---

## PHASE: 2 — Settings Domain Lock
## STATUS: ✅ LOCKED

## OBJECTIVES:
- Lock configuration hierarchy: System → Organization → Branch → Role → Feature
- Lock separation: configuration vs operational data vs secrets
- Lock versioned config changes + immutable audit
- Lock inheritance: branch override > organization > system
- Lock secrets boundary: masked, never in DOM/source; production = server vault
- Lock RBAC: HQ all levels; Manager own-branch override; others view

## COMPLETED:
- [x] Architecture document (25 gates) — SETTINGS-ARCHITECTURE.md
- [x] Domain contract
- [x] Prototype: 6 sections — Clinic Profile / Notifications / AI Behaviour / Security / Integrations / Branch Defaults
- [x] SETTINGS state: config registry + versions + audit
- [x] Save profile functional (persist + version + audit)
- [x] Toggles persist (bukan dummy lagi) + org/branch level logic
- [x] Branch override with inheritance + "branch override" indicator
- [x] Non-overridable settings blocked for branch level
- [x] Password change: current validation + min 8 + confirm match + audit
- [x] Locked configs (currency/timezone) disabled with 🔒 note
- [x] Integrations: Bukku config moved here; key masked; input cleared after save; status pill live dari BUKKU.status; test connection link
- [x] Branch Defaults view
- [x] Scope pill (HQ all levels / Manager branch / view only)

## ARCHITECTURE DECISIONS:
- Settings owns config registry — satu-satunya tempat config hidup; consumers (WhatsApp/AI/Finance) baca dari sini
- Secrets: SecretRef reference only; nilai sebenar production vault; prototype masked + disclosure
- Versioning pattern sama macam Finance config engine (locked) — consistency
- Session policy editing deferred — Phase 8 consolidation (boleh jadi kekal view-only)
- Per-user preferences deferred v2

## DOMAIN CONTRACT:
- OWNS: ConfigEntry, ConfigVersion, SecretRef, IntegrationStatus, hierarchy rules
- SOURCE OF TRUTH: config registry
- CONSUMES: staff.deactivated, branch.closed
- PRODUCES: config.*, integration.*, secret.* (ref), security.password_changed
- COMMANDS: update profile, toggle, override, reset, change password, save/test integration
- AUDIT: semua perubahan versioned + immutable
- AI: READ + RECOMMEND + DRAFT sahaja

## RBAC:
- HQ: semua level
- Branch Manager: own-branch override (overridable settings sahaja)
- Doctor/Receptionist: view effective config
- Integrations: HQ only (section gate)

## CROSS-DOMAIN DEPENDENCIES:
- Consumes: Administration (roles, branches, actor)
- Produces: Finance (currency/tz, integration status), WhatsApp Hub (notif config), AI Manager (AI toggles), Reports (aggregation tz)

## TESTS:
- S-01..S-25: **25/25 PASS**
- Full suite: **584/584 PASS** (559 + 25)
- Zero JS errors

## RISKS:
- Session policy placement — OPEN (Phase 8)
- Secret rotation automation — production phase
- Config export/import — production phase

## OPEN DECISIONS:
- Session management UI home (Settings vs Administration) — decide Phase 8

## LOCK GATE: ✅ PASS

## NEXT PHASE:
Phase 3 — X-Ray & Documents Domain Lock (Group B: Operational Data Foundation)
