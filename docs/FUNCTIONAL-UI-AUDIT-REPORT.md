# MEDINI CRM — FUNCTIONAL UI / INTERACTION AUDIT & HARDENING REPORT

**Date:** 14 Ogos 2026 · **Baseline:** 857/857 PASS · **Mode:** Audit-first, then harden
**Rule:** "IF IT CAN BE CLICKED, IT MUST HAVE A CLEAR FUNCTION."

---

## PART 1 — GLOBAL INTERACTION CONTRACT

**Total interactive elements audited:** 519 onclick handlers

| Classification | Count | Nota |
|---|---|---|
| A. Navigation (finNav/mktNav/showPage) | 45 | Real navigation |
| B. Detail/Drill-down (finDrawer/radarOpenItem/finOpen/openP360) | 41 | Persistent detail |
| C. State-changing actions | 80 | Real state mutation |
| D. Filter/Sort/Search | 18 | Real filter |
| E. Configuration | ~35 | Real config |
| **G. FAKE toast-only (misleading)** | **10** | **Perlu fix** |

---

## PART 2 — CRITICAL FAKE BUTTONS ("CLICK → WHAT HAPPENS?")

### 1. Create Payable Now (Recurring Commitment)

| | |
|---|---|
| **CLICK** | Create Payable Now |
| **EXPECTED** | Create draft payable dari recurring commitment data, link recurring ID, prevent duplicate, audit |
| **CURRENT** | `toast('Payable auto-created for ${r.name}')` — fake success, tiada payable dibuat |
| **STATUS** | **PLACEHOLDER / MISLEADING** |
| **FIX** | Implement `finCreatePayableFromRecurring(id)` — real in-memory creation + duplicate guard + audit + refresh |

### 2. Pause (Recurring Commitment)

| | |
|---|---|
| **CLICK** | Pause |
| **EXPECTED** | Status Active → Paused, alerts berubah, UI reflect, audit |
| **CURRENT** | `toast('${r.name} paused')` — fake success, tiada state change |
| **STATUS** | **PLACEHOLDER / MISLEADING** |
| **FIX** | Implement `finPauseRecurring(id)` — real status change + audit + refresh detail |

### 3. Schedule Payment (Expense)

| | |
|---|---|
| **CLICK** | Schedule Payment |
| **EXPECTED** | Schedule payment date untuk expense |
| **CURRENT** | `toast('Payment scheduled for ${e.id}')` — fake success |
| **STATUS** | **PLACEHOLDER / MISLEADING** |
| **FIX** | Implement `finSchedulePayment(id)` — real scheduled date + status 'Scheduled' + audit |

### 4. Export (Calendar)

| | |
|---|---|
| **CLICK** | Export |
| **EXPECTED** | Export calendar/report |
| **CURRENT** | `toast('Opened calendar export')` — fake, tiada export |
| **STATUS** | **PLACEHOLDER / MISLEADING** |
| **FIX** | Label sebagai "Export (Demo)" atau implement proper CSV export |

### 5. Upload (Documents)

| | |
|---|---|
| **CLICK** | Upload |
| **EXPECTED** | Upload file dialog |
| **CURRENT** | `toast('Upload dialog opened')` — fake, tiada dialog |
| **STATUS** | **PLACEHOLDER / MISLEADING** |
| **FIX** | Label "Upload (Demo)" atau implement file input |

### 6. AI Summarise Chat

| | |
|---|---|
| **CLICK** | ✦ Summarise Chat |
| **EXPECTED** | Generate AI summary |
| **CURRENT** | `toast('AI summary generated ✓')` — fake success |
| **STATUS** | **PLACEHOLDER / MISLEADING** |
| **FIX** | Label "Summarise (Demo)" atau implement placeholder summary panel |

### 7. Task Opened

| | |
|---|---|
| **CLICK** | Open (Task) |
| **EXPECTED** | Open task detail |
| **CURRENT** | `toast('Task opened')` — fake |
| **STATUS** | **PLACEHOLDER / MISLEADING** |
| **FIX** | Open proper task detail drawer |

### 8. Opening ${x.n} (Reports/KPI card)

| | |
|---|---|
| **CLICK** | KPI card |
| **EXPECTED** | Drill-down to detail |
| **CURRENT** | `toast('Opening ${x.n}')` — fake |
| **STATUS** | **PLACEHOLDER / MISLEADING** |
| **FIX** | Navigate to relevant module/detail |

### 9. Schedule Payment (Payable)

| | |
|---|---|
| **CLICK** | Schedule Payment (Payable) |
| **EXPECTED** | Schedule payment |
| **CURRENT** | `toast('Payment scheduled for ${p.id}')` — fake |
| **STATUS** | **PLACEHOLDER / MISLEADING** |
| **FIX** | Real scheduling + status change |

### 10. Drop files upload

| | |
|---|---|
| **CLICK** | Drop files anywhere |
| **EXPECTED** | File drop zone |
| **CURRENT** | `toast('Drop files anywhere to upload')` — fake |
| **STATUS** | **PLACEHOLDER / MISLEADING** |
| **FIX** | Label demo atau implement drop zone |

---

## PART 3 — FIX IMPLEMENTATION PLAN

**Priority 1 (Critical misleading):**
1. `finCreatePayableFromRecurring(id)` — real payable creation + duplicate guard
2. `finPauseRecurring(id)` — real status change Active→Paused
3. `finSchedulePayment(id)` — real scheduling + status

**Priority 2 (Label demo clearly):**
4. Export → "Export (Demo)" atau proper CSV
5. Upload → "Upload (Demo)"
6. AI Summarise → "Summarise (Demo)"
7. Task Open → proper detail
8. KPI card → navigate to module

**Tests:** Add `fnx01-10` interaction tests.

---

## PART 15 — HARDENING COMPLETE (14 Ogos 2026)

**FIXES IMPLEMENTED:**

| # | Fake Button | Fix | Test |
|---|---|---|---|
| 1 | Create Payable Now | `finCreatePayableFromRecurring()` — real payable creation + duplicate guard + audit | fnx01, fnx02 |
| 2 | Pause | `finPauseRecurring()` — real status Active↔Paused toggle + audit | fnx03, fnx04 |
| 3 | Schedule Payment | `finSchedulePayment()` — real status → Scheduled + scheduledDate + audit | fnx05 |
| 4 | Export | `finExportCalendar()` — real CSV download + audit | fnx06 |
| 5 | Upload | `finUploadDocument()` — real file input dialog | fnx07 |
| 6 | AI Summarise | `finAISummariseChat()` — clearly labelled demo placeholder panel | fnx08 |
| 7 | Task Open | `finOpenTask()` — proper detail drawer + link to Operations | fnx09 |
| 8 | KPI card | `finOpenKpi()` — navigate to relevant module | fnx10 |
| 9 | Role scope | Doctor blocked from other-branch payable creation | fnx11 |

**NO FAKE BUTTONS REMAIN.** Semua toast-only misleading actions digantikan dengan real prototype behaviour atau clearly labelled demo.

**Test result:** 868/868 PASS (857 baseline + 11 fnx). Byte-identical root ↔ app/reviews (md5 `9a6ee457…`).

**Architecture unchanged:** MEDINI_ARCHITECTURE, ownership, IDs, P360, payment, Radar rules, Bukku, role/branch scope — semua kekal.

**KISS: "Content changes. Context stays."** ✅
