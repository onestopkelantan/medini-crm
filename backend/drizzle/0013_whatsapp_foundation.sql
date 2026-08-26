-- SPRINT 6 T1: WhatsApp Hub production foundation. Persistent simulated state ONLY.
-- NO WAHA transport, NO worker, NO queue/outbox processing, NO campaign execution (S8 scope).
-- Governance D1 (locked): doctor has NO whatsapp access — RLS below carries hq/branch roles only.
CREATE TYPE wa_channel_status AS ENUM ('stopped', 'starting', 'working', 'failed', 'need_qr');
CREATE TYPE wa_conversation_status AS ENUM ('new', 'open', 'pending', 'escalated', 'resolved', 'archived');
CREATE TYPE wa_message_direction AS ENUM ('in', 'out');
CREATE TYPE wa_sender_type AS ENUM ('patient', 'human', 'ai', 'system');
CREATE TYPE wa_message_status AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');
CREATE TYPE wa_assignment_action AS ENUM ('assign', 'unassign', 'handoff', 'return_to_ai');
CREATE TYPE wa_ai_queue_state AS ENUM ('received', 'buffering', 'ready', 'processing', 'responded', 'waiting', 'handoff', 'closed');
CREATE TYPE wa_safety_decision AS ENUM ('allowed', 'blocked');

-- 1. wa_channels — one active WhatsApp channel per branch/org (persistent simulated WAHA session state).
CREATE TABLE wa_channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 phone varchar(64) NOT NULL, session_name varchar(128), status wa_channel_status NOT NULL DEFAULT 'stopped',
 health_score integer NOT NULL DEFAULT 0 CHECK (health_score BETWEEN 0 AND 100),
 sent_today_count integer NOT NULL DEFAULT 0 CHECK (sent_today_count >= 0),
 sent_today_date date, last_sent_at timestamptz, last_seen_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
-- One ACTIVE channel per branch (soft-deleted channels are history, not duplicates).
CREATE UNIQUE INDEX wa_channels_branch_active_uq ON wa_channels(org_id, branch_id) WHERE deleted_at IS NULL;
CREATE INDEX wa_channels_branch_status_idx ON wa_channels(branch_id, status);

-- 2. wa_conversations — one ACTIVE thread per channel+contact. patient_id is a canonical FK only (no copied patient data).
CREATE TABLE wa_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 channel_id uuid NOT NULL REFERENCES wa_channels(id) ON DELETE restrict,
 contact_phone varchar(64) NOT NULL, patient_id uuid REFERENCES patients(id) ON DELETE restrict,
 status wa_conversation_status NOT NULL DEFAULT 'new',
 assigned_to uuid REFERENCES staff(id) ON DELETE restrict,
 ai_queue_state wa_ai_queue_state, unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
 last_message_at timestamptz, first_response_at timestamptz, resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
-- Deterministic duplicate protection: one ACTIVE (non-archived) conversation per channel+contact.
-- Archived conversations are terminal history; a returning contact opens a NEW conversation.
CREATE UNIQUE INDEX wa_conversations_active_contact_uq ON wa_conversations(org_id, channel_id, contact_phone) WHERE status <> 'archived' AND deleted_at IS NULL;
CREATE INDEX wa_conversations_branch_status_idx ON wa_conversations(branch_id, status);
CREATE INDEX wa_conversations_assigned_idx ON wa_conversations(branch_id, assigned_to);
CREATE INDEX wa_conversations_patient_idx ON wa_conversations(patient_id);

-- 3. wa_messages — authoritative immutable communication records. body is sensitive (RLS-protected).
CREATE TABLE wa_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 channel_id uuid NOT NULL REFERENCES wa_channels(id) ON DELETE restrict,
 conversation_id uuid NOT NULL REFERENCES wa_conversations(id) ON DELETE restrict,
 direction wa_message_direction NOT NULL, sender_type wa_sender_type NOT NULL,
 body text NOT NULL, media_type varchar(64), status wa_message_status NOT NULL DEFAULT 'queued',
 idempotency_key varchar(256), external_message_id varchar(256),
 sent_at timestamptz, delivered_at timestamptz, read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
