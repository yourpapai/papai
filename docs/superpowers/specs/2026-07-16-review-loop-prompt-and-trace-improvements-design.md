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

1. **Correctness bugs** — four remaining issues that are wrong regardless of any tuning data (see Section "Correctness fixes"), two surfaced by code reconciliation and two validated by Run 1. Three originally-identified bugs were found already shipped on the branch during reconciliation (config-derived check command, retry-verdict recording, matcher ratchet widening) and are out of scope.
2. **Prompt-quality gaps** — the three prompt builders (+ matcher) lack evidence-gating, severity calibration, explicit scope/exclusions, minimal-change discipline, and rely on stale schema references across stateless subprocesses.
3. **No observability** — there is no structured record of loop behavior. Without it, the team cannot empirically decide _which_ of the heavier, data-dependent improvements (false-positive early-exit threshold, cross-model consensus, behavioral ratchet) are worth building.

### Why "fix obvious bugs + conservative prompt gains + instrument," not a full overhaul

It is too early to tune behavior on vibes: the loop has not yet been run enough against this repo to know whether false positives, non-convergence, coverage gaps, or fixer sloppiness is the dominant pain. The validated path is therefore: **fix what is plainly broken, apply the safe research-validated prompt wins everyone converges on, and instrument the loop so a few real runs produce the data needed to prioritize the rest.** The genuinely speculative behavioral knobs are explicitly deferred (see "Deferred").

## Key decisions (settled during brainstorm)

1. **Approach B (chosen).** Fix obvious correctness bugs + apply conservative, research-validated prompt improvements to all builders + add a structured `trace.jsonl`. Defer speculative behavioral knobs until trace data justifies them.
2. **Preserve the output JSON contract.** Prompt rewrites change _instructions only_; the Zod output schemas stay the same, with one additive exception: `FixerResultSchema` gains an optional `commitMessage` field (see Section 3 fixer). Optional + additive, so old result files still validate.
3. **Trust git, not the agent, for fix outcomes.** The loop verifies `HEAD` actually advanced past `baselineSha` before believing `fixed: true` (a fixer that reports `fixed:true` but changes nothing must not be marked fixed). The real `commitSha = HEAD` comes from git, not the agent. Aligns with the repo's `verification-before-completion` skill.
4. **Agent composes the commit message; the loop commits.** The fixer agent is the only actor that knows what it actually changed, so it returns a `commitMessage` field describing the real fix. The loop is the single committer (`ensureFixerChangesCommitted`), uses that message (sanitized to one line), and falls back to the issue title only if the agent omitted it. Removes the prior dual-committer reliance and fixes the raw-title commit messages.
5. **Trace never breaks a run.** Trace logging failures are swallowed; trace is for investigation, not correctness.
6. **Additive-only schema/path changes.** `tracePath` is synthesized from `runDir` on load; old persisted state and ledgers load without migration.
7. **Capture confidence, defer thresholding.** The reviewer is asked for honest confidence; the loop does not filter on it yet. The trace records the full distribution so a defensible cutoff can be chosen later.
8. **Preserve prompt sentinel phrases.** Fake-agent routing in tests keys off substring sentinels (`"Review the current implementation"`, `"Verify and fix"`, `"build error"`, `"Match newly found"`); the new prompts keep them.

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

## Section 2 — Correctness fixes (the remaining bugs)

Four unambiguous bugs remain after reconciling with the branch and validating Run 1. Each maps to existing tests under `tests/review-loop/`.

**1. Retry prompt can't rely on "same schema as before"** (`prompt-templates.ts:44`). Each `opencode run` is a fresh stateless subprocess (`agent-runner.ts:154`), so the previous schema is not in context. **Fix:** inline the exact JSON schema into `buildRetryFixPrompt`, same as the other two builders. (The config-derived `checkCommand` for the retry prompt is already shipped — `buildRetryFixPrompt` takes `checkCommand` and the loop passes `config.checkCommand`.)

