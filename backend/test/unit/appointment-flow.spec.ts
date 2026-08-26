import { describe, it, expect } from 'vitest';
import {
  canTransition, canReschedule, allowedTransitions, FORWARD_PATH,
} from '@modules/appointments/domain/appointment-flow';

describe('appointment status state machine', () => {
  it('accepts the canonical forward path step by step', () => {
    for (let i = 0; i < FORWARD_PATH.length - 1; i++) {
      const from = FORWARD_PATH[i]!;
      const to = FORWARD_PATH[i + 1]!;
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('allows cancellation from booked and confirmed only', () => {
    expect(canTransition('booked', 'cancelled')).toBe(true);
    expect(canTransition('confirmed', 'cancelled')).toBe(true);
    expect(canTransition('checked-in', 'cancelled')).toBe(true);
    expect(canTransition('in-progress', 'cancelled')).toBe(false);
    expect(canTransition('completed', 'cancelled')).toBe(false);
  });

  it('allows no-show only from waiting/called', () => {
    expect(canTransition('waiting', 'no-show')).toBe(true);
    expect(canTransition('called', 'no-show')).toBe(true);
    expect(canTransition('booked', 'no-show')).toBe(false);
    expect(canTransition('in-progress', 'no-show')).toBe(false);
  });

  it('rejects arbitrary jumps (booked → in-progress, waiting → completed)', () => {
    expect(canTransition('booked', 'in-progress')).toBe(false);
    expect(canTransition('waiting', 'completed')).toBe(false);
    expect(canTransition('booked', 'checked-in')).toBe(false);
  });

  it('terminal states have no outgoing transitions', () => {
    expect(allowedTransitions('completed')).toEqual([]);
    expect(allowedTransitions('cancelled')).toEqual([]);
    expect(allowedTransitions('no-show')).toEqual([]);
  });

  it('reschedule allowed only in booked/confirmed', () => {
    expect(canReschedule('booked')).toBe(true);
    expect(canReschedule('confirmed')).toBe(true);
    expect(canReschedule('checked-in')).toBe(false);
    expect(canReschedule('completed')).toBe(false);
  });
});
