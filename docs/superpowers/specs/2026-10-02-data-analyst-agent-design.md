# Data Analyst Agent — Design

**Date:** 2 Oct 2026
**Status:** Draft — for user review
**Sub-project:** Mentor requirement #4/#5 — the 4th agent + "data analytics" skill
**Registry:** agent `data-analyst` already registered (ownerDomain `reports`), capabilities `reports READ` + `finance READ` already granted.

---

## 1. Problem

The Data Analyst agent exists in the registry but has no engine: nothing in
the product lets anyone ask a question in plain language and get an answer
grounded in clinic data. The mentor's vision — "mengurus data analisis" — needs
a path from question → data → grounded answer.

What already exists (verified):
- **Reports service**: 11 methods — kpis, revenueByBranch, treatmentMix,
  appointmentTrends, doctorProduction, newPatients, allergies, formsIssued,
  accessAudit, whatsappTemplates, kpiRegistry — all permission-guarded,
  all scope-aware (HQ sees all branches, manager sees own).
- **MiniMax adapter**: proven live ("Sedia", real replies).
- **AiPolicyPort.canAutoExecute**: the governance seam the policy wiring just
  proved on the WhatsApp path.
- **/nur/ask**: the security pattern for an ask-the-model endpoint.

What is missing: the connective tissue. A user asks "berapa kutipan
Setia Tropika bulan lepas?" and something must (1) decide which report(s)
answer it, (2) fetch the data, (3) give ONLY those numbers to the model,
(4) return a grounded reply.

## 2. Goal

One new endpoint that answers data questions with real numbers:

```
POST /v1/ai/analyst/ask { message }
  → { reply, sources: [{key, period}], metrics: {...} }
```

The model may phrase the answer; it may never invent the numbers. Every figure
in a reply is traceable to a reports endpoint call.

## 3. Approach — FACTS-FIRST (no natural-language SQL)

Three options considered:

**A. Text-to-SQL** — model writes SQL against the schema, we execute it.
**B. Tool-calling loop** — model iteratively calls report endpoints.
**C. Facts-first (chosen)** — a deterministic resolver picks the report(s),
   fetches numbers, and injects them as FACTS into a single model call.

Why C, objectively:

| | A (text-to-SQL) | B (tool loop) | **C (facts-first)** |
|---|---|---|---|
| Injection/injection-adjacent risk | real (SQL from a model) | low | none |
| Latency | 2+ model calls + query | 2–4 model calls | **1 model call** |
| Cost | highest | high | **lowest** |
| Hallucination surface | query may be subtly wrong | tool args may drift | **numbers come from code** |
| Deterministic testability | poor | poor | **pure resolver = unit-testable** |
| Fits existing patterns | no | no | **yes — same shape as slot injection** |

This mirrors the Booking Manager design exactly: slot facts in, model words
out. The repo already established that pattern; consistency is worth more
than flexibility we don't need yet. (YAGNI: if questions someday need joins no
report covers, the resolver grows a case — under test.)

## 4. Design

### 4.1 Components

```
analyst-question.ts   (domain, pure)   — question → {reportKey, period} resolver
analyst-facts.ts      (domain, pure)   — facts object → prompt FACT lines
analyst.service.ts    (application)    — orchestrates: policy gate → resolve
                                         → fetch via ReportsService → facts → model
analyst.controller.ts (presentation)   — POST /v1/ai/analyst/ask
```

### 4.2 Question resolver (pure, fail-closed)

`resolveAnalystQuestion(text, today)` returns `{ keys: ReportKey[], period }`:

- **Period**: 7D/30D/90D/12M from Malay/English mentions (`bulan lepas`,
  `minggu ini`, `last month`, `30 hari`, `this year`…) — default **30D**.
- **Report keys** matched by keyword sets (Malay + English):
  - revenue/kutipan/jualan/hasil/pendapatan → `kpis` + `revenueByBranch`
  - no-show/tidak hadir → `kpis` (noShowRate) + `appointmentTrends`
  - treatment/rawatan → `treatmentMix`
  - doktor/doctor → `doctorProduction`
  - pesakit baharu/new patient → `newPatients`
  - borang/forms/MC → `formsIssued`
- **No match → keys: []** → the service replies honestly: "tiada data untuk
  soalan itu" with a list of what it CAN answer. Never guesses a report.
- Multiple matches are fine (e.g. "jualan dan no-show" → both).

### 4.3 Facts builder (pure)

`buildAnalystFacts(data)` turns each report result into FACT lines:

