# Proposal: fix-oxlint-180-findings

## Why

PR #398 (dependabot, `bun-dependencies` group) bumps `oxlint` 1.78.0 → 1.80.0, and the new
linter fails `bun run lint` with three diagnostics that 1.78 did not report. CI gates on lint
(`check:full`, pre-commit), so the PR cannot merge green until the code complies. The findings
are small, but two of them expose real hygiene issues (a duplicate interface silently merged by
TypeScript; a Zod const named against the repo's `XSchema` convention).

Scope note: this is build-tooling compliance only. No platform instance, task instance, or
config-context scope (per-user / group-shared / thread-isolated) is affected — no runtime
surface changes.

## What Changes

- `sdd-runner/src/event-schemas.ts`: rename the `DoneEvent` Zod const (line 90) to
  `DoneEventSchema` and update its in-file references (lines 244, 274). The exported
  `type DoneEvent` (line 294) keeps its name, so no external import changes.
- `sdd-runner/src/orchestrator.ts`: delete the byte-identical duplicate `RunResumeResult`
  interface (lines 67–73), keeping the first declaration.
- `tests/review-loop/test-helpers.ts`: rename the bare `_` parameter of `silentTrace().append`
  (line 177) to `_event` — underscore-prefixed non-bare parameters stay exempt under the new
  `no-unused-vars` default.
- No `.oxlintrc.json` changes and no suppression comments (repo policy forbids them; the
  underlying issues are fixed instead).

Root causes, verified by probing oxlint 1.78 vs 1.80 on a minimal repro: oxlint 1.80's
`no-redeclare` now flags the legal `const X` + `type X` pairing, and 1.79's `no-unused-vars`
now reports bare `_` parameters.

## Capabilities

### New Capabilities

None. Declared with `skip_specs: true`: this change alters no spec-level behavior — it renames
one symbol, removes a redundant duplicate declaration, and renames one test-helper parameter.
Lint hygiene of `sdd-runner`/`review-loop` internals is not a system capability, and no
existing spec under `openspec/specs/` covers it. Inventing one would couple every future
cleanup to a spec delta.

### Modified Capabilities

None.

## Impact

- Files: `sdd-runner/src/event-schemas.ts`, `sdd-runner/src/orchestrator.ts`,
  `tests/review-loop/test-helpers.ts`. All three are outside the mutation-gate product scope
  (`sdd-runner/` and `tests/` get no per-file floor), so no baseline re-measure is expected.
- Sequencing: land these fixes on master first — they are no-ops under oxlint 1.78 — then
  merge PR #398 (`@dependabot rebase` will pick them up and the PR goes green). Dependabot
  branches do not accept pushed commits.
- Docs: no behavior change; `docs/architecture/commands.md` (lint/`check:full` pipeline)
  needs no update.

## Non-goals

- No oxlint/oxfmt config re-laxing (no `argsIgnorePattern` or rule overrides to re-admit the
  old patterns) — fix the code, keep upstream defaults strict.
- No adoption of new oxlint 1.79/1.80 rules or oxfmt `experimentalOperatorPosition` beyond
  what the existing config selects.
- No rrule-temporal strict mode, Bot API 10.3 rich-message adoption, or strybk spec
  regeneration — separate opportunities identified in the PR #398 review, each declined here
  as needing their own change.
- No new tests pinning "lint passes" — `bun run lint` already runs in CI and pre-commit;
  a redundant test would duplicate the gate.
