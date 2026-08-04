<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tier 3 Chat Adapter Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Discord and Mattermost platform-adapter gaps in the nightly Tier 3 lane: Discord reply-to-bot mention equivalence, Discord live-status lifecycle, Mattermost thread-root reply propagation, and the Mattermost live-status mutation lifecycle.

**Architecture:** Keep adapter production paths real and replace only their external platform boundaries. Extend the existing injected Discord client fake with a parent-message `messages.fetch` surface and one-shot send-failure injection; extend the shared fake Mattermost server additively with `root_id` on delivered posts and an ordered capture of `PUT /api/v4/posts/:id/patch` and `DELETE /api/v4/posts/:id` mutations. Drive Discord scenarios in-process through the real provider and Mattermost scenarios in-container through the real adapter, registering each scenario one-to-one in the platform catalog and the Tier 3 records in `tests/stories/catalog/coverage.ts`.

**Tech Stack:** Bun 1.3.13, TypeScript, `bun:test`, existing `tests/platform` nightly lane, `tests/platform/harness/fake-discord-client.ts`, Docker-backed `tests/smoke/harness` container + fake Mattermost server.

## Global Constraints

- Preserve the proving tier `3` and seam name `platform-adapter-fakes` for the five new records; do not move them to Tier 0.
- Telegram is out of scope: do not touch `src/chat/telegram/`, `tests/platform/harness/fake-telegram-bot.ts`, or the Telegram scenario files. Kontur Talk is likewise untouched.
- Preserve Tier 0 frozen compatibility: do not modify `tests/stories/harness/`, `scripts/story/`, `bunfig.toml`, `tests/setup.ts`, `tests/mock-reset.ts`, or `tests/utils/test-helpers.ts`. The only permitted `tests/stories/**` change is additive catalog records in `tests/stories/catalog/coverage.ts`.
- The fake Mattermost server is shared with the Tier 2 lane: all changes to `tests/smoke/harness/fake-mattermost-server.ts` must be additive (new optional fields, new routes, new accessors); `bun test:smoke` must stay green without edits to Tier 2 scenarios.
- All scenario IDs, payloads, platform IDs, channel/post/message IDs, and fake outcomes are fixed constants. Never use live credentials, a live network endpoint, random data, fixed-wall-clock waits, or test ordering beyond the existing per-file container pattern.
- Run real adapter start/dispatch/reply paths; do not call the isolated helpers as the proof.
- Scenario files stay under `tests/platform/scenarios/` with the non-discovered `.platform.ts` suffix and run only through `bun test:platform` / nightly.
- Fake boundary extensions must expose only APIs the production adapter consumes, and cleanup must still fail on pending listeners, requests, or client resources.
- Use `.js` extensions in TypeScript imports and strict TypeScript without lint/type suppressions.

---

## File Structure

| File | Responsibility |
| --- | --- |
| Modify: `tests/platform/harness/fake-discord-client.ts` | Add `messages.fetch` parent-message serving via `seedChannelMessage` and one-shot `failNextChannelSend` injection. |
| Modify: `tests/platform/harness/fake-discord-client.test.ts` | Contract tests for the two new fake behaviors. |
| Create: `tests/platform/scenarios/discord-reply-mention.platform.ts` | Reply-to-bot mention equivalence record through the real provider dispatch. |
| Create: `tests/platform/scenarios/discord-live-status.platform.ts` | Live-status create/update/dismiss ordering and unavailable-status fallback records. |
| Modify: `tests/smoke/harness/fake-mattermost-server.ts` | Add `IncomingPost.rootId` to the WS frame, capture patch/delete mutations, expose `postMutations()`/`outboundEvents()`. |
| Modify: `tests/smoke/harness/fake-mattermost-server.test.ts` | Contract tests for the root_id frame and mutation capture. |
| Create: `tests/platform/scenarios/mattermost-thread-reply.platform.ts` | In-container thread-root propagation record. |
| Create: `tests/platform/scenarios/mattermost-status-lifecycle.platform.ts` | In-container status patch/delete lifecycle record. |
| Modify: `tests/platform/scenarios/catalog.ts` | Register five new `PLATFORM_STORIES` entries and extend `PLATFORM_COVERAGE_FILES` with the three newly covered Discord sources. |
| Modify: `tests/platform/run-platform.ts` | Import the four new scenario modules. |
| Modify: `tests/platform/catalog-crosscheck.test.ts` | Raise the Tier 3 cardinality from 11 to 16 and extend the named scenario-id list and the `PLATFORM_COVERAGE_FILES` assertion. |
| Modify: `tests/stories/catalog/coverage.ts` | Add five `SCN-*` ids to `CATALOG_SCENARIO_IDS`, five executable records with `provingTier: '3'`, and extend `CATALOG_SOURCE`. |

### Task 1: Extend the Discord fake with parent messages and one-shot send failure

**Files:**
- Modify: `tests/platform/harness/fake-discord-client.ts`
- Modify: `tests/platform/harness/fake-discord-client.test.ts`

**Interfaces:**
- Consumes: the existing `FakeDiscordClient`, `FakeDiscordClientOptions`, and `FakeChannel`.
- Produces: `FakeDiscordClient.seedChannelMessage(message: { id: string; authorId: string; content?: string }): void`; `FakeChannel.messages.fetch(id)` resolving `{ id, author: { id, username }, content }` and rejecting unknown ids; `FakeDiscordClientOptions.failNextChannelSend?: boolean` rejecting exactly the next `channel.send` with `'configured channel send rejection'`.

- [ ] **Step 1: Write the failing fake contract tests**

