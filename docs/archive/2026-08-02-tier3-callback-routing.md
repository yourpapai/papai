<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tier 3 Callback Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the remaining Discord and Telegram callback records to executable Tier 3 scenarios by proving their SDK event handlers route through `ChatRouter` and production interaction handling.

**Architecture:** Extend the injected Telegram fake only with deterministic callback delivery and observability. New platform scenarios use real Discord/Telegram providers inside `ChatRouter`, configure it using `setupBot`, then resolve real permission prompts through emitted SDK callbacks. The catalog promotion is the final independent deliverable.

**Tech Stack:** Bun test, TypeScript, discord.js structural client fake, grammY structural bot fake, SQLite test database, `ChatRouter`, `setupBot`.

## Global Constraints

- Cover exactly `SCN-interaction-discord-router-wrapped`, `SCN-interaction-discord-standalone-fallback`, and `SCN-interaction-telegram-callback`.
- Use the real provider event registration, `ChatRouter`, and production `setupBot` for router-wrapped scenarios.
- Keep all scenario files under `tests/platform/scenarios/` with the non-discovered `.platform.ts` suffix.
- Keep Tier 3 nightly-only; do not alter PR gates, Docker setup, production `src/`, or story coverage floors.
- Fakes may deliver events and record effects; they must not emulate production routing or authorization.
- Use `setupTestDb()`, `mockLogger()`, DI, and deterministic completion signals; do not add sleeps or retries.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `tests/platform/harness/fake-telegram-bot.ts` | Structural grammY fake: callback handler registration, queued callback dispatch, callback-answer recording, and lifecycle cleanup. |
| `tests/platform/harness/fake-telegram-bot.test.ts` | Contract tests for the fake's callback-delivery and cleanup behavior. |
| `tests/platform/scenarios/discord-callback-routing.platform.ts` | Router-wrapped permission callback and standalone Discord fallback scenarios. |
| `tests/platform/scenarios/telegram-callback-routing.platform.ts` | Router-wrapped Telegram permission callback scenario. |
| `tests/platform/scenarios/catalog.ts` | Scenario registry entries and Tier 3 adapter coverage-source list. |
| `tests/platform/run-platform.ts` | Explicit registration of both new non-discovered scenario files. |
| `tests/platform/catalog-crosscheck.test.ts` | Tier 3 count, registry, and coverage-source assertions. |
| `tests/stories/catalog/coverage.ts` | Promote the three records from pending to executable Tier 3. |
| `tests/stories/harness/catalog-coverage.test.ts` | Update catalog totals and the pending-seam projection. |

## Task 1: Add Deterministic Telegram Callback Delivery

**Files:**
- Modify: `tests/platform/harness/fake-telegram-bot.ts`
- Modify: `tests/platform/harness/fake-telegram-bot.test.ts`

**Interfaces:**
- Produces `FakeTelegramBot.emitCallback(ctx: Context): void`, `flush(): Promise<void>`, and `callbackAnswers(): readonly unknown[]`.
- `assertClean()` rejects an active poller, queued callbacks, or unfinished callback handler work.

- [ ] **Step 1: Write failing fake contract tests**

Add a test that registers `bot.on('callback_query:data', handler)`, emits a callback-shaped context, proves no handler has run before `flush()`, then proves it runs once after `flush()`.

```ts
test('queues callback-query handlers and records callback answers', async () => {
  const fake = createFakeTelegramBot({ getChatMember: () => Promise.resolve({ status: 'member' }) })
  const received: string[] = []
  fake.bot.on('callback_query:data', async (ctx) => {
    received.push(ctx.callbackQuery?.data ?? '')
    await ctx.answerCallbackQuery({ text: 'saved' })
  })

  fake.emitCallback(callbackContext('perm:a:prompt-1'))
  expect(received).toEqual([])
  await fake.flush()

  expect(received).toEqual(['perm:a:prompt-1'])
  expect(fake.callbackAnswers()).toEqual([{ text: 'saved' }])
  fake.assertClean()
})
```

Add a second test that emits a callback whose handler remains pending, asserts `assertClean()` fails, resolves the handler, flushes, and then asserts cleanup passes after `bot.stop()`.

- [ ] **Step 2: Run the focused fake tests and verify failure**

Run: `bun test tests/platform/harness/fake-telegram-bot.test.ts`

Expected: FAIL because `emitCallback`, `flush`, and `callbackAnswers` do not exist.

- [ ] **Step 3: Add the minimal fake event queue**

Replace the no-op `on` implementation with a filter-keyed handler registry. Keep all current API methods unchanged. Add a callback queue and a pending-handler set. Implement the new public fake surface with this shape:

```ts
type CallbackContext = Pick<Context, 'callbackQuery' | 'from' | 'chat' | 'me' | 'answerCallbackQuery'>

emitCallback(ctx: CallbackContext): void
flush(): Promise<void>
callbackAnswers(): readonly unknown[]
```

