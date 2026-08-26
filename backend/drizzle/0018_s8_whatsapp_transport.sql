-- Sprint 8 T2: WhatsApp transport runtime — message 'processing' lifecycle + failure reason.
-- Additive only; preserves S0–S7 behaviour.

-- Add 'processing' to the message-status enum (worker in-flight marker).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'wa_message_status'::regtype AND enumlabel = 'processing') THEN
    ALTER TYPE wa_message_status ADD VALUE 'processing';
  END IF;
END $$;

-- Failure reason for observability + retry classification (no content, no secrets).
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS last_error text;
