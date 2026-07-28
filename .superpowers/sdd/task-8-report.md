# Task 8 Report — `onIncomingEdit` integration hub

## What was implemented

Created `src/message-edit/handle.ts` exporting `onIncomingEdit(chat, msg, reply, deps)` plus the named `EditHandlerDeps` type, and wired it into `src/bot.ts` (replacing the Task-7 stub with an import). The handler:

1. Runs the same guard sequence as `onIncomingMessage`: `resolveMessageAuth` → denied skip → `shouldIgnoreGroupMessage` → `messageId === undefined` skip → command-edit skip → empty-text skip → same-text skip.
2. Always applies the **baseline** correction (runs for all windows): `cacheObservedIncomingMessage(msg, auth)` to upsert `message_metadata`, then `applyEditToHistory` to rewrite the matching user turn in `conversation_history`.
3. Classifies the edit via `classifyEdit({ editedMessageId, activeRun, lastTurn, laterUserMessageExists })` and dispatches:
   - **W1** (active run owns the edited message): pushes `⟲ Your earlier message was edited. New version:\n\n${msg.text}` onto `activeRun.steerQueue` and replies `✋ folding that into the current run…`.
   - **W2** (last completed turn owns it, no later user message): dispatches to a `handleW2` **stub** (Tasks 10–11).
   - **W3**: silent — baseline already corrected both stores.

The `laterUserMessageExists` helper is a small drizzle query against `message_metadata` for any row with `contextId == ctx && timestamp > prior.timestamp`, `.limit(1).get()`.

## How the import cycle was resolved

`bot.ts` now imports `onIncomingEdit` from `./message-edit/handle.js`. If `handle.ts` had imported `resolveMessageAuth` / `shouldIgnoreGroupMessage` from `../bot.js`, that would form a cycle (bot.ts ⇄ handle.ts).

**Resolution (brief option a):** extracted both helpers into a new shared module `src/bot-guards.ts`. Both `bot.ts` and `handle.ts` now import the helpers from `./bot-guards.js`. The new module has no inbound dependency on either `bot.ts` or `handle.ts`, so the graph is acyclic:

```
bot.ts ──► handle.ts ──► bot-guards.ts ◄── bot.ts
                              │
                              └──► auth.js, chat/types.js
```

Following the existing `bot-*.ts` pure-helper convention (cf. `bot-unauthorized-reply.ts`), the new file has a dedicated unit test `tests/bot-guards.test.ts`.

## TDD evidence

### RED (handle.ts)

```
$ bun test tests/message-edit/handle.test.ts
error: Cannot find module '../../src/message-edit/handle.js' …
1 fail
```

### RED (bot-guards.ts)

```
$ bun test tests/bot-guards.test.ts
error: Cannot find module '../src/bot-guards.js' …
1 fail
```

### GREEN (final)

```
$ bun test tests/message-edit/handle.test.ts tests/bot-guards.test.ts
7 pass / 0 fail (handle: 5, bot-guards: 7 → 12 total)
```

Handle suite covers: W1 pushes steer text containing both the edited body and the "Your earlier message was edited" prefix + acks with "folding that into the current run"; W1 also verifies baseline ran (history rewritten to `hi`, `message_metadata` row text is `hi`); W3 silent path still applies baseline (text → `second`), no ack; command edit is a no-op; same-text edit is a no-op; denied user is a no-op.

### Full-suite sanity

```
$ bun run test
8896 pass / 0 fail / 2 skip / 978 files
```

## Knip ignore removals (carry-forward)

Removed both pending ignore entries from `knip.config.ts` now that Task 8 consumes the symbols:

- `ignoreIssues['src/history.ts']: ['exports']` — added in commit 49e9d7ee9 for `applyEditToHistory`; now imported by `handle.ts`.
- `ignoreFiles: ['src/message-edit/classify.ts']` — added in commit 5c5ed9e05 for `classifyEdit`; now imported by `handle.ts`.

