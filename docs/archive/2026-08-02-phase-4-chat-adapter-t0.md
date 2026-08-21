<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4 Chat Adapter T0 Reachability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cataloged Tier 0 evidence for transport-free chat-adapter behavior and the audio-transcribe transformer against a strict fake transcription host.

**Architecture:** A new pure-helper story file imports real chat helpers directly, matching the existing T0 pure-helper pattern without booting an adapter transport. A separate plugin story starts the real runtime, activates the real audio-transcribe plugin, and runs `buildUserTurnMessages()` over a stored voice attachment; the existing scenario HTTP dispatcher is the sole OpenAI-compatible host boundary.

**Tech Stack:** Bun test runner, TypeScript, existing hermetic scenario runner, strict HTTP dispatcher, plugin registry, SQLite test fixture.

## Global Constraints

- Keep `SCN-interaction-discord-router-wrapped`, `SCN-interaction-discord-standalone-fallback`, and `SCN-interaction-telegram-callback` as `needs-seam@3`.
- Do not add Discord, grammY, webhook, poller, or SDK-client fakes.
- Do not change `.github/workflows/nightly.yml` or Tier 3's nightly-only policy.
- Do not extend 0Q beyond Tier 0.
- Add Tier 0 behavior stories; do not require an aggregate coverage-floor increase or lower the floor.
- All story inputs, IDs, token counts, callback data, host responses, and assertions are deterministic.

---

## File Structure

- Create `tests/stories/chat/adapter-pure-surfaces.story.test.ts` — Tier 0 stories for Mattermost normalization, Telegram context output, Discord interaction construction, and capability checks.
- Create `tests/stories/integrations/plugins/audio-transcribe.story.test.ts` — real audio plugin activation and one strict-host transformer request.
- Modify `tests/stories/catalog/coverage.ts` — add five Phase 4 IDs, map them to the T0 stories, and retain the three T3 pends unchanged.
- Modify `tests/stories/harness/catalog-coverage.test.ts` — assert the Phase 4 IDs and exact mappings; update the ledger total.
- Modify `tests/stories/harness/catalog-census.test.ts` only if its exact expected T0 count changes.
- Modify `tests/scripts/story-coverage-totals.test.ts` — update exact totals and formatted ledger output.
- Modify `docs/architecture/commands.md` — document the Tier 3/manual-review transport boundary under `Hermetic story qualification`.

### Task 1: Add Transport-Free Chat Stories

**Files:**
- Create: `tests/stories/chat/adapter-pure-surfaces.story.test.ts`

**Interfaces:**
- Consumes: `normalizeMattermostMessageText(message, botUsername)`, `determineMattermostThreadId(post, isMentioned, contextType, replyToMessageId)`, `renderTelegramContext(snapshot)`, `buildDiscordInteraction(ctx, isAdmin, platformInstanceId)`, `supportsFileReplies(chat)`, and `supportsCommandMenu(chat)`.
- Produces: four literal `SCN-*` markers discoverable by the T0 story census.

- [ ] **Step 1: Write the failing T0 story file**