Append to `tests/platform/harness/fake-discord-client.test.ts`:

```ts
  test('serves seeded parent messages and rejects unknown fetches', async () => {
    const fake = createFakeDiscordClient({ botId: 'bot-1', username: 'papai' })
    fake.seedChannelMessage({ id: 'parent-1', authorId: 'bot-1' })
    await expect(fake.channel.messages.fetch('parent-1')).resolves.toEqual({
      id: 'parent-1',
      author: { id: 'bot-1', username: 'seeded-author' },
      content: '',
    })
    await expect(fake.channel.messages.fetch('missing')).rejects.toThrow('unknown message missing')
    await fake.client.destroy()
    fake.assertClean()
  })

  test('rejects only the next channel send when failNextChannelSend is set', async () => {
    const fake = createFakeDiscordClient({ botId: 'bot-1', username: 'papai', failNextChannelSend: true })
    await expect(fake.channel.send({ content: 'first' })).rejects.toThrow('configured channel send rejection')
    await fake.channel.send({ content: 'second' })
    expect(fake.sentContents()).toEqual(['second'])
    await fake.client.destroy()
    fake.assertClean()
  })
```

- [ ] **Step 2: Run the contract tests to verify they fail**

Run: `bun test tests/platform/harness/fake-discord-client.test.ts`

Expected: FAIL because `seedChannelMessage`, `messages`, and `failNextChannelSend` do not exist.

- [ ] **Step 3: Implement the fake extensions**

In `tests/platform/harness/fake-discord-client.ts`:

Extend the options and client types:

```ts
export type FakeDiscordClientOptions = {
  botId: string
  username: string
  rejectInteractionResponse?: InteractionResponse
  failNextChannelSend?: boolean
}
```

Add to the `FakeDiscordClient` type:

```ts
  seedChannelMessage(message: { id: string; authorId: string; content?: string }): void
```

Change the `FakeChannel` type so `messages` is required:

```ts
type SeededParentMessage = { id: string; author: { id: string; username: string }; content: string }
type FakeChannel = SendableChannel & { type: number; messages: { fetch: (id: string) => Promise<SeededParentMessage> } }
```

Inside `createFakeDiscordClient`, add the seeded store and one-shot flag next to the other closures:

```ts
  const seededParents = new Map<string, SeededParentMessage>()
  let failNextSend = options.failNextChannelSend === true
```

Extend the `channel` object:

```ts
  const channel: FakeChannel = {
    id: 'channel-1',
    type: 0,
    messages: {
      fetch(id: string) {
        const found = seededParents.get(id)
        if (found === undefined) return Promise.reject(new Error(`unknown message ${id}`))
        return Promise.resolve(found)
      },
    },
    send(payload) {
      if (failNextSend) {
        failNextSend = false
        return Promise.reject(new Error('configured channel send rejection'))
      }
      const id = `sent-${String(++sentCount)}`
      sends.push(payload.content ?? '')
      calls.push({ method: 'send', content: payload.content })
      return Promise.resolve({
        id,
        edit(editPayload) {
          calls.push({ method: 'edit', content: editPayload.content })
          return Promise.resolve()
        },
        delete() {
          calls.push({ method: 'delete', messageId: id })
          return Promise.resolve()
        },
      })
    },
    sendTyping() {
      calls.push({ method: 'sendTyping' })
      return Promise.resolve()
    },
  }
```

Add the seed method to the returned object:

```ts
    seedChannelMessage(message) {
      seededParents.set(message.id, {
        id: message.id,
        author: { id: message.authorId, username: 'seeded-author' },
        content: message.content ?? '',
      })
    },
```

- [ ] **Step 4: Run the contract tests and existing Discord scenarios**

Run: `bun test tests/platform/harness/fake-discord-client.test.ts && bun test:platform`

Expected: both exit `0`; all 11 existing Tier 3 records still pass.

- [ ] **Step 5: Commit the fake extensions**

```bash
git add tests/platform/harness/fake-discord-client.ts tests/platform/harness/fake-discord-client.test.ts
git commit -m "test(platform): extend discord fake with parents and send failure"
```

### Task 2: Discord reply-to-bot mention equivalence scenario

**Files:**
- Create: `tests/platform/scenarios/discord-reply-mention.platform.ts`
- Modify: `tests/platform/scenarios/catalog.ts`
- Modify: `tests/platform/run-platform.ts`
- Modify: `tests/stories/catalog/coverage.ts`

**Interfaces:**
- Consumes: `seedChannelMessage` from Task 1; `resolveIsReplyToBot`/`mapDiscordMessage` behavior in `src/chat/discord/dispatch-helpers.ts:21-44` and `src/chat/discord/map-message.ts:51`.
- Produces: `PLATFORM_STORIES['SCN-interaction-discord-reply-to-bot-mention']`.

- [ ] **Step 1: Write the failing scenario**

