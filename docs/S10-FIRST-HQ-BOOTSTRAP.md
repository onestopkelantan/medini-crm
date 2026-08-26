# FIRST HQ BOOTSTRAP — Secure Initial Setup Procedure
**S10 GLM 5.3 Remediation · Task 6 · Status: DOCUMENTED (not yet needed for execution)**

This document defines the ONLY sanctioned way to create the first Medini HQ
Owner account on a fresh production deployment. It contains **no credentials**
and **no backdoors**. Read fully before executing.

---

## 1. Principles (non-negotiable)

1. **No hardcoded credentials** anywhere — code, migrations, env files, docs.
2. **No magic login / backdoor / hidden password.** The first HQ account is
   created through the SAME auth pipeline as every other account
   (Argon2id + JWT + refresh rotation).
3. **Bootstrap is one-shot.** After the first Active `hq` staff exists, the
   bootstrap path is permanently unavailable for that deployment.
4. **Separation of duties.** The Developer (technical role) NEVER learns the
   Medini HQ password, and the HQ Owner never receives developer access.
5. **Everything is audited.** Bootstrap writes an `audit_log` entry like any
   other privileged action.

## 2. Preconditions

- [ ] Production DB migrated 0000 → 0028 (clean replay verified).
- [ ] `APP_PUBLIC_BASE_URL` set to the real frontend origin (https).
- [ ] Secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`) injected via
      the secret manager — never committed.
- [ ] Legacy `:5000` service state confirmed (per S10 constraints, do NOT
      disable during this phase).
- [ ] Medini HQ Owner personally present (or on a verified channel) to RECEIVE
      the one-time setup token out-of-band.

## 3. Procedure

### Step 1 — Generate the one-time bootstrap token (operator, at the server)

```bash
cd backend
set -a && . ./.env && set +a
npx tsx scripts/bootstrap-hq.ts
```

The script (to be implemented ONLY when first deployment is scheduled — see §6):

1. Checks `SELECT count(*) FROM staff WHERE role = 'hq' AND status = 'Active'`.
   - If ≥ 1 → **aborts** ("bootstrap already consumed"). One-shot guarantee.
2. Generates a 32-byte CSPRNG token, stores ONLY its SHA-256 hash in
   `staff.invite_token` on a placeholder `Invited` row (`username: hq`,
   role `hq`, 30-minute expiry).
3. Prints the plaintext token ONCE to the operator's terminal. It is never
   logged, never written to disk, never sent over the network by the system.

### Step 2 — Deliver the token out-of-band

Operator reads the token to the Medini HQ Owner over a verified channel
(phone call to a known number / in person). **Never** email or WhatsApp it to
an unverified address. The token alone is useless without the registration
page AND expires in 30 minutes.

### Step 3 — HQ Owner completes registration themselves

1. Owner opens `https://<app>/register?token=<token>` on their own device.
2. Owner enters their name, username, and a **password THEY choose** (min 12
   chars, Argon2id-hashed by the normal pipeline).
3. Backend consumes the single-use token (marked used, row → `Pending`).

### Step 4 — Activate the first HQ (break-glass, dual-control)

Normally HQ approves staff — but no Active HQ exists yet for the FIRST one.
The operator runs, with the Owner present:

```bash
npx tsx scripts/bootstrap-hq-activate.ts --username <chosen-username>
```

This flips the row `Pending → Active` and writes an audit entry
(`bootstrap_first_hq_activated`, actor: `system`). The script refuses to run
if any OTHER Active `hq` already exists (prevents privilege escalation later).

### Step 5 — Verify + lock

- [ ] Owner logs in at `/login`, lands on dashboard, can see all branches.
- [ ] Owner immediately invites the SECOND HQ/admin via the normal
      Administration → Invite flow (redundancy; no single-person lockout).
- [ ] `scripts/bootstrap-hq*.ts` are now permanently inert for this deployment
      (guard in Step 1). Confirm by re-running Step 1 → must abort.
- [ ] Record completion (date, operator, owner username — NOT password) in the
      deployment log.

## 4. What the Developer does and does NOT know

| Item | Developer | HQ Owner |
|------|-----------|----------|
| Bootstrap token value | Generates, hands over, forgets | Receives, uses, forgets |
| HQ password | **NEVER** (chosen by owner, Argon2id at rest) | Owns it |
| Technical diagnostics (`/system-admin/*`) | ✅ (developer role) | ❌ |
| Business data (patients, finance…) | ❌ (matrix + guard + RLS RESTRICTIVE) | ✅ |
| User administration | ❌ | ✅ |

## 5. Failure / abort handling

| Situation | Action |
|-----------|--------|
| Token expires unused | Re-run Step 1 (still no Active hq → allowed). Old token row is invalidated by the new hash. |
| Token suspected leaked | Re-run Step 1 immediately (rotates hash), notify Owner. |
| Script run after first Active hq exists | Hard abort, audit-logged as `bootstrap_attempt_after_consumption` — treat as a security event. |
| DB seeded by mistake with a demo hq | **Do NOT activate.** Delete the row as DB owner, then run the real procedure. |

## 6. Implementation status

- [x] Architecture + procedure documented (this file).
- [x] `developer` role implemented (migration 0027, matrix, `/system-admin/*`,
      tests 6/6 — see S10-GLM53-REMEDIATION-REPORT.md §7).
- [ ] `scripts/bootstrap-hq.ts` + `bootstrap-hq-activate.ts` — **implement only
      when the first production deployment is scheduled.** The one-shot guard
      and audit hooks are specified above; no speculative code is added now
      (S10 constraint: changes must map to a GLM finding / approved requirement).
