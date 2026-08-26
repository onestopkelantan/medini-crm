# PART 3 — WHATSAPP HUB CONSOLIDATION (COMPLETE)

**Date:** 13 August 2026
**Status:** ✅ COMPLETE — verified 634/634 PASS
**Based on:** docs/TARGET-ARCHITECTURE.md

---

## Objective
Kecilkan WhatsApp Hub kepada "Manage conversations" sahaja — buang campaign responsibilities ke Marketing, simplify channel view, kekal operational AI (AI Suggest) dalam Inbox.

## Perubahan

### 1. Buang Campaign Queue dari WhatsApp Hub
- `WAH.campaignQueue` — dibuang dari state
- `waCampaignQueueView()` — dibuang (function + drawer)
- Butang "📤 Campaign Queue" — dibuang dari header
- Semua rujukan "Campaign Queue" — tiada lagi dalam page WhatsApp Hub

### 2. Template ownership dijelaskan
- `waTemplatesView()` → "Quick Reply Templates" (conversation quick replies sahaja)
- Nota "Campaign templates belong to Marketing" — ownership jelas
- Template picker dalam composer (`waInsertTemplate`) — kekal untuk operational reply

### 3. Channel bar disimplify
- Nama session WAHA (`medini-gp`, `medini-st`) — DISEMBUNYIKAN (infrastructure detail)
- User biasa nampak: branch + phone + status (Connected / Need QR)

### 4. Teks Marketing handoff dijelaskan
- "Communication Hub" → **"WhatsApp Hub"** (nama domain konsisten)
- "Communication Hub queue" → "WhatsApp Hub for delivery"
- `mktFollowUpViaHub` toast → "Follow-up sent to WhatsApp Hub for delivery"
- `mktPauseCampaign` — buang "(WhatsApp safety)" (mkt tak patut sebut mekanisme WAHA)

### 5. State model — dokumentasi sahaja (belum rewrite)
- `waChats[index]`, `WAH.assignments[index]`, `WAH.resolved[index]` — masih kekal untuk backward compat
- Target canonical model (conversationId stable) — documented dalam TARGET-ARCHITECTURE.md §5
- Migration gradual — bukan rewrite sekarang

## Kekal (tidak diubah)
- ✅ 3-pane layout (list, chat, context)
- ✅ Branch scope (`waVisibleIdx`, `getScopedChats`)
- ✅ Assignment/Resolve/Reopen
- ✅ AI Suggest dalam composer
- ✅ Escalation
- ✅ Patient context + View 360
- ✅ RBAC enforcement
- ✅ Audit trail

## Verification

```
Focused WhatsApp: TOTAL 25 | PASS 25 | FAIL 0
Full suite:       TOTAL 634 | PASS 634 | FAIL 0
```

## Files diubah
- `CURRENT-MEDINI-REVIEW.html` (+ app/reviews sync, MD5 identical)
- `app/smoke-review.mjs` (W-15..W-18 updated)
- `app/smoke-whatsapp.mjs` (focused test updated)

## Next
Part 4 — Marketing Consolidation (pastikan Marketing own outreach intent; campaign handoff ke WhatsApp Hub)