Create `tests/platform/scenarios/discord-reply-mention.platform.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { DiscordChatProvider, type DispatchableMessage } from '../../../src/chat/discord/index.js'
import type { IncomingMessage } from '../../../src/chat/types.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { createFakeDiscordClient, type FakeDiscordClient } from '../harness/fake-discord-client.js'
import { PLATFORM_STORIES } from './catalog.js'

const PLATFORM_INSTANCE_ID = 'discord-platform'
const BOT_ID = 'discord-bot'
const CHANNEL_ID = 'channel-42'
const MEMBER_ID = 'member-7'
const PARENT_BOT_MESSAGE_ID = 'parent-bot-1'
const PARENT_MEMBER_MESSAGE_ID = 'parent-member-1'
const title = (scenarioId: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[scenarioId].title

function replyMessage(fake: FakeDiscordClient, parentId: string, messageId: string): DispatchableMessage {
  return {
    id: messageId,
    author: { id: MEMBER_ID, username: 'member-seven', bot: false },
    content: 'following up without a mention',
    channel: fake.channel,
    mentions: { has: () => false },
    reference: { messageId: parentId },
    type: 0,
  }
}

describe('T3 Discord — reply-to-bot mention equivalence', () => {
  let fake: FakeDiscordClient
  let provider: DiscordChatProvider

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    fake = createFakeDiscordClient({ botId: BOT_ID, username: 'papai' })
    fake.channel.id = CHANNEL_ID
    provider = new DiscordChatProvider({
      clientFactory: fake.factory,
      token: 'discord-test-token',
      platformInstanceId: PLATFORM_INSTANCE_ID,
    })
  })

  afterEach(async () => {
    await provider.stop()
    fake.assertClean()
  })

  test(title('SCN-interaction-discord-reply-to-bot-mention'), async () => {
    const received: IncomingMessage[] = []
    provider.onMessage((message) => {
      received.push(message)
      return Promise.resolve()
    })
    const started = provider.start()
    fake.emitReady()
    const flushed = fake.flush()
    await started
    await flushed

    fake.seedChannelMessage({ id: PARENT_BOT_MESSAGE_ID, authorId: BOT_ID })
    fake.seedChannelMessage({ id: PARENT_MEMBER_MESSAGE_ID, authorId: 'member-9' })

    fake.emitMessage(replyMessage(fake, PARENT_BOT_MESSAGE_ID, 'reply-to-bot'))
    await fake.flush()
    fake.emitMessage(replyMessage(fake, PARENT_MEMBER_MESSAGE_ID, 'reply-to-member'))
    await fake.flush()

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      messageId: 'reply-to-bot',
      contextId: CHANNEL_ID,
      contextType: 'group',
      isMentioned: false,
      isReplyToBot: true,
      replyToMessageId: PARENT_BOT_MESSAGE_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
      text: 'following up without a mention',
      user: { id: MEMBER_ID, username: 'member-seven' },
    })
  })
})
```

- [ ] **Step 2: Register the scenario in the platform catalog and runner**

In `tests/platform/scenarios/catalog.ts`, add a file constant and story entry:

```ts
const DISCORD_REPLY_MENTION = 'tests/platform/scenarios/discord-reply-mention.platform.ts'
```

```ts
  'SCN-interaction-discord-reply-to-bot-mention': {
    scenarioId: 'SCN-interaction-discord-reply-to-bot-mention',
    title: 'treats a group reply to the bot\'s own message as a mention and ignores a reply to a member',
    file: DISCORD_REPLY_MENTION,
  },
```

In `tests/platform/run-platform.ts`, add after the `discord-callback-routing` import:

```ts
import './scenarios/discord-reply-mention.platform.js'
```

- [ ] **Step 3: Run the scenario to verify the census failure**

Run: `bun test:platform`

Expected: the scenario PASSES, but `bun test tests/platform/catalog-crosscheck.test.ts` FAILS because the Tier 3 record count is still 11 and the new scenario id is unclaimed in `tests/stories/catalog/coverage.ts`.

- [ ] **Step 4: Register the Tier 3 catalog record**

In `tests/stories/catalog/coverage.ts`, add `'SCN-interaction-discord-reply-to-bot-mention',` to `CATALOG_SCENARIO_IDS` (in the platform-adapter cluster after `'SCN-interaction-telegram-callback'`), and add the record after the `'SCN-interaction-telegram-callback'` record:

```ts
  'SCN-interaction-discord-reply-to-bot-mention': {
    verifiedAt: '2026-08-04',
    provingTier: '3',
    storyIds: [
      'tests/platform/scenarios/discord-reply-mention.platform.ts#treats a group reply to the bot\'s own message as a mention and ignores a reply to a member',
    ],
  },
```

In `tests/platform/catalog-crosscheck.test.ts`, change `expect(t3).toHaveLength(11)` to `expect(t3).toHaveLength(12)` and add `'SCN-interaction-discord-reply-to-bot-mention',` to the scenario-id list.

- [ ] **Step 5: Run the lane and crosscheck**

Run: `bun test:platform && bun test tests/platform/catalog-crosscheck.test.ts`

Expected: both exit `0`.

- [ ] **Step 6: Commit the scenario**

```bash
git add tests/platform/scenarios/discord-reply-mention.platform.ts tests/platform/scenarios/catalog.ts tests/platform/run-platform.ts tests/platform/catalog-crosscheck.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(platform): cover discord reply-to-bot mention equivalence"
```

### Task 3: Discord live-status lifecycle scenarios

**Files:**
- Create: `tests/platform/scenarios/discord-live-status.platform.ts`
- Modify: `tests/platform/scenarios/catalog.ts`
- Modify: `tests/platform/run-platform.ts`
- Modify: `tests/platform/catalog-crosscheck.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

**Interfaces:**
- Consumes: `failNextChannelSend` from Task 1; `createDiscordReplyFn`'s `createStatus` in `src/chat/discord/reply-helpers.ts:189-200`.
- Produces: `PLATFORM_STORIES['SCN-interaction-discord-live-status']` and `PLATFORM_STORIES['SCN-interaction-discord-live-status-unavailable']`.

- [ ] **Step 1: Write the failing scenarios**

Create `tests/platform/scenarios/discord-live-status.platform.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { DiscordChatProvider, type DispatchableMessage } from '../../../src/chat/discord/index.js'
import type { StatusHandle } from '../../../src/chat/types.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { createFakeDiscordClient, type FakeDiscordClient } from '../harness/fake-discord-client.js'
import { PLATFORM_STORIES } from './catalog.js'

