<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Review-loop prompt improvements, correctness fixes, and trace logging

**Status:** approved (brainstorm), ready for implementation planning
**Date:** 2026-07-16
**Spans:** `review-loop/` workspace + `tests/review-loop/`
**Builds on:** `2026-07-15-review-loop-simplification-design.md` (the shell-invoked review-loop), the existing `review-loop/` workspace.

## Problem

A prompt-and-flow analysis of the current review-loop (`prompt-templates.ts`, `issue-schema.ts`, `loop-controller.ts`, `issue-ledger.ts`, `issue-matcher.ts`) surfaced three categories of weakness, confirmed against deep research into LLM code-review best practices (agentic evidence-gated review; confidence-thresholded structured output; intent-first review with independent reviewer/fixer contexts; empirical verify-before-fix; false-positive early-exit; bounded convergence with a fresh-reviewer exit gate; the "adjudication ratchet").

1. **Correctness bugs** — five issues that are wrong regardless of any tuning data (see Section "Correctness fixes").
2. **Prompt-quality gaps** — the three prompt builders (+ matcher) lack evidence-gating, severity calibration, explicit scope/exclusions, minimal-change discipline, and rely on stale schema references across stateless subprocesses.
3. **No observability** — there is no structured record of loop behavior. Without it, the team cannot empirically decide _which_ of the heavier, data-dependent improvements (false-positive early-exit threshold, cross-model consensus, behavioral ratchet) are worth building.

### Why "fix obvious bugs + conservative prompt gains + instrument," not a full overhaul

It is too early to tune behavior on vibes: the loop has not yet been run enough against this repo to know whether false positives, non-convergence, coverage gaps, or fixer sloppiness is the dominant pain. The validated path is therefore: **fix what is plainly broken, apply the safe research-validated prompt wins everyone converges on, and instrument the loop so a few real runs produce the data needed to prioritize the rest.** The genuinely speculative behavioral knobs are explicitly deferred (see "Deferred").

## Key decisions (settled during brainstorm)

1. **Approach B (chosen).** Fix obvious correctness bugs + apply conservative, research-validated prompt improvements to all builders + add a structured `trace.jsonl`. Defer speculative behavioral knobs until trace data justifies them.
2. **Preserve the output JSON contract.** Prompt rewrites change _instructions only_; the exact Zod output schemas stay the same. No parsing or loop-wiring changes come from prompts.
3. **Trust git, not the agent, for `commitSha`.** The loop verifies a commit actually landed (`HEAD` advanced past `preFixSha`) before believing `fixed: true`. Aligns with the repo's `verification-before-completion` skill.
4. **Trace never breaks a run.** Trace logging failures are swallowed; trace is for investigation, not correctness.
5. **Additive-only schema/path changes.** `tracePath` is synthesized from `runDir` on load; old persisted state and ledgers load without migration.
6. **Capture confidence, defer thresholding.** The reviewer is asked for honest confidence; the loop does not filter on it yet. The trace records the full distribution so a defensible cutoff can be chosen later.
7. **Preserve prompt sentinel phrases.** Fake-agent routing in tests keys off substring sentinels (`"Review the current implementation"`, `"Verify and fix"`, `"build error"`, `"Match newly found"`); the new prompts keep them.

## Approaches considered

- **A — Instrument + correctness bugs only (rejected).** Lowest risk, but traces a known-weak baseline: the reviewer/fixer prompts keep their quality gaps, so early trace data partly measures a flawed prompt rather than real loop behavior.
- **B — Bugs + conservative prompt gains + trace (chosen).** Fixes what's broken, applies near-universal best practices (evidence-gating, scope/exclusions, severity calibration, minimal-change discipline) whose risk of making things worse is low, and instruments everything. First post-change runs double as calibration runs — exactly what the trace is for.
- **C — Comprehensive (rejected as premature).** B plus schema `.refine`, FP early-exit, full matcher ratchet rewrite, cross-model consensus. Builds behavioral machinery whose thresholds are currently guesses; over-engineering when "too early to say."

## Section 1 — Trace logging (observability pillar)

**Goal:** capture enough structured, per-event data that, after a few real runs, the team can empirically answer _any_ of the four candidate pain questions (FP rate, convergence, coverage, fixer safety) and then decide whether the deferred knobs are worth building.

