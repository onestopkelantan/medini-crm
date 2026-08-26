import { describe, expect, it } from 'vitest';
import { canTransitionCampaign, canTransitionFollowUp, canTransitionLead, canTransitionRecall } from '../../src/modules/marketing/domain/marketing-lifecycle';

describe('Marketing lifecycle contracts', () => {
  it('allows only deterministic lead transitions', () => {
    expect(canTransitionLead('new', 'contacted')).toBe(true);
    expect(canTransitionLead('qualified', 'converted')).toBe(true);
    expect(canTransitionLead('converted', 'contacted')).toBe(false);
  });
  it('requires approval before a campaign becomes approved', () => {
    expect(canTransitionCampaign('draft', 'pending_approval')).toBe(true);
    expect(canTransitionCampaign('draft', 'approved')).toBe(false);
    expect(canTransitionCampaign('approved', 'archived')).toBe(true);
  });
  it('does not reopen completed recall or follow-up cases', () => {
    expect(canTransitionRecall('open', 'completed')).toBe(true);
    expect(canTransitionRecall('completed', 'open')).toBe(false);
    expect(canTransitionFollowUp('open', 'cancelled')).toBe(true);
    expect(canTransitionFollowUp('cancelled', 'open')).toBe(false);
  });
});
