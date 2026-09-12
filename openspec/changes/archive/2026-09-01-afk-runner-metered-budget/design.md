# Design — afk-runner-metered-budget

## Context

Mirror of master's `sdd-policy-metered-budget` wave into the afk-runner port.
Motivation and measured evidence (31/31 presented gates R4-gated,
`autoExtendsUsed` 0 across 14 retained runs) are in the proposal. The shapes
to move, verified against `origin/master`:

- master `sdd-runner/src/config.ts` — `budget: z.number().positive().nullable().default(5)`,
  `metered: z.boolean().optional()`, derivation `metered ?? budget !== null`,
  `AUTONOMY_DEFAULTS` carries `metered: true`.
- master `sdd-runner/src/auto-policy.ts` — `r4FailsClosed`: cost-unknown branch
  requires `config.metered`; exceedance branch requires `costCeilingUsd !== null`.
- master `sdd-runner/src/expiry-settle.ts` — the waiter's emission protocol.
- master `sdd-runner/src/event-schemas.ts` — `'pending'` in the decision enum.

**Port difference that shrinks the work:** afk's `work/gate-expiry.ts` already
evaluates expiry through the shared `evaluateLadder` (`work/gate-prelude.ts`),
R4 included — master's pre-fix waiter had its own inline ladder, and that
asymmetry did not survive the port. The proposal's "waiter ladder applies the
same R4 treatment" item is therefore a test assertion, not a code change
(D5). Likewise, master's waiter mutates `state.json` on re-arm; afk's
event-sourced `gate rearmed` fold is kept instead (D3).

## Decisions

### D1 — Mirror the config + R4 predicates verbatim

`config.ts`: `budget` accepts `null` (unmetered), `metered` optional with the
derived default `budget !== null`; `AutonomyConfig.costCeilingUsd` widens to
`number | null`; `AUTONOMY_DEFAULTS` gains `metered: true`. `r4FailsClosed`:
`!costKnown && config.metered` for the cost-unknown branch;
`config.costCeilingUsd !== null &&` for the exceedance branch. An explicitly
numeric budget is then unreachable by any bypass: `metered: false` disables
only the cost-unknown branch, never the ceiling compare. Master's later-wave
additions to this function (`spendBaselineUsd` D10 baseline, `childCount`
projection) are **not** mirrored — they belong to other waves.

### D2 — Escalation: type-guard only (decided, option A)

`evaluateEscalationGate` compares `spentUsd >= costCeilingUsd`; once the
ceiling widens to `number | null`, the exceedance branch must grow a
`costCeilingUsd !== null &&` guard — the minimal edit that preserves R5's
semantics under the type change. The cost-unknown branch is **left
unchanged**: an unmetered run at escalation with unknown cost still settles
R5 (extend suppressed, human decides). Alternative B (full R4 symmetry —
unknown-cost suppression also requiring `metered`) was declined: it honors
the declared non-goal (R5 semantics unchanged), R5-as-ladder is afk-specific
(C6 D5; master has only the reserved enum value, no code to mirror), and
escalation is the fail-closed gate by design. The spec text "over the
ceiling or unknown" remains true with a null ceiling, so the R5 requirement
needs no delta.

### D3 — Waiter emission: master's protocol, afk's mechanism

Every **claimed** expiry outcome appends the standard `auto_decision` L2
event, after the settle write (same ordering the settle seam already uses —
`gate answered` → `auto_decision`):

- settle → `{ rule: <deciding rule>, decision: approve | extend }`
- re-arm and stay-pending → `{ rule: 'none', decision: 'pending',
  evidenceDigest: sha256('expiry-pending:<version>') }`
- lost claim → nothing (another producer owns the gate).

Re-arm keeps afk's event-sourced shape — one additive `gate rearmed` event,
fold drives `gateDeadlineReArmed` — not master's direct state save.
Human settles keep emitting nothing, so replay alone distinguishes waiter
settlements from human ones.

### D4 — Schema is additive

`AutoDecisionKindSchema` gains `'pending'` (enum parity with master). Fold
inertness: `recordAutoDecision` appends every record, but
`autoExtendsUsedOf` filters `decision === 'extend'`, so pending records
never inflate the extend bound. Existing event logs and the 26-fixture
parity harness parse unchanged under the widened enum.

### D5 — Ladder alignment is asserted, not built

The waiter and prelude share `evaluateLadder`; D1's predicates therefore
reach expiry evaluation automatically. A gate-expiry test pins this: with
unmetered autonomy and unknown cost, the expiry ladder must pass R4 (no
cost-unknown gate) — the collapse of the proposal's ladder-alignment item.

## Goals / Non-Goals

Goals: unplug the subscription deadlock; make waiter decisions
replay-visible; keep every existing parse, fixture, and oracle green.

Non-goals (beyond the proposal's): master's D10 tree-budget baseline and
plan-mode projection; any change to `state.json`-free event sourcing; new
operator surfaces.

## Risks / Trade-offs

- [Unmetered runs auto-decide where they previously always gated] → bounded
  by the round cap, R2's trajectory window, and the auto-extend bound; this
  is the change's purpose, and `budget: 5` semantics are byte-identical.
- [One gate can now carry two `auto_decision` events — presentation and
  expiry] → correct per the capability's "every ladder evaluation" rule;
  tests assert the exact sequences so replay stays unambiguous.
- [Unmetered escalation always suppresses extend (cost is unknown on
  subscriptions)] → accepted by D2; escalation is rare and the human is
  already in the loop.

## Migration Plan

None beyond code. Config shapes are additive (five-key configs parse
unchanged; `budget: null` / `metered` are new optional inputs), and the
event enum only widens. Rollback is `git revert`.

## TDD / Hook Interactions

The Write/Edit hook pipeline gates every file below, test-first. Order:

1. `tests/afk-runner/config.test.ts` + `config-strict.test.ts` — null budget,
   `metered` override, derivation, five-key parse unchanged.
2. `tests/afk-runner/work/auto-policy.test.ts` — R4 predicates (metered
   cost-unknown gates; unmetered passes; explicit ceiling never bypassed;
   `metered: false` + numeric budget still gates on exceedance) and the
   escalation null-guard.
3. `tests/afk-runner/event-schemas.test.ts` — `'pending'` parses; fold
   inertness for the extend bound.
4. `tests/afk-runner/work/gate-deadline.test.ts` + `gate-waiter.test.ts` —
   emission protocol (settle / re-arm / stay-pending / lost claim) and D5.
5. Production edits: `afk-runner/src/config.ts`, `work/auto-policy.ts`,
   `event-schemas.ts`, `work/gate-expiry.ts`.
6. Full gate: parity harness + memo oracle green, `validate --strict`,
   doc updates (`afk-runner.md`, `sdd-pipeline.md`).
