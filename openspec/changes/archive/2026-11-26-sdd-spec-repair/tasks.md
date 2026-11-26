## 1. Autonomy spec reconciliation

- [x] 1.1 Verify each REMOVED/ADDED/MODIFIED pairing against current code before editing: levels/rules map absent from `RunnerConfigSchema`; previews unconditional in `gate-prelude.ts`; reopen semantics in the routing table; waiter semantics in `deadline-waiter.ts`; gains block in `report.ts` — `bun run sdd-runner:start -- --help` style smoke (or source read) confirming removed flags/subcommands fail naming replacements
- [x] 1.2 Author the `sdd-runner-autonomy` delta as written (REMOVED ×4 with Reason+Migration, ADDED ×4, MODIFIED ×2 preserving scenario names) and run `openspec validate sdd-spec-repair --strict` — valid
- [x] 1.3 Cross-check the ADDED "Deadline waiter" requirement composes with `sdd-policy-metered-budget`'s waiter ADDED requirements (no duplicated statements, no contradictions) — read both delta files; record the composition note in this task's commit message

## 2. CLI and output spec reconciliation

- [x] 2.1 Author the `sdd-runner-cli` delta (REMOVED flag path; MODIFIED gate session + discovery with routing-verb vocabulary, scenario names preserved) — `openspec validate sdd-spec-repair --strict` — valid
- [x] 2.2 Author the `sdd-runner-output` delta (REMOVED quiet verbosity + watch verb with migrations naming `SDD_DEBUG` and TUI re-attach) — `openspec validate sdd-spec-repair --strict` — valid

## 3. Coordination and final verification

- [x] 3.1 Confirm `sdd-policy-metered-budget`'s MODIFIED R4 block remains the only R4 delta (this change does not touch R4) — `openspec show sdd-spec-repair --json --deltas-only | jq '[.. | strings | select(contains("R4"))] | length'` → 0
- [x] 3.2 Full validation pass: `openspec validate sdd-spec-repair --strict` and `openspec list --json` showing the change planning-complete
- [x] 3.3 Record the apply/archive ordering (this change before `sdd-policy-metered-budget` and `sdd-review-loop-memory`) in both siblings' proposal Impact sections — edit only those two files, no code