Verified: `bun run knip` is clean.

## Files changed

| File                                | Change                                                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/message-edit/handle.ts`        | **new** — `onIncomingEdit` + `EditHandlerDeps` + `handleW2` stub + `laterUserMessageExists`.                                                                               |
| `src/bot-guards.ts`                 | **new** — extracted `resolveMessageAuth` + `shouldIgnoreGroupMessage` (cycle break).                                                                                       |
| `src/bot.ts`                        | Removed the local copies of the two guards (now imported from `./bot-guards.js`); removed the Task-7 `onIncomingEdit` stub (now imported from `./message-edit/handle.js`). |
| `tests/message-edit/handle.test.ts` | **new** — 5 tests covering W1/W3/command-edit/same-text/denied-user.                                                                                                       |
| `tests/bot-guards.test.ts`          | **new** — 7 tests covering the extracted helpers.                                                                                                                          |
| `knip.config.ts`                    | Removed the two temporary ignore entries (history.ts exports + classify.ts unused-file).                                                                                   |

## Self-review findings

- **Completeness:** `handle.ts` implements guards (auth, group filter, messageId, command, empty text, same-text) + baseline history + W1 (steer + ack) + W3 (silent). W2 dispatches to a stub. `bot.ts` wiring replaces the Task-7 stub. Both knip ignores removed. W2 body and platform-event subscription deferred per the plan.
- **Quality:** no cycle (bot.ts ⇄ handle.ts broken via `bot-guards.ts`); guards mirror `onIncomingMessage` semantics exactly (same ordering, same skip conditions); baseline runs unconditionally before window classification for all of W1/W2/W3.
- **Discipline:** W2 is a true stub (`// noop until Tasks 10–11`); no platform-event subscription code added.
- **Testing:** all five scenarios assert observable post-conditions (steer text content, ack text, history text after edit, metadata row text after edit, no-ack on W3/skip paths).

## Concerns / deviations

1. **`EditHandlerDeps` shape (deviation from brief).** The brief specified `EditHandlerDeps = { processMessage: (...args: never[]) => Promise<void> }` (required `processMessage`) and `deps as EditHandlerDeps` at the W2 dispatch site. That cast trips oxlint's `typescript(no-unsafe-type-assertion)` rule (the assertion target is narrower than the source because `processMessage` is optional on the deps param). Project conventions forbid `lint-disable`/`type-ignore`, so I made `EditHandlerDeps`'s `processMessage` **optional** to match the deps param type — the cast is no longer needed. The named type and its role as the W2-deps contract are preserved for Task 10. Task 10 should narrow with a runtime guard when it actually needs `processMessage`.

2. **Brief's test sketch adjusted.** The brief's test sketch imported `setupTestDb` from `tests/utils/db-helpers.js` (doesn't exist — it lives in `tests/utils/test-helpers.ts`), treated `createDmMessage(arg)`'s first arg as text (it's actually `userId`), and used `createMockChatForBot()` directly as the chat argument (it returns `{ provider, … }`, not a `ChatProvider`). I used the actual helper shapes (`createMockChat()` for the chat argument, `createDmMessage('userId')` + spread for text). The intent of every brief test is preserved.

3. **Format/lint cleanup pass.** Initial implementation tripped three oxlint rules (useless trailing `return`, two unsafe type assertions). Fixed by removing the redundant return, dropping the `deps as EditHandlerDeps` cast (see concern 1), and replacing `{} as ChatProvider` in tests with `createMockChat()`. Final state: `bun run lint`, `bun run format:check`, `bun run typecheck`, `bun run knip`, and `bun run test` all green.

4. **Cache write timing in tests.** `cacheMessage` defers the SQLite write to a microtask via `scheduleMessagePersistence`. Tests that need to assert the post-cache state of `getMessageByContext` must `await flushPendingWrites()` (existing helper) after calling `cacheObservedIncomingMessage`. Used in the W1, W3, and same-text tests.
