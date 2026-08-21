## Context

See `proposal.md` — Why. Current state: TDD is enforced via shared `.hooks/tdd/` checks consumed by both ` .claude/hooks/` (Claude Code) and `.opencode/plugins/tdd-enforcement.ts` (opencode).

- `PreToolUse` (`pre-tool-use.mjs:24-65`, `tdd-enforcement.ts:101-128`): `enforceWritePolicy` (inline suppressions, `.oxlintrc.json` protection) → `enforceTdd` (block if gateable impl file `src/|client/|plugins/|review-loop/src/|sdd-runner/src/` has no covering test or test doesn't import impl). On pass, `SessionState.setNeedsRecheck(true)`.
- `PostToolUse` (`post-tool-use.mjs:12-41`, `tdd-enforcement.ts:139-165`): `trackTestWrite` → `verifyTestImport` → `verifyTestsPass` (runs `bun test <file> --only-failures`, 30s timeout, 3k cap, `coverage.mjs`/`coverage-session.mjs` for coverage drop). Claude prints hook JSON; opencode does `client.session.promptAsync` (injects a new turn).
- `Stop`/`session.idle` (`stop.mjs:12-40`, `tdd-enforcement.ts:167-190`): `checkFull --skip-tests` (typecheck/lint/format) + doc/analytics review prompts.
- `Pre-Bash`: only blocks `git stash` / `git checkout --`.

Bypass: any `bash` file-write (`python3 open().write()`, `node -e fs.writeFileSync`, `echo >`, `cp`, `sed -i`, …) misses `Write/Edit` gating entirely. Auto-run in `PostToolUse` pollutes context (opencode: extra `promptAsync` turn per edit; Claude: hook output blob) and duplicates the agent's own `bun test`.

## Goals / Non-Goals

**Goals:**
- Remove context pollution from `verifyTestsPass` while preserving `enforceWritePolicy` and `verifyTestImport` signal.
- Convert `enforceTdd` from hard block to single advisory nudge per file per session — no stub, no filesystem layer.
- Keep both hosts (` .claude` and `.opencode`) in sync via shared `.hooks/tdd/` code.
- Document the new contract: local = steer, CI = gate.

**Non-Goals:**
- Filesystem/container/`chmod`/`bwrap` enforcement; bash denylist; auto-scaffolded test stubs; wiring dormant surface checks (`snapshot-surface.mjs`/`verify-no-new-surface.mjs`); changing CI mutation/coverage gates.

## Decisions

### 1. Remove `verifyTestsPass` entirely (both hosts)

- **What:** Delete the `verifyTestsPass` call site in `post-tool-use.mjs:28-32` and `tdd-enforcement.ts:162-164`. Keep `trackTestWrite` + `verifyTestImport` (lightweight, no subprocess). Leave `test-runner.mjs`/`coverage*.mjs` on disk — they remain used by `getSessionBaseline`/`getCoverage` elsewhere and are reversible from git.
- **Why:** Models already run `bun test <file>` themselves; the hook's 30s `bun test --only-failures` + optional 120s `bun test --coverage` run duplicates work and injects up to 3k tokens per edit. Removal is the lowest-risk pollution fix and is trivially revertible.
- **Alternative considered:** Thin to a one-line summary or sidecar file. Rejected for now — can be re-added behind a flag if regression (agents stop testing) is observed.

### 2. Soften `enforceTdd` PreToolUse from block to nudge — allow write, emit once

- **What:** Change `enforce-tdd.mjs:46-82` / call sites in `pre-tool-use.mjs:42-54` + `tdd-enforcement.ts:121-124` from `permissionDecision: deny` / `throw` to: allow the write, then in `PostToolUse` (after the write succeeded) check the same predicate (`isGateableImplFile && !findTestFile && !alreadyTestedThisSession`) and if true, emit a single advisory message per file per session.
- **Where to emit:**
  - Claude: `PostToolUse` `console.log(JSON.stringify({ hookSpecificOutput: ... additionalContext }))` or plain stdout advisory (not a block). Keeps history as hook output, not a new turn.
  - opencode: `client.session.promptAsync` with a short nudge (existing `notifySession` path, but now once per file, not per edit + test run).
- **Dedup:** Use `SessionState.changedSourceFiles` (`session-state.mjs:189-204`) or a new `Set` in the check to ensure one nudge per file per session. Subsequent edits to same file don't re-nag.
- **Message shape (short, non-shaming):** `Wrote src/foo/bar.ts without a covering test — next time write the failing test first (TDD). Expected test: tests/foo/bar.test.ts. CI will require it.`
- **Why not stub:** Creating `tests/foo/bar.test.ts` for the agent does the work and leaves phantom files; steering preserves ownership and avoids cleanup.
- **Alternative considered:** Keep block for `Write/Edit` but add bash-after audit + revert. Rejected as heavier and still post-hoc; for cooperative agents a nudge + CI gate is sufficient.

### 3. No new gate at Stop for now

- Keep `Stop` as `checkFull --skip-tests` + doc/analytics prompts. The hard gate remains existing CI (`test:mutate:changed` per-file floor + coverage ratchet via `scripts/mutation/baseline.json`). If local nudge proves too soft, a future change can promote a `git diff`-based `tdd-audit` into `checkFull` without revisiting this design.
- **Why:** Minimizes scope; this change is purely a simplification (removal + softening), not a new enforcement mechanism.

### 4. Shared-code principle

- All TDD predicate logic stays in `.hooks/tdd/` (`test-resolver.mjs`, `session-state.mjs`, `enforce-tdd.mjs`) and both hosts import it. No host-specific fork of the nudge predicate. `tdd-enforcement.ts` and `pre-tool-use.mjs`/`post-tool-use.mjs` remain thin adapters.

## Risks / Trade-offs

- [Agent ignores nudge and lands test-less code locally] → Mitigated by CI mutation/coverage gates which block PRs; local `Stop`/`checkFull` remains green for this case. Risk is acceptable for cooperative-agent threat model; adversarial bypass was never closable without a filesystem layer.
- [Loss of fast red signal after impl edit] → Mitigated by agent's own `bun test <file>` habit and by existing `verifyTestImport` nudge for test files that don't import impl. If regression observed, re-add a thinned `verifyTestsPass` summary behind a flag (git history preserves the full version).
- [Nudge fatigue if dedup fails] → Mitigated by per-file-per-session dedup and short message (no 3k dump). Verified by manual edit of same file twice.
- [Host drift (Claude vs opencode)] → Mitigated by shared predicate; both adapters must be updated together and tested with `bun test .hooks/tests/`.

## Migration Plan

1. Land this change on the current branch; no data migration (no DB, no `SessionState` schema change beyond optional dedup key).
2. Update `docs/architecture/commands.md` TDD Enforcement section to describe the new pipeline: (1) write-policy gate, (2) test-first nudge (advisory), (3) test tracker, (4) import gate — and note that targeted test runs are now the agent's responsibility.
3. Rollback: revert the two call-site deletions and the `enforceTdd` softening — git revert restores the block + auto-run.

## Open Questions

- None blocking. If follow-up adds a `Stop`-phase `git diff` audit, decide then whether it should be advisory or `decision:block`.

## Scope Model / Tool-Prefs / DB Impact

- No new persisted state, no new tool surface, no `tool_prefs` (allow/ask/deny) change, no drizzle migration. `SessionState` (`storage` scoped by `session_id` + `cwd`) continues to hold `writtenTests`/`changedSourceFiles` for dedup.

## Hook / TDD Interaction

- Gated files remain `isGateableImplFile` (`src/|client/|plugins/|review-loop/src/|sdd-runner/src/`, `*.ts|js|tsx|jsx`, not `*.test.*|*.spec.*`). Test-first order is now a convention enforced by nudge + CI, not by a `Write` block. New files under those roots will trigger the nudge on first write when no parallel `tests/` file is found.
