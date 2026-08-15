<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Carrying the minimality ladder across workspaces

## Context

See `proposal.md` — Why. What this design has to settle is where one paragraph of
prompt text lives when its readers sit in two workspaces that deliberately do not
share a runtime boundary.

The current state:

- `MINIMALITY_LADDER` is a module-private constant in
  `review-loop/src/prompt-templates.ts:33`, used by three fix prompts, and asserted
  by `tests/review-loop/prompt-templates.test.ts` on obligations rather than wording.
- `opencode-agent` treats `review-loop/` as a **subprocess**, not a module: it drives
  it through `review-runner.ts` and imports nothing from it.
- `mutation-improve` does the opposite — it imports `review-loop/src/*` by relative
  path — so a cross-workspace source import has precedent, but not from this consumer.
- `PROTECTED_PATHS_RULE` (`opencode-agent/src/protected-paths.ts:64`) is the
  established shape for "one rule, several instruction blocks":
  `tests/opencode-agent/instructions.test.ts:36` asserts every carrier `toContain` the
  constant, so a softened copy cannot pass.

## Goals / Non-Goals

**Goals.** One authority for the rule's text. A failing test when any carrier drifts
from it. No new runtime dependency between workspaces.

**Non-Goals.** Unifying the two workspaces' prompt-assembly styles. Sharing anything
beyond this one constant. Changing what `review-loop`'s three fix prompts already say.

## Decisions

### D1: Two constants, one equality test — not a shared module

Each workspace keeps its own exported constant; a test in `tests/` imports both and
asserts they are equal.

```
        review-loop/src/                opencode-agent/src/
        prompt-templates.ts             prompts.ts
        MINIMALITY_LADDER               MINIMALITY_RULE
              │                                │
              │  carried by                    │  carried by
              ▼                                ▼
        buildFixPrompt                   IMPLEMENT_INSTRUCTIONS
        buildRetryFixPrompt              CI_FIX_INSTRUCTIONS
        buildRetryFixWith…Prompt               │
              │                                │
              └────────────┬───────────────────┘
                           ▼
             tests/…/minimality-rule.test.ts
             asserts the two texts are equal,
             and that each carrier contains its own
```

*Why not a shared module (option B).* It would be a new file whose only content is a
string, imported across a boundary `opencode-agent` maintains on purpose — its
`CLAUDE.md` records that the review loop is a subprocess and "must not grow back" into
the pipeline's own modules. A runtime import for one paragraph buys nothing a test
does not, and costs a coupling that has to be defended at every later refactor.

*Why not a relative-path import from `review-loop` (option A).* Same coupling, with a
direction that makes `opencode-agent`'s CI install order matter for a string. The
`mutation-improve` precedent exists because that workspace reuses real machinery —
agent runner, worktrees, diff stats — not a constant.

*Why the test is the right home for the coupling.* `tests/` already reaches across
every workspace, and there is precedent for exactly this shape:
`tests/review-loop/diff-stats.test.ts:117` imports the repo's own `isTestFile` from
`.hooks/tdd/test-resolver.mjs` and asserts the loop's pattern against it. Drift
pinning is a test's job here, and it is already how this repository pins drift.

### D2: The constant's home in `opencode-agent` is `prompts.ts`, not a new file

`implement-prompts.ts` and `phases/ci-fix.ts` both already import `prompts.js` — the
first for `UntrustedEnvelope`, the second for `buildCiFixPrompt` as well. The rule's
second rung is "already in this codebase"; a new `minimality-rule.ts` would fail it.

### D3: Carriers are the code-writing blocks only

`IMPLEMENT_INSTRUCTIONS` and `CI_FIX_INSTRUCTIONS` carry it. `PROPOSE_INSTRUCTIONS`
and `PROPOSE_FILES_INSTRUCTIONS` (`phases/plan-draft.ts`) do not: they draft OpenSpec
artifacts, where the minimality question is about admitted scope rather than written
code, and where a rule about stdlib and one-liners would be noise. That boundary is
specced, not merely observed, so a later edit that adds the rule to a drafting block
fails a test rather than passing quietly.

### D4: Assertions match the constant, not the prose

`review-loop`'s existing tests deliberately assert obligations rather than wording, so
rewording the prompt does not fail the suite. The new assertions are the opposite
shape — `toContain(CONSTANT)` — and that is not a contradiction: the existing tests
check that the *loop still requires* minimality, the new ones check that *every
carrier says the same thing*. Keep both. Losing the first makes a reworded rule
untested; losing the second lets a carrier drift.

## Risks / Trade-offs

**Two constants can be edited in one workspace and not the other, and the test then
fails on a change that is correct** → That failure is the mechanism working: the fix
is to make the same edit in both, which is one line and is what a shared module would
have forced anyway. The test names both files.

**A `toContain` assertion passes on a carrier that also says the opposite two lines
later** → Real and unmitigated by containment alone. The spec's third requirement is
the guard: the brake clause is part of the constant, so a carrier cannot keep the
ladder and drop the clause. A carrier that adds *contradicting* text is a review
problem, not a test problem, and inventing a lint for it would be the over-build this
change is about.

**`CLAUDE.md` prose cannot be pinned by a test** → Accepted. It is one paragraph, it
is read by a human on every edit to that file, and the alternative is generating
Markdown from a TypeScript constant, which is machinery for a paragraph.

## Migration Plan

Additive throughout: no persisted shape, no schema, no config key, no data. Rollback
is deleting the paragraph and the two carriers. Nothing in flight is affected — the
prompts change what future agent turns are told, and no stored state records what a
past turn was told.

Order matters only in that `review-loop`'s constant becomes exported before the
equality test can import it.
