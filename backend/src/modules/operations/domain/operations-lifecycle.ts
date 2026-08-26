export type DoctorStatusState = 'available' | 'busy' | 'break' | 'offline';
export type ChecklistState = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type TaskState = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type IncidentState = 'open' | 'acknowledged' | 'resolved' | 'closed';

function allows(current: string, next: string, transitions: Record<string, readonly string[]>): boolean {
  return current === next || (transitions[current] ?? []).includes(next);
}

export const canTransitionDoctorStatus = (current: DoctorStatusState, next: DoctorStatusState) => allows(current, next, {
  available: ['busy', 'break', 'offline'], busy: ['available', 'break', 'offline'], break: ['available', 'offline'], offline: ['available'],
});
export const canTransitionChecklist = (current: ChecklistState, next: ChecklistState) => allows(current, next, {
  open: ['in_progress', 'cancelled'], in_progress: ['completed', 'cancelled'], completed: [], cancelled: [],
});
export const canTransitionTask = (current: TaskState, next: TaskState) => allows(current, next, {
  open: ['in_progress', 'cancelled'], in_progress: ['completed', 'cancelled'], completed: [], cancelled: [],
});
export const canTransitionIncident = (current: IncidentState, next: IncidentState) => allows(current, next, {
  open: ['acknowledged', 'resolved', 'closed'], acknowledged: ['resolved', 'closed'], resolved: ['closed'], closed: [],
});
