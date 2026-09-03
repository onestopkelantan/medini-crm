/**
 * Principal — identity of the authenticated user.
 */
export interface Principal {
  /** Staff UUID. */
  readonly staffId: string;

  /** Display name of the staff member. */
  readonly name: string;

  /** Username. */
  readonly username: string;

  /** Effective role. */
  readonly role: string;

  /** Organization UUID. */
  readonly orgId: string;

  /** Branch UUID, null for HQ. */
  readonly branchId: string | null;

  /** Doctor identity, otherwise null. */
  readonly doctorId: string | null;
}