**2. `fixed: true` is trusted without proof** (`loop-controller.ts:165-172`). The branch already captures `baselineSha` (`:144`), `reset --hard` on not-fixed (`:160`), and auto-commits dirty trees via `ensureFixerChangesCommitted` (`:131`). **The remaining gap:** if the fixer reports `fixed: true` + `valid` but makes _no change_ (clean tree, no commit), `ensureFixerChangesCommitted` is a no-op, yet the loop still calls `recordFixAttempt` → the issue is falsely marked fixed with `HEAD === baselineSha`. **Fix:** after the build passes and `ensureFixerChangesCommitted` runs, capture `postSha = HEAD`; if `postSha === baselineSha` (no commit landed), override the outcome to **not fixed** — do **not** call `recordFixAttempt`; trace the event as `fix_complete` with `fixed=false` + a `no_commit` marker (the build passed but nothing changed, so the fixer's `fixed:true` was a false claim). When a commit did land, record `commitSha = postSha` in the trace. `commitSha` stays `nullable().optional()` in the _agent-output_ schema (additive, no migration); the **loop's** record of it comes from git.

**3. Revert paths leak untracked scratch files** (`loop-controller.ts:100,120,160`). Validated in Run 1 (`fa778fcef`): the three `reset --hard <sha>` sites do not run `git clean -fd`, so untracked files the fixer created (e.g. scratch, partial edits) survive the reset and get swept into the next issue's `git add -A`. `resetWorktree` (`worktree.ts:55`) already does both `reset --hard` + `clean -fd`, but it resets to `HEAD`; the loop needs reset to `baselineSha`. **Fix:** add a `resetWorktreeTo(worktreePath, sha)` helper (`reset --hard <sha>` + `clean -fd`) in `worktree.ts` and use it at all three revert sites.

**4. `valid` + `manual` verdicts spin as non-terminal** (`issue-ledger.ts:160` `mapVerifierDecisionToLedgerStatus`). Validated in Run 1: 2 ledger records had `verdict:valid` + `fixability:manual` ("requires human judgment, not auto-fixable, no files modified"), but the mapper maps `valid` → `verified` — a **non-terminal** status — so these manual/needs-human issues stayed actionable and were re-run by the fixer **every round** until `max_rounds`, wasting cycles (a direct cause of the "convergence is weak" observation). **Fix:** make the status mapping consider `fixability`, not just `verdict`: `valid` + `manual` → `needs_human` (terminal); `valid` + `auto` → `verified` (the existing happy-path precursor to `fixed_pending_review`). Reinforce in the fixer prompt: `verdict:valid` means "valid issue _that I fixed_"; a valid-but-not-auto-fixable issue should be `needs_human`.

### Shipped on the branch (out of scope — not re-implemented)

These three were identified during design but found already implemented when reconciling with the code. Recorded for trace accuracy; no work.

- **Config-derived check command** — `buildFixPrompt(.., checkCommand)` (`prompt-templates.ts:19`); loop passes `config.checkCommand` (`loop-controller.ts:95,148`).
- **Retry verdict recorded** — `retryFixAfterBuildFailure` records the real verdict on not-fixed (`loop-controller.ts:101-106`); synthesizes only on build failure (`:121-126`).
- **Matcher ratchet widening** — `runMatchAndRecord` passes all ledger records to the matcher (`loop-controller.ts:221`); covered by the "does not re-discover terminal issues as duplicates" test (`loop-controller.test.ts:464`).

**5. Matcher context grows unbounded across rounds** (`loop-controller.ts:221`, `issue-matcher.ts:34`). Run 1 reached 50 ledger issues / 10 rounds; the matcher inlines a summary line per existing record into its prompt every round, so cost and prompt size grow with the ledger. **Fix (evidence-backed cost control, not a correctness bug):** bound the matcher's existing-set to **non-terminal records + records seen in the last N rounds** (e.g. N=2) instead of all records. Terminal records were already needed for ratchet correctness (don't drop them entirely — a re-report of a `rejected` issue must still match), so keep terminal records that are recent; drop stale terminal records from the matcher context only. Exact N and "stale" threshold are configurable constants, traceable via the trace's `match_complete` event.

## Section 3 — Conservative prompt improvements (research-validated)

These rewrite the _instructions_ around each builder but **preserve the exact output JSON schema** — no parsing or loop-wiring changes come from prompts. Every shift in behavior is exactly what the trace log measures. Sources: agentic-review ("if you can't cite it, fetch it"), Convergo (quote-the-line gate, evidence-not-vibes), code-review-assistant guides (explicit scope + exclusions halves noise), review-fix-pipeline (empirical verify-before-fix).

**Reviewer — `buildReviewPrompt`:**