```typescript
import { expect } from 'bun:test'

import { supportsCommandMenu, supportsFileReplies } from '../../../src/chat/capabilities.js'
import { buildDiscordInteraction } from '../../../src/chat/discord/interaction-helpers.js'
import {
  determineMattermostThreadId,
  normalizeMattermostMessageText,
} from '../../../src/chat/mattermost/message-normalization.js'
import { renderTelegramContext } from '../../../src/chat/telegram/context-renderer.js'
import { scenario } from '../harness/scenario.js'

scenario('SCN-chat-message-normalization: standalone mentions preserve command and thread boundaries', () => {
  expect(normalizeMattermostMessageText('@papai /help today', 'papai')).toEqual({
    text: '/help today', isMentioned: true, commandInput: '/help today',
  })
  expect(normalizeMattermostMessageText('email@papai.example', 'papai')).toMatchObject({ isMentioned: false })
  expect(determineMattermostThreadId({ id: 'post-1' }, true, 'group', undefined)).toBe('post-1')
  expect(determineMattermostThreadId({ id: 'post-2', root_id: 'root-1' }, false, 'group', 'reply-1')).toBe('root-1')
})

scenario('SCN-chat-context-rendering: Telegram context output distinguishes bounded and unbounded budgets', () => {
  const snapshot = { modelName: 'test-model', totalTokens: 1250, maxTokens: 2000, approximate: false, sections: [] }
  expect(renderTelegramContext(snapshot)).toMatchObject({ method: 'text', content: expect.stringContaining('62.5%') })
  expect(renderTelegramContext({ ...snapshot, maxTokens: null })).toMatchObject({
    method: 'text', content: expect.not.stringMatching(/%/u),
  })
})

scenario('SCN-chat-interaction-payload: Discord payloads scope DM and group callbacks without transport', () => {
  const base = { user: { id: 'user-1', username: '' }, customId: 'perm:a:prompt-1', channelId: 'channel-1', message: { id: 'message-1' } }
  expect(buildDiscordInteraction({ ...base, channel: { type: 1 } }, false, 'discord-a')).toMatchObject({
    contextId: 'user-1', contextType: 'dm', storageContextId: 'user-1', platformInstanceId: 'discord-a', user: { username: null },
  })
  expect(buildDiscordInteraction({ ...base, channel: { type: 0 } }, true, 'discord-a')).toMatchObject({
    contextId: 'channel-1', contextType: 'group', storageContextId: 'channel-1', user: { isAdmin: true },
  })
  expect(buildDiscordInteraction({ ...base, customId: '', channel: null }, false, 'discord-a')).toBeNull()
})

scenario('SCN-chat-capability-gating: reply features follow declared capability metadata', () => {
  expect(supportsFileReplies({ capabilities: new Set(['messages.files']) })).toBe(true)
  expect(supportsFileReplies({ capabilities: new Set(['messages.buttons']) })).toBe(false)
  expect(supportsCommandMenu({ capabilities: new Set(['commands.menu']) })).toBe(true)
  expect(supportsCommandMenu({ capabilities: new Set(['messages.buttons']) })).toBe(false)
})
```

- [ ] **Step 2: Run the file to verify the new stories are green before catalog registration**

Run: `bun test --path-ignore-patterns '' tests/stories/chat/adapter-pure-surfaces.story.test.ts`

Expected: PASS with four passing `SCN-chat-*` stories.

- [ ] **Step 3: Format and check the new file**

Run: `bun run format:check && bun run lint && bun typecheck`

Expected: all commands exit 0.

- [ ] **Step 4: Commit the standalone story slice**

```bash
git add tests/stories/chat/adapter-pure-surfaces.story.test.ts
git commit -m "test(stories): cover pure chat adapter surfaces"
```

### Task 2: Add The Real Audio-Transcribe Fake-Host Story

**Files:**
- Create: `tests/stories/integrations/plugins/audio-transcribe.story.test.ts`

**Interfaces:**
- Consumes: `discoverPlugins('plugins')`, `setPluginAdminConfig`, `setPluginEnabledForContext`, `saveAttachment`, `buildUserTurnMessages`, and `ScenarioWorld.http.serveHost()`.
- Produces: `SCN-plugin-audio-transcribe-transformer`, a T0 story proving real plugin activation, request construction, and inline transformer output.

- [ ] **Step 1: Write the failing plugin story**

