## 1. Cause classification (design D1)

- [x] 1.1 Failing tests in `tests/sdd-runner/analyze.test.ts`: extend `r2EligibilityRate` with `byCause` — `r2-fired` (extend auto_decision naming R2), `cost-unknown` (R4 presentation, run costKnown false), `over-ceiling` (R4 presentation, costKnown true), `preview` (preview auto_decision), `trajectory-blocked` (predicate fails); state→gate join by first early presentation after the convergence; era run with no supporting records keeps today's unknown verbatim. Implement in `sdd-runner/src/analyze-findings.ts`. Verify: `bun test tests/sdd-runner/analyze.test.ts`
- [x] 1.2 Failing test pinning real-corpus shapes: the kiss-help-style preview pair attributes `preview ×2`, and cost-unknown extend-by-human rows attribute `cost-unknown` (fixtures mirroring the investigation's event sequences). Verify: `bun test tests/sdd-runner/analyze.test.ts`

## 2. Report + JSON (design D2 + D3)

- [x] 2.1 Failing tests for the per-run line (`r2 eligibility: 2/5 (cost-unknown ×3)`, causes in fixed order, omitted when none) and the corpus aggregate's cause mix; JSON pins for additive `byCause` (nonzero causes only). Implement in `sdd-runner/src/analyze-report.ts` and `sdd-runner/src/analyze-corpus.ts`. Verify: `bun test tests/sdd-runner/analyze.test.ts`

## 3. Close-out

- [x] 3.1 Full gates: `bun test`, `bun run typecheck`, `bun run lint`; then a live smoke over the 8-workdir corpus expecting `cost-unknown ×9 · preview ×2` for the 11 eligible states (acceptance: the breakdown reproduces the gap investigation's hand decomposition exactly). Verify: `bun run test:status`
