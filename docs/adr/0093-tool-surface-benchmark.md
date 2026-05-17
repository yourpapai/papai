# ADR-0093: Tool Surface Benchmark — Comparison of Full Direct Tools vs Intent-Routed Direct Tools

## Status

Accepted

## Date

2026-05-09

## Context

The papai branch introducing intent-based tool routing (`routeToolsForMessage`) needed a way to measure whether exposing a subset of tools based on the user's message intent actually impacts model success rates compared to exposing all tools. The existing benchmark patterns in the project used real model calls with deterministic fake backend state, which provided a trustworthy foundation.

We needed a benchmark that:

- Compares tool-surface strategies fairly on identical scenarios
- Scores deterministically from backend state, not from free-form assistant text
- Remains isolated from the full papai runtime
- Is advisory (manual execution, not CI-gated)
- Covers routing-sensitive categories (recurring, deferred, web) alongside basic CRUD

## Decision Drivers

1. **Fair comparison**: Same seeded state, same prompts, same model, same repetitions — only tool exposure changes.
2. **Deterministic scoring**: State-only evaluation avoids LLM-as-judge brittleness.
3. **Coverage**: 10 scenarios spanning single-step, multi-step, confirmation-gated, and routing-sensitive flows.
4. **Isolation**: Fake backend is benchmark-local; no external providers, no papai runtime coupling.
5. **Observability**: Markdown + JSON output artifacts for human and machine analysis.

## Considered Options

### Option 1: Reuse Full `makeTools()` + Real Papai Runtime

- **Pros**: Tests exact production code path.
- **Cons**: Pulls in full papai provider runtime, config store, auth checks, message queue; loses determinism; requires full environment setup.
- **Verdict**: Rejected — violates isolation and determinism goals.

### Option 2: Benchmark-Local Fake Tools with State-Only Scoring (Accepted)

- **Pros**: Deterministic fake backend, no external dependencies, isolated from runtime, exact same scenarios across modes.
- **Cons**: Fake tools only approximate real provider behavior; routing classifier comes from production code (`routeToolsForMessage`), so routing logic is real.
- **Verdict**: Accepted — best balance of determinism, isolation, and real routing behavior.

### Option 3: Grade Assistant Text Instead of State

- **Pros**: Could detect "polite refusals" or reasoning failures.
- **Cons**: Brittle wording sensitivity; not objective for tool-surface comparison.
- **Verdict**: Rejected — state-only scoring is more objective.

## Decision

Implement a **benchmark-local advisory tool-surface benchmark** with:

1. 10 deterministic scenario prompts exercising single-step, multi-step, read-only, confirmation-gated, and routing-sensitive flows.
2. Two benchmark modes: `direct_full` (all tools exposed) and `direct_routed` (intent-routed subset via `routeToolsForMessage`).
3. Fake in-memory store for tasks, comments, users, recurring entries, deferred prompts, and ordered tool-call trace.
4. State-only evaluators that inspect final store state and tool-call sequence.
5. Vercel AI SDK `generateText()` with real model calls.
6. Markdown summary + JSON raw-results output.
7. Manual `bun benchmark:tool-surface` execution; not CI-gated.

## Rationale

The benchmark-local fake tool approach satisfies all decision drivers:

- **Fairness**: Both modes share the same fake tools, store, prompts, and execution loop.
- **Determinism**: Fake tools are stateful but deterministic; the only non-determinism is the LLM model call, which is the signal we want to measure.
- **Coverage**: 10 scenarios cover the full breadth of papai-style tool use.
- **Isolation**: No papai runtime, no real external providers.
- **Observability**: Summary and detail tables in markdown; machine-parseable JSON.

Routing remains real: `routeToolsForMessage` is imported from production code, so the benchmark tests the actual routing classifier, not a mock.

## Consequences

### Positive

- Comparative signal on whether tool-surface reduction affects success rates.
- Deterministic evaluation prevents subjective scoring drift.
- Scenario catalog is extensible: adding a scenario only requires updating the catalog and evaluator.
- Tests cover parsing, evaluation, mode building, and summary rendering without live model calls.
- Retry logic (3 attempts) handles transient provider failures gracefully.

