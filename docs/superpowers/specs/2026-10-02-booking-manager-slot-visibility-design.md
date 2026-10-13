# Booking Manager: Slot Visibility for Nur — Design

**Date:** 2 Oct 2026
**Status:** Draft — for user review
**Sub-project:** Mentor requirement #1 — *"Reply Booking lalu jadi Booking Manager yang pastikan waktu available"*
**Confirms:** Booking model is **fully autonomous** (AI confirms → appointment created, no staff approval).

---

## 1. Problem

The AI receptionist Nur cannot see the doctor's schedule when she replies, so she
cannot answer the most common booking question: *"Sabtu pagi ada masa kosong?"*

The slot engine exists and is correct. `findFreeSlots` (pure, tested) computes free
slots from `doctor_schedules` against existing `appointments`. But it runs **only
inside the booking-completion path** (`maybeSaveBooking` → `findAlternatives`) —
i.e. only AFTER the patient has already given full details (name, date, time,
treatment) and a validation has failed.

The result is a two-message experience:

| Message | Sees real availability? |
|---|---|
| Nur's conversational reply | ❌ no slot data — she answers generically |
| Booking-system message (post-extraction) | ✅ verified slots, but only on failure |

Nur's own prompt (line ~121) **promises** the capability — *"Sistem akan berikan
senarai masa yang KOSONG. Tawarkan maksimum 2 pilihan daripada senarai itu"* —
but nothing ever provides that list to the model. The promise is currently untrue.

**Verified:** 2 MiniMax calls per inbound message (reply at line 666, extraction at
line 1196). The extraction call runs after every reply, which is the natural seam
for a future cheap-model split (out of scope here, see §8).

## 2. Goal

One change: when a date is in play, Nur's reply context contains the verified free
slots for that date, so she offers them conversationally — in her own words, with
doctor names — before the patient has to give full details.

Non-goals: no new tables, no model split, no changes to the booking validation
gauntlet (duplicate / holiday / past-date / doctor-on-shift / occupied checks all
stay exactly as they are).

## 3. Approach (chosen: Option A from brainstorm)

**Inject live slots into Nur's reply context.** In `answerConversation`, when a
date can be determined (from booking memory or the current message), run the same
schedule query `findAlternatives` uses, take up to 2 free slots, and append them
to the AI context as facts.

Why the alternatives were rejected:
- **Option B (keep two-message design, polish wording)** — leaves Nur unable to
  answer the most common question; the mentor's requirement is explicitly that
  the agent ("Booking Manager") ensures availability, not a post-hoc form message.

## 4. Design

### 4.1 Where the change lives

All in `backend/src/modules/ai-manager/presentation/whatsapp-webhook.controller.ts`
(the controller is already 2,000+ lines and this reuses its private helpers;
extracting a service is a separate refactor, not smuggled in here).

### 4.2 New private method: `freeSlotsContext`

```ts
/**
 * Verified free slots for a date, phrased for the AI prompt.
 * Reuses the exact query findAlternatives() runs (doctor_schedules × staff ×
 * appointments), so Nur can never know more or less than the booking system.
 * Returns '' when there is no date to search for — most messages are not
 * booking-related and must not pay a schedule query.
 */
private async freeSlotsContext(
  scope: WaScope,
  date: string | null,
  doctorId?: string | null,
): Promise<string>
```

Behaviour:
1. `date` null or unparsable → return `''` (no cost).
2. Run the same shifts+busy query as `findAlternatives` (14-day window from the
   requested date, active doctors of THIS branch, appointments excluding
   cancelled/no-show).
3. `findFreeSlots({ shifts, busy, preferredDoctorId: doctorId ?? null,
   preferredDate: date, preferredMin: null, limit: 2 })` — same call shape as
   the existing booking path, `preferredMin: null` because the patient named a
   day, not a time.
4. Empty result → return `'\nSLOT KOSONG: tiada slot ditemui untuk tarikh ini.
   Cadangkan tarikh lain; JANGAN mereka masa.'` — the honest empty case is a
   FACT the model must state, not improvise past.
5. Otherwise return:

```
\nSLOT KOSONG (disahkan sistem, tawarkan maksimum 2):
• 2026-10-04 10:30 — Dr. Aina Rahman
• 2026-10-04 11:00 — Dr. Aina Rahman
```

Format matches the line format `findAlternatives` already produces
(`• ${date} ${label} — ${doctorName}`) so the model sees one consistent shape
wherever slots appear.

### 4.3 Where the date comes from

In `answerConversation`, after `previous = getBookingMemory(chatId)`:

- **Primary:** `previous?.date` — the accumulated booking memory (set by the
  extraction step after every AI reply, so turn N's reply already knows the date
  the patient gave in turn N).