const PLATFORM_INSTANCE_ID = 'discord-platform'
const BOT_ID = 'discord-bot'
const CHANNEL_ID = 'channel-42'
const MEMBER_ID = 'member-7'
const title = (scenarioId: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[scenarioId].title

function mentionedMessage(content: string, fake: FakeDiscordClient): DispatchableMessage {
  return {
    id: 'message-9',
    author: { id: MEMBER_ID, username: 'member-seven', bot: false },
    content,
    channel: fake.channel,
    mentions: { has: (id: string) => id === BOT_ID },
    reference: null,
    type: 0,
  }
}

async function startProvider(fake: FakeDiscordClient, provider: DiscordChatProvider): Promise<void> {
  const started = provider.start()
  fake.emitReady()
  const flushed = fake.flush()
  await started
  await flushed
}

describe('T3 Discord — live status lifecycle', () => {
  let fake: FakeDiscordClient
  let provider: DiscordChatProvider

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    fake = createFakeDiscordClient({ botId: BOT_ID, username: 'papai' })
    fake.channel.id = CHANNEL_ID
    provider = new DiscordChatProvider({
      clientFactory: fake.factory,
      token: 'discord-test-token',
      platformInstanceId: PLATFORM_INSTANCE_ID,
    })
  })

  afterEach(async () => {
    await provider.stop()
    fake.assertClean()
  })

  test(title('SCN-interaction-discord-live-status'), async () => {
    provider.onMessage(async (_incoming, reply) => {
      const status = await reply.createStatus?.('💭 Thinking…')
      expect(status).toBeDefined()
      await status?.update('🔍 Searching memory: "budget"…')
      await status?.dismiss()
      await reply.formatted('Done.')
    })

    await startProvider(fake, provider)
    fake.emitMessage(mentionedMessage('@papai status please', fake))
    await fake.flush()

    expect(fake.channelCalls()).toEqual([
      { method: 'send', content: '💭 Thinking…' },
      { method: 'edit', content: '🔍 Searching memory: "budget"…' },
      { method: 'delete', messageId: 'sent-1' },
      { method: 'send', content: 'Done.' },
    ])
  })

  test(title('SCN-interaction-discord-live-status-unavailable'), async () => {
    await provider.stop()
    fake.assertClean()
    const failingFake = createFakeDiscordClient({ botId: BOT_ID, username: 'papai', failNextChannelSend: true })
    failingFake.channel.id = CHANNEL_ID
    const failingProvider = new DiscordChatProvider({
      clientFactory: failingFake.factory,
      token: 'discord-test-token',
      platformInstanceId: PLATFORM_INSTANCE_ID,
    })
    let statusResult: StatusHandle | undefined | 'unset' = 'unset'
    failingProvider.onMessage(async (_incoming, reply) => {
      statusResult = await reply.createStatus?.('💭 Thinking…')
      await reply.formatted('Done anyway.')
    })

    await startProvider(failingFake, failingProvider)
    failingFake.emitMessage(mentionedMessage('@papai status please', failingFake))
    await failingFake.flush()

    expect(statusResult).toBeUndefined()
    expect(failingFake.sentContents()).toEqual(['Done anyway.'])

    await failingProvider.stop()
    failingFake.assertClean()
  })
})
```

`StatusHandle` is re-exported from `src/chat/types.ts:212` (`export type { StatusHandle } from './status-handle.js'`), so the import above is correct as written.

- [ ] **Step 2: Register both scenarios in the platform catalog and runner**

In `tests/platform/scenarios/catalog.ts`:

```ts
const DISCORD_LIVE_STATUS = 'tests/platform/scenarios/discord-live-status.platform.ts'
```

```ts
  'SCN-interaction-discord-live-status': {
    scenarioId: 'SCN-interaction-discord-live-status',
    title: 'creates, edits, and dismisses the Discord live-status message in order before the reply posts',
    file: DISCORD_LIVE_STATUS,
  },
  'SCN-interaction-discord-live-status-unavailable': {
    scenarioId: 'SCN-interaction-discord-live-status-unavailable',
    title: 'resolves an undefined Discord status handle when the status send fails and still posts the reply',
    file: DISCORD_LIVE_STATUS,
  },
```

In `tests/platform/run-platform.ts`:

```ts
import './scenarios/discord-live-status.platform.js'
```

Extend `PLATFORM_COVERAGE_FILES` in `tests/platform/scenarios/catalog.ts` (append after `'src/chat/router-helpers.ts'`):

```ts
  'src/chat/discord/dispatch-helpers.ts',
  'src/chat/discord/map-message.ts',
  'src/chat/discord/reply-helpers.ts',
```

and update the exact-array assertion in `tests/platform/catalog-crosscheck.test.ts:70-81` to the same eleven-entry list.

- [ ] **Step 3: Run the scenarios to verify the census failure**

Run: `bun test:platform`

Expected: both scenarios PASS; `bun test tests/platform/catalog-crosscheck.test.ts` FAILS on the Tier 3 count.

- [ ] **Step 4: Register the Tier 3 catalog records**

In `tests/stories/catalog/coverage.ts`, add `'SCN-interaction-discord-live-status',` and `'SCN-interaction-discord-live-status-unavailable',` to `CATALOG_SCENARIO_IDS`, and the records:

```ts
  'SCN-interaction-discord-live-status': {
    verifiedAt: '2026-08-04',
    provingTier: '3',
    storyIds: [
      'tests/platform/scenarios/discord-live-status.platform.ts#creates, edits, and dismisses the Discord live-status message in order before the reply posts',
    ],
  },
  'SCN-interaction-discord-live-status-unavailable': {
    verifiedAt: '2026-08-04',
    provingTier: '3',
    storyIds: [
      'tests/platform/scenarios/discord-live-status.platform.ts#resolves an undefined Discord status handle when the status send fails and still posts the reply',
    ],
  },
