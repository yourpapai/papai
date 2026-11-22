# Tasks

## 1. Red: approval resolver and assembly contract

- [ ] 1.1 Create `tests/tools/permission-approval.test.ts` covering the resolver contract: an `allow` tool returns `not-applicable` without prompting; an `ask` tool awaits the prompt exactly once and returns `approved` on allow; a denial returns `{ type: 'denied', reason }` carrying today's user-denied text; an `ignored` (timeout) decision returns the timeout reason; a missing prompt surface returns the no-surface reason; verify `bun test tests/tools/permission-approval.test.ts` fails because `buildToolApproval` does not exist.
- [ ] 1.2 Update `tests/tools/permission-gate.test.ts` and `tests/tools/tool-preferences.test.ts` so an `ask` tool exposes a reason-stripping `execute` (no in-body gating), the executed input has no `_permission_reason`, and `deny` tools are still removed; verify `bun test tests/tools/permission-gate.test.ts tests/tools/tool-preferences.test.ts` fails.

## 2. Green: resolver, assembly, and orchestrator threading

- [ ] 2.1 Replace `gatedExecute` with `buildToolApproval` plus a reason-stripping wrapper in `src/tools/permission-gate.ts`; drop `buildPermissionDenied` and the no-surface branch from the gate; verify `bun test tests/tools` and `bun run typecheck` pass.
- [ ] 2.2 Carry `toolApproval` as a **required** field on `InvokeModelArgs` and `GenerateArgs`, build it in `buildLlmInvocationOpts`, and pass it from `callGenerateText` to `generateText`; verify `bun run typecheck` fails on any unwired literal and `bun test tests/run-control/invoke-wiring.test.ts` passes.

## 3. Wiring the three model call sites

- [ ] 3.1 Add `tests/llm-orchestrator-tool-approval.test.ts` asserting the interactive call, the verifier call (`buildTurnVerifier`), and the proactive call each receive the resolver, and that a proactive turn (no chat surface) denies an `ask` tool; verify the test fails before the wiring and passes after.
- [ ] 3.2 Wire the resolver through `buildTurnVerifier` (`src/llm-orchestrator-support.ts`) and the proactive helper so no model call offers an `ask` tool without it; verify `bun test tests/llm-orchestrator-tool-approval.test.ts tests/llm-orchestrator* tests/deferred-prompts` passes.

## 4. Analytics and risky-turn parity

- [ ] 4.1 Add tests asserting a denied call emits the tool-execution fact with `outcome: 'permission_denied'` and the confirmation lifecycle facts unchanged; implement the emission in the resolver; verify `bun test tests/llm-orchestrator-tool-terminal.test.ts tests/analytics` passes.
- [ ] 4.2 Add a test that a turn whose tool result is `execution-denied` is detected as a tool failure and classified `partial` by the verified-completion path; extend `detectToolFailure`; verify `bun test tests/completion tests/llm-orchestrator-send.test.ts` passes.

## 5. Docs and the full gate

- [ ] 5.1 Update `docs/architecture/tools.md`, `src/tools/CLAUDE.md`, and the tool-permission prose in `docs/architecture/behaviors.md` for the pre-execution approval boundary and the model-visible denial; verify `rg -n gatedExecute src docs` returns no stale reference and `bun run format:check` passes.
- [ ] 5.2 Run `bun test`, `bun run typecheck`, `bun run lint`, `bun run security`, `bun run test:stories`, and `bun run test:mutate:changed --base=HEAD~1`; verify all exit 0 and the docs from 5.1 are in the same commit.

## Workflow follow-up

- Mark candidate 3 of `openspec/changes/dependency-refresh-2026-11/follow-ups.md` as delivered once the implementation lands.
- Archive this change after review approval and a green full gate.
