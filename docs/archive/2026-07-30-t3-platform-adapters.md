<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tier 3 Platform Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the five pending Phase 3 platform-adapter records in the nightly Tier 3 lane using deterministic Discord, Kontur Talk, and Telegram fakes.

**Architecture:** Keep adapter production paths real and replace only their external platform boundaries. Reuse Discord's injected client factory; add a narrow Kontur Talk API-base seam and Telegram bot-factory seam so a fake HTTP service/client can be controlled without credentials or wall-clock timing. Register each non-discovered `.platform.ts` scenario one-to-one in the existing platform catalog.

**Tech Stack:** Bun test runner, TypeScript, `bun:test`, Discord structural client types, grammY structural bot API fake, in-process `Bun.serve` Kontur Talk fake, existing `tests/platform` nightly lane.

## Global Constraints

- Preserve the proving tier `3` and seam name `platform-adapter-fakes` for all five records; do not move them to Tier 0.
- Do not include `SCN-deferred-poller-lifecycle`, scheduler/clock changes, or Tier 4 tests.
- All scenario IDs, payloads, platform IDs, room/channel IDs, user IDs, thread IDs, and fake outcomes are fixed constants.
- Never use live credentials, a live network endpoint, random data, fixed-wall-clock waits, or test ordering.
- Run real adapter start/dispatch/reply paths; do not call the isolated helpers as the proof.
- The fake boundary exposes only APIs consumed by the production adapter and its cleanup must fail on pending listeners, requests, responses, timers, or server/client resources.
- Scenario files stay under `tests/platform/scenarios/` with the non-discovered `.platform.ts` suffix and run only through `bun test:platform` / nightly.
- Preserve existing Tier 0 helper and unit tests; add no catalog record outside the five named records.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/chat/kontur-talk/config.ts` | Resolve the default production API base URL and an explicit test override without weakening credential validation. |
| `src/chat/kontur-talk/index.ts` | Build Kontur Talk request URLs from the resolved base URL. |
| `src/chat/telegram/index.ts` | Construct the production grammY bot through an injectable structural factory, defaulting to `new Bot(token)`. |
| `tests/chat/kontur-talk/config.test.ts` | Unit coverage for the private/test-only Kontur API base resolution contract. |
| `tests/chat/telegram/index.test.ts` | Unit coverage that the Telegram provider uses an injected bot factory without exposing a token or changing normal construction. |
| `tests/platform/harness/fake-discord-client.ts` | Deterministic Discord client, channel, message, and button-interaction recorder. |
| `tests/platform/harness/fake-discord-client.test.ts` | Contract tests for Discord fake event, reply, and cleanup recording. |
| `tests/platform/harness/fake-kontur-talk-server.ts` | In-process request-recording Kontur Talk HTTP fake with controllable updates and sends. |
| `tests/platform/harness/fake-kontur-talk-server.test.ts` | Contract tests for the fake server's request recording and shutdown behavior. |
| `tests/platform/harness/fake-telegram-bot.ts` | Minimal structurally compatible Telegram bot/API recorder for membership lookups. |
| `tests/platform/harness/fake-telegram-bot.test.ts` | Contract tests for the fake Bot API membership and cleanup behavior. |
| `tests/platform/scenarios/discord-interactions.platform.ts` | The three Discord Tier 3 records through provider startup and emitted events. |
| `tests/platform/scenarios/kontur-talk-replies.platform.ts` | Kontur Talk formatting/thread/unsupported-button record through the HTTP fake. |
| `tests/platform/scenarios/telegram-admin-authorization.platform.ts` | Telegram membership authorization record through the injected bot fake. |
| `tests/platform/scenarios/catalog.ts` | One-to-one scenario metadata for the five new records. |
| `tests/platform/run-platform.ts` | Explicit import of all new non-discovered scenario modules. |
| `tests/platform/catalog-crosscheck.test.ts` | Update Tier 3 expected cardinality from three to eight while retaining bidirectional validation. |

## Task 1: Add the two narrow adapter test seams

**Files:**

- Modify: `src/chat/kontur-talk/config.ts`
- Modify: `src/chat/kontur-talk/index.ts`
- Modify: `src/chat/telegram/index.ts`
- Modify: `tests/chat/kontur-talk/config.test.ts`
- Modify: `tests/chat/telegram/index.test.ts`

**Interfaces:**

- Produces `ResolvedKonturTalkConfig.apiBaseUrl: string`, defaulting to the current Kontur Talk production base URL.
- Produces `TelegramBotFactory`, a structural `(token: string) => TelegramBotLike` constructor dependency whose default is `new Bot(token)`.
- Consumes the existing `KonturTalkConstructorConfig`, `TelegramConstructorConfig`, and normal provider constructors.

- [ ] **Step 1: Write failing seam tests**

Add a Kontur configuration case that proves an explicit loopback URL is preserved and a Telegram case that proves the supplied factory receives the non-empty token and returns the bot used for `isGroupAdmin`:

```ts
test('preserves an explicit API base URL for a platform fake', () => {
  expect(resolveKonturTalkConfig({
    jwtToken: 'header.eyJzdWIiOiJib3QifQ.signature',
    platformInstanceId: 'kontur-platform',
    apiBaseUrl: 'http://127.0.0.1:43123/api/v1',
  }).apiBaseUrl).toBe('http://127.0.0.1:43123/api/v1')
})

