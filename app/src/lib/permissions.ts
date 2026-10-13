/**
 * permissions.ts — what the UI may OFFER, mirroring ROLE_DOMAIN_MATRIX (Fasa 1).
 *
 * WHY THIS FILE EXISTS
 *
 * Permission decisions were scattered as inline string comparisons:
 *
 *     canIssue={user?.role === "doctor" || user?.role === "branch_admin" || ...}
 *
 * and at least one of them DISAGREED with the server. `canIssue` admitted the receptionist
 * while the matrix gave `branch_admin: clinical = NONE`, so the screen offered a button that
 * always failed with 403. A UI that offers an action it cannot perform teaches the user that
 * the SYSTEM is broken, not that they lack rights — and they stop trying.
 *
 * The server stays the authority; nothing here grants anything. These helpers only decide
 * whether a control is WORTH SHOWING. If they are ever wrong in the permissive direction the
 * request fails safely; the danger is being wrong in the restrictive direction (a control
 * hidden from someone who could use it), which is why they live in ONE place that can be
 * compared against `ROLE_DOMAIN_MATRIX` at a glance.
 *
 * The rules, matching the matrix exactly:
 *
 *   hq             clinical: view=true,  create=false, edit=false   (manages master data)
 *   doctor         clinical: view, create, edit — all scope 'own'
 *   branch_manager clinical: view=true,  create=false, edit=false   (branch scope)
 *   branch_admin   clinical: view=true,  create=false, edit=false   (receptionist, branch)
 *
 * Only a doctor WRITES clinical records. That is not a UI convention: it is what the matrix
 * enforces, and what the dangerous direction (a wrong allergy, a note that carries a
 * dentist's judgement) requires.
 */

export type Role = "hq" | "branch_manager" | "branch_admin" | "doctor" | string;

/** May this role WRITE clinical records — notes, allergies, plans, consent, forms?
 *  Doctors only, and scope 'own' means the server narrows it further to their patients. */
export function canWriteClinical(role: Role | null | undefined): boolean {
  return role === "doctor";
}

/** May this role issue a numbered form (MC / PDPA / time-off)?
 *
 *  A doctor only, for now. Issuing attaches a serial number to a document that carries a
 *  clinician's judgement, and the matrix gives `clinical:create` to no one else.
 *
 *  OPEN QUESTION for the owner: should the COUNTER print an MC (a reprint of one a doctor
 *  issued, most likely)? That is a real workflow, but it needs `clinical:create` for
 *  branch_admin, which would also let the counter write notes and allergies. If it is
 *  wanted, it should be a SEPARATE narrow permission, not a widening of this one. */
export function canIssueForm(role: Role | null | undefined): boolean {
  return role === "doctor";
}

/** May this role manage form TEMPLATES and the treatment catalogue?
 *  HQ only — the wording is a legal document and the catalogue is the pricing master. */
export function canManageMasterData(role: Role | null | undefined): boolean {
  return role === "hq";
}

/** May this role EDIT a treatment plan (status changes, item ticks)?
 *  Doctors only; `clinical:edit` is false for every other role. */
export function canEditPlan(role: Role | null | undefined): boolean {
  return role === "doctor";
}

/** May this role READ clinical records at all?
 *
 *  Everyone except a role with no business-domain access. The receptionist IS included —
 *  reading the record is how the counter answers "what did the dentist do last time?", and
 *  that is the whole reason the counter needs this screen. */
export function canReadClinical(role: Role | null | undefined): boolean {
  return role === "hq" || role === "doctor" || role === "branch_manager"
    || role === "branch_admin" || role === "receptionist";
}

/* ------------------------------------------------------------------ finance
 *
 * `finance:create` gates EVERY money-writing endpoint in the backend: sales,
 * expenses, recurring, treatment-costs, lab-payables. Only `hq` holds it:
 *
 *     hq              finance = R(true,  true,  true,  true, false, false)  all
 *     branch_manager  finance = R(true,  false, false, true, false, false)  branch
 *     branch_admin    finance = NONE
 *     doctor          finance = NONE
 *
 * `finance:submit` is granted to `branch_manager` but is asked for by NO endpoint —
 * it is a reserved cell. So a manager may see Finance and may not write in it.
 *
 * WHY THIS MATTERS AS A UI RULE, NOT A BACKEND ONE
 *
 * `/finance` is route-guarded to hq + branch_manager. "Record Expense" had no role
 * check, so a manager was offered a form that could only ever 403 — the exact
 * failure `canIssue` had before this file existed ("a UI that offers an action it
 * cannot perform teaches the user that the SYSTEM is broken").
 *
 * The counter also cannot write money, which is a real operational consequence:
 * a branch can see its takings and cannot record an expense against them.
 */
export function canWriteFinance(role: Role | null | undefined): boolean {
  return role === "hq";
}

/** May this role approve money — commission runs, payouts? (`finance:approve`.) */
export function canApproveFinance(role: Role | null | undefined): boolean {
  return role === "hq";
}

/** May this role READ the finance page at all? Managers see their own branch;
 *  the counter and the dentist have no finance page. */
export function canReadFinance(role: Role | null | undefined): boolean {
  return role === "hq" || role === "branch_manager";
}

/** May this role EDIT patient master data — the family tab, registration details?
 *
 *  Mirrors `patients:edit` in the matrix: hq, branch_manager, branch_admin (and the
 *  receptionist alias) hold it; a DOCTOR does not.
 *
 *  That split is deliberate and worth keeping: a dentist decides what treatment is
 *  needed, the front desk decides who the patient's family is. Letting a clinician
 *  rewrite the family record would let a clinical note be contradicted by an
 *  administrative edit.
 */
export function canEditPatient(role: Role | null | undefined): boolean {
  return role === "hq" || role === "branch_manager" || role === "branch_admin" || role === "receptionist";
}

/** May this role WRITE marketing content — segments, templates, campaigns, leads?
 *
 *  Mirrors `marketing:create` / `marketing:edit`: hq, branch_manager, branch_admin. A
 *  DOCTOR holds `marketing: view` only — a dentist may see which recall campaigns are
 *  running without being able to launch one to patients.
 */
export function canWriteMarketing(role: Role | null | undefined): boolean {
  return role === "hq" || role === "branch_manager" || role === "branch_admin" || role === "receptionist";
}