`emitCallback` must enqueue every handler registered for `callback_query:data`; `flush` drains handlers in FIFO order and waits for each returned promise. Extend `assertClean()` with explicit failures for queued events and pending callback handlers. Define `callbackContext(data)` in the test as a local builder returning those minimum fields: `callbackQuery`, `from`, `chat`, `me`, and `answerCallbackQuery`.

- [ ] **Step 4: Run the focused fake tests and verify success**

Run: `bun test tests/platform/harness/fake-telegram-bot.test.ts`

Expected: PASS, including existing membership and polling lifecycle tests.

- [ ] **Step 5: Commit the fake contract**

```bash
git add tests/platform/harness/fake-telegram-bot.ts tests/platform/harness/fake-telegram-bot.test.ts
git commit -m "test(platform): add Telegram callback fake"
```

## Task 2: Add Discord Callback-Routing Scenarios

**Files:**
- Create: `tests/platform/scenarios/discord-callback-routing.platform.ts`

**Interfaces:**
- Consumes `createFakeDiscordClient`, `DiscordChatProvider`, `ChatRouter`, `setupBot`, `askPermissionViaChat`, and the authorization/database helpers used by existing chat tests.
- Produces title-marked executions of `SCN-interaction-discord-router-wrapped` and `SCN-interaction-discord-standalone-fallback`.

- [ ] **Step 1: Write the two failing scenarios**

Build a local router helper that returns the real Discord provider only for `discord-platform`, adds that instance as type `discord`, and calls `setupBot(router, ADMIN_USER_ID)`. Seed an authorized Discord DM user and the matching scoped storage context with the existing test helpers before starting the router.

For the wrapped scenario, create a real prompt using `askPermissionViaChat` and a reply whose `buttons()` returns a `PromptHandle` spy. Extract the generated allow callback from the button payload, emit it via `fake.emitButton({ customId })`, flush, and assert:

```ts
await expect(decision).resolves.toBe('allow')
expect(promptHandle.remove).toHaveBeenCalledTimes(1)
expect(fake.deferUpdateCalls()).toHaveLength(1)
expect(fake.followUpCalls()).toEqual([{ content: 'Allowed delete_task ✅', flags: 64 }])
```

For the standalone scenario, start the provider directly, install `onMessage` with a capture array, emit an unmatched button callback, then assert the callback is deferred and the fallback receives a normalized message with `platformInstanceId`, the button `message.id`, `contextId`, and `text` derived from the unmatched callback. Assert no follow-up is sent.

- [ ] **Step 2: Run the new scenario file and verify failure**

Run: `bun test --path-ignore-patterns '' tests/platform/scenarios/discord-callback-routing.platform.ts`

Expected: FAIL because the scenario file has not been created.

- [ ] **Step 3: Implement minimal scenario setup and teardown**

Use `beforeEach` to call `mockLogger()`, `setupTestDb()`, and `resetPermissionPromptForTesting()`. Use `afterEach` to reset permission prompts, stop the router/provider, and call `fake.assertClean()`. Start the router with `await router.start()` after `setupBot` has registered handlers; start the standalone provider with the ready/flush sequence used by `discord-interactions.platform.ts`.

Do not use `testDispatchButtonInteraction`; each assertion must enter via `FakeDiscordClient.emitButton()` and the provider's real `interactionCreate` listener.

- [ ] **Step 4: Run the focused scenario file and verify success**

Run: `bun test --path-ignore-patterns '' tests/platform/scenarios/discord-callback-routing.platform.ts`

Expected: PASS for both title-marked scenarios, with no fake lifecycle leak.

- [ ] **Step 5: Commit Discord scenario coverage**

```bash
git add tests/platform/scenarios/discord-callback-routing.platform.ts
git commit -m "test(platform): cover Discord callback routing"
```

## Task 3: Add Telegram Callback-Routing Scenario

**Files:**
- Create: `tests/platform/scenarios/telegram-callback-routing.platform.ts`

**Interfaces:**
- Consumes Task 1's queued Telegram callback fake plus the real `TelegramChatProvider`, `ChatRouter`, `setupBot`, and permission prompt API.
- Produces a title-marked execution of `SCN-interaction-telegram-callback`.

- [ ] **Step 1: Write the failing Telegram scenario**

Seed an authorized Telegram group member and its scoped group/thread storage context. Create a router owning a real Telegram provider at `telegram-platform`, call `setupBot(router, ADMIN_USER_ID)`, and start the router. Create a real prompt with `askPermissionViaChat`, extract `perm:d:<id>`, then emit a callback context containing that callback data, group chat ID, user, callback message ID, and `message_thread_id`.

Assert production outcomes rather than mapped-object spies:

```ts
await expect(decision).resolves.toBe('deny')
expect(promptHandle.remove).toHaveBeenCalledTimes(1)
expect(fake.callbackAnswers()).toEqual([{ text: 'Denied delete_task 🚫' }])
```

Also assert the callback answer count is exactly one and teardown calls `router.stop()` then `fake.assertClean()`.

