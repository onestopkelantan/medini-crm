# D18 — WhatsApp Send Cooldown: Governance Record (N8-6)

## Decision

Per-channel external WhatsApp sends are throttled with a **randomized 30–60
second cooldown**, implemented as a worker-side sleep drawn from
`WA_SEND_DELAY_MIN_MS = 30_000` to `WA_SEND_DELAY_MAX_MS = 60_000`
(`whatsapp-lifecycle.ts`, `randomizedSendDelay()` in
`whatsapp-transport.worker.ts`).

## Prior governance (superseded)

`docs/M2-WHATSAPP-HUB.md` (gate 5) originally specified a **60–180s**
randomized interval as the anti-ban RATE_LIMIT. No document in the repository
independently authorized lowering the floor below 60s at the time the S8 code
was written — GLM 5.3 correctly flagged the original 30s change as lacking
independent governance evidence (N8-6).

## Authorizing evidence

The 30–60s window is authorized by **Bos's explicit governance instruction in
the S8 remediation workflow itself** (master prompt §D18 override, quoted in
`whatsapp-lifecycle.ts`):

> "30–60 SECOND randomized per-channel cooldown" — S8 remediation
> authorization, confirmed again by Bos for Remediation Pass 2
> (N8-6 disposition: "Bos has now explicitly approved the S8 remediation
> workflow, record the actual governance source available").

This record is the honest statement of the evidence chain: the 30s floor is
**not** derived from M2-era docs (which say 60–180s); it stands solely on
Bos's direct workflow authorization. If that authorization is ever withdrawn,
the floor must revert to 60s (`WA_SEND_DELAY_MIN_MS = 60_000`) without any
other code change.

## Safety note

- The deterministic safety gate (`evaluateWaSafety`, `WA_MIN_INTERVAL_MS`)
  uses the same 30s floor, keeping gate evaluation and worker behaviour
  consistent.
- The worker sleep occurs **before** the WAHA call, so retries also respect
  the cooldown.
- Test seam `WA_SEND_DELAY_DISABLE=1` skips the sleep in integration tests
  only; the delay math itself is unit-tested (`s8-send-delay.spec.ts`).
