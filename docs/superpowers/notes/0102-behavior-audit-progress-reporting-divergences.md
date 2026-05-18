# ADR-0102: Behavior Audit Progress Reporting — Divergence Notes

> Companion document to ADR-0102. Captures each deviation between the original spec (2026-04-25), the implementation plan (2026-04-27), and the accepted delivery state.

---

## Deviation 1: `keyword-resolver-agent.ts` never existed; keyword extraction reuses same agent

| Field         | Value                                                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan spec** | `keyword-resolver-agent.ts` with `resolveKeywordsWithRetry` returning `AgentResult<ResolverResult>`; Phase 1 items sum usage from `extractWithRetry` + `resolveKeywordsWithRetry` before rendering per-item line. |
| **Expected**  | Separate keyword resolution agent emitting its own usage.                                                                                                                                                         |
| **Actual**    | No `keyword-resolver-agent.ts` file exists. Keyword extraction is part of the single `extract-agent.ts` call — the LLM returns both behaviors and keywords in one prompt. One agent call, one usage envelope.     |
| **Why**       | The extraction agent already prompts for both behaviors and keywords simultaneously. A separate keyword resolution would double LLM usage for every item with no functional benefit.                              |
| **Impact**    | Each Phase 1 item makes exactly one agent call, not two. Per-item and aggregate usage accurately reflect actual LLM consumption. Phase stats are simpler — no summation needed.                                   |
| **Correct?**  | Yes — architectural refinement. `addAgentUsage` exists in `phase-stats.ts` for potential future multi-call items but is not used for Phase 1.                                                                     |

---

## Deviation 2: Entrypoint path is `scripts/behavior-audit/index.ts`, not `scripts/behavior-audit.ts`

| Field             | Value                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan File Map** | `scripts/behavior-audit.ts` as the primary entrypoint, to be modified.                                                                                                |
| **Expected**      | A flat `scripts/behavior-audit.ts` orchestrating all four phases.                                                                                                     |
| **Actual**        | Entrypoint is `scripts/behavior-audit/index.ts`, which exports `runBehaviorAudit`. The flat file does not exist.                                                      |
| **Why**           | The behavior-audit scripts were consolidated into a directory early in the project (see ADR-0084). The plan's File Map was written against an older directory layout. |
| **Impact**        | Zero functional impact. The entrypoint name is `audit:behavior` in package.json, pointing to `scripts/behavior-audit/index.ts`.                                       |
| **Correct?**      | Yes — the entrypoint does everything the plan expected (creates one reporter, passes it into all phases).                                                             |

---

## Deviation 3: `listr2` dependency not added; only fallback exists

| Field           | Value                                                                                                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan Task 5** | Add `listr2` to `package.json`, implement full interactive renderer with task rows and final task states.                                                                                                                                                                                                       |
| **Expected**    | Full `listr2` integration with animated terminal UI in TTY environments.                                                                                                                                                                                                                                        |
| **Actual**      | `listr2` is NOT in `package.json` (verified via `grep -c '"listr2"' package.json` → `0`). The `createListr2FallbackReporter` always falls back to text.                                                                                                                                                         |
| **Why**         | The plan explicitly allowed this: "If Bun runtime compatibility is problematic, stop after the text renderer and keep the backend hook unimplemented behind `auto`/`text` only." The hook is preserved for future implementation but the team decided not to add a dependency for unverified Bun compatibility. |
| **Impact**      | Interactive rendering is text-only. This is acceptable for CI and log-capture first-class support. `auto` mode correctly falls back to text.                                                                                                                                                                    |
| **Correct?**    | Yes — intentional deferral per plan escape clause. Renderer boundary is clean; `listr2` can be added later without changing phase code.                                                                                                                                                                         |

---

## Deviation 4: Event `detail` field converted to typed `ProgressOutcome`

| Field         | Value                                                                                                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------- | ------------------------------------ |
| **Plan spec** | `item-finish` event has `outcome: 'done'                                                                                                                                                                                                                             | 'failed' | 'skipped' | 'reused'`and a flat`detail: string`. |
| **Expected**  | Uniform structure: all outcomes carry a `detail` string explaining what happened.                                                                                                                                                                                    |
| **Actual**    | `ProgressOutcome` is a discriminated union: `done` carries `{ usage, elapsedMs }`; `failed`/`skipped`/`reused` carry `{ detail }`. Text renderer calls `formatPerItemSuffix(usage, elapsedMs)` for `done` outcomes instead of passing a pre-formatted detail string. |
| **Why**       | Avoids string-formatting token/tool/time data inside the event object. Keeps `ProgressOutcome` typed and serializable. The spec's `formatPerItemSuffix` from `phase-stats.ts` remains the single source of truth for rendering metrics.                              |
| **Impact**    | Type safety improved — `done` outcomes must provide numeric usage, preventing silent loss of per-item statistics. Event shape is richer but still deterministic.                                                                                                     |
| **Correct?**  | Yes — type-safe refinement that preserves formatter centralization.                                                                                                                                                                                                  |

---