**Location & format.** New `tracePath` on `RunState` → `<runDir>/trace.jsonl`. **JSON Lines** (one JSON object per line), append-only. Rationale: append is crash-safe (no reserialize/rewrite), streamable, trivially greppable with `jq`. Sits alongside the existing `agent-output.log` (raw agent events) and `ledger.json` (durable issue state); the trace is the _loop-behavior_ view that ties them together.

**Envelope + events.** Discriminated union, typed and Zod-schema'd. Common fields: `ts`, `round`, `phase`. Events, mapped to the questions they answer:

| Event             | Key payload                                                                             | Answers                        |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------------------ |
| `round_start`     | `round`, config snapshot (`maxRounds`, `maxNoProgressRounds`, `checkCommand`)           | baseline                       |
| `review_complete` | `round`, `issueCount`, `issues[]` (title/severity/file/confidence)                      | coverage, severity calibration |
| `match_complete`  | `round`, `newCount`, `matchedCount`, `matches[]`                                        | convergence, ratchet health    |
| `verify_complete` | `round`, `issueId`, `verdict`, `fixability`, reasoning (truncated), `targetFiles`       | **FP rate**                    |
| `build_complete`  | `round`, `issueId`, `passed`, `attempt` (1\|2), `durationMs`                            | fixer safety                   |
| `fix_complete`    | `round`, `issueId`, `fixed`, `commitSha`, `attempt`                                     | fixer safety — did commit land |
| `round_summary`   | `round`, reported/new/fixed/rejected/needsHuman/alreadyFixed counts, `noProgressRounds` | convergence at a glance        |
| `loop_end`        | `doneReason`, `rounds`, totals                                                          | final outcome                  |

**Component shape** (new file `review-loop/src/trace-log.ts`):

- `TraceEvent` discriminated union (Zod schema for the persisted shape).
- `TraceLogger` interface: `append(e: TraceEvent): Promise<void>`.
- `createFileTraceLogger(path)`: append-only JSONL writer.

**Wiring (fits existing DI).** Add `trace: TraceLogger` to `ReviewLoopDeps` (alongside `spawn`/`exec`/`log`); add `tracePath` to `RunState`. `createRunState`/`loadRunState` synthesize `tracePath` from `runDir` exactly as they already do for `ledgerPath`/`logPath` — **no migration**, old runs load fine. `cli.ts` constructs the file logger.

**Error handling (invariant).** Trace failures must never break a run. The file logger swallows fs errors; `append` is fire-and-forget (`void` return at call sites). Trace is for investigation, not correctness.

## Section 2 — Correctness fixes (the obvious bugs)

Five unambiguous bugs — each wrong regardless of tuning data. All map to existing tests under `tests/review-loop/`.

**1. Retry prompt can't rely on "same schema as before"** (`prompt-templates.ts:34`). Each `opencode run` is a fresh stateless subprocess (`agent-runner.ts:153`), so the previous schema is not in context. **Fix:** inline the exact JSON schema into `buildRetryFixPrompt`, same as the other two builders.

**2. Fixer validates against the wrong gate** (`prompt-templates.ts:23`). The fixer prompt hardcodes `bun check:full`, but the loop re-runs `config.checkCommand` afterward (`loop-controller.ts:159`). A custom `checkCommand` means the fixer validates against the wrong gate → spurious build-fail → retry. **Fix:** pass `config.checkCommand` into `buildFixPrompt`/`buildRetryFixPrompt` so both gates match.

**3. `fixed: true` is trusted without proof** (`loop-controller.ts:153`, `issue-schema.ts:34`). `commitSha` is `nullable().optional()` and the loop trusts `result.fixed` alone. **Fix:** in `processIssue`, capture `preFixSha` before the fixer runs; when the fixer reports `fixed: true`, verify with git that `HEAD` advanced past `preFixSha` and use the real `commitSha = HEAD`. If `HEAD` did not advance (no commit landed), override the outcome to **not fixed**: still `recordVerification` the fixer's reported verdict (so the reason is preserved), but do **not** call `recordFixAttempt`, do **not** run the build check, and trace the event as `fix_complete` with `fixed=false` + a `no_commit` marker. The agent's `fixed:true` self-report is never trusted alone. `commitSha` stays `nullable().optional()` in the _agent-output_ schema (additive, no migration), but the **loop's** record of it comes from git, not the agent.

