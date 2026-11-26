## 1. Remove verifyTestsPass auto-run (both hosts)

- [x] 1.1 Remove `verifyTestsPass` call from `.claude/hooks/post-tool-use.mjs` (delete the `import` and the `await verifyTestsPass` block, keep `trackTestWrite` + `verifyTestImport`). Verify: `bun test .hooks/tests/tdd/checks/verify-tests-pass.test.ts` still passes (or is updated to reflect removal) and manual `bun run typecheck`.
- [x] 1.2 Remove `verifyTestsPass` call from `.opencode/plugins/tdd-enforcement.ts` (`handleToolExecuteAfter` — delete the `void verifyTestsPass(...).then(...)` block and its import; keep `trackTestWrite` + `verifyTestImport` + `notifySession` for the import case). Verify: `bun run typecheck` and `bun test .hooks/tests/tdd/checks/verify-tests-pass.test.ts`.

## 2. Soften enforceTdd from block to advisory nudge

- [x] 2.1 Add failing tests for the new nudge behavior in `.hooks/tests/tdd/checks/enforce-tdd.test.ts` (and adapter tests for `pre-tool-use.mjs:42-54` / `tdd-enforcement.ts:101-128`): when gateable impl file has no covering test, write is allowed but a nudge payload is returned for `PostToolUse` to emit. Tests must cover dedup (second write to same file in same session does not re-nudge) and non-gateable paths remain unaffected. Verify: `bun test .hooks/tests/tdd/checks/enforce-tdd.test.ts`.
- [x] 2.2 Implement the nudge in `.hooks/tdd/checks/enforce-tdd.mjs` (or a thin `tdd-nudge.mjs` reusing its predicate `isGateableImplFile` + `findTestFile` + `SessionState`): return advisory payload instead of `decision:block` when no test is found, with dedup via `SessionState.changedSourceFiles`. Many callers will treat this as "allow but emit". Verify: `bun test .hooks/tests/tdd/checks/enforce-tdd.test.ts`.
- [x] 2.3 Wire the nudge in `.claude/hooks/pre-tool-use.mjs` → `post-tool-use.mjs`: `PreToolUse` no longer denies on missing test; `PostToolUse` emits the advisory (stdout `additionalContext` / hook output) once per file per session, using the same predicate. Verify: `bun test .hooks/tests/tdd/checks/track-test-write.test.ts` and manual `node .claude/hooks/post-tool-use.mjs` smoke test.
- [x] 2.4 Wire the nudge in `.opencode/plugins/tdd-enforcement.ts`: `handleToolExecuteBefore` no longer throws on `enforceTdd`; `handleToolExecuteAfter` emits `notifySession` nudge once per file per session (reuse `SessionState`). Verify: `bun run typecheck` and `bun test .hooks/tests/tdd/checks/enforce-tdd.test.ts`.

## 3. Docs and validation

- [x] 3.1 Update `docs/architecture/commands.md` TDD Enforcement section to describe the new pipeline (write-policy gate → test-first nudge (advisory, once per file) → test tracker → import gate; targeted test runs are now the agent's responsibility via `bun test <file>`). Verify: `bun run lint` (docs lint if applicable).
- [x] 3.2 Run full validation: `bun test`, `bun run typecheck`, `bun run lint`, and `openspec validate --strict` (expect `skip_specs: true` to satisfy zero-delta check). Update `openspec/changes/tdd-steering-nudge/tasks.md` checkboxes as work completes.

