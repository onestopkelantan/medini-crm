import { describe, it, expect } from 'vitest';
import { isSignable, canReplaceDraft, canAmend, nextVersion } from '@modules/clinical/domain/soap-sign';
import { evaluateCompletionGate } from '@modules/clinical/domain/safety-gate';
import { evaluateConsentGate } from '@modules/clinical/domain/consent-gate';

describe('SOAP sign rules (Sprint 3 S3-B — ADR-009)', () => {
  const full = {
    soapSubjective: 'sakit gigi', soapObjective: 'caries 36',
    soapAssessment: 'pulpitis', soapPlan: 'RCT',
  };

  it('requires all four SOAP sections before signing', () => {
    expect(isSignable(full)).toBe(true);
    expect(isSignable({ ...full, soapPlan: '' })).toBe(false);
    expect(isSignable({ ...full, soapSubjective: ' ' })).toBe(false);
    expect(isSignable({ ...full, soapAssessment: 'x' })).toBe(false);
  });

  it('unsigned drafts may be replaced; signed notes may NOT', () => {
    expect(canReplaceDraft(null)).toBe(true);
    expect(canReplaceDraft(new Date())).toBe(false);
  });

  it('only signed notes can be amended; amendments increment version', () => {
    expect(canAmend(new Date())).toBe(true);
    expect(canAmend(null)).toBe(false);
    expect(nextVersion(1)).toBe(2);
    expect(nextVersion(3)).toBe(4);
  });
});

describe('safety gate (Sprint 3 S3-B — block, not warn)', () => {
  it('blocks completion when severe signal exists without acknowledgement', () => {
    const v = evaluateCompletionGate({ severeAdverseEventCount: 1, allergyAcknowledgedAt: null });
    expect(v.allowed).toBe(false);
    expect(v.blockers).toContain('SEVERE_ALLERGY_UNACKNOWLEDGED');
  });

  it('allows completion once acknowledged, or when no severe signal exists', () => {
    expect(evaluateCompletionGate({ severeAdverseEventCount: 1, allergyAcknowledgedAt: new Date() }).allowed).toBe(true);
    expect(evaluateCompletionGate({ severeAdverseEventCount: 0, allergyAcknowledgedAt: null }).allowed).toBe(true);
  });
});

describe('consent gate (Sprint 3 S3-B)', () => {
  it('blocks acceptance of consent-required plans without a record', () => {
    const v = evaluateConsentGate({ consentRequired: true, recordedConsentCount: 0 });
    expect(v.allowed).toBe(false);
    expect(v.blockers).toContain('CONSENT_REQUIRED');
  });

  it('allows when consent recorded or not required', () => {
    expect(evaluateConsentGate({ consentRequired: true, recordedConsentCount: 1 }).allowed).toBe(true);
    expect(evaluateConsentGate({ consentRequired: false, recordedConsentCount: 0 }).allowed).toBe(true);
  });
});
