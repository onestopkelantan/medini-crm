-- ============================================================================
-- SPRINT 7 T3: AI MANAGER production foundation — GOVERNANCE PLANE ONLY.
-- NO LLM calls, NO model runtime, NO worker/queue/scheduler, NO outbox.
-- Approved: G4 capability matrix, G5 HIGH-risk = AP-3/AP-4 only,
-- G6 seed GR-1/GR-5 global guardrails, G7 seed canonical 8 agents.
-- AI Manager governs; domain AI experiences live in their domains.
-- ============================================================================

CREATE TYPE ai_agent_status AS ENUM ('registered', 'enabled', 'paused', 'archived');
CREATE TYPE ai_capability_class AS ENUM ('READ', 'DRAFT', 'EXECUTE');
CREATE TYPE ai_guardrail_level AS ENUM ('HARD_BLOCK', 'APPROVAL_REQUIRED');
CREATE TYPE ai_risk_level AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE ai_decision AS ENUM ('AUTO', 'DRAFT', 'APPROVAL_REQUIRED', 'BLOCKED');
CREATE TYPE ai_knowledge_type AS ENUM ('static', 'dynamic');

-- 1. ai_agents — registry of AI workers. Each agent has exactly ONE owner domain.
CREATE TABLE ai_agents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 key varchar(64) NOT NULL,
 name varchar(128) NOT NULL,
 icon varchar(32),
 owner_domain varchar(32) NOT NULL,
 status ai_agent_status NOT NULL DEFAULT 'registered',
 description text,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
 deleted_at timestamptz
);
CREATE UNIQUE INDEX ai_agents_org_key_uq ON ai_agents(org_id, key) WHERE deleted_at IS NULL;
CREATE INDEX ai_agents_domain_idx ON ai_agents(org_id, owner_domain, status);

-- 2. ai_capabilities — per-agent READ/DRAFT/EXECUTE grants per domain (explicit; no implicit permissions).
CREATE TABLE ai_capabilities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 agent_id uuid NOT NULL REFERENCES ai_agents(id) ON DELETE restrict,
 domain varchar(32) NOT NULL,
 capability ai_capability_class NOT NULL,
 /* draft_only = true → EXECUTE never granted even if requested (Marketing/Clinical/Inventory/Insights) */
 draft_only boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE UNIQUE INDEX ai_capabilities_agent_domain_cap_uq ON ai_capabilities(org_id, agent_id, domain, capability);
CREATE INDEX ai_capabilities_agent_idx ON ai_capabilities(agent_id);

-- 3. ai_knowledge — governance METADATA over knowledge (source_ref owned by the domain, not content).
CREATE TABLE ai_knowledge (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 agent_id uuid NOT NULL REFERENCES ai_agents(id) ON DELETE restrict,
 item varchar(256) NOT NULL,
 type ai_knowledge_type NOT NULL DEFAULT 'static',
 source_domain varchar(32),
 source_ref varchar(256),
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
 deleted_at timestamptz
);
CREATE INDEX ai_knowledge_agent_idx ON ai_knowledge(agent_id) WHERE deleted_at IS NULL;

-- 4. ai_automations — trigger/action governance metadata ONLY. No execution in S7.
CREATE TABLE ai_automations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 agent_id uuid NOT NULL REFERENCES ai_agents(id) ON DELETE restrict,
 trigger_key varchar(128) NOT NULL,
 action_key varchar(128) NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE UNIQUE INDEX ai_automations_agent_trigger_uq ON ai_automations(org_id, agent_id, trigger_key, action_key);

