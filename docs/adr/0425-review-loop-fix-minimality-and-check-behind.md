<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0425: Shape the Fix, Do Not Gate It — Minimality in the Prompt, Check-Behind as an Advisory Signal

## Status

Accepted

## Date

2026-08-15

## Context

The review loop had no notion of a fix being *bigger than the problem*. `filterActionable` admits an issue on its ledger **status**, never on worth, and the inspector that follows judges only whether a diff addresses the issue it was given — its prompt is scoped away from quality by explicit anti-scope-creep language in [ADR-0303](0303-review-loop-parallel-fixes-inspector.md). So nothing shaped a fix toward the smallest thing that works, and nothing noticed when one landed with no check behind it.

PR #272's review run made the cost visible. Of 17 fix commits: **6 shipped no test at all**, in a repo whose Write/Edit hook gates implementation code on test-first; one resolved a logging gap by adding a module-scope `pino` logger to a package whose stated design is fully DI-seamed; and one wrote an architecture paragraph that a later fix in the same run invalidated two hours on. Every one of them passed every gate the loop has, because they built and they addressed their issue.

The obvious place to catch this is the inspector — it is the only actor holding both the issue and the diff. That turns out to be the one place it must not go.

## Decision Drivers

- **A gate rejects only after the cost is already spent.** A fixer run is 5–21 minutes plus a build check. A prompt constraint acts before any of that; a gate acts after all of it.
- **The inspector's rejection is destructive.** `MAX_ATTEMPTS = 2` is shared by build failure and inspector rejection alike, and a second rejection terminates the issue at `needs_human`. Routing "too big" through that gate can discard a *correct* fix and spend a build retry doing it.
- **Proportionality is not a merge/no-merge property.** A correct-but-oversized fix should still merge. The inspector has no verdict that means "merge this, but note it."
- **A signal must measure a rule that exists.** Anything recorded that does not correspond to an adopted rule is speculative instrumentation, which is the same class of waste this change exists to reduce.
- **The loop cannot keep prose true.** No actor sees two fixes, and the terminal round's fixes are never reviewed at all — so documentation authored by one fix and invalidated by a later one cannot be caught within a run.

## Considered Options

### Option 1 — Minimality in the fix prompts + one advisory boolean (chosen)

The three fix prompts gain a minimality ladder applied *after* comprehension, a requirement that non-trivial logic leaves one runnable check behind, and a prohibition on authoring architecture prose. The orchestrator records one boolean per accepted fix — did its diff touch a test path — sourced from the numstat it already runs, and reports it in the summary and `metrics.json`.

- **Pros:** costs no tokens and no extra agent call; acts before the fixer's time is spent rather than after; cannot discard a correct fix; the one recorded signal measures exactly the one mechanically-checkable rule introduced alongside it; the prose prohibition removes a failure class rather than detecting it.
- **Cons:** the ladder is unenforced — a fixer may ignore it, as it can already ignore "no drive-by refactors"; "non-trivial logic" remains the fixer's judgment about its own work.

### Option 2 — Add `proportionate` to the inspector result, rejected

Extend `InspectorResultSchema` and the inspect prompt to judge whether a fix is proportionate to its issue.

- **Pros:** no new agent call; the inspector already holds the issue, the diff, and the fixer's reasoning.
- **Cons:** collides with the unified retry budget — a proportionality rejection consumes a build-failure retry, and a second one discards a correct fix at `needs_human`. Contradicts ADR-0303's deliberate scoping and revives the "too-aggressive inspector wastes fixer budget" risk that ADR names. The natural mitigation, separate per-failure budgets, is ADR-0303's already-rejected Option 3.

### Option 3 — A separate proportionality judge agent, rejected

A fourth agent role running after the inspector.

- **Pros:** clean separation; the inspector's prompt is untouched; its own budget semantics are possible.
- **Cons:** ADR-0303 already treats the inspector's single extra call per merged fix as a real accepted cost; doubling it to police fix size is not proportionate to the problem. Building a new agent to prevent over-engineering is self-refuting.

### Option 4 — A richer mechanical signal (diff size, new dependency, new migration), rejected

Score each fix on several syntactic dimensions instead of one boolean.

- **Pros:** catches bloat the test-path boolean cannot see.
- **Cons:** measures no rule this change adopts, needs thresholds that will be tuned by feel, and would have flagged the single most valuable commit in the run that motivated the work — a schema migration that fixed real data corruption.

## Decision

Option 1. Concretely:

1. **`MINIMALITY_LADDER`** in `prompt-templates.ts`, carried by `buildFixPrompt` and both retry prompts. It runs after comprehension, and states outright that a smaller diff is not the goal — validation, error handling, security and tests are never what gets cut to reach one.
2. **`CHECK_BEHIND_RULE`** requires non-trivial logic to leave one runnable check in the test path this repo already maps the file to, and says a scratch reproduction deleted afterwards does not satisfy it.
3. **`NO_PROSE_RULE`** extends the existing "do NOT edit the plan/spec" prohibition to architecture documentation. The fixer names the file and reports the gap in `reasoning`.
4. **`measureCheckBehind`** in `commit-attempt.ts` returns `with-check | without-check | unmeasured`, measured **before** the merge — `mergeWorkerIntoPrimary` rebases the worker branch, after which the baseline is no longer an ancestor and the diff would sweep in other workers' commits. It never throws.
5. **`parseNumstatPaths` / `measureDiffPathsSince` / `touchedTestPath`** in `diff-stats.ts`, added as new exports rather than by widening `DiffStats`, because `mutation-improve` imports `parseNumstat` and `measureDiffSince` and its `reportMergeDiff` swallows failures — a changed shape there would degrade silently. Test-path classification reuses `.hooks/tdd`'s pattern, with a test asserting the two agree.
6. **`checkBehind` counts** on `RoundCollector` and `RoundMetric`, reported as a `Checks left behind:` summary line that keeps `unmeasured` out of the ratio.

## Consequences

### Positive

- The fix is shaped where shaping is free, and the loop can now say whether its own check-behind rule is being followed.
- No correct fix can be discarded for being too large, because nothing gates on size.
- The prose failure class is gone rather than monitored: the loop no longer writes documentation it cannot keep true.
- `mutation-improve` is unaffected — verified by typecheck and its 161 tests against the changed shared module.

### Negative

- The ladder and the check-behind rule are instructions, not gates. A fixer that ignores them produces a signal, not a failure.
- The signal is syntactic: a fix that touches a test file without meaningfully testing anything counts as having left a check behind.

### Risks

- **The advisory signal is read by nobody and becomes noise.** Mitigated by scope: it measures one adopted rule, and if that rule is dropped the signal goes with it.
- **"Non-trivial" is self-assessed.** The boolean measures the outcome rather than the judgment, so an inflated self-assessment still surfaces as an accepted fix with no test path touched.

## Related Decisions

- [ADR-0303](0303-review-loop-parallel-fixes-inspector.md) — established the inspector as a merge gate, its anti-scope-creep prompt scoping, and the unified `MAX_ATTEMPTS = 2` this ADR declines to overload.
- [ADR-0290](0290-review-loop-simplification.md) — the shell-invoked agent model and the fix prompts this ADR extends.
