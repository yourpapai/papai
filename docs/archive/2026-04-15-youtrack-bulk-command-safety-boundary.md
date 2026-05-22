<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack Bulk Command Safety Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apply_youtrack_command` reject multi-issue requests with a normal tool failure result instead of executing or confirming them.

**Architecture:** Keep the change local to `src/tools/apply-youtrack-command.ts` by adding an early bulk-request guard before the existing confirmation flow. Update `tests/tools/youtrack-command.test.ts` to lock in the new bulk-disabled boundary while preserving the current single-issue behavior.

**Tech Stack:** Bun, TypeScript, Bun test runner (`bun:test`), Zod, Vercel AI SDK tool definitions

---

### Task 1: Add Failing Bulk-Rejection Tests

**Files:**

- Modify: `tests/tools/youtrack-command.test.ts`
- Implementation reference: `src/tools/apply-youtrack-command.ts`

- [ ] **Step 1: Add a helper for asserting tool-failure results**

Insert this helper near the existing `expectConfirmationMessage(...)` helper in `tests/tools/youtrack-command.test.ts`:

```ts
const expectToolFailureMessage = (result: unknown, text: string): void => {
  expect(result).toMatchObject({ success: false })
  expect(result).toBeObject()
  if (result === null || typeof result !== 'object' || !('message' in result) || typeof result.message !== 'string') {
    expect.unreachable('Expected tool failure result with a message string')
  }
  expect(result.message).toContain(text)
}
```

- [ ] **Step 2: Replace the obsolete bulk-confirmation test with a bulk-failure test**

Replace the existing bulk test block in `tests/tools/youtrack-command.test.ts`:

```ts
test('requires confirmation when an allowlisted command targets multiple issues', async () => {
  const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1', 'TEST-2'] }))
  const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

  const result = await getToolExecutor(tool)({
    query: 'for me',
    taskIds: ['TEST-1', 'TEST-2'],
    confidence: 0.6,
  })

  expectConfirmationMessage(result, 'to 2 issue(s)')
  expect(applyCommand).not.toHaveBeenCalled()
})
```

with:

```ts
test('returns a tool failure when a command targets multiple issues', async () => {
  const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1', 'TEST-2'] }))
  const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

  const result = await getToolExecutor(tool)({
    query: 'for me',
    taskIds: ['TEST-1', 'TEST-2'],
    confidence: 0.6,
  })

  expectToolFailureMessage(result, 'disabled for safety')
  expectToolFailureMessage(result, 'structured tools')
  expectToolFailureMessage(result, 'one issue at a time')
  expect(applyCommand).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Remove the obsolete confirmed-bulk success test**

Delete this test block from `tests/tools/youtrack-command.test.ts` because bulk success is no longer allowed:

```ts
test('forwards a confirmed allowlisted command that targets multiple issues', async () => {
  const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1', 'TEST-2'] }))
  const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))

  const result = await getToolExecutor(tool)({
    query: 'for me',
    taskIds: ['TEST-1', 'TEST-2'],
    confidence: 1,
  })

  expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1', 'TEST-2'] })
  expect(applyCommand).toHaveBeenCalledWith({
    query: 'for me',
    taskIds: ['TEST-1', 'TEST-2'],
    comment: undefined,
    silent: undefined,
  })
})
```

- [ ] **Step 4: Run the focused tool test file to verify red**

Run:

```bash
bun test tests/tools/youtrack-command.test.ts
```

Expected: FAIL because the current implementation still executes or confirms bulk requests instead of returning a normal tool failure result.

### Task 2: Implement Early Bulk Rejection

**Files:**

- Modify: `src/tools/apply-youtrack-command.ts`
- Test: `tests/tools/youtrack-command.test.ts`

- [ ] **Step 1: Add a bulk guard before the confirmation path**

In `src/tools/apply-youtrack-command.ts`, add this block inside `execute`, after the existing `applyCommand` availability check and before `requiresConfirmation(...)` is called:

```ts
if (taskIds.length > 1) {
  const message =
    'Bulk YouTrack commands are disabled for safety. Use structured tools when possible, or run the command one issue at a time.'
  log.warn({ query, taskCount: taskIds.length }, 'apply_youtrack_command blocked — bulk commands disabled')
  return { success: false, message }
}
```

- [ ] **Step 2: Leave single-issue confirmation logic untouched**

Do not change `requiresConfirmation(...)`, `describeAction(...)`, or the existing single-issue confirmation flow. The only behavior change for this task is the early bulk rejection branch.

- [ ] **Step 3: Run the focused test file to verify green**

Run:

```bash
bun test tests/tools/youtrack-command.test.ts
```

Expected: PASS, including the new bulk-disabled test and the existing single-issue regression coverage.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/tools/apply-youtrack-command.ts tests/tools/youtrack-command.test.ts
git commit -m "fix: disable bulk youtrack commands"
```

### Task 3: Run Focused Verification

**Files:**

- Verify only; no new files expected

- [ ] **Step 1: Run the command-related verification suite**

Run:

```bash
bun test tests/tools/youtrack-command.test.ts tests/providers/youtrack/operations/commands.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: PASS. This verifies the tool-level bulk rejection did not affect provider transport or YouTrack tool exposure.

- [ ] **Step 2: Run the broader YouTrack regression suite used on this branch**

Run:

```bash
bun test tests/tools/agile-tools.test.ts tests/tools/task-history-tools.test.ts tests/tools/saved-query-tools.test.ts tests/tools/youtrack-command.test.ts tests/tools/create-task.test.ts tests/tools/update-task.test.ts tests/tools/get-task.test.ts tests/tools/tools-builder.test.ts tests/tools/index.test.ts tests/providers/youtrack/operations/agiles.test.ts tests/providers/youtrack/operations/activities.test.ts tests/providers/youtrack/operations/saved-queries.test.ts tests/providers/youtrack/operations/commands.test.ts tests/providers/youtrack/operations/tasks.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit only if verification required follow-up code changes**

If verification required no further edits, do not create an extra commit. If fixes were needed, commit them with a focused message.

## Plan Self-Review

Spec coverage check:

- Bulk requests return a normal tool failure result: covered in Task 1 Step 2 and Task 2 Step 1.
- Bulk requests do not call `provider.applyCommand`: covered in Task 1 Step 2.
- Bulk requests do not return `confirmation_required`: covered by the new tool-failure assertions and by removing the obsolete bulk-confirmation expectation.
- Single-issue behavior remains unchanged: covered by leaving the existing single-issue tests intact and verifying green in Task 2 Step 3.

Placeholder scan:

- No `TODO`, `TBD`, or vague “add handling” steps remain.
- All code-edit steps include exact snippets or exact removal targets.

Type consistency check:

- The planned failure result shape is `{ success: false, message }`, which matches the stated design goal of returning a normal tool failure result rather than `confirmation_required`.
- File paths, commit messages, and test commands all match the current repository layout.

## Notes For Implementers

- This plan supersedes the older bulk-confirmation plan in `docs/superpowers/plans/2026-04-15-youtrack-bulk-command-confirmation.md`.
- Do not reuse the abandoned bulk-confirmation branch logic.
- Do not change provider code or tool exposure for this task.
- Keep the change minimal: early bulk rejection only.
