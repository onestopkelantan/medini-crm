export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
export type CampaignStatus = 'draft' | 'pending_approval' | 'approved' | 'cancelled' | 'archived';
export type RecallStatus = 'open' | 'completed' | 'cancelled';
export type FollowUpStatus = 'open' | 'completed' | 'cancelled';

function allows(current: string, next: string, transitions: Record<string, readonly string[]>): boolean {
  return current === next || (transitions[current] ?? []).includes(next);
}

export const canTransitionLead = (current: LeadStatus, next: LeadStatus) => allows(current, next, {
  new: ['contacted', 'lost'], contacted: ['qualified', 'lost'], qualified: ['converted', 'lost'], converted: [], lost: [],
});
export const canTransitionCampaign = (current: CampaignStatus, next: CampaignStatus) => allows(current, next, {
  draft: ['pending_approval', 'cancelled'], pending_approval: ['approved', 'cancelled'], approved: ['archived', 'cancelled'], cancelled: [], archived: [],
});
export const canTransitionRecall = (current: RecallStatus, next: RecallStatus) => allows(current, next, {
  open: ['completed', 'cancelled'], completed: [], cancelled: [],
});
export const canTransitionFollowUp = (current: FollowUpStatus, next: FollowUpStatus) => allows(current, next, {
  open: ['completed', 'cancelled'], completed: [], cancelled: [],
});