test('uses the injected bot factory for Bot API membership lookup', async () => {
  const calls: Array<[number, number]> = []
  const botFactory: TelegramBotFactory = (token) => {
    expect(token).toBe('telegram-test-token')
    return {
      on: () => undefined,
      command: () => undefined,
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      api: {
        getChatMember: (chatId: number, userId: number) => {
          calls.push([chatId, userId])
          return Promise.resolve({ status: 'administrator' })
        },
      },
    }
  }
  const provider = new TelegramChatProvider({
    token: 'telegram-test-token',
    platformInstanceId: 'telegram-platform',
    botFactory,
  })
  await expect(provider.isGroupAdmin('telegram-platform', '-100', '42')).resolves.toBe(true)
  expect(calls).toEqual([[-100, 42]])
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `bun test tests/chat/kontur-talk/config.test.ts tests/chat/telegram/index.test.ts`

Expected: FAIL because `apiBaseUrl`, `TelegramBotFactory`, and `botFactory` do not yet exist.

- [ ] **Step 3: Implement the minimal seams**

Extend the Kontur types and resolver; keep the production default exact and reject an empty override. Store `apiBaseUrl` on the provider and build URLs from it:

```ts
const DEFAULT_API_BASE_URL = 'https://chat.ktalk.ru/_matrix/client/strangler/api/v1'

export type KonturTalkConstructorConfig = Partial<{
  jwtToken: string
  platformInstanceId: string
  apiBaseUrl: string
}>

export type ResolvedKonturTalkConfig = {
  jwtToken: string
  platformInstanceId: string
  apiBaseUrl: string
}

const resolveApiBaseUrl = (apiBaseUrl: string | undefined): string => {
  if (apiBaseUrl === undefined) return DEFAULT_API_BASE_URL
  if (apiBaseUrl.trim() === '') throw new Error('apiBaseUrl must not be empty')
  return apiBaseUrl.replace(/\/$/u, '')
}
```

Define the Telegram factory as a narrow structural type containing the members used by the provider (`on`, `command`, `start`, `stop`, and its `api` methods). Add optional `botFactory` to the constructor config and construct with `config.botFactory?.(token) ?? new Bot(token)`. Do not export or log the supplied token, and do not use `Reflect` in production code.

- [ ] **Step 4: Run focused unit tests and static checks**

Run: `bun test tests/chat/kontur-talk/config.test.ts tests/chat/telegram/index.test.ts`

Expected: PASS with the new tests and all existing cases green.

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the seam-only change**

```bash
git add src/chat/kontur-talk/config.ts src/chat/kontur-talk/index.ts src/chat/telegram/index.ts tests/chat/kontur-talk/config.test.ts tests/chat/telegram/index.test.ts
git commit -m "test(platform): add adapter fake seams"
```

## Task 2: Create deterministic Tier 3 fake boundaries

**Files:**

- Create: `tests/platform/harness/fake-discord-client.ts`
- Create: `tests/platform/harness/fake-discord-client.test.ts`
- Create: `tests/platform/harness/fake-kontur-talk-server.ts`
- Create: `tests/platform/harness/fake-kontur-talk-server.test.ts`
- Create: `tests/platform/harness/fake-telegram-bot.ts`
- Create: `tests/platform/harness/fake-telegram-bot.test.ts`

**Interfaces:**

- Consumes `DiscordClientFactory`, `DispatchableMessage`, `ButtonInteractionLike`, and the structural Telegram bot factory from Task 1.
- Produces `createFakeDiscordClient()`, `startFakeKonturTalkServer()`, and `createFakeTelegramBot()` with explicit `emit`, recorded-call, and `assertClean` methods.

- [ ] **Step 1: Write failing harness contract tests alongside the fakes**

Create focused `bun:test` files adjacent to each fake that establish its observable contract:

```ts
test('Discord fake emits ready once and records ordered channel sends', async () => {
  const fake = createFakeDiscordClient({ botId: 'discord-bot', username: 'papai' })
  const started = fake.login('discord-test-token')
  fake.emitReady()
  await started
  await fake.channel.send({ content: 'first' })
  await fake.channel.send({ content: 'second' })
  expect(fake.sentContents()).toEqual(['first', 'second'])
  await fake.client.destroy()
  fake.assertClean()
})
```

```ts
test('Kontur fake records a send request and shuts down cleanly', async () => {
  const fake = await startFakeKonturTalkServer()
  await fetch(`${fake.baseUrl}/bot/test/send_message`, { method: 'POST', body: JSON.stringify({ room_id: '!room' }) })
  expect(fake.sentRequests()).toHaveLength(1)
  await fake.stop()
})
```

```ts
test('Telegram fake records numeric membership lookup and exposes no polling timer', async () => {
  const fake = createFakeTelegramBot({ getChatMember: () => Promise.resolve({ status: 'member' }) })
  await fake.bot.api.getChatMember(-100, 42)
  expect(fake.membershipCalls()).toEqual([[-100, 42]])
  fake.assertClean()
})
```

- [ ] **Step 2: Run the harness tests to verify they fail**

Run: `bun test tests/platform/harness`

Expected: FAIL because the fake modules and factories do not exist.

- [ ] **Step 3: Implement only the adapter-consumed fake surface**

Implement an event-listener map and one-shot ready listener in the Discord fake. Its channel records `send`, `edit`, `delete`, and `sendTyping`; its button interaction records every `deferUpdate` and `followUp`, with a configurable rejection for one call. `client.destroy()` clears the listener map and marks the client stopped; `assertClean()` fails unless destruction occurred and no pending deferred response remains.

Run an in-process `Bun.serve` Kontur fake on an OS-assigned loopback port. Record parsed JSON requests in arrival order; return only schema-valid fixed responses for `/get_updates` and `/send_message`; reject an unexpected path/method. After delivering the explicitly queued update batch, hold the next `/get_updates` request pending until test teardown; this prevents an uncontrolled tight polling loop. Its `stop()` closes the server, settles that held request, and `assertClean()` rejects unconsumed expected requests or an unclosed server.

Implement the Telegram fake as the minimal factory result used by the provider. It records `getChatMember(chatId, userId)` calls and returns a caller-selected status or rejection. It must provide no polling loop and must make `stop()`/`assertClean()` idempotent.

- [ ] **Step 4: Run the harness tests**

Run: `bun test tests/platform/harness`

Expected: PASS.

- [ ] **Step 5: Commit the fake boundaries**

```bash
git add tests/platform/harness
git commit -m "test(platform): add deterministic adapter fakes"
```

## Task 3: Prove the three Discord Tier 3 records

**Files:**

- Create: `tests/platform/scenarios/discord-interactions.platform.ts`

**Interfaces:**

- Consumes `DiscordChatProvider` with the existing `clientFactory` constructor dependency and `createFakeDiscordClient()` from Task 2.
- Produces three `title('SCN-…')` tests, each with no external network or timer ownership.

- [ ] **Step 1: Write the three failing platform scenarios**

Use fixed constants `discord-platform`, `discord-bot`, `channel-42`, `member-7`, and `message-9`. Start the real provider via its fake client, then emit events rather than calling private dispatch helpers. Add these assertions:

```ts
test(title('SCN-interaction-discord-command-routing'), async () => {
  provider.registerCommand('help', async (message) => { received.push(message) })
  provider.onMessage(async () => { ordinaryMessages += 1 })
  await startProvider(fake, provider)
  fake.emitMessage(mentionedMessage('/help retained-args'))
  await fake.flush()
  expect(received).toHaveLength(1)
  expect(received[0]!.commandMatch).toBe('retained-args')
  expect(ordinaryMessages).toBe(0)
})
```

```ts
test(title('SCN-interaction-discord-format-chunking'), async () => {
  await startProvider(fake, provider)
  await replyToMentionedMessage(provider, fake, oversizedFencedMarkdown)
  const chunks = fake.sentContents()
  expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true)
  expect(chunks).toEqual(expectedDiscordChunks)
  expect(chunks.every(hasBalancedFences)).toBe(true)
})
```

```ts
test(title('SCN-interaction-discord-response-lifecycle'), async () => {
  provider.onInteraction(async (_incoming, reply) => { await reply.ephemeralConfirm?.('saved') })
  await startProvider(fake, provider)
  fake.emitButton(buttonInteraction({ rejectDefer: true }))
  await fake.flush()
  expect(fake.deferCount()).toBe(1)
  expect(fake.followUps()).toEqual([{ content: 'saved', ephemeral: true }])
  expect(fake.duplicateAcknowledgements()).toBe(0)
})
```

The chunk fixture must contain a deterministic code fence crossing the 2,000-character boundary and `expectedDiscordChunks` must include the adapter's close/reopen fence text, so no lossy reconstruction assertion can hide reordering.

- [ ] **Step 2: Run the Discord scenario to verify it fails**

Run: `bun test tests/platform/scenarios/discord-interactions.platform.ts`

Expected: FAIL because the scenario and title registry do not yet exist; do not run it through default discovery.

- [ ] **Step 3: Complete the scenario against the Task 2 fake**

Keep all event delivery asynchronous through the fake listener queue and await `fake.flush()` rather than sleeping. In `afterEach`, await `provider.stop()` and call `fake.assertClean()`. The lifecycle rejection case must prove one failed `deferUpdate` plus one safe follow-up and no second defer attempt; it must not assert a retry.

- [ ] **Step 4: Run the direct scenario module**

Run: `bun test tests/platform/scenarios/discord-interactions.platform.ts`

Expected: PASS with all three titled tests.

- [ ] **Step 5: Commit Discord coverage**

```bash
git add tests/platform/scenarios/discord-interactions.platform.ts
git commit -m "test(platform): cover Discord interaction adapters"
```

## Task 4: Prove Kontur Talk formatting and Telegram admin authorization

**Files:**

- Create: `tests/platform/scenarios/kontur-talk-replies.platform.ts`
- Create: `tests/platform/scenarios/telegram-admin-authorization.platform.ts`

**Interfaces:**

- Consumes the Task 1 Kontur base URL and Telegram bot-factory seams plus Task 2 fake server/client factories.
- Produces `title('SCN-interaction-kontur-reply-formatting')` and `title('SCN-interaction-telegram-admin-authorization')` exactly once each.

- [ ] **Step 1: Write the failing Kontur scenario**

Start `KonturTalkChatProvider` with `apiBaseUrl: fake.baseUrl`, fixed JWT payload subject `kontur-bot`, room `!room:example`, default thread `$thread-default`, and a fake update. Drive the actual handler to send text, formatted text with an overridden `$thread-override`, and buttons:

```ts
expect(fake.sentRequests()).toEqual([
  { method: 'POST', path: '/bot/header.eyJzdWIiOiJrb250dXItYm90In0.signature/send_message', body: {
    room_id: '!room:example', message: 'plain reply', format: 'plain', thread_id: '$thread-default', mentions: [],
  } },
  { method: 'POST', path: '/bot/header.eyJzdWIiOiJrb250dXItYm90In0.signature/send_message', body: {
    room_id: '!room:example', message: '**formatted reply**', format: 'markdown', thread_id: '$thread-override', mentions: [],
  } },
])
await expect(reply.buttons('unsupported', { buttons: [] })).rejects.toThrow(/does not support/iu)
expect(fake.sentRequests()).toHaveLength(2)
```

- [ ] **Step 2: Write the failing Telegram scenario**

Construct the real `TelegramChatProvider` with `createFakeTelegramBot` and table-drive fixed statuses:

```ts
for (const row of [
  { outcome: { status: 'creator' }, expected: true },
  { outcome: { status: 'administrator' }, expected: true },
  { outcome: { status: 'member' }, expected: false },
  { outcome: new Error('fake Bot API unavailable'), expected: null },
]) {
  const fake = createFakeTelegramBot({ getChatMember: () => outcomeToPromise(row.outcome) })
  const provider = new TelegramChatProvider({ token: 'telegram-test-token', platformInstanceId: 'telegram-platform', botFactory: fake.factory })
  await expect(provider.isGroupAdmin('telegram-platform', '-100', '42')).resolves.toBe(row.expected)
  expect(fake.membershipCalls()).toEqual([[-100, 42]])
  fake.assertClean()
}
await expect(provider.isGroupAdmin('telegram-platform', 'not-a-number', '42')).resolves.toBeNull()
expect(fake.membershipCalls()).toEqual([])
```

- [ ] **Step 3: Run the two scenarios to verify they fail**

Run: `bun test tests/platform/scenarios/kontur-talk-replies.platform.ts tests/platform/scenarios/telegram-admin-authorization.platform.ts`

Expected: FAIL because the scenarios do not yet exist.

- [ ] **Step 4: Implement the scenarios and cleanup**

For Kontur, consume every expected request before stopping the provider, then stop the fake server and await the held `/get_updates` settlement before asserting server cleanliness. This proves teardown cannot leave a self-rescheduled poll live. For Telegram, exercise the provider's public `isGroupAdmin` method only; `null` is the required fail-closed outcome and must not be coerced to `false` or `true` by the scenario.

- [ ] **Step 5: Run the direct scenarios**

Run: `bun test tests/platform/scenarios/kontur-talk-replies.platform.ts tests/platform/scenarios/telegram-admin-authorization.platform.ts`

Expected: PASS with one titled test per record.

- [ ] **Step 6: Commit the remaining platform coverage**

```bash
git add tests/platform/scenarios/kontur-talk-replies.platform.ts tests/platform/scenarios/telegram-admin-authorization.platform.ts
git commit -m "test(platform): cover Kontur and Telegram adapters"
```

## Task 5: Register the five scenarios and verify the nightly lane

**Files:**

- Modify: `tests/platform/scenarios/catalog.ts`
- Modify: `tests/platform/run-platform.ts`
- Modify: `tests/platform/catalog-crosscheck.test.ts`

**Interfaces:**

- Consumes the five scenario modules from Tasks 3 and 4.
- Produces one `PLATFORM_STORIES` entry per pending Tier 3 catalog record and an explicit runner import for every module.

- [ ] **Step 1: Write the catalog crosscheck expectation first**

Update the existing cardinality assertion to require eight executable Tier 3 records and add explicit expected IDs:

```ts
expect(t3).toHaveLength(8)
expect(Object.keys(PLATFORM_STORIES)).toEqual(expect.arrayContaining([
  'SCN-interaction-discord-command-routing',
  'SCN-interaction-discord-format-chunking',
  'SCN-interaction-discord-response-lifecycle',
  'SCN-interaction-kontur-reply-formatting',
  'SCN-interaction-telegram-admin-authorization',
]))
```

- [ ] **Step 2: Run the crosscheck to verify it fails**

Run: `bun test tests/platform/catalog-crosscheck.test.ts`

Expected: FAIL because the catalog contains only the three Mattermost entries.

- [ ] **Step 3: Register every scenario exactly once**

Add three entries pointing at `discord-interactions.platform.ts`, one at `kontur-talk-replies.platform.ts`, and one at `telegram-admin-authorization.platform.ts`. Their `scenarioId` must equal the record ID and their `title` must be the exact human-readable title passed through the local `title()` helper. Add one import per scenario module to `run-platform.ts`; do not import the harness directly.

- [ ] **Step 4: Run lane-local verification**

Run: `bun test tests/platform/catalog-crosscheck.test.ts`

Expected: PASS; the one-to-one mapping and marker census accept exactly eight Tier 3 records.

Run: `bun test:platform`

Expected: PASS or an explicit existing Docker skip for the unrelated Mattermost scenarios; all five new fake-boundary scenarios pass without Docker or network access.

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Run changed-file quality checks**

Run: `bun test:mutate:changed`

Expected: PASS or an actionable baseline update only for production files changed in Task 1; do not update a baseline without a green mutation run.

Run: `bun security`

Expected: PASS.

- [ ] **Step 6: Commit registration and verification changes**

```bash
git add tests/platform/scenarios/catalog.ts tests/platform/run-platform.ts tests/platform/catalog-crosscheck.test.ts
git commit -m "test(platform): register adapter scenarios"
```

## Final Verification

- [ ] Run `bun test:platform` and confirm all five new Tier 3 scenarios are executed by the explicit runner.
- [ ] Run `bun test tests/platform/catalog-crosscheck.test.ts` and confirm all eight Tier 3 catalog entries map one-to-one to a registered `title()` marker.
- [ ] Run `bun run typecheck`, `bun security`, and `bun test:mutate:changed`; retain their command output as final evidence.
- [ ] Confirm `SCN-deferred-poller-lifecycle` remains `needs-seam@4` with `scheduler-due-seed` and `scheduler-chat-di` in the ledger and that no Tier 4 file changed.
