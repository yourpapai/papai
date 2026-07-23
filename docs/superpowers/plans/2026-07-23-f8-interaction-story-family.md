<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# F8 Interaction Story Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the one Tier-0-reachable interaction scenario (`SCN-interaction-permission-decision`) to an executable hermetic story, keep the three wire-level scenarios forward-only with sharpened rationale, and append the roadmap's terminal F5–F8 amendment — closing the coverage-expansion program.

**Architecture:** F8 is a terminal, **zero-production-change** family (the F4 precedent). The permission-decision dispatch path is already production-complete and proven incidentally by `SCN-task-ask-confirm`; this plan adds a dedicated story whose subject is the **interaction router** (its distinctive proof is the ADR-0182 self-finalization observed on the raw reply log), then rides the ledger update in the same PR, then documents the program's completion.

**Tech Stack:** Bun test runner, the hermetic story harness (`tests/stories/`), TypeScript (strict, `.js` import extensions), the `when.interaction` seam, `given.toolPrefs`/`given.taskInstance` fixtures.

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-07-23-f8-interaction-story-family-design.md`). Every task's requirements implicitly include this section.

- **Zero production `src/` change.** F8 adds only test + doc changes.
- **No new `STORY_SEAM_IDS` id; no new `given.*`/`when.*` seam.** The story reuses existing harness surfaces.
- **Ledger target after F8:** `128 ids / 101 executable / 27 pending`; pending readiness split `0 executable-as-is / 5 needs-seam / 22 blocked`.
- **Rule 3 — no assertion-only stories.** Every checkpoint is observable behavior: a durable state change gated behind a routed callback, plus the prompt-finalization payload — never a bare call count.
- **Rule 5 — ledger rides with the story** in the same PR.
- **Rule 7 — frozen-tree discipline.** Adding a file under the frozen `tests/stories/**` tree re-baselines the compat manifest `treeHash`; this is intended and recorded. Do not touch runner/sandbox files.
- **Never add lint-disable or type-ignore comments.** A pre-commit hook blocks them and also runs `format:check`; run `bunx prettier --write <file>` on any `.md`/`.ts` file before committing.
- **Use `.js` extension in TypeScript import paths.**
- **`platform-adapter-fakes` is left deliberately unrealized.** Do not build grammY/discord.js fakes.

## File Structure

- **Create** `tests/stories/interactions/permission-decision.story.test.ts` — the one executable story. New `interactions/` group directory, sibling to `tests/stories/tasks/`. Self-contained: it carries its own local `waitForPermissionCallback` and finalization helpers (the harness does not export them, and importing another `*.story.test.ts` would execute its scenarios).
- **Modify** `tests/stories/catalog/coverage.ts` — remove the `ready('F8', …)` audit record for `SCN-interaction-permission-decision`; add its `EXECUTABLE_STORY_MAPPINGS` entry; sharpen the three parked forward-only rationale strings.
- **Modify** `tests/stories/harness/catalog-coverage.test.ts` — update the three totals (`100→101`, `28→27`, `1→0`) and strengthen the interaction test to assert the promotion.
- **Modify** `docs/superpowers/specs/2026-07-19-story-coverage-expansion-roadmap-design.md` — append the terminal F5–F8 amendment section.

The runner manifest totals line is derived automatically from `coverage.ts` by `scripts/story/coverage-totals.ts` (no manual number to edit there).

---

### Task 1: The executable interaction-routing story

Write the dedicated `SCN-interaction-permission-decision` story. It runs the full ask-gate callback roundtrip over the (proven, hermetic) task-create ask-gate, but its distinctive checkpoint — the one `SCN-task-ask-confirm` omits — is the ADR-0182 self-finalization: after the routed callback, the prompt emits an `ephemeral-confirm` toast (`Allowed create_task ✅` / `Denied create_task 🚫`). That event is not surfaced by `then.repliesTo` (which only exposes `text`/`formatted`/`replace-text`/`buttons` kinds, `scenario.ts:445-447`), so the story observes it directly on `world.chat.allReplies()`.

**Files:**

- Create: `tests/stories/interactions/permission-decision.story.test.ts`

**Interfaces:**

- Consumes (from the harness, existing): `scenario(title, async ({ given, when, then, world }) => …)` (`tests/stories/harness/scenario.ts`); `given.user`, `given.dm`, `given.taskInstance`, `given.assign`, `given.toolPrefs`, `given.llm`; `when.dispatchMessage`, `when.interaction`; `then.replyTo(user).equals(text)`, `then.task(title).exists()`, `then.task(title).absent()`; `world.chat.allReplies(): readonly ScenarioReply[]` where `ScenarioReply = { kind: string; content?: string; options?: unknown; … }` (`tests/stories/harness/chat.ts:27-36`); `callCapability`, `answer` (`tests/stories/harness/scripted-llm.ts`).
- Produces: the manifest scenario id `tests/stories/interactions/permission-decision.story.test.ts#SCN-interaction-permission-decision: routes an ask-gate callback and self-finalizes the prompt`, consumed by Task 2's `EXECUTABLE_STORY_MAPPINGS` entry.

- [ ] **Step 1: Write the story file**

Create `tests/stories/interactions/permission-decision.story.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import type { ScenarioReply } from '../harness/chat.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

type ReplyReader = Readonly<{
  chat: { allReplies(): readonly ScenarioReply[] }
}>

const permissionCallback = (world: ReplyReader, prefix: string, since: number): string | undefined =>
  world.chat
    .allReplies()
    .slice(since)
    .flatMap((reply) => {
      const options = reply.options
      if (typeof options !== 'object' || options === null || !('buttons' in options)) return []
      const { buttons } = options
      if (!Array.isArray(buttons)) return []
      const items: unknown[] = buttons
      return items.flatMap((button): string[] => {
        if (typeof button !== 'object' || button === null || !('callbackData' in button)) return []
        return typeof button.callbackData === 'string' ? [button.callbackData] : []
      })
    })
    .find((callbackData) => callbackData.startsWith(prefix))

const waitForPermissionCallback = async (world: ReplyReader, prefix: string): Promise<string | undefined> => {
  const since = world.chat.allReplies().length
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const callback = permissionCallback(world, prefix, since)
    if (callback !== undefined) return callback
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
  }
  return undefined
}

const finalizationConfirmations = (world: ReplyReader): string[] =>
  world.chat
    .allReplies()
    .filter((reply) => reply.kind === 'ephemeral-confirm')
    .flatMap((reply) => (typeof reply.content === 'string' ? [reply.content] : []))

scenario(
  'SCN-interaction-permission-decision: routes an ask-gate callback and self-finalizes the prompt',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance()
    given.assign(dm, instance)
    given.toolPrefs(dm, {
      riskDefaults: {},
      domainDefaults: {},
      toolOverrides: { create_task: 'ask' },
    })

    // Allow arm: the routed perm:a callback resumes the deferred tool and self-finalizes the prompt.
    given.llm([
      callCapability('tasks.create', {
        projectId: 'proj-1',
        title: 'Approved',
        _permission_reason: 'creates a task',
      }),
      answer('Created “Approved”.'),
    ])
    await when.dispatchMessage(alice, dm, 'Create task Approved')
    const allowCallback = await waitForPermissionCallback(world, 'perm:a:')
    expect(allowCallback).toBeDefined()
    await when.interaction(alice, dm, allowCallback ?? '')

    then.replyTo(alice).equals('Created “Approved”.')
    await then.task('Approved').exists()
    expect(finalizationConfirmations(world)).toContain('Allowed create_task ✅')

    // Deny arm: the routed perm:d callback refuses the tool and self-finalizes the prompt.
    given.llm([
      callCapability('tasks.create', {
        projectId: 'proj-1',
        title: 'Refused',
        _permission_reason: 'creates a task',
      }),
      answer('I could not create “Refused” without your permission.'),
    ])
    await when.dispatchMessage(alice, dm, 'Create task Refused')
    const denyCallback = await waitForPermissionCallback(world, 'perm:d:')
    expect(denyCallback).toBeDefined()
    await when.interaction(alice, dm, denyCallback ?? '')

    then.replyTo(alice).equals('I could not create “Refused” without your permission.')
    await then.task('Refused').absent()
    expect(finalizationConfirmations(world)).toContain('Denied create_task 🚫')
  },
)
```

- [ ] **Step 2: Run the story sandboxed and verify it passes**

Run: `bun test:stories`
Expected: PASS. The new scenario executes; the runner's totals line still reads `story catalog: 100/128 executable; pending 28 …` (the ledger flips in Task 2, not here). If the scenario fails on the `ephemeral-confirm` assertion, do **not** weaken the assertion — read the sanitized event trace: the finalization path (`src/chat/interaction-router.ts:29-36`) takes the ephemeral branch only when both `reply.ephemeralConfirm` and the prompt handle exist, which the scenario chat provider guarantees (`chat.ts:165-188`).

- [ ] **Step 3: Verify the assertion is live (guard against a vacuous pass)**

Temporarily change `'Allowed create_task ✅'` to `'Allowed create_task WRONG'` and re-run `bun test:stories`.
Expected: FAIL on that `toContain`. Revert the change immediately and re-run to confirm PASS. (This proves the finalization observable is actually asserted, not silently absent.)

- [ ] **Step 4: Commit**

```bash
bunx prettier --write tests/stories/interactions/permission-decision.story.test.ts
git add tests/stories/interactions/permission-decision.story.test.ts
git commit -m "test(stories): promote the F8 interaction permission-decision scenario"
```

---

### Task 2: Ledger update and sharpened rationale

Move `SCN-interaction-permission-decision` from pending to executable in the catalog, sharpen the three parked records' rationale, and update the contract-test totals. This is the rule-5 ledger step and must land in the same PR as Task 1.

**Files:**

- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:**

- Consumes: the manifest scenario id produced by Task 1.
- Produces: the finalized ledger (`101` executable / `27` pending) that the runner manifest and contract tests assert.

- [ ] **Step 1: Add the executable mapping in `coverage.ts`**

In `tests/stories/catalog/coverage.ts`, add an entry to `EXECUTABLE_STORY_MAPPINGS` (the `Partial<Record<…>>` object; placement is cosmetic — put it after the `SCN-context-group-identity` entry):

```typescript
  'SCN-interaction-permission-decision': {
    verifiedAt: '2026-07-23',
    storyIds: [
      'tests/stories/interactions/permission-decision.story.test.ts#SCN-interaction-permission-decision: routes an ask-gate callback and self-finalizes the prompt',
    ],
  },
```

- [ ] **Step 2: Remove the now-obsolete audit record in `coverage.ts`**

Delete the `ready('F8', …)` entry for `SCN-interaction-permission-decision` from `AUDIT_RECORDS` (currently at `coverage.ts:867-870`):

```typescript
  'SCN-interaction-permission-decision': ready(
    'F8',
    'Permission roundtrips already run via when.interaction in the ACP control stories; promoted from forward-only to confirmed.',
  ),
```

(An executable scenario must not also carry an audit record — the contract test `audit records cover exactly the pending scenarios` asserts `Object.keys(AUDIT_RECORDS)` equals the pending id set.)

- [ ] **Step 3: Sharpen the three parked rationale strings in `coverage.ts`**

Replace the three `needs('F8', …)` rationale strings (`coverage.ts:852-865`) so each names the dispatch-layer boundary rather than only the missing fake:

```typescript
  // F8 — platform interactions
  'SCN-interaction-discord-router-wrapped': needs(
    'F8',
    ['platform-adapter-fakes'],
    'The harness enters at runtime.dispatchInteraction, below the platform adapter; this scenario verifies the discord.js wire above it (a raw callback decoded and routed into dispatch), which is Tier-3 platform-integrated territory, out of the roadmap scope. Needs a fake Discord client, not built speculatively.',
  ),
  'SCN-interaction-discord-standalone-fallback': needs(
    'F8',
    ['platform-adapter-fakes'],
    'The harness enters at runtime.dispatchInteraction, below the platform adapter; this scenario verifies the discord.js standalone fallback wire above it, which is Tier-3 platform-integrated territory, out of the roadmap scope. Needs a fake Discord client, not built speculatively.',
  ),
  'SCN-interaction-telegram-callback': needs(
    'F8',
    ['platform-adapter-fakes'],
    'The harness enters at runtime.dispatchInteraction, below the platform adapter; this scenario verifies the grammY callback wire above it, which is Tier-3 platform-integrated territory, out of the roadmap scope. Needs a fake Telegram API, not built speculatively.',
  ),
```

- [ ] **Step 4: Update the totals in `catalog-coverage.test.ts`**

Make three edits in `tests/stories/harness/catalog-coverage.test.ts`:

`tests/stories/harness/catalog-coverage.test.ts:201`

```typescript
expect(catalogCoverage.filter((coverage) => coverage.kind === 'executable')).toHaveLength(101)
```

`tests/stories/harness/catalog-coverage.test.ts:237`

```typescript
expect(pendingIds).toHaveLength(27)
```

`tests/stories/harness/catalog-coverage.test.ts:266`

```typescript
expect(states.filter((state) => state === 'executable-as-is')).toHaveLength(0)
```

Leave lines 267 (`needs-seam` → `5`) and 268 (`blocked` → `22`) unchanged.

- [ ] **Step 5: Strengthen the interaction test to assert the promotion**

Replace the body of the `'marks only platform-adapter interaction scenarios as forward-only'` test (`catalog-coverage.test.ts:114-124`) so it documents that the fourth scenario is now executable:

```typescript
test('marks only platform-adapter interaction scenarios as forward-only', () => {
  const interactionCoverage = catalogCoverage.filter(({ scenarioId }) => scenarioId.startsWith('SCN-interaction-'))

  expect(interactionCoverage).toHaveLength(4)
  expect(interactionCoverage.map(({ catalogStatus }) => catalogStatus)).toEqual([
    'forward-only',
    'forward-only',
    'forward-only',
    'confirmed',
  ])
  expect(interactionCoverage.find(({ scenarioId }) => scenarioId === 'SCN-interaction-permission-decision')?.kind).toBe(
    'executable',
  )
})
```

- [ ] **Step 6: Run the contract suite and verify the new totals**

Run: `bun test:stories:contracts`
Expected: PASS (all catalog-coverage totals green at 101/27, executable-as-is 0).

- [ ] **Step 7: Run the full story suite and confirm the totals line**

Run: `bun test:stories`
Expected: PASS. The runner prints `story catalog: 101/128 executable; pending 27 (0 executable-as-is, 5 needs-seam, 22 blocked)`.

- [ ] **Step 8: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): reconcile the F8 ledger to 101 executable"
```

---

### Task 3: Roadmap terminal amendment

Append the append-only F5–F8 amendment to the roadmap doc, bringing the program ledger current at the terminal family and marking the program complete.

**Files:**

- Modify: `docs/superpowers/specs/2026-07-19-story-coverage-expansion-roadmap-design.md`

- [ ] **Step 1: Append the amendment section**

Add the following at the end of `docs/superpowers/specs/2026-07-19-story-coverage-expansion-roadmap-design.md` (after the existing `### Ledger trajectory` block):

```markdown
## Reclassifications and amendments (F5–F8)

Append-only continuation of the F1–F4 section, recording the tail families. F8 is the terminal
family and reconciles the program ledger to its final number.

### F5 — `deferred-*`/`reminder-*` (landed)

- **8 executable** — the estimate met exactly. Realized the single-pass
  `tick`/`pollScheduledOnce`/`pollAlertsOnce` drivers over seeded due rows; no production clock
  seam (virtual-time injection stays deferred to tiering phase 5). Ledger 87 → 95.

### F6 — `web-fetch` (landed)

- **2 executable** — the estimate met exactly. Realized the `assertPublicUrl` DI seam (the one
  small production change in the tail families) with DB-backed quota seeding. Ledger 95 → 97;
  `public-url-assertion` exhausted.

### F7 — `settings-admin-mcp-*` + reclassified-in `http-mcp-plugin` (landed)

- **3 executable** against a 2 estimate — `http-mcp-plugin` was reclassified in from F4. Covered
  both MCP directions (papai-as-client user endpoint, papai-as-server route + operator gate); one
  additive production change (user-MCP capability registration). Ledger 97 → 100;
  `fake-mcp-server` realized and exhausted.

### F8 — `interaction-*` (landed, terminal)

- **1 executable + 3 forward-only** against a 4 estimate. `SCN-interaction-permission-decision`
  promoted via `when.interaction` (its distinctive proof is the ADR-0182 self-finalization on the
  raw reply log, which `SCN-task-ask-confirm` never asserts); zero production change. The three
  wire-level scenarios stay forward-only with rationale sharpened to name the dispatch-layer
  boundary: the harness enters at `runtime.dispatchInteraction`, below the platform adapter, so the
  discord.js/grammY wire above it is Tier-3 platform-integrated territory, out of scope.
  `platform-adapter-fakes` left deliberately unrealized. Ledger 100 → 101.

### Seam-inventory drift (F5–F8)

| Seam                        | Status after F5–F8                                                          |
| --------------------------- | --------------------------------------------------------------------------- |
| `assertPublicUrl`           | Realized in F6 (a real DNS lookup the I/O guard cannot intercept).          |
| `fake-mcp-server`           | Realized and exhausted by F7 across both MCP directions.                    |
| `platform-adapter-fakes`    | Deliberately unrealized — the program's single parked seam (4 F3+F8 pends). |
| `mattermost-action-fixture` | Deliberately unrealized — the distinct F4 sibling seam (1 pend).            |

### Ledger trajectory (final)

Audit baseline **32 / 96** → F1–F3 **81 / 47** → F4 **87 / 41** → F5 **95** → F6 **97** → F7 **100**
→ **F8 101 / 27**. The Deliverable-2 projection ("~75–95 executable if F1–F7 land") is met and
exceeded.

## Program complete

With F8 landed, the coverage-expansion program is complete. All 128 catalog ids carry either an
executable mapping (101) or a named, justified pend (27: 0 executable-as-is, 5 needs-seam,
22 blocked) — zero generic "awaiting branch audit" reasons remain. The two unrealized seams
(`platform-adapter-fakes`, `mattermost-action-fixture`) are parked by design, justified only if a
future refactor touches the chat adapters. The frozen-harness compatibility proof now covers every
seam `plugin-core-separation` can rewire that is reachable at Tier 0.
```

- [ ] **Step 2: Format and commit**

```bash
bunx prettier --write docs/superpowers/specs/2026-07-19-story-coverage-expansion-roadmap-design.md
git add docs/superpowers/specs/2026-07-19-story-coverage-expansion-roadmap-design.md
git commit -m "docs(f8): append the terminal F5-F8 roadmap amendment"
```

---

### Task 4: Final verification

Confirm the whole change is green and the frozen tree re-baselines only as intended.

- [ ] **Step 1: Contracts, story suite, and stress**

Run: `bun test:stories:contracts && bun test:stories`
Expected: both PASS; totals line reads `101/128 executable; pending 27 (0 executable-as-is, 5 needs-seam, 22 blocked)`.

Run: `bun test:stories:stress`
Expected: PASS with no flakes across the repeated/randomized runs (deterministic seed `41021`) — the callback poll and finalization observation are the determinism surface under scrutiny.

- [ ] **Step 2: Lint, typecheck, format**

Run: `bun run check` (or the repo's `lint`/`typecheck`/`format:check` scripts if `check` is unavailable)
Expected: PASS. No lint-disable/type-ignore comments were introduced.

- [ ] **Step 3: Confirm no production `src/` change**

Run: `git diff --name-only master... -- src/`
Expected: empty output (F8 touched only `tests/stories/**` and `docs/**`).

## Self-Review

**Spec coverage:**

- Promote `SCN-interaction-permission-decision` to executable → Task 1 (story) + Task 2 (mapping). ✓
- Distinctive proof = ADR-0182 finalization, observed on the raw reply log → Task 1 Step 1 (`finalizationConfirmations`, `toContain('Allowed create_task ✅')`/`'Denied create_task 🚫'`). ✓ (The spec's "plan-discovery step / named fallback" is resolved here: `then.repliesTo` does not surface the kind, so the story reads `world.chat.allReplies()` directly; the callback-binding fallback is unnecessary.)
- Keep three scenarios forward-only, rationale sharpened to name the dispatch-layer boundary → Task 2 Step 3. ✓
- Ledger 100→101, pending 28→27, readiness 0/5/22 → Task 2 Steps 1,2,4 + contract updates. ✓
- Roadmap terminal F5–F8 amendment (rows, seam-drift table, ledger trajectory, program-complete note) → Task 3. ✓
- Zero production change; no new seam → Global Constraints + Task 4 Step 3. ✓
- Frozen-tree re-baseline intended → Global Constraints; the new story file is the only frozen-tree byte change. ✓

**Placeholder scan:** No TBD/TODO; every code and command step shows exact content. ✓

**Type consistency:** `ReplyReader` is defined once and reused by all three helpers; `ScenarioReply` fields (`kind`, `content`, `options`) match `chat.ts:27-36`; the `EXECUTABLE_STORY_MAPPINGS` entry's `storyIds` string matches the scenario title in Task 1 Step 1 exactly (`SCN-interaction-permission-decision: routes an ask-gate callback and self-finalizes the prompt`); `create_task` is the snake_case wire key confirmed at `permission-gate.ts:127` / `formatDecisionConfirmation` (`permission-prompt.ts:124-126`). ✓