## Deviation 5: Per-file "skipped" log lines remain as direct `log.log`

| Field                  | Value                                                                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan Decision Note** | "Do not allow helper utilities to print directly to `console`; all operator-visible progress must go through the reporter."                                                                                       |
| **Expected**           | Even file-level "already done" and "no selected tests" skip notices go through the reporter.                                                                                                                      |
| **Actual**             | `extract.ts` `logSkippedFile` still writes `[Phase 1] N/M — path (skipped, reason)` directly via `deps.log.log`. Two similar lines exist in `index.ts` for "Already complete, skipping" early-exits.              |
| **Why**                | These are low-frequency, file-level (not item-level) skip notices emitted during orchestration, not per-item progress. They do not carry stable item IDs and are not subject to parallel interleaving corruption. |
| **Impact**             | Negligible — these lines are not interleaved with per-item output because they are emitted synchronously before any parallel work begins. They remain plain text and work in CI/log captures.                     |
| **Correct?**           | **Partial** — not a functional bug, but a mild inconsistency. Could be routed through a non-attributed reporter log in a future hygiene pass.                                                                     |

---

## Deviation 6: `phase-stats.ts` tests exist and cover the spec's accumulation/formatting API

| Field                     | Value                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan spec Test Impact** | "New: unit tests for `phase-stats.ts` accumulation and formatting."                                                                                                         |
| **Expected**              | Test file mentioned in spec but not in the plan's File Map.                                                                                                                 |
| **Actual**                | `tests/scripts/behavior-audit/phase-stats.test.ts` exists with 13 tests covering accumulation, formatting, wall time, tool breakdown, empty stats handling, and edge cases. |
| **Impact**                | The spec is fully verified by tests even though the plan's File Map did not list the test file.                                                                             |
| **Correct?**              | Yes — the spec test requirement was met even if the plan file map missed it.                                                                                                |

---

## Deviation 7: `item-finish` with `outcome.kind: 'done'` uses `formatPerItemSuffix` from `phase-stats.ts`

| Field                  | Value                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Plan Decision Note** | "Keep `formatPerItemSuffix(...)` as the source of truth for token/tool/time formatting."                                                                                                                                                                                                                                                                                                                                                         |
| **Expected**           | Per-item success rendering is delegated to `formatPerItemSuffix` exactly as specified.                                                                                                                                                                                                                                                                                                                                                           |
| **Actual**             | The text renderer constructs its own suffix via `renderDoneSuffix` in `progress-reporter-state.ts`, using the same formulas (`formatTokenCount`, `formatElapsed`, `computeTokensPerSecond`) but in a different module. The spec's `formatPerItemSuffix` exists and is correct but is only used as the fallback-path formatter inside `extract-reporting.ts`, `classify-reporting.ts`, `consolidate-reporting.ts` (for the no-reporter codepath). |
| **Why**                | The reporter's state reducer must format output deterministically without importing the full `phase-stats.ts` module. The formulas are duplicated inline to avoid a circular/unnecessary dependency. Both render identically — verified by test.                                                                                                                                                                                                 |
| **Impact**             | Two modules contain the same formatting formulas. If token formatting changes, two locations need updating. This is a minor maintenance burden.                                                                                                                                                                                                                                                                                                  |
| **Correct?**           | **Partial** — formatting is correct and tested, but the DRY principle is slightly violated. Could be consolidated in a future refactor.                                                                                                                                                                                                                                                                                                          |

---

## Deviation 8: Agent error logs still bypass the reporter

| Field                  | Value                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan Decision Note** | "Do not allow helper utilities to print directly to `console`; all operator-visible progress must go through the reporter."                                                                                                                                                                                           |
| **Actual**             | `extract-agent.ts:93`, `classify-agent.ts:141`, `consolidate-agent.ts:131`, `consolidate-agent.ts:136`, `consolidate-agent.ts:142`, `consolidate-agent.ts:168`, `evaluate-agent.ts:101`, `evaluate-agent.ts:106`, `evaluate-agent.ts:112` still contain `console.log` for exhausted-retry error diagnostics.          |
| **Why**                | These are error-level diagnostics emitted when retry limits are exhausted, not regular phase progress. They are not per-item events — they fire inside agent internals where no reporter reference is available. Routing them through the reporter would require threading reporter through every agent's retry loop. |
| **Impact**             | Low — these fire only on failures and do not interfere with normal progress output. They are visible in logs for debugging.                                                                                                                                                                                           |
| **Correct?**           | **Partial** — acceptable for error diagnostics, but the principle "all operator-visible progress through reporter" is not fully met.                                                                                                                                                                                  |

---

## Remediation Checklist

- [ ] **(Optional)** Route file-level skip notices in `extract.ts` through reporter as non-attributed log events.
- [ ] **(Optional)** Consolidate `formatPerItemSuffix` into a shared formatting module (single source of truth) — `progress-reporter-state.ts` should import `formatPerItemSuffix` from `phase-stats.ts`.
- [ ] **(Optional)** Add `listr2` dependency and implement true interactive renderer when Bun runtime compatibility is confirmed.