### Negative

- Fake tools approximate real provider behavior; edge cases in real providers may not surface.
- Benchmark requires external API credentials; cannot run in CI.
- No historical trend tracking (no persistent store of past runs).

## Divergence Notes

Implementation diverged from the spec and plan in the following ways:

| Deviation                                    | Details                                                                                                                      | Impact                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `proxy` mode omitted                         | Plan specified `proxy` mode (3 modes); spec and implementation use 2 (`direct_full`, `direct_routed`)                        | Spec was correct; plan had stale reference to a mode not required by design          |
| JSON output not written                      | Spec and plan both require JSON; implementation only writes markdown; `jsonOutputPathFor` exists but is unused               | Machine-parseable results are not persisted; must be derived from markdown or re-run |
| Missing-credentials error message is generic | Spec: "clear error"; plan: specific env var name; actual: `catch { console.error('Benchmark run failed.') }` swallows detail | Users cannot see which env var is missing without reading code                       |
| File split exceeded plan's module count      | Plan: 2 modules (`scenarios.ts`, `benchmark.ts`); actual: 7 modules split for file-size lint compliance                      | Same public API; more files to navigate                                              |
| Evaluators stricter than plan's examples     | Plan showed basic evaluators; impl adds ordering checks (search before mutation), no-mutation guards, exact-state matching   | More robust scoring; less chance of false-positive success                           |

## Implementation Status

Implemented (with divergence).

### Modules Created

| Module                                                | Responsibility                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `scripts/tool-surface-benchmark-scenarios-data.ts`    | Seeded task definitions, scenario catalog, store factory, snapshot builder  |
| `scripts/tool-surface-benchmark-scenarios-support.ts` | Scenario evaluator functions, benchmark types                               |
| `scripts/tool-surface-benchmark-scenarios-tools.ts`   | Fake tool schemas, tool executors, direct tool builder                      |
| `scripts/tool-surface-benchmark-scenarios.ts`         | Barrel re-export + `toolsForMode` builder                                   |
| `scripts/tool-surface-benchmark-report.ts`            | Markdown result aggregation and rendering                                   |
| `scripts/tool-surface-benchmark-runner-support.ts`    | Result-helper factories (`successBenchmarkResult`, `failedBenchmarkResult`) |
| `scripts/tool-surface-benchmark.ts`                   | CLI parsing, retry logic, `generateText` orchestration, file write          |

### Tests Created

| Test File                                                | Coverage                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `tests/scripts/tool-surface-benchmark-scenarios.test.ts` | 10 scenario IDs, evaluator edge cases (22 assertions), routed mode tool exposure |
| `tests/scripts/tool-surface-benchmark.test.ts`           | CLI parsing, retry logic, failure messages, summary rendering                    |

### Package Script

Added to `package.json`:

```json
"benchmark:tool-surface": "bun scripts/tool-surface-benchmark.ts"
```

### Verification Evidence

| Verification            | Command                                                                                                        | Result               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------- |
| Scenario + runner tests | `bun test tests/scripts/tool-surface-benchmark-scenarios.test.ts tests/scripts/tool-surface-benchmark.test.ts` | 26 pass, 0 fail      |
| Type check              | `bun typecheck`                                                                                                | clean                |
| Linter                  | `bun lint`                                                                                                     | 0 warnings, 0 errors |
| Format check            | `bun format:check`                                                                                             | clean                |

## Related Decisions

- ADR-0083: Enrich Codeindex Search Ergonomics for Agents — The benchmark leverages `routeToolsForMessage` from the tool-router module

## References

- Implementation: `scripts/tool-surface-benchmark*.ts`
- Tests: `tests/scripts/tool-surface-benchmark*.test.ts`
- Spec: Archived at `docs/archive/2026-05-09-tool-surface-benchmark-design.md`
- Plan: Archived at `docs/archive/2026-05-09-tool-surface-benchmark-implementation.md`