-- 5. ai_guardrails — hard rules. agent_id NULL = GLOBAL ('All'). HARD_BLOCK is absolute.
CREATE TABLE ai_guardrails (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 agent_id uuid REFERENCES ai_agents(id) ON DELETE restrict,
 rule_key varchar(64) NOT NULL,
 rule text NOT NULL,
 level ai_guardrail_level NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE INDEX ai_guardrails_agent_idx ON ai_guardrails(org_id, agent_id);

-- 6. ai_approval_rules — risk-based approval: LOW auto · MEDIUM auto(reviewable) · HIGH human wajib.
CREATE TABLE ai_approval_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 agent_id uuid REFERENCES ai_agents(id) ON DELETE restrict,
 action_key varchar(128) NOT NULL,
 risk ai_risk_level NOT NULL,
 auto boolean NOT NULL DEFAULT true,
 note text,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE UNIQUE INDEX ai_approval_rules_agent_action_uq ON ai_approval_rules(org_id, agent_id, action_key);

-- 7. ai_audit_log — append-only record of AI governance decisions/actions.
CREATE TABLE ai_audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 agent_id uuid,
 actor_id uuid,
 action varchar(128) NOT NULL,
 detail jsonb,
 status varchar(32) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_audit_log_agent_idx ON ai_audit_log(org_id, agent_id, created_at);
CREATE INDEX ai_audit_log_status_idx ON ai_audit_log(org_id, status, created_at);

GRANT SELECT, INSERT, UPDATE ON ai_agents, ai_capabilities, ai_knowledge, ai_automations, ai_guardrails, ai_approval_rules TO medini_app;
GRANT SELECT, INSERT ON ai_audit_log TO medini_app;

ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_agents FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_capabilities ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_capabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_knowledge ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_knowledge FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_automations ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_automations FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_guardrails ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_guardrails FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_approval_rules ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_approval_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_audit_log ENABLE ROW LEVEL SECURITY; ALTER TABLE ai_audit_log FORCE ROW LEVEL SECURITY;

-- AI governance is org-global (agents serve all branches). Canonical matrix:
--   hq = view/create/edit/approve · branch_manager = view · others = NONE.
CREATE POLICY ai_agents_policy ON ai_agents
  USING (app_role() IN ('hq','branch_manager')) WITH CHECK (app_role() = 'hq');
CREATE POLICY ai_capabilities_policy ON ai_capabilities
  USING (app_role() IN ('hq','branch_manager')) WITH CHECK (app_role() = 'hq');
CREATE POLICY ai_knowledge_policy ON ai_knowledge
  USING (app_role() IN ('hq','branch_manager')) WITH CHECK (app_role() = 'hq');
CREATE POLICY ai_automations_policy ON ai_automations
  USING (app_role() IN ('hq','branch_manager')) WITH CHECK (app_role() = 'hq');
CREATE POLICY ai_guardrails_policy ON ai_guardrails
  USING (app_role() IN ('hq','branch_manager')) WITH CHECK (app_role() = 'hq');
CREATE POLICY ai_approval_rules_policy ON ai_approval_rules
  USING (app_role() IN ('hq','branch_manager')) WITH CHECK (app_role() = 'hq');
CREATE POLICY ai_audit_log_policy ON ai_audit_log
  USING (app_role() IN ('hq','branch_manager')) WITH CHECK (app_role() IN ('hq','branch_manager'));

-- ============================================================================
-- CANONICAL SEED (approved G6 + G7) — org 00000000-0000-0000-0000-000000000001.
-- Idempotent via ON CONFLICT on the partial unique (org_id,key) natural key.
-- 8 agents with exactly ONE owner domain each; draft-only where locked.
-- ============================================================================
INSERT INTO ai_agents (org_id, key, name, icon, owner_domain, status, description) VALUES
 ('00000000-0000-0000-0000-000000000001','ai-receptionist','AI Receptionist','🤖','whatsapp','enabled','Auto-reply + suggest replies for WhatsApp conversations'),
 ('00000000-0000-0000-0000-000000000001','marketing-ai','Marketing AI','📣','marketing','enabled','Campaign content generation (draft-only)'),
 ('00000000-0000-0000-0000-000000000001','clinical-ai','Clinical AI','🦷','clinical','enabled','Clinical scribe drafts (draft-only; doctor signs)'),
 ('00000000-0000-0000-0000-000000000001','booking-ai','Booking AI','📅','appointments','enabled','Appointment booking opportunities + reminders'),
 ('00000000-0000-0000-0000-000000000001','finance-ai','Finance AI','💰','finance','enabled','Payment reminder drafts (gated approval)'),
 ('00000000-0000-0000-0000-000000000001','inventory-ai','Inventory AI','📦','operations','enabled','Inventory suggestions (draft-only)'),
 ('00000000-0000-0000-0000-000000000001','recall-ai','Recall AI','🔁','marketing','enabled','Recall detection + outreach drafts'),
 ('00000000-0000-0000-0000-000000000001','insights-ai','Insights AI','📊','reports','enabled','Read-only analytics insights (draft-only)')
ON CONFLICT (org_id, key) WHERE deleted_at IS NULL DO NOTHING;

-- Capabilities (explicit; approved G4). owner-domain READ+DRAFT for all;
-- EXECUTE only for non-draft-only agents in owner domain.
INSERT INTO ai_capabilities (org_id, agent_id, domain, capability, draft_only)
SELECT a.org_id, a.id, a.owner_domain, c.cap, (a.key IN ('marketing-ai','clinical-ai','inventory-ai','insights-ai'))
FROM ai_agents a
CROSS JOIN (VALUES ('READ'::ai_capability_class),('DRAFT'::ai_capability_class),('EXECUTE'::ai_capability_class)) AS c(cap)
WHERE a.org_id='00000000-0000-0000-0000-000000000001' AND a.deleted_at IS NULL
ON CONFLICT (org_id, agent_id, domain, capability) DO NOTHING;

-- Approval rules (approved G5 — exactly TWO HIGH-risk actions):
-- AP-3 campaign send (Marketing AI) HIGH non-auto; AP-4 clinical sign-off (Clinical AI) HIGH non-auto.
INSERT INTO ai_approval_rules (org_id, agent_id, action_key, risk, auto, note)
SELECT a.org_id, a.id, 'AP-3', 'HIGH', false, 'Campaign send requires human approval'
FROM ai_agents a WHERE a.org_id='00000000-0000-0000-0000-000000000001' AND a.key='marketing-ai'
ON CONFLICT (org_id, agent_id, action_key) DO NOTHING;
INSERT INTO ai_approval_rules (org_id, agent_id, action_key, risk, auto, note)
SELECT a.org_id, a.id, 'AP-4', 'HIGH', false, 'Clinical sign-off requires doctor approval'
FROM ai_agents a WHERE a.org_id='00000000-0000-0000-0000-000000000001' AND a.key='clinical-ai'
ON CONFLICT (org_id, agent_id, action_key) DO NOTHING;

-- Global guardrails (approved G6 — agent_id NULL = applies to ALL agents).
INSERT INTO ai_guardrails (org_id, agent_id, rule_key, rule, level) VALUES
 ('00000000-0000-0000-0000-000000000001', NULL, 'GR-1', 'AI must not provide medical advice or diagnosis', 'HARD_BLOCK'),
 ('00000000-0000-0000-0000-000000000001', NULL, 'GR-5', 'AI must not send PHI to external model prompts', 'HARD_BLOCK')
ON CONFLICT DO NOTHING;