- **Plan-anchoring:** "Read the plan at `<planPath>` and evaluate the implementation against it; cite which plan requirement each issue relates to." (Today the prompt only names the path without instructing it to read/cite it.)
- **Evidence-gating (the big one):** "Only report issues for files/lines you have actually opened and read. `evidence` must quote the offending source line(s); `file`/`lineStart`/`lineEnd` must point at code you opened. Before raising an issue, verify the impact you're claiming (e.g. check `.gitignore` before asserting something 'will be committed by `git add -A`'; trace the control flow before asserting a missing `continue` matters). If you cannot cite exact evidence or verify the impact, lower `confidence` or omit the issue." Directly attacks hallucination and un-citable findings. **Run 1 validated this:** false-premise fixes `ac1b51d4a` (asserted agent JSON would be committed — `.review-loop/` is gitignored) and `e1b40ad35` (asserted a missing `continue` mattered — it was a no-op) both asserted impact without verifying.
- **Explicit scope + exclusions:** in-scope = bugs, security, error handling, plan-conformance, repo-convention violations; DO-NOT = style/formatting a linter owns, naming preferences, "correct but I'd write it differently."
- **Severity calibration:** one-line definitions per band (critical = data-loss/security/crash/blocks the plan goal; high = likely bug or breaks a requirement; medium = conditional correctness risk / maintainability; low = minor) so severity stops drifting between runs.
- **Convention-awareness:** "Apply the repo conventions in `AGENTS.md` (already in your context) — logging rules, no lint-disable, `.js` import extensions, `max-lines` design signal. Violations are in scope." (`AGENTS.md` is auto-injected since `cwd` = worktree root.)
- Keeps `{"issues": []}` empty-path.

**Fixer — `buildFixPrompt`:**

- Keep the load-bearing **verify-before-fix** ordering.
- **Minimal-change discipline:** "Edit only what's necessary; no drive-by refactors; scope edits to `targetFiles`."
- **Empirical verification:** "If non-trivial, run a check that reproduces the issue before and confirms resolution after; run `<checkCommand>` to confirm." (`checkCommand` is config-derived — already shipped.)
- **Do NOT commit; compose the message instead.** Remove the existing "commit with message: fix(review-loop): <issue title>" instruction (the loop owns commits via `ensureFixerChangesCommitted`). Instead instruct: "Do not commit. After editing, return a `commitMessage` field: a single-line conventional-commit subject, `fix(review-loop): <subject>`, that describes the **actual changes you made** (not the issue title)." The loop sanitizes it (strip backticks/quotes/newlines, one line) and falls back to the issue title only if absent.
- **Schema (additive):** add `commitMessage: z.string().optional()` to `FixerResultSchema`. Optional + additive so old result files still validate.

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
- **Full behavioral ratchet** — the structural matcher-input widening is already shipped; richer re-adjudication semantics are deferred.

Each of these should be proposed as a follow-up spec once `trace.jsonl` from several real runs points at it.

## Testing & verification

Conventions: `bun:test`, DI-first, `SpawnFn`/`ShellExecFn`/`TraceLogger` injected via mocks; helpers in `tests/review-loop/test-helpers.ts`; the TDD resolver maps `review-loop/src/**` → `tests/review-loop/**` (test-first enforced by the write hook).

**Implementation constraint.** `loop-controller.test.ts:39` (`createMockSpawn`) and `fake-agent-integration.test.ts` route fake reviewer/fixer/matcher responses by **prompt substring sentinels** — `"Review the current implementation"`, `"Verify and fix"`, `"build error"`, `"Match newly found"`. The prompt rewrites **must preserve these phrases** (or those mocks stop routing). Cheap to honor; avoids a larger "role arg" refactor.

**New tests:**

- `tests/review-loop/trace-log.test.ts` — Zod schema validates each event variant; `createFileTraceLogger` appends correct JSONL; **fs errors are swallowed** (write to a bad path → no throw); in-memory capturing logger for DI in loop tests.
- Extend `run-state.test.ts` — old persisted state **without** `tracePath` still loads and synthesizes `tracePath` from `runDir` (backward-compat / no migration).

**Correctness-fix tests:**