**4. Retry's verdict is discarded** (`loop-controller.ts:102-139`). `retryFixAfterBuildFailure` runs the fixer again but, on success, only `recordFixAttempt`s (count++) — throwing away the retry's own verdict/reasoning/targetFiles; on failure it synthesizes `needs_human` from build stderr, also discarding the agent's reasoning. **Fix:** `recordVerification` the retry's actual result when it returns a verdict; only synthesize from build stderr when the build itself fails. Also feeds the trace so retry outcomes become analyzable.

**5. Adjudication ratchet leaks at the matcher** (`loop-controller.ts:217`). `runMatchAndRecord` passes only `filterActionable(...)` to the matcher, so a re-reported `rejected`/`needs_human` issue cannot match anything → becomes a _new_ record → gets re-processed, defeating the ratchet. **Fix:** widen the matcher's existing-set input to all ledger records (closed issues still reopen via `reopenExisting` on regression, which is desired). `filterActionable` still governs _processing_, so terminal issues will not be re-fixed — they just stop duplicating and stop burning fixer cycles. Side benefit: `matchedCount` vs `newCount` in the trace becomes meaningful for convergence analysis.

_Risk note on #5:_ widening matcher input inlines more summaries into the matcher prompt; for long runs this grows it, but it is bounded by `maxRounds` (default 10) and the matcher is already O(issues). Acceptable; flagged for monitoring via the trace.

## Section 3 — Conservative prompt improvements (research-validated)

These rewrite the _instructions_ around each builder but **preserve the exact output JSON schema** — no parsing or loop-wiring changes come from prompts. Every shift in behavior is exactly what the trace log measures. Sources: agentic-review ("if you can't cite it, fetch it"), Convergo (quote-the-line gate, evidence-not-vibes), code-review-assistant guides (explicit scope + exclusions halves noise), review-fix-pipeline (empirical verify-before-fix).

**Reviewer — `buildReviewPrompt`:**

- **Plan-anchoring:** "Read the plan at `<planPath>` and evaluate the implementation against it; cite which plan requirement each issue relates to." (Today the prompt only names the path without instructing it to read/cite it.)
- **Evidence-gating (the big one):** "Only report issues for files/lines you have actually opened and read. `evidence` must quote the offending source line(s); `file`/`lineStart`/`lineEnd` must point at code you opened. If you cannot cite exact evidence, lower `confidence` or omit the issue." Directly attacks hallucination and un-citable findings.
- **Explicit scope + exclusions:** in-scope = bugs, security, error handling, plan-conformance, repo-convention violations; DO-NOT = style/formatting a linter owns, naming preferences, "correct but I'd write it differently."
- **Severity calibration:** one-line definitions per band (critical = data-loss/security/crash/blocks the plan goal; high = likely bug or breaks a requirement; medium = conditional correctness risk / maintainability; low = minor) so severity stops drifting between runs.
- **Convention-awareness:** "Apply the repo conventions in `AGENTS.md` (already in your context) — logging rules, no lint-disable, `.js` import extensions, `max-lines` design signal. Violations are in scope." (`AGENTS.md` is auto-injected since `cwd` = worktree root.)
- Keeps `{"issues": []}` empty-path.

**Fixer — `buildFixPrompt`:**

- Keep the load-bearing **verify-before-fix** ordering.
- **Minimal-change discipline:** "Edit only what's necessary; no drive-by refactors; scope edits to `targetFiles`."
- **Empirical verification:** "If non-trivial, run a check that reproduces the issue before and confirms resolution after; run `<checkCommand>` before committing." (`checkCommand` now config-derived — Section 2.)
- **Commit-message sanitization:** replace the raw `<issue title>` with "subject derived from the issue title, single line, no backticks/quotes/newlines" — so the free-text title cannot produce a shell-unsafe or multi-line commit message.

**Retry — `buildRetryFixPrompt`:**

- Schema inlined (Section 2 fix).
- Add: "This is your final attempt. If you cannot make the build pass, report `needs_human` and leave the tree buildable — do not leave a broken tree."

**Matcher — `buildMatcherPrompt`:**