```
DATA DISAHKAN SISTEM (jawab HANYA dengan nombor ini; JANGAN mereka angka):
KPI (30D): jumlah jualan RM2,550 · temujanji selesai 10 · no-show 10%
REVENUE IKUT CAWANGAN (30D): Bukit Indah RM2,100 · Setia Tropika RM350 · ...
```

Numbers that are `available:false` (the honest-unavailable KPIs) are rendered
as "tidak tersedia" — the model is told to SAY unavailable, matching the
existing honesty rules (`revenue_per_appointment` precedent).

### 4.4 Service flow

```
principal (HQ or branch_manager; permission 'reports','view' + 'ai','view')
  1. policy gate: canAutoExecute('data-analyst','reports','analyst.answer')
     → not AUTO → 403 "Data Analyst agent is paused" (the button stays real)
  2. resolveAnalystQuestion(message)
     → keys empty → honest capability reply (no model call)
  3. for each key: ReportsService[key](principal, period)   ← real scope: a
     branch_manager gets branch-scoped numbers automatically, because the
     reports layer already enforces scope. No new authz code.
  4. buildAnalystFacts(...) → single minimax.chat(analystPrompt + facts, message)
  5. return { reply, sources: [{key, period}] }
```

### 4.5 The prompt

Analyst persona (BM-first, mirrors nurPrompt conventions):

```
Awak ialah penganalisis data Klinik Pergigian Medini. Jawab soalan staf
tentang data klinik menggunakan HANYA DATA DISAHKAN SISTEM di bawah.
- Bahasa Melayu profesional; boleh campur istilah Inggeris.
- Sebut angka dari data sahaja. JANGAN mereka, jangan agak, jangan kira sendiri.
- Kalau data tidak tersedia, kata terus "tidak tersedia".
- Maksimum 4-5 ayat. Sebut tempoh (contoh: "bagi 30 hari lepas").
```

### 4.6 Security (mirrors /nur/ask precedent)

- `@RequirePermission('ai', 'view')` + **HQ-only** (the /nur/ask rationale:
  financial figures behind this surface make it at least as sensitive; a
  branch_manager has Reports for their own branch already, so no loss).
- Policy-gated by agent status (paused → refuse).
- Rate: reuses the global throttler; one model call per request, bounded facts.

## 5. Error handling

- Policy gate not AUTO → 403 with the agent's status (no model call).
- Resolver empty → canned capability list reply (no model call).
- A report method throws → that report's facts are omitted; the reply says
  which data is unavailable rather than failing the whole answer.
- MiniMax down → 503 AiProviderUnavailable (existing adapter behaviour).

## 6. Testing

1. **Unit — resolver**: period extraction (`bulan lepas`→30D, `7 hari`→7D,
   none→30D) and key matching (revenue both languages, no-match→[], multi-key).
   Fail-closed cases included. ~15 cases.
2. **Unit — facts builder**: numbers rendered, unavailable rendered as
   "tidak tersedia", shape of FACT header.
3. **Integration (live MySQL, honest-skip pattern)**: seed minimal data →
   call the service → assert `sources` populated and facts contain the
   revenue figure from the seed; model text not asserted.
4. **Live manual**: `/ai` UI later gets an "Ask the analyst" panel — for now
   verify by curl as HQ: reply must quote real RM figures from Reports.

## 7. Risks / trade-offs

| Risk | Assessment |
|---|---|
| Keyword resolver misses a phrasing | Fails honestly with the capability list; grows a case under test |
| Model rephrases a number wrongly | Mitigated: facts say "JANGAN mereka"; `sources` lets the operator verify |
| Scope leakage | None new — ReportsService enforces by principal; we pass the caller's principal through unchanged |
| Another parallel-session collision | Checked git log before starting (18 clean minutes); checkpoint tag before code |
| Cost | 1 model call/question, only when resolver matches |

## 8. Explicitly deferred (YAGNI)

- UI panel in AI Manager (endpoint first; the tab exists and can host it later)
- Tool-calling / free SQL (revisit only when a real question set proves the
  resolver insufficient)
- Chart/image generation; multi-turn analyst memory; scheduled digests
- Caching of report results (30D queries are fast; cache when a question log
  shows repeats)

## 9. Verification checklist

- [ ] checkpoint tag before code
- [ ] `tsc -b` + unit suites green (new tests: resolver + facts)
- [ ] integration test passes against live MySQL (or honest-skips)
- [ ] live curl: HQ asks "berapa kutipan bulan lepas?" → reply quotes the
      real RM2,550-class figure from Reports (not invented)
- [ ] branch_manager receives 403 (HQ-only), doctor 403
- [ ] paused agent → 403 "paused" (the gate is real here too)