```

In `tests/platform/catalog-crosscheck.test.ts`, change `expect(t3).toHaveLength(12)` to `expect(t3).toHaveLength(14)` and add both new ids to the scenario-id list.

- [ ] **Step 5: Run the lane, crosscheck, and coverage gate**

Run: `bun test:platform && bun test tests/platform/catalog-crosscheck.test.ts && bun test:platform:coverage`

Expected: all exit `0`; the coverage runner prints `Checked 11 required source files`.

- [ ] **Step 6: Commit the scenarios**

```bash
git add tests/platform/scenarios/discord-live-status.platform.ts tests/platform/scenarios/catalog.ts tests/platform/run-platform.ts tests/platform/catalog-crosscheck.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(platform): cover discord live-status lifecycle"
```

### Task 4: Extend the fake Mattermost server with root_id delivery and mutation capture

**Files:**
- Modify: `tests/smoke/harness/fake-mattermost-server.ts`
- Modify: `tests/smoke/harness/fake-mattermost-server.test.ts`

**Interfaces:**
- Consumes: the existing `IncomingPost`, `CapturedPost`, and HTTP handler.
- Produces: `IncomingPost.rootId?: string` (emitted as `root_id` in the WS `posted` frame); `PostMutation = { method: 'PATCH' | 'DELETE'; path: string; message?: string }`; `OutboundEvent = { kind: 'post'; post: CapturedPost } | { kind: 'mutation'; mutation: PostMutation }`; `FakeMattermostServer.postMutations(): readonly PostMutation[]`; `FakeMattermostServer.outboundEvents(): readonly OutboundEvent[]` in arrival order.

- [ ] **Step 1: Write the failing fake contract tests**

Append to `tests/smoke/harness/fake-mattermost-server.test.ts`:

```ts
describe('fake Mattermost server — root_id frames and mutation capture', () => {
  test('includes root_id on delivered posts and records patch/delete mutations in order', async () => {
    const mm = startFakeMattermostServer({})
    const received: string[] = []
    const ws = new WebSocket(mm.localBaseUrl.replace('http', 'ws') + '/api/v4/websocket')
    ws.onmessage = (event) => received.push(String(event.data))
    ws.onopen = () => ws.send(JSON.stringify({ action: 'authentication_challenge' }))
    await mm.whenConnected()

    mm.deliverMessage({ channelId: 'chan-1', message: 'thread reply', userId: 'user-1', postId: 'reply-1', rootId: 'root-1' })
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (received.some((frame) => frame.includes('"event":"posted"'))) {
          clearInterval(timer)
          resolve()
        }
      }, 5)
    })
    const posted = received.find((frame) => frame.includes('"event":"posted"'))!
    expect(posted).toContain('\\"root_id\\":\\"root-1\\"')

    await fetch(`${mm.localBaseUrl}/api/v4/posts/out-1/patch`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '💬 Preparing response…' }),
    })
    await fetch(`${mm.localBaseUrl}/api/v4/posts/out-1`, { method: 'DELETE' })

    expect(mm.postMutations()).toEqual([
      { method: 'PATCH', path: '/api/v4/posts/out-1/patch', message: '💬 Preparing response…' },
      { method: 'DELETE', path: '/api/v4/posts/out-1' },
    ])
    expect(mm.outboundEvents().map((event) => event.kind)).toEqual(['mutation', 'mutation'])

    ws.close()
    await mm.stop()
  })
})
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `bun test tests/smoke/harness/fake-mattermost-server.test.ts`

Expected: FAIL because `rootId`, `postMutations`, and `outboundEvents` do not exist.

- [ ] **Step 3: Implement the additive server extensions**

In `tests/smoke/harness/fake-mattermost-server.ts`:

```ts
export type IncomingPost = {
  channelId: string
  message: string
  userId: string
  userName?: string
  postId?: string
  rootId?: string
}

export type PostMutation = { method: 'PATCH' | 'DELETE'; path: string; message?: string }
export type OutboundEvent = { kind: 'post'; post: CapturedPost } | { kind: 'mutation'; mutation: PostMutation }
```

Add to the `FakeMattermostServer` type:

```ts
  postMutations(): readonly PostMutation[]
  outboundEvents(): readonly OutboundEvent[]
```

Add a regex and schema next to the existing ones:

```ts
const POST_PATCH_RE = /^\/api\/v4\/posts\/([^/]+)\/patch$/u
const patchBodySchema = z.object({ message: z.string().optional() })
```

Add capture state next to `postBuffer`:

```ts
  const mutations: PostMutation[] = []
  const outbound: OutboundEvent[] = []
```

In `onPost`, also record the event:

```ts
  const onPost = (post: CapturedPost): void => {
    outbound.push({ kind: 'post', post })
    const waiter = postWaiters.shift()
    if (waiter === undefined) postBuffer.push(post)
    else waiter(post)
  }
```

In `handleHttp`, add two routes immediately before the final `return new Response('not found', { status: 404 })`:

