<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: review-loop fix proportionality

## Context

See proposal.md — Why. Three constraints shape the approach.

`MAX_ATTEMPTS = 2` (`issue-processor-attempts.ts:46`) is shared by build failure and inspector
rejection alike; a second rejection terminates at `needs_human` (lines 190–204), discarding the
fix. Anything routed through that gate can throw away correct work.

`diff-stats.ts` has two consumers. `mutation-improve` imports `measureDiffSince` and `headSha`
(`merge-stats.ts:6`, `pipeline.ts:10`), and its `reportMergeDiff` catches every failure and
degrades to a log line — so a breaking change there is silent, not loud.

`finalizeRun` is skipped entirely on a stopped run (`cli.ts:120-123`). Nothing that must happen
per fix may be placed there.

## Goals / Non-Goals

**Goals:**

- Shape the fix at generation time, where influencing it is free.
- Measure adherence with data the loop already collects.
- Leave the merge decision exactly as it is today.

**Non-Goals:**

- Any new agent, agent call, or schema the agents must fill in.
- Any change to `DiffStats`, `AgentRunResult`, or other shared types.
- Judging whether a fix is *good* — only whether it left a check behind.

## Decisions

**Prevention in the prompt, not detection at a gate.** A gate rejects only after the fixer's
5–21 minutes and the build check are already spent; a prompt constraint costs nothing and acts
before the cost is incurred. *Alternative considered:* adding `proportionate` to
`InspectorResultSchema`. Rejected — the inspector is a merge gate with a destructive second
outcome, and ADR-0303 scoped it away from quality deliberately, naming "a too-aggressive
inspector wastes fixer budget" as a risk. *Alternative considered:* a separate judge agent.
Rejected — ADR-0303 already treats the inspector's single extra call per merged fix as a real
accepted cost; doubling it to police fix size is not proportionate to the problem.

**One boolean, not a score.** The signal answers exactly one question — did the diff touch a
test path — because that is the only question that measures a rule this change introduces.
*Alternative considered:* diff size, new-dependency and new-migration flags. Rejected: they
measure no adopted rule, need thresholds, and would have flagged `ddb7951`, the best commit in
the run that motivated this work.

**Additive read of the numstat.** `parseNumstat` currently discards the paths it parses. The
path-aware read SHALL be a new export alongside the existing one, leaving `DiffStats` and
`measureDiffSince` untouched, so `mutation-improve` cannot break silently.

**Test paths resolved by the repo's own mapping.** The TDD resolver already maps
`review-loop/src/**` to `tests/review-loop/**` and `src/**` to `tests/**`. Reusing it keeps one
definition of "where the test for this file lives"; a rule private to the loop would drift.

**Prohibition rather than detection for documentation.** No actor sees two fixes, and the
terminal round's fixes are never reviewed — so a doc invalidated by a later fix cannot be
caught within a run. Forbidding the fixer to author prose removes the class. *Alternative
considered:* a coherence pass over the whole run diff. Rejected — the only place it fits is
end-of-run, which a stopped run skips, and a run that has exhausted its budget is the worst
moment to add an agent call.

## Risks / Trade-offs

- **The minimality ladder is unenforced; the fixer may ignore it, as it can already ignore "no
  drive-by refactors."** → The coverage boolean makes non-adherence visible for the one rule
  that is mechanically checkable; the rest is accepted as best-effort until data says otherwise.
- **"Non-trivial logic" is a judgment the fixer makes about its own work.** → Deliberate. The
  boolean measures the outcome rather than the judgment, so an inflated self-assessment shows up
  as a fix with no test path touched.
- **Documentation now goes stale passively — the loop changes code and no doc follows.** → This
  is the pre-existing condition and an ordinary PR-review concern. Actively publishing a
  confident wrong claim is a defect the loop itself creates; passive staleness is not.
- **A signal nobody reads is waste.** → Its reader is named: it measures the check-behind
  requirement introduced in the same change. If that rule is ever dropped, the signal goes too.

## Migration Plan

No data migration, no persisted state, no config change. The prompt edits take effect on the
next run; the signal appears in new runs' summary and `metrics.json`. Rolling back is reverting
the commits — older `metrics.json` files stay readable because the field is additive.

## Hook / TDD interactions

`review-loop/src/**` is gateable implementation code mapped to `tests/review-loop/**`, so every
source edit here is test-first. New tests land in `tests/review-loop/prompt-templates.test.ts`
(the prompt contract) and a new `tests/review-loop/diff-stats.test.ts` case for the path-aware
read. Prompt assertions should pin the *contract* — that the instruction requires a check to
remain — not the exact wording, or every prompt reword becomes a test failure.
