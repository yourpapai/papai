<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Bun Check Full Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get `bun check:full` back to green by removing the local formatting blocker, updating the stale YouTrack proxy test, and teaching Knip about the behavior-audit entrypoints and intentional dynamic test helpers.

**Architecture:** Keep the new proxy-tool design intact and fix the check suite around it instead of restoring the old direct tool surface. Treat the `papai_tool` API as the source of truth, then make Knip understand the root workspace’s script/test graph so it stops reporting live behavior-audit files as dead code.

**Tech Stack:** Bun, TypeScript, Bun test, AI SDK tool wrappers, Knip, oxfmt

---

## File map

- `docs/superpowers/plans/2026-04-30-telegram-group-label-resolution.md`
  - Local plan doc currently failing `oxfmt --check`.
- `tests/providers/youtrack/tools-integration.test.ts`
  - Stale integration test that still expects direct tool exposure instead of proxy-only exposure.
- `tests/tools/index.test.ts`
  - Existing proxy-tool reference pattern to follow.
- `src/tools/index.ts`
  - Confirms the intended runtime shape is `{ papai_tool: ... }`.
- `src/tools/tool-proxy-modes.ts`
  - Confirms `describe` returns `${toolName}: ${description}` text, which the replacement test can assert against.
- `knip.json`
  - New root Knip configuration to add explicit root entry/project coverage and suppress known dynamic test-helper false positives.

---

### Task 1: Remove the local formatting blocker

**Files:**

- Modify: `docs/superpowers/plans/2026-04-30-telegram-group-label-resolution.md`

- [ ] **Step 1: Reproduce the format failure in isolation**

Run:

```bash
bun format:check
```

Expected: FAIL with output that names `docs/superpowers/plans/2026-04-30-telegram-group-label-resolution.md` as the only formatting problem.

- [ ] **Step 2: Format the offending Markdown file**

Run:

```bash
bunx oxfmt --write --ignore-path=.oxfmtignore docs/superpowers/plans/2026-04-30-telegram-group-label-resolution.md
```

Expected: the file is rewritten in place with no other repo files changed by this step.

- [ ] **Step 3: Re-run the formatter check**

Run:

```bash
bun format:check
```

Expected: PASS.

- [ ] **Step 4: Commit the formatting-only change**

```bash
git add docs/superpowers/plans/2026-04-30-telegram-group-label-resolution.md
git commit -m "chore: format telegram group label plan"
```

---

### Task 2: Rewrite the stale YouTrack tool integration test around `papai_tool`

**Files:**

- Modify: `tests/providers/youtrack/tools-integration.test.ts`
- Reference: `tests/tools/index.test.ts`
- Reference: `src/tools/index.ts`
- Reference: `src/tools/tool-proxy-modes.ts`
- Test: `tests/providers/youtrack/tools-integration.test.ts`
- Test: `tests/tools/index.test.ts`

- [ ] **Step 1: Reproduce the current failing test**

Run:

```bash
bun test tests/providers/youtrack/tools-integration.test.ts
```

Expected: FAIL at `expect(toolNames).toContain('create_task')` with `Received: [ "papai_tool" ]`.

- [ ] **Step 2: Replace the stale direct-tool assertion with a proxy-aware integration test**

Replace `tests/providers/youtrack/tools-integration.test.ts` with:

```ts
import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ToolExecutionOptions } from 'ai'

import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import { YouTrackProvider } from '../../../src/providers/youtrack/index.js'
import { makeTools } from '../../../src/tools/index.js'
import { getToolExecutor } from '../../utils/test-helpers.js'

const createConfig = (): YouTrackConfig => ({
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
})

function toolOptions(toolCallId: string): ToolExecutionOptions {
  return { toolCallId, messages: [] }
}

function firstText(result: unknown): string {
  assert.ok(typeof result === 'object' && result !== null && 'content' in result, 'Expected proxy text result')
  const content = (result as { readonly content?: unknown }).content
  assert.ok(Array.isArray(content) && content.length > 0, 'Expected proxy text content')
  const first = content[0]
  assert.ok(
    typeof first === 'object' && first !== null && 'text' in first && typeof first.text === 'string',
    'Expected proxy text content item',
  )
  return first.text
}

async function expectToolAvailable(tools: ReturnType<typeof makeTools>, toolName: string): Promise<void> {
  const proxy = tools['papai_tool']
  assert.ok(proxy !== undefined, 'Expected papai_tool to be available')

  const result = await getToolExecutor(proxy)({ describe: toolName }, toolOptions(`describe-${toolName}`))

  expect(firstText(result)).toContain(`${toolName}:`)
}

describe('YouTrack provider tools integration', () => {
  test('makeTools exposes papai_tool and preserves the expected internal YouTrack tool surface', async () => {
    const provider = new YouTrackProvider(createConfig())
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })

    expect(Object.keys(tools)).toEqual(['papai_tool'])

    await Promise.all(
      [
        'create_task',
        'get_task',
        'update_task',
        'list_tasks',
        'search_tasks',
        'find_user',
        'get_current_user',
        'count_tasks',
        'get_project',
        'list_projects',
        'create_project',
        'update_project',
        'delete_project',
        'list_project_team',
        'add_project_member',
        'remove_project_member',
        'add_comment',
        'get_comments',
        'update_comment',
        'remove_comment',
        'add_comment_reaction',
        'remove_comment_reaction',
        'list_labels',
        'create_label',
        'update_label',
        'remove_label',
        'add_task_label',
        'remove_task_label',
        'add_task_relation',
        'update_task_relation',
        'remove_task_relation',
        'list_watchers',
        'add_watcher',
        'remove_watcher',
        'add_vote',
        'remove_vote',
        'set_visibility',
        'list_statuses',
        'create_status',
        'update_status',
        'delete_status',
        'reorder_statuses',
        'list_agiles',
        'list_sprints',
        'create_sprint',
        'update_sprint',
        'assign_task_to_sprint',
        'get_task_history',
        'list_saved_queries',
        'run_saved_query',
        'apply_youtrack_command',
      ].map((toolName) => expectToolAvailable(tools, toolName)),
    )
  })
})
```

