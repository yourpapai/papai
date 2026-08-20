<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Admitting cleanups without displacing defects

## Context

See `proposal.md` — Why. The mechanics this design has to fit into:

- `filterActionable` (`review-round.ts:47`) admits on ledger **status** only — it filters
  terminal statuses and nothing else. There is no severity or worth gate to hang a
  cleanup rule on, and adding one is out of scope here.
- `orderByExposure` (`issue-processor.ts:185`) is a single-key sort on exposure rank. It
  is the loop's only ordering of any kind.
- `MAX_ATTEMPTS = 2` is unified across verdict and build retries
  (`issue-processor-attempts.ts`); a second rejection is `needs_human`. ADR-0303 records
  why, and the fix-proportionality change re-affirmed it as a non-goal to split.
- The ledger persists across `--resume-run` and is Zod-validated on read.
- A run has a soft stop (`stop-controller.ts`) honoured **between two issues**. Ordering
  therefore decides what a stopped run spends its budget on.

## Goals / Non-Goals

**Goals.** Cleanups become reportable. A defect is never delayed by one. A ledger written
before this change still loads. The effect is measurable afterwards.

**Non-Goals.** Changing admission (`filterActionable` keeps admitting on status). Splitting
retry budgets. Any new config knob. Making the fixer behave differently per kind.

## Decisions

### D1: `kind` on the issue, not a severity level or a title convention

```
  reviewer emits ─┬─ kind: 'defect'   ← everything reportable today
                  └─ kind: 'cleanup'  ← the five admitted forms
                                          delete · stdlib · native · yagni · shrink
```

*Why not a sixth severity ("trivial").* Severity already has one meaning — what happens
if the code is reached — and the exposure work was careful to keep that meaning separate
from reachability. Overloading it a third time with "is this a bug at all" would make all
three unreadable, and `SeverityCountsSchema` is already surfaced per round.

*Why not a title prefix.* Ordering has to read it, and parsing an agent-authored string
to decide dispatch order is exactly the "scrape prose to recover an artefact" failure
`opencode-agent`'s local rules record.

*Why the five forms are a closed set rather than free text.* An open category collects
everything a reviewer mildly dislikes, which is the failure mode the existing prompt
already guards against by excluding "correct but I would write it differently". Five
named forms, each with a mandatory replacement, is the same discipline the exposure rule
uses: a citation, not a rating.

### D2: Ordering is kind-then-exposure, keeping `orderByExposure` intact underneath

```
  before:  sort(exposureRank)
           cleanup(cited) ─── critical defect(none) ─── …
              ▲ wrong: a cleanup fixed first

  after:   sort(kindRank, then exposureRank)
           ┌──────── defects ────────┐┌─────── cleanups ───────┐
            cited → unknown → none     cited → unknown → none
```

The exposure comparator is not rewritten — it becomes the tiebreak. That keeps the
existing ordering behaviour and its tests exactly as they are, and makes the new rule one
comparison in front of them.

*Why not simply cap cleanups at `medium` and let severity order them.* Severity does not
order anything today; making it do so would change how defects are ordered as a side
effect of a change about cleanups.

### D3: `kind` is optional on read, required on write

`z.enum(['defect','cleanup']).default('defect')` on the ledger read path. A ledger written
before this change loads and reads as all-defects, which is true. This is the same
narrow-envelope reasoning `readPersistedRunStats` already relies on and that
`cli.test.ts:602` pins — an older artifact must keep loading, and the test says so in as
many words.

No `STATE_VERSION`-style bump: nothing in flight is stranded, and rollback is one-way only
in the sense that older code ignores a field it does not know.

### D4: The severity cap is applied on ingest, not asked of the reviewer

The prompt states the rule, and the ingest path clamps. A rule stated only in a prompt is
a courtesy; the clamp is the mechanism — the same split `PROTECTED_PATHS_RULE` makes
between what the prompts say and what `stageAllowed` enforces.

### D5: The fixer prompt is unchanged

`buildFixPrompt` already says "Edit only what is necessary — no drive-by refactors; scope
edits to targetFiles." For a cleanup, the deletion *is* the necessary edit and the target
files *are* its scope, so the existing sentence is correct for both kinds. Adding a
kind-conditional branch to the fix prompt would be new machinery to say the same thing.

Note what this means for `CHECK_BEHIND_RULE`: a cleanup that deletes code introduces no
non-trivial logic, so the rule does not fire, and the advisory check-behind signal will
record `without-check` for it. That is accurate rather than a false negative — but it does
mean the `Checks left behind:` ratio moves when cleanups are admitted, which is why the
counts are reported per kind (spec, final requirement) rather than pooled.

## Risks / Trade-offs

**Cleanup findings flood a round and the ledger fills with low-value entries** → Ordering
means they are fixed last and dropped first by a stopped run. If volume is still wrong,
the measurement added here is what says so; a gate invented now would be guessing at a
threshold. Watch the per-kind counts over the first runs.

**A cleanup is wrong and deletes something reachable** → The path is unchanged: the fixer
verifies before acting and can return `invalid`, the build gate runs, and the inspector
still sees the fix. A wrong cleanup costs the same as a wrong defect finding and is
refused the same way.

**The reviewer mislabels a defect as a cleanup, delaying a real bug** → Possible, and the
cap makes it cheaper rather than free: a mislabelled defect loses its severity as well as
its place in the queue. Mitigated by the kinds being narrow and each requiring a named
replacement — a null-dereference does not have one.

**`Checks left behind:` becomes harder to read across kinds** → Addressed by reporting per
kind; the pooled ratio is not preserved.

## Migration Plan

Additive: one optional-on-read field, one comparator key, one prompt section, per-kind
counters alongside the existing ones. No migration of stored ledgers — the default handles
them. Rollback is removing the prompt section; issues already tagged `cleanup` load fine
under a schema that ignores the field.

## Open Questions

- Whether `shrink` earns its place. It is the least objective of the five and the only one
  whose replacement is "the same logic, written shorter" rather than a name. If the first
  runs show it producing most of the noise, dropping it is a one-line change to the prompt
  and the closed set — it does not alter the ordering, the schema, or any task here.