```ts
    if (req.method === 'PUT' && POST_PATCH_RE.test(path)) {
      const rawBody: unknown = await req.json().catch(() => ({}))
      const parsedBody = patchBodySchema.safeParse(rawBody)
      const message = parsedBody.success ? parsedBody.data.message : undefined
      const mutation: PostMutation = { method: 'PATCH', path, ...(message === undefined ? {} : { message }) }
      mutations.push(mutation)
      outbound.push({ kind: 'mutation', mutation })
      return Response.json({ id: POST_PATCH_RE.exec(path)?.[1] ?? '' })
    }
    if (req.method === 'DELETE' && POST_SINGLE_RE.test(path)) {
      const mutation: PostMutation = { method: 'DELETE', path }
      mutations.push(mutation)
      outbound.push({ kind: 'mutation', mutation })
      return Response.json({})
    }
```

In `deliverMessage`, extend the embedded post:

```ts
      const embedded = {
        id: post.postId ?? `in-${inCount}`,
        user_id: post.userId,
        channel_id: post.channelId,
        message: post.message,
        user_name: post.userName ?? post.userId,
        ...(post.rootId === undefined ? {} : { root_id: post.rootId }),
      }
```

Add the accessors to the returned object:

```ts
    postMutations() {
      return mutations.slice()
    },
    outboundEvents() {
      return outbound.slice()
    },
```

- [ ] **Step 4: Run the contract tests and the Tier 2 lane**

Run: `bun test tests/smoke/harness/fake-mattermost-server.test.ts && bun test:smoke`

Expected: both exit `0`; Tier 2 scenarios are untouched.

- [ ] **Step 5: Commit the server extensions**

```bash
git add tests/smoke/harness/fake-mattermost-server.ts tests/smoke/harness/fake-mattermost-server.test.ts
git commit -m "test(platform): capture mattermost root_id and post mutations"
```

### Task 5: Mattermost thread-root reply scenario

**Files:**
- Create: `tests/platform/scenarios/mattermost-thread-reply.platform.ts`
- Modify: `tests/platform/scenarios/catalog.ts`
- Modify: `tests/platform/run-platform.ts`
- Modify: `tests/platform/catalog-crosscheck.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

**Interfaces:**
- Consumes: `IncomingPost.rootId` from Task 4; the container/fake-server boot pattern of `tests/platform/scenarios/mattermost-http-action.platform.ts`; `textResponse` from `tests/smoke/harness/fake-llm-server.ts`.
- Produces: `PLATFORM_STORIES['SCN-mattermost-thread-root-reply']`.

- [ ] **Step 1: Write the failing scenario**

Create `tests/platform/scenarios/mattermost-thread-reply.platform.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { buildContainerEnv, startPapaiContainer, type PapaiContainer } from '../../smoke/harness/container.js'
import { isDockerAvailable } from '../../smoke/harness/docker.js'
import { startFakeLlmServer, textResponse, type FakeLlmServer } from '../../smoke/harness/fake-llm-server.js'
import { startFakeMattermostServer, type FakeMattermostServer } from '../../smoke/harness/fake-mattermost-server.js'
import { ensurePapaiE2eImage } from '../../smoke/harness/image.js'
import { PLATFORM_STORIES } from './catalog.js'

const ADMIN_USER_ID = 'admin-user-1'
const ROOT_POST_ID = 'root-post-1'
const title = (key: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[platform] Docker unavailable — skipping T3 thread-reply lane')

type Handle = { container: PapaiContainer; llm: FakeLlmServer; mm: FakeMattermostServer; stopped: boolean }
let handle: Handle | undefined

describe.skipIf(!DOCKER)('T3 Mattermost — thread-root reply propagation', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
    const llm = startFakeLlmServer()
    const mm = startFakeMattermostServer({ botUserId: 'bot-user-1', botUsername: 'smokebot' })
    try {
      const container = await startPapaiContainer({
        env: buildContainerEnv({ llmBaseUrl: llm.containerBaseUrl, mattermostUrl: mm.containerBaseUrl }),
        readyTimeoutMs: 90_000,
      })
      handle = { container, llm, mm, stopped: false }
    } catch (error) {
      await mm.stop()
      await llm.stop()
      throw error
    }
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    if (!handle.stopped) await handle.container.stop().catch(() => undefined)
    await handle.container.remove().catch(() => undefined)
    await handle.mm.stop()
    await handle.llm.stop()
  })

  test(
    title('SCN-mattermost-thread-root-reply'),
    async () => {
      await handle!.mm.whenConnected()
      handle!.llm.enqueue([textResponse('Top-level reply.'), textResponse('Thread reply.')])

      const topStatus = handle!.mm.waitForPost()
      const topReply = handle!.mm.waitForPost()
      handle!.mm.deliverMessage({
        channelId: 'dm-thread',
        message: 'top level question',
        userId: ADMIN_USER_ID,
        postId: ROOT_POST_ID,
      })
      expect((await topStatus).root_id).toBe(ROOT_POST_ID)
      const top = await topReply
      expect(top.message).toContain('Top-level reply.')
      expect(top.root_id).toBe(ROOT_POST_ID)

      const threadStatus = handle!.mm.waitForPost()
      const threadReply = handle!.mm.waitForPost()
      handle!.mm.deliverMessage({
        channelId: 'dm-thread',
        message: 'follow up in thread',
        userId: ADMIN_USER_ID,
        postId: 'reply-post-2',
        rootId: ROOT_POST_ID,
      })
      expect((await threadStatus).root_id).toBe(ROOT_POST_ID)
      const threaded = await threadReply
      expect(threaded.message).toContain('Thread reply.')
      expect(threaded.root_id).toBe(ROOT_POST_ID)
    },
    60_000,
  )
})
```

The first captured post per turn is the live-status `💭 Thinking…` post (same pattern as `SCN-chat-turn-tool-loop` in `tests/smoke/scenarios/container-p.smoke.ts:139-145`); both it and the real reply carry the thread root because `makePost` in `src/chat/mattermost/reply-helpers.ts:166-180` sends `root_id: options?.threadId ?? threadId ?? ''` for every post.

- [ ] **Step 2: Register the scenario in the platform catalog and runner**

In `tests/platform/scenarios/catalog.ts`:

```ts
const MATTERMOST_THREAD_REPLY = 'tests/platform/scenarios/mattermost-thread-reply.platform.ts'
```

```ts
  'SCN-mattermost-thread-root-reply': {
    scenarioId: 'SCN-mattermost-thread-root-reply',
    title: 'posts Mattermost replies under the incoming thread root for top-level and thread posts',
    file: MATTERMOST_THREAD_REPLY,
  },
