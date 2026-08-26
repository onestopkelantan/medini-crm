# WAHA CONNECTION FLOW (COMPLETE)

**Date:** 14 August 2026
**Status:** ✅ COMPLETE — verified 720/720 PASS
**Design:** KISS — auto branch dari login, QR direct, unlock conversation selepas connect

---

## Objective
WhatsApp Hub mesti "connect dulu" sebelum boleh guna. Kalau belum connect → banner + Connect Now → QR (simulated) → conversations unlock. Retention setting configurable.

## Flow (approved oleh Zul)

```
Buka WhatsApp Hub
   ├─ Branch connect? (auto dari login — tak payah pilih)
   │    ├─ YES → terus tunjuk conversations ✅
   │    └─ NO → banner "⚠️ This phone number is not connected"
   │         + [Connect Now]
   │              → Drawer: auto branch + number + QR (simulated)
   │              → "✅ I've Scanned the QR (simulate)"
   │              → connected → conversations unlock 🎉
```

## Perubahan

### WhatsApp Hub — Connection Flow
| Feature | Detail |
|---|---|
| `waActiveBranch()` | Auto dari login (HQ guna branchContext; lain guna branchId) |
| `waConnectNow()` | Buka drawer QR — auto branch + number + session, takde pilih branch |
| QR (simulated) | Placeholder ASCII QR + instruksi "WhatsApp → Linked Devices" |
| `waSimulateScan()` | Connect → status WORKING → audit `channel_connected` |
| `waDisconnect()` | Status → PENDING → audit |
| `waRenderConnectBanner()` | Amber "not connected" + Connect Now ATAU green "connected" + Disconnect; tunjuk X/5 numbers connected + retention |
| Inbox lock | Belum connect → inbox opacity 0.45 + header/chat/context kosong |
| Channel bar | Status: Connected (teal) / Scan QR (amber) / Not Connected (slate) |
| Channels | 5 channel (2 WORKING, 1 NEED_QR, 2 PENDING) — pattern untuk expand ke 14 |

### Settings → Integrations — WAHA card
| Feature | Detail |
|---|---|
| WAHA Base URL + API Key (masked) | Config server WhatsApp transport — 1 config untuk semua channel |
| Message History Retention | 3/6/12/36 months / Forever — `waSetRetention()` + audit `retention_updated` |
| Save + Test Connection (simulated) | Audit `integration_configured` / `integration_tested` |
| Nota | "Real connection: production phase (post-P9)" |

## Inter-domain
- **Settings → Integrations** (config WAHA) → **WhatsApp Hub → Channels** (connect per branch)
- 1 config serve semua 14 channel — connect berasingan per branch
- Retention = jawapan "berapa lama WhatsApp boleh baca" (1 bulan/3 bulan/1 tahun — configurable)

## Verification

```
TOTAL 723 | PASS 723 | FAIL 0
```
- 720 existing + 3 QR refresh tests (W-36..W-38) = 723
- W-26: branch auto dari login ✅
- W-27/28: banner "not connected" ✅
- W-29/30: Connect Now + QR ✅
- W-31/32: simulate scan → connected + audited ✅
- W-33: banner green + inbox unlocked ✅
- W-34: retention works ✅
- W-35: disconnect works ✅
- W-36: countdown + QR box ✅
- W-37: refresh QR regenerates + audited ✅
- W-38: QR pattern renders ✅

## QR Refresh Flow (30s — macam WhatsApp sebenar)

- `waConnectNow()` → set `expiresAt = now + 30000` → render drawer
- Countdown badge `⏳ Ns` update setiap saat
- **Auto-refresh** bila countdown ≤ 0 → `waRefreshQr()` → QR pattern baru + audit `channel_qr_refreshed`
- **Manual refresh**: butang [↻ Refresh QR] — sama flow
- QR pattern berubah setiap refresh (simulated — real: WAHA generate)
- Timer cleanup: clearInterval bila scan siap / drawer tutup

## Files diubah
- `CURRENT-MEDINI-REVIEW.html` (+ app/reviews sync, MD5 `c3898fc3...`)
- `app/smoke-review.mjs` (+10 tests)
- `app/smoke-whatsapp.mjs` (W-03 fix)

## Next
P8 — Cross-Domain Architecture Consolidation
