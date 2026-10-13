import { describe, expect, it } from 'vitest';
import { canTransitionDoctorStatus, canTransitionChecklist, canTransitionTask, canTransitionIncident } from '../../src/modules/operations/domain/operations-lifecycle';

describe('Operations lifecycle contracts', () => {
  it('doctor status transitions are deterministic', () => {
    expect(canTransitionDoctorStatus('available', 'busy')).toBe(true);
    expect(canTransitionDoctorStatus('offline', 'available')).toBe(true);
    expect(canTransitionDoctorStatus('offline', 'busy')).toBe(false);
  });
  it('checklist cannot reopen after completion', () => {
    expect(canTransitionChecklist('open', 'in_progress')).toBe(true);
    expect(canTransitionChecklist('in_progress', 'completed')).toBe(true);
    expect(canTransitionChecklist('completed', 'open')).toBe(false);
  });
  it('task cannot skip to completed from open', () => {
    expect(canTransitionTask('open', 'in_progress')).toBe(true);
    expect(canTransitionTask('open', 'completed')).toBe(false);
    expect(canTransitionTask('in_progress', 'completed')).toBe(true);
  });
  it('incident close requires resolve path', () => {
    expect(canTransitionIncident('open', 'acknowledged')).toBe(true);
    expect(canTransitionIncident('acknowledged', 'resolved')).toBe(true);
    expect(canTransitionIncident('resolved', 'closed')).toBe(true);
    expect(canTransitionIncident('closed', 'open')).toBe(false);
  });
});