-- Mandatory message idempotency backstop: one row per (conversation, key). Key REQUIRED for outbound records (service-enforced).
CREATE UNIQUE INDEX wa_messages_conv_idem_uq ON wa_messages(org_id, conversation_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;
-- S8-ready transport dedupe slot (unused in S6 — no WAHA).
CREATE UNIQUE INDEX wa_messages_channel_ext_uq ON wa_messages(org_id, channel_id, external_message_id) WHERE external_message_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX wa_messages_conv_created_idx ON wa_messages(conversation_id, created_at);
CREATE INDEX wa_messages_branch_status_idx ON wa_messages(branch_id, status);

-- 4. wa_assignments — append-only assignment/handoff history. NO updated_at/deleted_at (same discipline as audit_log).
CREATE TABLE wa_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 conversation_id uuid NOT NULL REFERENCES wa_conversations(id) ON DELETE restrict,
 action wa_assignment_action NOT NULL, assigned_to uuid REFERENCES staff(id) ON DELETE restrict, actor_id uuid REFERENCES staff(id) ON DELETE restrict,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_assignments_conv_idx ON wa_assignments(conversation_id, created_at);
CREATE INDEX wa_assignments_branch_idx ON wa_assignments(branch_id, created_at);

-- 5. wa_templates — quick-reply content records only (no automated sending).
CREATE TABLE wa_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 name varchar(256) NOT NULL, body text NOT NULL, category varchar(64), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, deleted_at timestamptz
);
CREATE UNIQUE INDEX wa_templates_org_branch_name_uq ON wa_templates(org_id, branch_id, name) WHERE deleted_at IS NULL;
CREATE INDEX wa_templates_branch_active_idx ON wa_templates(branch_id, active);

-- 6. wa_safety_decisions — auditable record of every safety-gate evaluation (allowed AND blocked).
CREATE TABLE wa_safety_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE restrict,
 channel_id uuid NOT NULL REFERENCES wa_channels(id) ON DELETE restrict,
 conversation_id uuid REFERENCES wa_conversations(id) ON DELETE restrict, message_id uuid,
 actor_id uuid, decision wa_safety_decision NOT NULL, blocked_reason varchar(64), gates jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_safety_decisions_branch_idx ON wa_safety_decisions(branch_id, created_at);
CREATE INDEX wa_safety_decisions_channel_idx ON wa_safety_decisions(channel_id, created_at);
CREATE INDEX wa_safety_decisions_conv_idx ON wa_safety_decisions(conversation_id);

GRANT SELECT, INSERT, UPDATE ON wa_channels, wa_conversations, wa_messages, wa_templates TO medini_app;
GRANT SELECT, INSERT ON wa_assignments, wa_safety_decisions TO medini_app;

ALTER TABLE wa_channels ENABLE ROW LEVEL SECURITY; ALTER TABLE wa_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_conversations ENABLE ROW LEVEL SECURITY; ALTER TABLE wa_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY; ALTER TABLE wa_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE wa_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_templates ENABLE ROW LEVEL SECURITY; ALTER TABLE wa_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_safety_decisions ENABLE ROW LEVEL SECURITY; ALTER TABLE wa_safety_decisions FORCE ROW LEVEL SECURITY;

-- WhatsApp scope policy (D1): hq full; branch roles (branch_manager/branch_admin/receptionist) own branch.
-- Doctor is ABSENT → denied at DB layer as well as the RBAC matrix. Fail-closed without app context.
CREATE POLICY wa_channels_scope ON wa_channels USING (app_role() = 'hq' OR (app_role() IN ('branch_manager','branch_admin','receptionist') AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() IN ('branch_manager','branch_admin','receptionist') AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY wa_conversations_scope ON wa_conversations USING (app_role() = 'hq' OR (app_role() IN ('branch_manager','branch_admin','receptionist') AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() IN ('branch_manager','branch_admin','receptionist') AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY wa_messages_scope ON wa_messages USING (app_role() = 'hq' OR (app_role() IN ('branch_manager','branch_admin','receptionist') AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() IN ('branch_manager','branch_admin','receptionist') AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY wa_assignments_scope ON wa_assignments USING (app_role() = 'hq' OR (app_role() IN ('branch_manager','branch_admin','receptionist') AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() IN ('branch_manager','branch_admin','receptionist') AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY wa_templates_scope ON wa_templates USING (app_role() = 'hq' OR (app_role() IN ('branch_manager','branch_admin','receptionist') AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() IN ('branch_manager','branch_admin','receptionist') AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
CREATE POLICY wa_safety_decisions_scope ON wa_safety_decisions USING (app_role() = 'hq' OR (app_role() IN ('branch_manager','branch_admin','receptionist') AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[])))) WITH CHECK (app_role() = 'hq' OR (app_role() IN ('branch_manager','branch_admin','receptionist') AND branch_id::text = ANY(COALESCE(app_branch_ids(), ARRAY[]::text[]))));