- "Match on the underlying problem / same root cause / same location, not surface wording. When in doubt, link to an existing issue; `existingId=null` only for genuinely new, unrelated problems."
- "Some existing issues may already be `rejected`/`needs_human`/`already_fixed` — still match re-reports to them by underlying problem; the loop decides whether to re-process."

**Risk framing:** these are instructions; worst case the model partially ignores them. They cannot break the output contract. Effect (severity/verdict/matched-new distributions, build-pass rate) is fully visible in the trace.

## Deferred (needs trace data first — do not build now)

- **Confidence thresholding** — capture distribution in trace; pick a defensible cutoff after a few runs.
- **False-positive early-exit** — needs a measured FP rate to set a termination threshold.
- **Cross-model consensus** — needs evidence that a single model's findings are the bottleneck.
- **Full behavioral ratchet** — the matcher-input widening (Section 2 #5) is the safe, structural part; richer re-adjudication semantics are deferred.

Each of these should be proposed as a follow-up spec once `trace.jsonl` from several real runs points at it.

## Testing & verification

Conventions: `bun:test`, DI-first, `SpawnFn`/`ShellExecFn`/`TraceLogger` injected via mocks; helpers in `tests/review-loop/test-helpers.ts`; the TDD resolver maps `review-loop/src/**` → `tests/review-loop/**` (test-first enforced by the write hook).

**Implementation constraint.** `loop-controller.test.ts:39` (`createMockSpawn`) and `fake-agent-integration.test.ts` route fake reviewer/fixer/matcher responses by **prompt substring sentinels** — `"Review the current implementation"`, `"Verify and fix"`, `"build error"`, `"Match newly found"`. The prompt rewrites **must preserve these phrases** (or those mocks stop routing). Cheap to honor; avoids a larger "role arg" refactor.

**New tests:**

- `tests/review-loop/trace-log.test.ts` — Zod schema validates each event variant; `createFileTraceLogger` appends correct JSONL; **fs errors are swallowed** (write to a bad path → no throw); in-memory capturing logger for DI in loop tests.
- Extend `run-state.test.ts` — old persisted state **without** `tracePath` still loads and synthesizes `tracePath` from `runDir` (backward-compat / no migration).

**Correctness-fix tests:**

- `prompt-templates.test.ts` — retry prompt **inlines** the schema (assert schema string present; assert `"same schema as before"` is gone); fixer prompt **contains `config.checkCommand`** (parametrize with a custom command and assert it appears); commit-message text instructs a sanitized single-line subject.
- `loop-controller.test.ts`:
  - **commitSha via git:** fake fixer reports `fixed:true` but HEAD did not advance → treated as **not** fixed (no `recordFixAttempt`); HEAD advanced → fixed + recorded SHA traced. (Existing `setupGitRepo` already provides a real git repo.)
  - **retry verdict recorded:** retry returns a real verdict → `recordVerification` gets _that_ verdict; build-fails-only path still synthesizes from stderr.
  - **matcher ratchet:** a re-reported `rejected` issue matches the existing record (no duplicate id, not re-processed). Requires widening matcher input — assert the matcher receives terminal records.

**Prompt-improvement tests:** assert presence of the key clauses (evidence-gating text, severity-band words, `AGENTS.md` reference, minimal-change instruction) — content-contract locks so the gains do not silently regress. The _behavioral_ effect of prompts is **not** unit-tested (cannot be) — that is exactly what the trace log measures on real runs.

**Verification commands** (repo root, from `review-loop/package.json`): `bun run review-loop:test` · `bun run review-loop:typecheck` · `bun run review-loop:lint` · `bun run review-loop:format:check`. The write hook already enforces test-first + lint/typecheck on `review-loop/src/**`.

**Explicitly not covered by tests** (deferred, needs real-run trace data): actual FP-rate reduction, convergence improvement, optimal confidence threshold — these are measured post-change via `trace.jsonl`, not asserted.

## Out of scope

- The `opencode run` shell-subprocess + file-JSON exchange architecture is unchanged. The agents already have tools (read/grep/bash) via opencode; the prompts now _instruct_ evidence-fetching rather than a tool-build.
- No reviewer/fixer _persona_ or system-prompt layer is added; improvements live in the user-turn task strings only, matching the current single-turn model.
- No cross-model, no consensus, no thresholding (see "Deferred").
