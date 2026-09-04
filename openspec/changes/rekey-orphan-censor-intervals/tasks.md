## 1. Regression coverage (test-first)

- [x] 1.1 Add failing copy+verify test: 0 source events + 1 `v1` censor interval → apply copies remapped `v2` interval and `verifyMappingNormalizedContentIn` returns ok. Verify: `bun test tests/analytics/rekey/copy-children.test.ts`
- [x] 1.2 Extend mixed-state coverage: event-backed + orphan censors copy 1:1 with no extras. Verify: `bun test tests/analytics/rekey/`

## 2. Fix

- [x] 2.1 Remove the `inSource` guard in `copyCensorIntervalsIn` so all source intervals remap (keep `exists` idempotency). Verify: `bun test tests/analytics/rekey/copy-children.test.ts`
- [x] 2.2 Re-run rekey suites + typecheck/lint. Verify: `bun test tests/analytics/rekey && bun run typecheck && bun run lint`

## 3. Evidence and closeout

- [x] 3.1 Run full `bun test`, `bun run typecheck`, `bun run lint`; update Stage C evidence (`11-stage-c-evidence.md` rekey drill) on a successor run proving `verify` green. Verify: full suite green + evidence row links run/verify output