- `prompt-templates.test.ts` — retry prompt **inlines** the schema (assert schema string present; assert `"same schema as before"` is gone); fixer prompt no longer instructs the agent to commit and instead requests a `commitMessage`.
- `issue-schema.test.ts` — `FixerResultSchema` accepts an optional `commitMessage` string and still validates results without it (additive).
- `loop-controller.test.ts`:
  - **no-commit guard:** fake fixer reports `fixed:true`+`valid` but leaves the tree clean (HEAD does not advance) → treated as **not** fixed (no `recordFixAttempt`); HEAD advances (real commit) → fixed + `commitSha` traced. (Existing `setupGitRepo` provides a real git repo; existing `onFixer` mock hook can simulate no-op vs. real edits.)
  - **commit message from agent:** when the fixer returns a `commitMessage`, the loop's commit subject uses it (sanitized); when omitted, falls back to the issue title.
  - **clean -fd on revert (#3):** after a non-fix / retry-failure revert, an untracked scratch file the fixer created is gone from the worktree (assert via `git status --porcelain` is empty AND the file is absent).
  - **valid+manual → terminal (#4):** a fixer result `{verdict:'valid', fixability:'manual', fixed:false}` lands the issue as `needs_human` (terminal) and is NOT re-processed in the next round; `{verdict:'valid', fixability:'auto', fixed:false}` stays `verified` (non-terminal).
  - **matcher bounding (#5):** with a ledger spanning many rounds, the matcher receives only non-terminal + recently-seen records (assert the existing-set passed to `matchIssues` excludes stale terminal records).

**Prompt-improvement tests:** assert presence of the key clauses (evidence-gating text, severity-band words, `AGENTS.md` reference, minimal-change instruction) — content-contract locks so the gains do not silently regress. The _behavioral_ effect of prompts is **not** unit-tested (cannot be) — that is exactly what the trace log measures on real runs.

**Verification commands** (repo root, from `review-loop/package.json`): `bun run review-loop:test` · `bun run review-loop:typecheck` · `bun run review-loop:lint` · `bun run review-loop:format:check`. The write hook already enforces test-first + lint/typecheck on `review-loop/src/**`.

**Explicitly not covered by tests** (deferred, needs real-run trace data): actual FP-rate reduction, convergence improvement, optimal confidence threshold — these are measured post-change via `trace.jsonl`, not asserted.

## Out of scope

- The `opencode run` shell-subprocess + file-JSON exchange architecture is unchanged. The agents already have tools (read/grep/bash) via opencode; the prompts now _instruct_ evidence-fetching rather than a tool-build.
- No reviewer/fixer _persona_ or system-prompt layer is added; improvements live in the user-turn task strings only, matching the current single-turn model.
- No cross-model, no consensus, no thresholding (see "Deferred").

## Drift Log

| Date       | Category                  | Item                                                                                                | Decision                                                                                                              |
| ---------- | ------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 2026-07-16 | Already shipped           | §2 config-derived check command                                                                     | Removed from scope; verified at `prompt-templates.ts:19`, `loop-controller.ts:95,148`                                 |
| 2026-07-16 | Already shipped           | §2 retry-verdict recording                                                                          | Removed from scope; verified at `loop-controller.ts:101-106,121-126`                                                  |
| 2026-07-16 | Already shipped           | §2 matcher ratchet widening                                                                         | Removed from scope; verified at `loop-controller.ts:221`, test `loop-controller.test.ts:464`                          |
| 2026-07-16 | In-plan, partial          | §2 retry prompt schema-inline                                                                       | Kept; narrowed (checkCommand part already shipped)                                                                    |
| 2026-07-16 | In-plan, partial          | §2 `fixed:true` trust                                                                               | Rewritten to the actual remaining gap (no-commit guard via `postSha === baselineSha`)                                 |
| 2026-07-16 | In-plan, divergent        | Fixer commit ownership (prompt told agent to commit + loop also commits)                            | Resolved with user: agent composes `commitMessage`, loop is single committer; additive schema field                   |
| 2026-07-16 | Out-of-plan, on-goal      | Run 1 retrospective `2026-07-16-review-loop-run-1-retrospective.md`                                 | Validated; folded in: §2 #3 `clean -fd`, §2 #4 `valid+manual`→terminal, §2 #5 matcher bounding; evidence-gating cited |
| 2026-07-16 | Validated, new            | `clean -fd` on revert paths (Run 1 `fa778fcef`)                                                     | Added as §2 #3                                                                                                        |
| 2026-07-16 | Validated, new            | `valid+manual` verdict spins as non-terminal `verified` (Run 1 ledger)                              | Added as §2 #4                                                                                                        |
| 2026-07-16 | Promoted from risk-note   | Matcher context unbounded (Run 1: 50 issues / 10 rounds)                                            | Added as §2 #5                                                                                                        |
| 2026-07-16 | Deferred (needs decision) | Run 1 retro: issue categories, `plan_drift` verdict, severity early-stop, `needs_human.md`, SIGKILL | Not folded — scope-expansion candidates (see question)                                                                |