```typescript
import { expect } from 'bun:test'

import { saveAttachment } from '../../../../src/attachments/store.js'
import { toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { buildUserTurnMessages } from '../../../../src/llm-orchestrator-attachments.js'
import { discoverPlugins } from '../../../../src/plugins/discovery.js'
import { setPluginEnabledForContext } from '../../../../src/plugins/registry.js'
import { setPluginAdminConfig } from '../../../../src/plugins/store.js'
import { scenario } from '../../harness/scenario.js'

const AUDIO_PLUGIN_ID = 'audio-transcribe'
const TRANSCRIPTION_HOST = 'transcribe.invalid'

scenario('SCN-plugin-audio-transcribe-transformer: a voice attachment is transcribed through the declared host', async ({ given, world }) => {
  const plugin = discoverPlugins('plugins').plugins.find(({ manifest }) => manifest.id === AUDIO_PLUGIN_ID)
  if (plugin === undefined) throw new Error('Expected audio-transcribe plugin to be discoverable')

  const user = given.user('voice-user')
  const context = given.dm(user)
  const contextId = toScopedContextId({ platformInstanceId: context.platformInstanceId, nativeContextId: context.id })
  given.plugin(plugin)
  setPluginEnabledForContext(AUDIO_PLUGIN_ID, contextId, true)
  setPluginAdminConfig(AUDIO_PLUGIN_ID, 'api_key', 'test-key', 'scenario-admin')
  setPluginAdminConfig(AUDIO_PLUGIN_ID, 'base_url', `https://${TRANSCRIPTION_HOST}`, 'scenario-admin')
  world.http.serveHost(TRANSCRIPTION_HOST, async (request) => {
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/v1/audio/transcriptions')
    const form = await request.formData()
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('file')).toBeInstanceOf(File)
    return Response.json({ text: 'release notes', language: 'en', duration: 1.5 })
  })
  await world.start()
  const attachment = await saveAttachment({
    contextId: world.scopedStorageContextId(context), sourceProvider: 'unknown', sourceMessageId: 'voice-message',
    sourceFileId: 'voice-file', filename: 'voice.ogg', mimeType: 'audio/ogg', content: Buffer.from('voice-bytes'),
    status: 'available', origin: 'voice',
  })
  const messages = await buildUserTurnMessages(
    world.scopedStorageContextId(context), user.id, 'scenario-main-model', 'summarize this', [attachment.attachmentId],
  )
  expect(messages.modelMessage.content).toContain('release notes')
})
```

Keep the host responder local to this one story; scenario teardown verifies that it received at least one request.

- [ ] **Step 2: Run the story and confirm the expected initial failure**

Run: `bun test --path-ignore-patterns '' tests/stories/integrations/plugins/audio-transcribe.story.test.ts`

Expected: FAIL until the implementation establishes the correct scoped plugin config and the assertion narrows `ModelMessage.content` safely.

- [ ] **Step 3: Make the smallest corrections required by the real interfaces**

Use `world.scopedStorageContextId(context)` as the `buildUserTurnMessages()` context argument. Use `contextId` only for `setPluginEnabledForContext`, because plugin eligibility is keyed by config context. Narrow `messages.modelMessage.content` with `typeof content === 'string'` before asserting its transcript line; the scenario model is text-only. Do not add a harness API or a mock transport.

```typescript
const content = messages.modelMessage.content
expect(typeof content).toBe('string')
if (typeof content !== 'string') throw new Error('Expected text-only scenario model content')
expect(content).toContain('[Voice attachment')
expect(content).toContain('release notes')
```

- [ ] **Step 4: Run the story and the existing audio unit suite**

Run: `bun test --path-ignore-patterns '' tests/stories/integrations/plugins/audio-transcribe.story.test.ts tests/plugins/audio-transcribe.test.ts`

Expected: PASS; the story consumes the fake-host POST and the unit suite remains green.

- [ ] **Step 5: Commit the integration story**

```bash
git add tests/stories/integrations/plugins/audio-transcribe.story.test.ts
git commit -m "test(stories): cover audio transcription host"
```

### Task 3: Register Phase 4 T0 Evidence In The Ledger

**Files:**
- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/harness/catalog-coverage.test.ts`
- Modify: `tests/scripts/story-coverage-totals.test.ts`

**Interfaces:**
- Consumes: five literal scenario titles from Tasks 1 and 2.
- Produces: five new `CatalogScenarioId` values with tier `0`, exact T0 story paths, updated totals of 223 total / 198 executable / 25 pending / T0 152.

- [ ] **Step 1: Write the failing catalog assertions**

In `tests/stories/harness/catalog-coverage.test.ts`, add a dedicated assertion:

