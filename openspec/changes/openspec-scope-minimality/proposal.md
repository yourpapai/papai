<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Ask whether a piece of scope needs to exist, before anything divides it

## Why

Every rule this repository gives an artifact drafter is about how work is *shaped*, never
about whether it should be admitted. `rules.tasks` says to break work into independently
verifiable chunks, and `sdd-runner`'s atomicity checker (`decompose.ts:92`) splits any task
that bundles several — both push toward more. `rules.design` already asks a drafter to
justify a new dependency against the existing stack, which is one rung of the minimality
ladder arriving early and on its own. Nothing anywhere asks the first and cheapest
question: does this capability need to be built at all.

The leverage is unusual. `openspec instructions` returns `rules` alongside the instruction,
and **both** drafters in this repository already forward them verbatim — `sdd-runner`'s
`buildDrafterPrompt` (`draft.ts:59`) and `opencode-agent`'s `artifactBrief`
(`plan-draft.ts:159`). The Claude Code planning skills read the same file. So one edit to
`openspec/config.yaml` reaches every agent that drafts a proposal here, with no code
change in any of them.

## What Changes

- **`rules.proposal`** gains two rungs, and only two: state what breaks if a capability is
  not built, and name the existing capability or module that already covers it if one
  does. Scope that survives neither goes into the `Non-goals` section the rules already
  require — it is not dropped silently, it is recorded as declined.
- **`rules.design`** gains the reuse rung explicitly, beside the dependency rule that is
  already there and is the same question one level out.
- **`rules.tasks` gains nothing**, deliberately. Admission and division are different
  questions and this change touches only the first.
- **The boundary is written down** in `docs/architecture/sdd-pipeline.md`: scope minimality
  governs what is admitted, atomicity governs how admitted work is divided. Without that
  sentence the next person to read both rules together sees a contradiction.

## Capabilities

### New Capabilities

- `sdd-scope-minimality`: the necessity question every drafted proposal must answer, where
  declined scope is recorded, and the boundary against task atomicity.

### Modified Capabilities

None. No existing capability spec under `openspec/specs/` describes the drafting rules.

## Impact

`openspec/config.yaml` (`rules.proposal`, `rules.design`) and
`docs/architecture/sdd-pipeline.md`. No source change: both drafters already forward
`rules`, and `tests/sdd-runner/` and `tests/opencode-agent/` already cover that forwarding
— this change adds a case pinning that a rule reaching the drafter is not silently dropped,
rather than new machinery to deliver one.

Every agent that drafts an artifact here is affected — `sdd-runner`'s drafter,
`opencode-agent`'s `PROPOSE_INSTRUCTIONS` path, and the `openspec-propose` /
`openspec-update-change` skills — because all of them read the same `rules` array.

**Scope impact: none.** Planning-time tooling. No platform instance, no task instance, and
no per-user, group-shared or thread-isolated state.

## Non-goals

- **Any rule that reduces task count.** `rules.tasks` and the atomicity checker stay
  exactly as they are; a "fewer tasks" rule would contradict a checker that exists to split
  them, and splitting is this repository's settled answer to size.
- **Word, section or task-count limits.** `rules.proposal` already caps proposals at 500
  words; a second numeric limit measures length, not necessity.
- **Changing the `spec-driven` schema**, its artifact set, or their dependency order.
- **A gate.** Nothing validates that the necessity question was answered well;
  `openspec validate --strict` keeps checking structure only. A drafter that answers it
  badly is a review problem, and inventing a checker for prose would be the over-build this
  change argues against.
- **The minimality ladder for production code** — that is `agent-minimality-ladder`, which
  deliberately excludes the two artifact-drafting instruction blocks this change covers.
- **`sdd-runner`'s intake scope estimator and depth profiles.** They size the pipeline, not
  the change; a necessity rule there would be answering the question before the proposal
  that frames it exists.