```

In `tests/platform/run-platform.ts`:

```ts
import './scenarios/mattermost-thread-reply.platform.js'
```

- [ ] **Step 3: Run the scenario to verify the census failure**

Run: `bun test:platform`

Expected: the scenario PASSES (with Docker); the crosscheck FAILS on the Tier 3 count.

- [ ] **Step 4: Register the Tier 3 catalog record**

In `tests/stories/catalog/coverage.ts`, add `'SCN-mattermost-thread-root-reply',` to `CATALOG_SCENARIO_IDS`, and the record after the Task 2/3 records:

```ts
  'SCN-mattermost-thread-root-reply': {
    verifiedAt: '2026-08-04',
    provingTier: '3',
    storyIds: [
      'tests/platform/scenarios/mattermost-thread-reply.platform.ts#posts Mattermost replies under the incoming thread root for top-level and thread posts',
    ],
  },
```

In `tests/platform/catalog-crosscheck.test.ts`, change `expect(t3).toHaveLength(14)` to `expect(t3).toHaveLength(15)` and add `'SCN-mattermost-thread-root-reply',` to the scenario-id list.

- [ ] **Step 5: Run the lane and crosscheck**

Run: `bun test:platform && bun test tests/platform/catalog-crosscheck.test.ts`

Expected: both exit `0`.

- [ ] **Step 6: Commit the scenario**

```bash
git add tests/platform/scenarios/mattermost-thread-reply.platform.ts tests/platform/scenarios/catalog.ts tests/platform/run-platform.ts tests/platform/catalog-crosscheck.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(platform): cover mattermost thread-root replies"
```

### Task 6: Mattermost live-status mutation lifecycle scenario

**Files:**
- Create: `tests/platform/scenarios/mattermost-status-lifecycle.platform.ts`
- Modify: `tests/platform/scenarios/catalog.ts`
- Modify: `tests/platform/run-platform.ts`
- Modify: `tests/platform/catalog-crosscheck.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

**Interfaces:**
- Consumes: `postMutations()`/`outboundEvents()` from Task 4; the tool-loop enqueue pattern from `tests/smoke/scenarios/container-p.smoke.ts:134-147`; `buildMattermostStatusHandle` in `src/chat/mattermost/reply-helpers.ts:131-146`.
- Produces: `PLATFORM_STORIES['SCN-mattermost-status-mutation-lifecycle']`.

- [ ] **Step 1: Write the failing scenario**

Create `tests/platform/scenarios/mattermost-status-lifecycle.platform.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { buildContainerEnv, startPapaiContainer, type PapaiContainer } from '../../smoke/harness/container.js'
import { isDockerAvailable } from '../../smoke/harness/docker.js'
import { startFakeLlmServer, textResponse, toolResponse, type FakeLlmServer } from '../../smoke/harness/fake-llm-server.js'
import { startFakeMattermostServer, type FakeMattermostServer } from '../../smoke/harness/fake-mattermost-server.js'
import { ensurePapaiE2eImage } from '../../smoke/harness/image.js'
import { PLATFORM_STORIES } from './catalog.js'

const ADMIN_USER_ID = 'admin-user-1'
const title = (key: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[key].title

const DOCKER = await isDockerAvailable()
if (!DOCKER) console.warn('[platform] Docker unavailable — skipping T3 status-lifecycle lane')

type Handle = { container: PapaiContainer; llm: FakeLlmServer; mm: FakeMattermostServer; stopped: boolean }
let handle: Handle | undefined

describe.skipIf(!DOCKER)('T3 Mattermost — live-status mutation lifecycle', () => {
  beforeAll(async () => {
    await ensurePapaiE2eImage()
    const llm = startFakeLlmServer()
    const mm = startFakeMattermostServer({ botUserId: 'bot-user-1', botUsername: 'smokebot' })
    try {
      const container = await startPapaiContainer({
        env: buildContainerEnv({ llmBaseUrl: llm.containerBaseUrl, mattermostUrl: mm.containerBaseUrl }),
        readyTimeoutMs: 90_000,
      })
      handle = { container, llm, mm, stopped: false }
    } catch (error) {
      await mm.stop()
      await llm.stop()
      throw error
    }
  }, 180_000)

  afterAll(async () => {
    if (handle === undefined) return
    if (!handle.stopped) await handle.container.stop().catch(() => undefined)
    await handle.container.remove().catch(() => undefined)
    await handle.mm.stop()
    await handle.llm.stop()
  })

  test(
    title('SCN-mattermost-status-mutation-lifecycle'),
    async () => {
      await handle!.mm.whenConnected()
      handle!.llm.enqueue([
        toolResponse('call_load', 'load_tool', { names: ['list_memory'] }),
        toolResponse('call_list', 'list_memory', {}),
        textResponse('Status lifecycle reply.'),
      ])

      const statusPost = handle!.mm.waitForPost()
      const replyPost = handle!.mm.waitForPost()
      handle!.mm.deliverMessage({
        channelId: 'dm-status',
        message: 'exercise the status lifecycle',
        userId: ADMIN_USER_ID,
        postId: 'status-root-1',
      })
      const status = await statusPost
      const reply = await replyPost
      expect(status.message).toContain('💭')
      expect(reply.message).toContain('Status lifecycle reply.')

      const mutations = handle!.mm.postMutations()
      const patches = mutations.filter((mutation) => mutation.method === 'PATCH')
      const deletes = mutations.filter((mutation) => mutation.method === 'DELETE')
      expect(patches.length).toBeGreaterThan(0)
      expect(patches.at(-1)?.message).toContain('💬')
      expect(patches.at(-1)?.path).toMatch(/^\/api\/v4\/posts\/out-\d+\/patch$/u)
      expect(deletes).toHaveLength(1)
      expect(deletes[0]!.path).toBe(patches.at(-1)!.path.replace(/\/patch$/u, ''))

      const events = handle!.mm.outboundEvents()
      const deleteIndex = events.findIndex((event) => event.kind === 'mutation' && event.mutation.method === 'DELETE')
      const replyIndex = events.findIndex(
        (event) => event.kind === 'post' && event.post.message.includes('Status lifecycle reply.'),
      )
      expect(deleteIndex).toBeGreaterThanOrEqual(0)
      expect(replyIndex).toBeGreaterThan(deleteIndex)
    },
    60_000,
  )
})
```

