## 1. Unmetered config semantics

- [x] 1.1 Red-first `tests/sdd-runner/config.test.ts`: `budget` parses as `number | null` (absent → default 5; explicit `null` → unmetered), `metered` optional boolean, derived metered-ness (`budget !== null` when `metered` absent), unknown keys still rejected — `bun test tests/sdd-runner/config.test.ts`
- [x] 1.2 Widen `RunnerConfigSchema` in `sdd-runner/src/config.ts`; document both keys in `config.example.json` — `bun test tests/sdd-runner/config.test.ts`

## 2. R4 metered carve-out

- [x] 2.1 Red-first `tests/sdd-runner/auto-policy.test.ts` over corpus-shaped gate states: unmetered + unknown cost + R2 predicate → R2 extend decides (R4 does not veto); unmetered + no R2 predicate → stays pending; metered + unknown cost → gates exactly as today; numeric exceedance gates in both modes — `bun test tests/sdd-runner/auto-policy.test.ts`
- [x] 2.2 Implement the metered predicate inside R4 in `sdd-runner/src/auto-policy.ts` (ladder order untouched); thread derived metered-ness from config — `bun test tests/sdd-runner/auto-policy.test.ts`
- [x] 2.3 Red-first `tests/sdd-runner/gate-prelude.test.ts`: unmetered cap-hit gates preview without R4 cost evidence; metered path byte-identical to today on numeric budgets — `bun test tests/sdd-runner/gate-prelude.test.ts`

## 3. Waiter settle audit events

- [x] 3.1 Red-first `tests/sdd-runner/events.test.ts`: `auto_decision.decision` widens additively (`'gate' | 'approve' | 'extend' | 'pending'`); old events parse unchanged — `bun test tests/sdd-runner/events.test.ts`
- [x] 3.2 Red-first `tests/sdd-runner/deadline-waiter.test.ts`: expiry claim + settle/re-arm/stay-pending each emit `auto_decision` (rule, decision, gateVersion) appended after the settle write; externally-settled gates emit nothing — `bun test tests/sdd-runner/deadline-waiter.test.ts`
- [x] 3.3 Implement the emits in the waiter's settle seam in `sdd-runner/src/deadline-waiter.ts` — `bun test tests/sdd-runner/deadline-waiter.test.ts`

## 4. Expiry ladder parity

- [ ] 4.1 Red-first: waiter's `conservativeBranchApplies` calls the same metered-aware R4 predicate as the prelude (unmetered expiry may R2-extend; metered unknown cost stays pending) — `bun test tests/sdd-runner/deadline-waiter.test.ts`
- [ ] 4.2 Refactor the waiter to consume the shared predicate; pin prelude-vs-expiry agreement over the corpus fixture gates — `bun test tests/sdd-runner/deadline-waiter.test.ts tests/sdd-runner/auto-policy.test.ts`

## 5. Verification and docs

- [ ] 5.1 One full `bun run test`, `bun run typecheck`, `bun run lint` — all green
- [ ] 5.2 Update `docs/architecture/sdd-pipeline.md` (Config and autonomy keys, Deadline, Cost / duration markers, Event model) in the same commit as the final code
