-- ============================================================================
-- 0030 — appointment_reminders reminder_type 'h8' (E6, H-8 jam)
--
-- WHY
--
-- The clinic's agreed reminder policy (6 Okt, owner decision) is a single
-- WhatsApp CONFIRMATION 8 hours before the visit: "esok/8 jam lagi, datang
-- tak?" — one message per appointment, not a risk-based ladder. The
-- appointment_reminders table (0027) predates that decision and its
-- reminder_type enum has no fitting value: 'same_morning' and 'day_before'
-- are fixed-time concepts, 'high_risk_extra' belongs to the removed
-- no-show-risk feature.
--
-- 'h8' says exactly what it is: due 8 hours before the appointment, for
-- ANY booked visit. The scheduler reads scheduled_for, so nothing else
-- about the row changes.
--
-- ENUM GROWTH IN MYSQL
--
-- ALTER ... MODIFY on an enum is a metadata-only rewrite for a wider list
-- (rows are untouched); adding at the END keeps existing ordinal values
-- stable. Hand-applied like 0027–0029 and recorded in the journal.
-- ============================================================================

ALTER TABLE `appointment_reminders`
  MODIFY COLUMN `reminder_type` enum('same_morning','day_before','high_risk_extra','h8')
  NOT NULL;