- [ ] **Step 2: Run the scenario and verify failure**

Run: `bun test --path-ignore-patterns '' tests/platform/scenarios/telegram-callback-routing.platform.ts`

Expected: FAIL because the scenario file has not been created.

- [ ] **Step 3: Implement the smallest real-routing scenario**

Use the same `setupTestDb()`, scoped authorization seeding, and permission-prompt reset pattern as Task 2. Keep the callback context builder local to this file and typed as the narrow structural input required by `FakeTelegramBot.emitCallback`; do not export test-only Telegram production types. Call `fake.emitCallback(ctx)` then `await fake.flush()`; never call `dispatchCallbackQuery` directly.

- [ ] **Step 4: Run the focused scenario and verify success**

Run: `bun test --path-ignore-patterns '' tests/platform/scenarios/telegram-callback-routing.platform.ts`

Expected: PASS, including exactly one acknowledgement and clean stopped polling state.

- [ ] **Step 5: Commit Telegram scenario coverage**

```bash
git add tests/platform/scenarios/telegram-callback-routing.platform.ts
git commit -m "test(platform): cover Telegram callback routing"
```

## Task 4: Promote The Three Catalog Records And Register The Lane

**Files:**
- Modify: `tests/platform/scenarios/catalog.ts`
- Modify: `tests/platform/run-platform.ts`
- Modify: `tests/platform/catalog-crosscheck.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:**
- Consumes the exact `title('SCN-*')` invocations from Tasks 2 and 3.
- Produces three executable `provingTier: '3'` catalog records and no remaining `needs-seam@3` records.

- [ ] **Step 1: Write failing crosscheck assertions**

Update the Tier 3 catalog crosscheck to expect 11 executable records and require all three new scenario IDs. Add callback source modules to the coverage list:

```ts
'src/chat/discord/button-dispatch.ts',
'src/chat/telegram/interaction-helpers.ts',
'src/chat/router-helpers.ts',
```

Update `catalog-coverage.test.ts` to expect 201 executable and 22 pending records, zero `needs-seam` records, and no `SCN-interaction-*` callback IDs in the pending audit projection.

- [ ] **Step 2: Run catalog checks and verify failure**

Run: `bun test --path-ignore-patterns '' tests/platform/catalog-crosscheck.test.ts tests/stories/harness/catalog-coverage.test.ts`

Expected: FAIL because the registry and `catalogCoverage` still report 8 Tier 3 records and three pending seams.

- [ ] **Step 3: Register scenarios and promote records**

In `PLATFORM_STORIES`, add the three IDs with titles byte-identical to their scenario `title()` calls and files pointing to the two new scenario files. Import both files from `run-platform.ts`.

Move these exact entries out of `AUDIT_RECORDS` and into `EXECUTABLE_STORY_MAPPINGS` with `provingTier: '3'` and the registry-derived story IDs:

```ts
'SCN-interaction-discord-router-wrapped'
'SCN-interaction-discord-standalone-fallback'
'SCN-interaction-telegram-callback'
```

Keep all other pending records unchanged. Update every exact count and set assertion in the catalog contract to reflect the 3-record move.

- [ ] **Step 4: Run catalog and platform lane verification**

Run:

```bash
bun test --path-ignore-patterns '' tests/platform/catalog-crosscheck.test.ts tests/stories/harness/catalog-coverage.test.ts
bun run test:platform
bun run test:stories:contracts
```

Expected: all pass; catalog output reports 201/223 executable, Tier 3 = 11, pending = 22, and `needs-seam = 0`.

- [ ] **Step 5: Verify default discovery and static checks**

Run:

```bash
bun test --list | rg 'tests/platform/scenarios/.*\.platform\.ts' && exit 1 || exit 0
bun run typecheck
bun run lint
```

Expected: the discovery check prints nothing and exits 0; typecheck and lint pass.

- [ ] **Step 6: Run changed-file mutation verification if production-adjacent source changed**

Run: `bun run test:mutate:changed`

Expected: no changed production source is reported. If any implementation source was changed contrary to the design, its paired mutation result must meet the configured ratchet before proceeding.

- [ ] **Step 7: Commit catalog promotion**

```bash
git add tests/platform/scenarios/catalog.ts tests/platform/run-platform.ts tests/platform/catalog-crosscheck.test.ts tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(catalog): close Tier 3 callback scenarios"
```

## Final Verification

- [ ] **Step 1: Inspect the final diff**

Run: `git status --short && git diff master...HEAD -- tests/platform tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts`

Expected: only Tier 3 fakes, scenarios, registry, and catalog contracts changed; no `src/` production behavior change.

- [ ] **Step 2: Run the complete required suite**

Run:

```bash
bun run test:platform
bun run test:stories:contracts
bun run typecheck
bun run lint
```

Expected: all commands exit 0. The platform run executes 11 Tier 3 cataloged scenarios and the catalog contracts report 201 executable / 22 pending with no remaining seam-pending records.