```typescript
test('maps Phase 4 transport-free chat and audio stories to Tier 0', () => {
  expect(Object.fromEntries(
    ['SCN-chat-message-normalization', 'SCN-chat-context-rendering', 'SCN-chat-interaction-payload', 'SCN-chat-capability-gating', 'SCN-plugin-audio-transcribe-transformer']
      .map((scenarioId) => [scenarioId, catalogCoverage.find((entry) => entry.scenarioId === scenarioId)]),
  )).toMatchObject({
    'SCN-chat-message-normalization': { kind: 'executable', provingTier: '0' },
    'SCN-chat-context-rendering': { kind: 'executable', provingTier: '0' },
    'SCN-chat-interaction-payload': { kind: 'executable', provingTier: '0' },
    'SCN-chat-capability-gating': { kind: 'executable', provingTier: '0' },
    'SCN-plugin-audio-transcribe-transformer': { kind: 'executable', provingTier: '0' },
  })
})
```

Update existing exact totals in the same test from `218` to `223`, and in `tests/scripts/story-coverage-totals.test.ts` from `193` to `198` executable and from `T0 147` to `T0 152`.

- [ ] **Step 2: Run the contract tests to verify they fail**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts`

Expected: FAIL because the five IDs are absent from `CATALOG_SCENARIO_IDS` and totals remain Phase 3 values.

- [ ] **Step 3: Add the five catalog entries and exact mappings**

Append these IDs to `CATALOG_SCENARIO_IDS`:

```typescript
'SCN-chat-message-normalization',
'SCN-chat-context-rendering',
'SCN-chat-interaction-payload',
'SCN-chat-capability-gating',
'SCN-plugin-audio-transcribe-transformer',
```

Add `EXECUTABLE_STORY_MAPPINGS` entries with `verifiedAt: '2026-08-02'`, `provingTier: '0'`, and the exact paths/titles from Tasks 1 and 2. Do not add these IDs to `FORWARD_ONLY_SCENARIO_IDS`, `PHASE3_UNCATALOGUED_CLUSTER_IDS`, or `AUDIT_RECORDS`. Leave the three existing `needs(..., '3', ...)` records byte-for-byte unchanged.

- [ ] **Step 4: Update ledger snapshots and run T0 contracts**

Run: `bun run test:stories:contracts`

Expected: PASS. The startup coverage line reads `198/223 executable (T0 152, T1 29, T2 8, T3 8, T4 1)` and still reports `3 needs-seam` unblocked by T3.

- [ ] **Step 5: Commit the catalog change**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): catalog Phase 4 chat coverage"
```

### Task 4: Document The T3 Qualification Boundary And Verify The Phase

**Files:**
- Modify: `docs/architecture/commands.md`

**Interfaces:**
- Consumes: the unchanged three Tier 3 pending IDs and the existing `Hermetic story qualification` policy.
- Produces: an explicit refactor checklist rule that 0Q cannot qualify adapter transport.

- [ ] **Step 1: Add the documentation sentence under `## Hermetic story qualification`**

Add this paragraph after the frozen-tree qualification rules:

```markdown
Chat-adapter transport is outside 0Q: `SCN-interaction-discord-router-wrapped`,
`SCN-interaction-discord-standalone-fallback`, and
`SCN-interaction-telegram-callback` remain `needs-seam@3`. Their Discord/grammY
callback wires are reviewed manually or by the nightly Tier 3 platform-adapter
lane; they are never a refactor-qualification gate.
```

- [ ] **Step 2: Verify the targeted source and documentation behavior**

Run: `bun run test:stories:contracts && bun run test:stories`

Expected: PASS. The T0 runner discovers the five new records and the three callback records remain pending at T3.

- [ ] **Step 3: Measure coverage without promising an uplift**

Run: `bun run test:stories:coverage`

Expected: PASS if the existing floor holds. If the printed measurement exceeds `scripts/story/coverage-floor.json`, run `bun run coverage:ratchet:stories`, inspect the generated floor diff, and commit the strictly higher floor. If it does not exceed the floor, leave the floor unchanged.

- [ ] **Step 4: Run final static verification**

Run: `bun run format:check && bun run lint && bun typecheck`

Expected: all commands exit 0.

- [ ] **Step 5: Commit documentation and any monotonic floor increase**

```bash
git add docs/architecture/commands.md scripts/story/coverage-floor.json
git commit -m "docs(stories): document adapter transport boundary"
```

Do not stage `scripts/story/coverage-floor.json` when its contents did not increase.
