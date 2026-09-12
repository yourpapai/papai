<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Carry the minimality ladder to every agent that writes production code

## Why

`review-loop` teaches its fixer to reach for the smallest thing that works
(`MINIMALITY_LADDER`, `prompt-templates.ts:33`, shipped in `8d22c58`). The other two
agents in this repository that write production code are told nothing of the kind.
`CLAUDE.md` has no rule about scope at all — no ladder, no reuse-before-build, no
question about whether the code needs to exist — and it is read by the agent that
writes most of the code here. `opencode-agent`'s `IMPLEMENT_INSTRUCTIONS` is five
lines, one of which warns that the job may be killed at any moment: a prompt that
raises urgency and says nothing about size.

The rule is written, tested and in use. What is missing is its reach.

## What Changes

- **One rule, one definition.** The ladder's text becomes a named constant with a
  single home, carried verbatim by every instruction block that asks an agent to
  write production code, and asserted against that constant by a test — the pattern
  `PROTECTED_PATHS_RULE` already establishes in `opencode-agent`, where
  `instructions.test.ts` makes a softened copy fail.
- **New carriers:** `IMPLEMENT_INSTRUCTIONS` (`implement-prompts.ts:41`) and
  `CI_FIX_INSTRUCTIONS` (`phases/ci-fix.ts:25`). The two `plan-draft.ts` blocks are
  deliberately excluded — they draft OpenSpec artifacts, which is a different rule
  and a different change.
- **`CLAUDE.md` / `AGENTS.md`** gain one Key Conventions paragraph, sitting beside
  the existing `max-lines` note so the two are read together.
- **The ladder keeps its brake.** The clause that a smaller diff is not the goal, and
  that validation, error handling, security and tests are never cut to reach one,
  travels with it everywhere. A carrier missing the brake fails the test.

## Capabilities

### New Capabilities

- `agent-minimality-instructions`: the minimality rule's single definition, which
  agent instruction surfaces must carry it, and what it may never be read to permit.

### Modified Capabilities

None. `review-loop-fix-quality` (in `openspec/changes/review-loop-fix-proportionality/`)
already requires the review loop's fix prompts to carry the ladder; this change moves
where the text lives without changing that requirement's behaviour.

## Impact

`review-loop/src/prompt-templates.ts` (the constant's current home),
`opencode-agent/src/implement-prompts.ts`, `opencode-agent/src/phases/ci-fix.ts`,
`CLAUDE.md`, `AGENTS.md`; tests under `tests/review-loop/` and
`tests/opencode-agent/`. Docs: `review-loop/CLAUDE.md`, `opencode-agent/CLAUDE.md`.

Whether `opencode-agent` imports the constant from `review-loop/src` (the relative-path
precedent `mutation-improve` already sets) or the two workspaces keep separate copies
pinned by a drift test is a design decision, not a scope one — see `design.md`.

**Scope impact: none.** Local developer tooling and agent instructions. No platform
instance, no task instance, and no per-user, group-shared or thread-isolated state.

## Non-goals

- **"Fewest files possible."** The upstream phrasing of this rule says it; this repo's
  `max-lines` convention says a length failure means *split the file*. The repo's rule
  wins and the phrase is not adopted.
- **Marker comments** (`ponytail:` or otherwise) recording deliberate simplifications.
  Hook policy blocks suppression comments and nothing would read a new vocabulary.
- **Intensity levels or an off switch.** A discipline that can be turned off mid-run is
  not one the loop can rely on.
- **Measuring the rule by diff size.** Already rejected, with a named counter-example,
  in `review-loop-fix-proportionality`'s non-goals.
- **`mutation-improve`'s IMPROVE agent.** It cannot touch `src/` at all; the ladder is
  a no-op there. Its own over-build is addressed separately.
- Installing the upstream plugin, or any session-wide prompt injection.