- **Fallback (turn 1, no memory yet):** a light regex over the current `text` for
  a date mention — the same normalisation idea the codebase already applies in
  `normalizeDate`. Malaysian forms: `Sabtu`, `Sabtu ini`, `esok`, `lusa`,
  `27 Okt`, `2026-10-04`. Two rules keep it honest:
  - Only weekday/relative words are resolved via `malaysiaDate()` (already in
    file); anything ambiguous → no date → no slots (fail-closed, same as the
    slot engine's own "drop, don't default" rule at line 1155).
  - A wrong day-name guess is harmless: the slots shown would be for the wrong
    day, but every one of them is STILL a real free slot — the patient will
    correct the day and the next turn re-runs with memory. Nothing is invented.

`doctorId` comes from `previous?.doctorId` (patient named a doctor earlier) —
the same field `findAlternatives` already honours.

### 4.4 Injection point

In the `context` string built at lines 649–664, appended after the `knownDoctor`
block and before `CAWANGAN ANDA`:

```ts
const slotContext = await this.freeSlotsContext(
  burstScope, dateForSlots, previous?.doctorId,
);
// context = ... + (knownDoctor ? ... : ...) + slotContext + `\nCAWANGAN ANDA...`
```

The system prompt line at 671 already tells the model not to invent slot
decisions; slot facts in context give that rule something real to stand on.

### 4.5 The complete booking flow after this change

```
Turn 1  "Sabtu pagi ada masa kosong?"
          extraction: {is_booking:true, date:'Sabtu'} → memory
          reply: context has SLOT KOSONG for Saturday → Nur offers
                 "Sabtu 10:30 dan 11:00 bersama Dr. Aina — yang mana sesuai?"
Turn 2  "10:30 boleh, nama saya Anjas, nak scaling"
          extraction: {name, time, treatment} → memory complete
          reply: Nur confirms details conversationally
          maybeSaveBooking: full validation gauntlet
              ✗ fails → existing alternative/verbal messages (unchanged)
              ✓ passes → appointment + booking_request created (unchanged),
                         "Booking berjaya disahkan + Kod: APT-xxxx"
```

Every slot Nur ever mentions is a system-verified fact. The model chooses words,
never times.

## 5. Error handling

- `freeSlotsContext` catches its own DB errors and returns `''` (mirrors
  `findAlternatives`: a failed lookup must never break the patient's reply).
- No Redis → no booking memory → no date → no slot query (the no-memory path is
  exactly today's behaviour, unchanged).
- Empty schedule (no doctor_schedules rows for the branch) → "tiada slot
  ditemui" fact, which is ALSO today's behaviour for a booking attempt with no
  schedules — consistent, and it surfaces a real configuration gap in the demo
  data instead of hiding it.

## 6. Testing

TDD per the superpowers workflow:

1. **Unit — date extraction fallback** (`test/unit/booking-slot-context.spec.ts`,
   new): the regex/normalisation mapping — `Sabtu ini` → next Saturday,
   `esok` → tomorrow, `27 Okt` → 2026-10-27, garbage → null. Pure function,
   extracted as `resolveMentionedDate(text, today)` so it is testable without
   Redis/DB.
2. **Unit — slot context formatting**: given fixed shifts/busy, the context
   string contains exactly 2 bullets in the `• date label — doctor` shape; empty
   case yields the "tiada slot" fact line.
3. **Integration — happy path** (extend the existing live-MySQL pattern from
   `fasa4-conversation-reply.spec.ts`): seed a doctor_schedules row + one busy
   appointment, POST a WAHA-shaped webhook with a dated booking message, assert
   the model prompt received slots OR — because MiniMax is nondeterministic —
   assert on the observable seam instead: log/mock capture of `freeSlotsContext`
   output. The reply text itself is not asserted verbatim.
4. **Live verification (manual, when a channel is next paired):** send
   "Sabtu pagi ada masa kosong?" from a phone; Nur's reply must contain a real
   slot from doctor_schedules. DB assertion: `wa_messages` inbound row exists
   (already tested by prior fix).

## 7. Risks and trade-offs

| Risk | Assessment |
|---|---|
| Extra DB query per reply | Only when a date is in play; the query is the same one the booking path already runs, indexed on (org, branch, schedule_date) |
| Model offers a slot then booking fails (race: slot taken between reply and confirm) | Pre-existing: the validation gauntlet re-checks at booking time and offers alternatives. The injection does NOT create this race; it only surfaces slots earlier |
| Wrong day resolved from ambiguous text ("Sabtu" when patient meant next week) | Slots shown are still real; patient corrects; fail-closed default for ambiguity |
| Larger prompt | +2 lines of context, bounded by `limit: 2` |
| Channel/AI off | Untouched — this lives entirely in the allowed reply path |

## 8. Explicitly deferred (YAGNI, documented for later)

- **Model split** (reply model vs cheap extraction model). The seam is exactly
  `minimax.chat()` at 2 call sites; a split later is one env var + second
  adapter instance. Deferred until real message volume justifies it.
- **Multi-day slot search** ("bila lagi ada?") — `findFreeSlots` already
  supports the 14-day window; extending Nur to offer across days is a prompt
  tweak after this lands, not part of this change.
- **Extracting a BookingService** out of the 2,000-line controller — separate
  refactor, should not ride along.

## 9. Verification checklist (from this session's lessons)

- [ ] `tsc -b` both sides (the real gates, per repo convention)
- [ ] Unit tests pass; integration test honest-skips when MySQL is down
- [ ] One commit: `feat(wa): Nur offers system-verified free slots when a date is in play`
- [ ] Checkpoint tag before the change
- [ ] No `.env`, no secrets, no unrelated files in the diff
- [ ] Live send verification deferred until a channel is paired again (test number banned)
