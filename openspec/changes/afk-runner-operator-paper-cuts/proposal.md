# afk-runner-operator-paper-cuts

## Why

Before retirement, master closed four operator-facing paper cuts on sdd-runner
(`cf8a53ac4`); afk-runner inherited three of them unfixed. The working-tree
guard in `agent-layer.ts` still allows all of `openspec/changes/`, so a run's
agent can rewrite a **different** change's artifacts without tripping
`DiffGuardViolationError`. `--depth` returns from `runIntake` before the
estimator spawns, so an override silently discards the estimator's independent
reading. And `resolveDepth`'s two-level `disagreement` flag is emitted into the
depth event and returned — with no consumer: computed, recorded, never read.

## What Changes

- The working-tree guard scopes to the spawn's own change folder:
  `RunStageAgentOptions.changeName` (required on every spawn) restricts the
  allowed prefix to `openspec/changes/<changeName>/`; a sibling whose name
  shares a prefix does not match. The tree-wide `openspec/changes/` prefix
  survives only as a stated fallback if a seam without a change name emerges.
- A `--depth` override logs a warn line naming the cost: the estimator never
  ran, and the forced profile sizes the round caps and the tail shape (S skips
  atomicity; decompose presents the final gate).
- Estimator/prescreen `disagreement` logs a warn line naming both readings and
  the higher one taken — the flag stops being emitted-and-unread.
- `.claude/commands/sdd-auto.md` flag prose is pinned to the parser: a test
  extracts every documented flag and runs it through afk's arg parsing, so the
  front-door doc cannot drift into unknown-flag errors.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `afk-runner-pipeline`: the agent-seam write-guard requirement gains
  own-change-folder scoping. Without it the guard answers "did the agent write
  only where it was told" wrong — any change folder is fair game, including a
  sibling run's in-flight artifacts.
- `afk-runner-cli`: start's operator feedback gains the two intake warns, and
  the documented flag inventory is pinned to the parser. Without it an override
  silently discards the estimator reading and `disagreement` stays dead signal.

## Impact

- Code: `afk-runner/src/agent-layer.ts`, `work/intake.ts` (a warn sink on the
  intake deps seam), the CLI arg surface, + tests under `tests/afk-runner/`
  including the doc-drift pin.
- Docs: `docs/architecture/afk-runner.md` (intake and guard notes).
- Instances/scope: none — offline runner workspace, per-workdir config; no DB,
  no chat surfaces, no per-user/group-shared/thread-isolated state.
- Depends on `afk-runner-spec-home` for the parent capabilities.

## Non-goals

- The bin/shebang and dead-command paper cuts — afk's entry is the
  `afk-runner:start` alias and printed pointers name real verbs.
- Any oversize verdict or decomposition routing — declined with the plan branch
  (0 `plan` events in 14 runs); the override warn names a discarded estimator
  reading, which afk does have.
- TUI surfaces (U8 hold); estimator prompt or model changes.