- [ ] **Step 3: Run the updated test plus the existing proxy regression test**

Run:

```bash
bun test tests/providers/youtrack/tools-integration.test.ts
bun test tests/tools/index.test.ts
```

Expected: PASS for both files.

- [ ] **Step 4: Commit the proxy-test update**

```bash
git add tests/providers/youtrack/tools-integration.test.ts
git commit -m "test: update youtrack tools integration for proxy tool"
```

---

### Task 3: Add root Knip configuration for behavior-audit entrypoints and dynamic test helpers

**Files:**

- Create: `knip.json`
- Reference: `package.json`
- Reference: `scripts/behavior-audit/index.ts`
- Reference: `scripts/behavior-audit/profile-clustering.ts`
- Reference: `scripts/behavior-audit/tune-embedding.ts`
- Reference: `tests/scripts/behavior-audit-integration.helpers.ts`
- Reference: `tests/scripts/behavior-audit-integration.runtime-helpers.ts`
- Reference: `tests/scripts/behavior-audit-integration.support.ts`
- Reference: `tests/scripts/behavior-audit/test-fixtures.ts`
- Test: `bun knip`

- [ ] **Step 1: Reproduce the current Knip failure**

Run:

```bash
bun knip
```

Expected: FAIL with unused-file reports for the behavior-audit scripts and unused-export reports concentrated in the same script/test-helper cluster.

- [ ] **Step 2: Create a root Knip config that marks the root behavior-audit CLIs as entrypoints and ignores the dynamic test-support modules**

Create `knip.json` with:

```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "workspaces": {
    ".": {
      "entry": [
        "src/index.ts",
        "scripts/behavior-audit/index.ts",
        "scripts/behavior-audit/profile-clustering.ts",
        "scripts/behavior-audit/tune-embedding.ts"
      ],
      "project": ["src/**/*.ts", "client/**/*.ts", "client/**/*.tsx", "scripts/**/*.ts", "tests/**/*.ts"],
      "ignore": [
        "tests/scripts/behavior-audit-integration.helpers.ts",
        "tests/scripts/behavior-audit-integration.runtime-helpers.ts",
        "tests/scripts/behavior-audit-integration.support.ts",
        "tests/scripts/behavior-audit/test-fixtures.ts"
      ]
    }
  }
}
```

This keeps the root runtime/test graph explicit without touching the already-separate `codeindex` and `review-loop` check flows.

- [ ] **Step 3: Re-run Knip until the root workspace is clean**

Run:

```bash
bun knip
```

Expected: PASS. If Knip still reports additional root-only behavior-audit entry files, add those exact files to `workspaces["."].entry` in `knip.json` and rerun before continuing.

- [ ] **Step 4: Commit the Knip configuration**

```bash
git add knip.json
git commit -m "chore: configure knip for behavior audit entrypoints"
```

---

### Task 4: Run the full verification suite

**Files:**

- Verify only

- [ ] **Step 1: Run the focused checks first**

Run:

```bash
bun format:check
bun test tests/providers/youtrack/tools-integration.test.ts
bun test tests/tools/index.test.ts
bun knip
```

Expected: PASS for all four commands.

- [ ] **Step 2: Run the full repository gate**

Run:

```bash
bun check:full
```

Expected: PASS with all checks green.

- [ ] **Step 3: Commit any final verification-driven adjustments**

If `bun check:full` required no additional code changes, no commit is needed here. If a tiny follow-up adjustment was required, commit it with:

```bash
git add -A
git commit -m "chore: make full check pass"
```

---

## Notes for the implementing agent

- Do **not** revert `src/tools/index.ts` back to direct tool exposure. The current contract is proxy-only and is already covered by `tests/tools/index.test.ts` and the single-proxy design docs.
- Prefer fixing Knip by teaching it the real root workspace graph before deleting or de-exporting behavior-audit code.
- Keep the formatting change isolated from the runtime/test changes so any regression is easy to bisect.
