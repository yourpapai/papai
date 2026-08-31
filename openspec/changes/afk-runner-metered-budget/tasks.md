# Tasks — afk-runner-metered-budget

## 1. Config: nullable budget + metered flag

- [x] 1.1 Failing tests in `tests/afk-runner/config.test.ts`: `budget: null` parses; `metered: true/false` override parses; derivation defaults metered to `budget !== null`; five-key configs without the new keys parse unchanged. Verify: `bun test tests/afk-runner/config.test.ts`
- [x] 1.2 Failing strict-schema tests in `tests/afk-runner/config-strict.test.ts`: unknown keys still rejected alongside the new shapes. Verify: `bun test tests/afk-runner/config-strict.test.ts`
- [x] 1.3 Implement in `afk-runner/src/config.ts`: `budget: z.number().positive().nullable().default(5)`, `metered: z.boolean().optional()`, `RunnerConfig.budget: number | null`, `AUTONOMY_DEFAULTS.metered: true`, `autonomyOf` derives `metered ?? budget !== null` and widens `costCeilingUsd` to `number | null`. Verify: `bun test tests/afk-runner/config.test.ts tests/afk-runner/config-strict.test.ts && bun run typecheck`

## 2. R4 unmetered predicates + escalation null guard

- [x] 2.1 Failing tests in `tests/afk-runner/work/auto-policy.test.ts`: metered + unknown cost gates (unchanged); unmetered + unknown cost passes R4 to the matching rule; unmetered + null ceiling never trips the exceedance branch; `metered: false` + numeric budget still gates on projected exceedance (explicit ceiling never bypassed); escalation ladder with null ceiling falls through to rule none and keeps unknown-cost suppression regardless of metered. Verify: `bun test tests/afk-runner/work/auto-policy.test.ts`
- [x] 2.2 Implement in `afk-runner/src/work/auto-policy.ts`: `r4FailsClosed` cost-unknown branch requires `config.metered`; exceedance branch requires `costCeilingUsd !== null`; `evaluateEscalationGate` over-ceiling branch gains the same null guard and its cost-unknown branch stays unconditional (design D2). Verify: `bun test tests/afk-runner/work/auto-policy.test.ts`

## 3. Event schema: pending decision kind

- [x] 3.1 Failing tests in `tests/afk-runner/event-schemas.test.ts`: an `auto_decision` event with `decision: 'pending'` parses; a folded pending record does not change `autoExtendsUsed` (fold inertness). Verify: `bun test tests/afk-runner/event-schemas.test.ts`
- [x] 3.2 Add `'pending'` to `AutoDecisionKindSchema` in `afk-runner/src/event-schemas.ts`. Verify: `bun test tests/afk-runner/event-schemas.test.ts`

## 4. Waiter emission protocol

- [ ] 4.1 Failing tests in `tests/afk-runner/work/gate-deadline.test.ts`: a claiming waiter settle appends `auto_decision` naming the deciding rule after the settle write; re-arm and stay-pending each append `{ rule: 'none', decision: 'pending' }`; a lost claim appends nothing; the `gate rearmed` event flow is unchanged. Verify: `bun test tests/afk-runner/work/gate-deadline.test.ts`
- [ ] 4.2 Failing test (design D5) in `tests/afk-runner/work/gate-deadline.test.ts`: with unmetered autonomy and unknown cost, the expiry ladder passes R4 through the shared `evaluateLadder` — metered semantics reach the waiter with no waiter-side ladder code. Verify: `bun test tests/afk-runner/work/gate-deadline.test.ts`
- [ ] 4.3 Implement in `afk-runner/src/work/gate-expiry.ts`: emit per design D3 — settle → deciding rule with approve/extend after the settle; re-arm/stay-pending → `none`/`pending` with `sha256('expiry-pending:<version>')` digest; lost claim silent. Verify: `bun test tests/afk-runner/work/gate-deadline.test.ts tests/afk-runner/work/gate-waiter.test.ts`

## 5. Docs + full gate

- [ ] 5.1 Update `docs/architecture/afk-runner.md` and `docs/architecture/sdd-pipeline.md`: unmetered budget semantics, metered flag derivation, waiter `auto_decision` protocol, pending decision kind. Verify: `bun run format:check`
- [ ] 5.2 Full gate: `bun test`, `bun run typecheck`, `bun run lint`, parity harness + memo oracle green inside the sweep, `openspec validate "afk-runner-metered-budget" --strict`.
