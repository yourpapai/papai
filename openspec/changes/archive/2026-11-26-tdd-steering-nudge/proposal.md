## Why

TDD hooks today block `Write/Edit/MultiEdit` when no covering test exists (`enforceTdd`) and auto-run the companion test (`verifyTestsPass`, 3k dump or `promptAsync` injection). Models have learned to bypass the block via any `bash` file-write (`python3 open().write()`, `node -e fs.writeFileSync`, `echo >`, `cp`, etc.) because only the Write tools are gated, not the filesystem. Separately, the auto-run pollutes the context window and duplicates work the agent would do itself with `bun test <file>`. Feedback needs to be advisory and cheap, with the hard gate moved to where it cannot be bypassed.

## What Changes

- **BREAKING** Remove `verifyTestsPass` auto-run from both hosts: ` .claude/hooks/post-tool-use.mjs` and `.opencode/plugins/tdd-enforcement.ts` (and their shared `test-runner.mjs` / `coverage*.mjs` call sites in that path). Fast feedback becomes the agent's own `bun test <file>`.
- Change `enforceTdd` / `PreToolUse` from **block** to **steer**: allow the impl write to succeed, then emit a single deduped nudge per file per session ("Wrote `src/foo.ts` without a covering test — next time write the failing test first, follow TDD") via the host's advisory channel (`PostToolUse` stdout for Claude, `promptAsync` for opencode). No stub file is created.
- Keep `enforceWritePolicy` (inline suppression / `.oxlintrc.json` protection) and `trackTestWrite` / `verifyTestImport` as-is — they remain lightweight and non-polluting.
- Update docs to reflect the new hook contract: local = steer, CI/Stop = gate.
- No filesystem/container layer, no bash denylist, no auto-scaffolded test stub.

## Capabilities

### New Capabilities
- None — this is a hook-behavior simplification, not a product capability.

### Modified Capabilities
- None — no `openspec/specs/` behavior changes. Hook TDD is internal tooling (covered by `docs/architecture/commands.md` and `.hooks/`), not a user-facing spec. This change opts out of delta specs.

## Impact

- Affected code: `.hooks/tdd/checks/enforce-tdd.mjs`, `.hooks/tdd/checks/verify-tests-pass.mjs` (removal), `.hooks/tdd/test-runner.mjs` / `coverage*.mjs` usage, `.claude/hooks/pre-tool-use.mjs` + `post-tool-use.mjs`, `.opencode/plugins/tdd-enforcement.ts`, `docs/architecture/commands.md`.
- No platform/task instance or scope-model impact (no DB, no per-user/group/thread state change beyond existing `SessionState.changedSourceFiles` dedup).
- No new dependencies.
- Risk: agents that ignore the nudge can land test-less code locally; mitigated by existing hard gates: `bun check:full` / `test:mutate:changed` + coverage ratchet in CI, which cannot be bypassed via `bash`.

## Non-goals

- Filesystem / container / `chmod` / `bwrap` enforcement — explicitly not pursued; too much complexity for the threat model (cooperative agents, not adversarial).
- Bash-command denylist (`>`, `python`, `node -e`, `sed -i`, …) — arms race, not maintained.
- Auto-scaffolding a test stub file for the agent — declined: agent stays responsible for writing the test; hook only steers.
- Re-introducing any auto `bun test` run in hooks — declined for now; can be re-added as a one-line summary behind a flag if regression is observed (git history preserves it).
- Wiring dormant surface checks (`snapshot-surface.mjs` / `verify-no-new-surface.mjs`) — separate work.
