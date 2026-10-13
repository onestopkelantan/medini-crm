import { describe, it, expect } from 'vitest';

import { canAiCreateBooking, shouldFlagForHuman, AI_HOLD_MESSAGE, AI_HOLD_LABEL } from '@modules/whatsapp/domain/ai-control';
import { evaluatePolicy, classifyAction, UNCLASSIFIED } from '@modules/ai-manager/domain/ai-manager-policy';

/**
 * Booking AI gate — the Pause button must be REAL for bookings too.
 *
 * The reply pipeline (`ai-receptionist`) was policy-gated, but `maybeSaveBooking`
 * created appointments WITHOUT consulting the registry. So pausing "Booking AI"
 * in AI Manager changed nothing, even though the AI Manager states "a paused
 * agent cannot run anything it proposes".
 *
 * Booking is a SECOND agent (`booking-ai`, owner domain `appointments`) with its
 * own registry status. The controller asks
 * `canAutoExecute('booking-ai','appointments','booking.create')` and refuses to
 * create the appointment unless the verdict is AUTO. These tests pin:
 *   (a) the pure domain rule the controller applies, and
 *   (b) the engine verdict the port returns for that call.
 */

describe('canAiCreateBooking — booking-ai gate (pure domain rule)', () => {
  it('booking agent enabled → booking may proceed', () => {
    const d = canAiCreateBooking({ bookingAgentEnabled: true });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBeNull();
  });

  it('booking agent paused → booking refused, reason BOOKING_AGENT_PAUSED', () => {
    const d = canAiCreateBooking({ bookingAgentEnabled: false });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('BOOKING_AGENT_PAUSED');
  });

  it('a refused booking flags the conversation for a human', () => {
    expect(shouldFlagForHuman('BOOKING_AGENT_PAUSED')).toBe(true);
  });

  it('BOOKING_AGENT_PAUSED has a plain-Malay message and short label', () => {
    expect(AI_HOLD_MESSAGE.BOOKING_AGENT_PAUSED.length).toBeGreaterThan(10);
    expect(AI_HOLD_LABEL.BOOKING_AGENT_PAUSED.length).toBeGreaterThan(2);
  });
});

describe('booking-ai gate — engine verdict the controller relies on', () => {
  const base = {
    agentOwnerDomain: 'appointments',
    agentDraftOnly: false,
    grantedCapabilities: ['READ', 'DRAFT', 'EXECUTE'] as const,
    matchedGuardrails: [] as { level: 'HARD_BLOCK' | 'APPROVAL_REQUIRED' }[],
    domain: 'appointments',
    capability: 'EXECUTE' as const,
  };

  it('enabled + EXECUTE granted + auto approval rule → AUTO (booking proceeds)', () => {
    const r = evaluatePolicy(
      { ...base, agentStatus: 'enabled', approvalRule: { risk: 'MEDIUM', auto: true } },
      classifyAction('booking.create'),
    );
    expect(r.decision).toBe('AUTO');
  });

  it('paused agent → BLOCKED (Pause button stops bookings)', () => {
    const r = evaluatePolicy(
      { ...base, agentStatus: 'paused', approvalRule: { risk: 'MEDIUM', auto: true } },
      classifyAction('booking.create'),
    );
    expect(r.decision).toBe('BLOCKED');
    expect(r.reason).toContain('paused');
  });

  it('registered (never enabled) agent → BLOCKED', () => {
    const r = evaluatePolicy(
      { ...base, agentStatus: 'registered', approvalRule: { risk: 'MEDIUM', auto: true } },
      classifyAction('booking.create'),
    );
    expect(r.decision).toBe('BLOCKED');
  });

  it('enabled but EXECUTE not granted → BLOCKED (capability revoked)', () => {
    const r = evaluatePolicy(
      {
        ...base,
        agentStatus: 'enabled',
        grantedCapabilities: ['READ'],
        approvalRule: { risk: 'MEDIUM', auto: true },
      },
      classifyAction('booking.create'),
    );
    expect(r.decision).toBe('BLOCKED');
    expect(r.reason).toContain('not granted');
  });

  it('enabled + no classification/approval rule → APPROVAL_REQUIRED (fail-closed)', () => {
    const r = evaluatePolicy(
      { ...base, agentStatus: 'enabled', approvalRule: null },
      UNCLASSIFIED,
    );
    expect(r.decision).toBe('APPROVAL_REQUIRED');
  });

  it('booking.create is not treated as medical advice (GR-1 must not block it)', () => {
    const c = classifyAction('booking.create');
    expect(c.medicalAdvice).toBe(false);
    expect(c.phiToExternalModel).toBe(false);
  });
});