The placeholder patch (`💬 Preparing response…`) is the last patch before dismissal per the live-status contract in `docs/architecture/behaviors.md`; the status post is deleted before the real reply posts, which the ordered `outboundEvents` log proves.

- [ ] **Step 2: Register the scenario in the platform catalog and runner**

In `tests/platform/scenarios/catalog.ts`:

```ts
const MATTERMOST_STATUS_LIFECYCLE = 'tests/platform/scenarios/mattermost-status-lifecycle.platform.ts'
```

```ts
  'SCN-mattermost-status-mutation-lifecycle': {
    scenarioId: 'SCN-mattermost-status-mutation-lifecycle',
    title: 'patches the Mattermost live-status placeholder and deletes it before the reply posts',
    file: MATTERMOST_STATUS_LIFECYCLE,
  },
```

In `tests/platform/run-platform.ts`:

```ts
import './scenarios/mattermost-status-lifecycle.platform.js'
```

- [ ] **Step 3: Run the scenario to verify the census failure**

Run: `bun test:platform`

Expected: the scenario PASSES (with Docker); the crosscheck FAILS on the Tier 3 count.

- [ ] **Step 4: Register the Tier 3 catalog record and extend the source line**

In `tests/stories/catalog/coverage.ts`, add `'SCN-mattermost-status-mutation-lifecycle',` to `CATALOG_SCENARIO_IDS`, and the record:

```ts
  'SCN-mattermost-status-mutation-lifecycle': {
    verifiedAt: '2026-08-04',
    provingTier: '3',
    storyIds: [
      'tests/platform/scenarios/mattermost-status-lifecycle.platform.ts#patches the Mattermost live-status placeholder and deletes it before the reply posts',
    ],
  },
```

Extend `CATALOG_SOURCE` by appending to the existing literal:

```ts
'; extended 2026-08-04 with 5 chat adapter (@3) ids (tier3-chat-adapter-coverage)'
```

In `tests/platform/catalog-crosscheck.test.ts`, change `expect(t3).toHaveLength(15)` to `expect(t3).toHaveLength(16)` and add `'SCN-mattermost-status-mutation-lifecycle',` to the scenario-id list.

- [ ] **Step 5: Run the lane and crosscheck**

Run: `bun test:platform && bun test tests/platform/catalog-crosscheck.test.ts`

Expected: both exit `0`.

- [ ] **Step 6: Commit the scenario**

```bash
git add tests/platform/scenarios/mattermost-status-lifecycle.platform.ts tests/platform/scenarios/catalog.ts tests/platform/run-platform.ts tests/platform/catalog-crosscheck.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(platform): cover mattermost status mutation lifecycle"
```

## Final Verification

- [ ] Run `bun test:platform`; expected exit code `0` with 16 Tier 3 scenarios (Discord/Kontur run without Docker; Mattermost container scenarios skip with a warning when Docker is unavailable).
- [ ] Run `bun test tests/platform/catalog-crosscheck.test.ts`; expected exit code `0` with the cardinality at 16.
- [ ] Run `bun test:platform:coverage`; expected exit code `0`, printing `Checked 11 required source files`.
- [ ] Run `bun test:smoke`; expected exit code `0` (Tier 2 lane unaffected by the additive fake-server change).
- [ ] Run `bun test:stories:contracts`; expected exit code `0` (Tier 0 contracts unaffected by the additive catalog records).
- [ ] Run `bun run typecheck && bun run lint`; expected exit code `0`.
- [ ] Run `git status --short`; expected output shows no uncommitted changes.
- [ ] Verify no file under `src/chat/telegram/` or `tests/platform/harness/fake-telegram-bot.ts` appears in the branch diff, and no `tests/stories/harness/` or `scripts/story/` file is modified.
