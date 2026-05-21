<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# /context Command Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin-only file-export `/context` command with a visual context window display available to all authorized users. Shows a proportional emoji grid of token usage by category plus platform-specific detail (Telegram monospace block, Discord embed, Mattermost markdown table).

**Architecture:** Add a platform-agnostic `ContextCollector` that gathers system prompt, memory, history, and tool definitions, tokenizes each with `ai-tokenizer`, and produces a `ContextSnapshot`. Each `ChatProvider` grows a `renderContext(snapshot)` method that produces platform-native output via a shared grid builder. Add an optional `reply.embed()` method so Discord can emit native embeds.

**Tech Stack:** Bun, TypeScript, Bun test, Vercel AI SDK, `ai-tokenizer`, discord.js v14, grammy, pino

---

## Scope Notes

This is a single plan: one new dependency, one new command flow, one interface extension. Everything shares the `ContextSnapshot` type that must be defined before any renderer or handler can consume it.

The existing `/context` file export is **replaced**, not extended — the `adminUserId` parameter on `registerContextCommand` goes away, the file-upload code is deleted, and any test that asserts admin-only behavior is rewritten.

## File Structure

| Path                                             | Responsibility                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/chat/types.ts`                              | Add `ContextSection`, `ContextSnapshot`, `ContextRendered`, `EmbedField`, `EmbedOptions`; extend `ChatProvider` with `renderContext()`; extend `ReplyFn` with optional `embed` |
| `src/commands/context-collector.ts`              | Gather context data, tokenize sections, produce `ContextSnapshot`                                                                                                              |
| `src/commands/context-grid.ts`                   | Shared grid builder (proportional emoji grid from a snapshot)                                                                                                                  |
| `src/commands/context.ts`                        | Command handler (rewritten) — calls collector, delegates rendering to provider                                                                                                 |
| `src/commands/index.ts`                          | No API change; verify re-export still works                                                                                                                                    |
| `src/bot.ts`                                     | Remove `adminUserId` argument from `registerContextCommand` call                                                                                                               |
| `src/chat/telegram/context-renderer.ts`          | Telegram renderer: inline emoji grid + monospace detail                                                                                                                        |
| `src/chat/telegram/index.ts`                     | Add `renderContext()` method delegating to the renderer                                                                                                                        |
| `src/chat/discord/context-renderer.ts`           | Discord renderer: emoji grid description + embed fields                                                                                                                        |
| `src/chat/discord/reply-helpers.ts`              | Add `embed()` method to `createDiscordReplyFn`                                                                                                                                 |
| `src/chat/discord/index.ts`                      | Add `renderContext()` method delegating to the renderer                                                                                                                        |
| `src/chat/mattermost/context-renderer.ts`        | Mattermost renderer: emoji grid + markdown table                                                                                                                               |
| `src/chat/mattermost/index.ts`                   | Add `renderContext()` method delegating to the renderer                                                                                                                        |
| `tests/utils/test-helpers.ts`                    | Update `createMockReply()` and `createMockChat()` to include new members                                                                                                       |
| `tests/commands/context-collector.test.ts`       | Unit tests for the collector (DI-driven)                                                                                                                                       |
| `tests/commands/context-grid.test.ts`            | Unit tests for the grid builder                                                                                                                                                |
| `tests/commands/context.test.ts`                 | New unit tests for the command handler                                                                                                                                         |
| `tests/chat/telegram/context-renderer.test.ts`   | Unit tests for the Telegram renderer                                                                                                                                           |
| `tests/chat/discord/context-renderer.test.ts`    | Unit tests for the Discord renderer                                                                                                                                            |
| `tests/chat/discord/reply-helpers.test.ts`       | Add assertions for the new `embed()` method                                                                                                                                    |
| `tests/chat/mattermost/context-renderer.test.ts` | Unit tests for the Mattermost renderer                                                                                                                                         |
| `package.json`                                   | Add `ai-tokenizer` dependency                                                                                                                                                  |

---

### Task 1: Add the `ai-tokenizer` dependency

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

Run:

```bash
bun add ai-tokenizer
```

Expected: installs `ai-tokenizer` as a runtime dependency and updates `package.json` + `bun.lock`.

- [ ] **Step 2: Verify the install worked**

Run:

```bash
bun pm ls | grep ai-tokenizer
```

Expected: one line showing `ai-tokenizer` with a version.

- [ ] **Step 3: Smoke-test the import path we will use**

Run:

```bash
bun -e "import('ai-tokenizer/encoding/cl100k_base').then(m => console.log(Object.keys(m).slice(0,5))).catch(e => { console.error(e); process.exit(1) })"
```

Expected: prints an array (the encoding module's exports). If the import path differs, adjust subsequent tasks to use whatever path actually works — `ai-tokenizer` exposes each encoding at `ai-tokenizer/encoding/<name>` per its README.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add ai-tokenizer dependency for /context token counts"
```

---

### Task 2: Extend chat types with `ContextSnapshot`, `ContextRendered`, and `EmbedOptions`

**Files:**

- Modify: `src/chat/types.ts`

- [ ] **Step 1: Add the new types near the existing reply types**

Open `src/chat/types.ts` and add the following block **before** the existing `type ReplyFn = ...` definition (around line 122, right after the `ButtonReplyOptions` interface):

```typescript
/** One section of the LLM context window, with an optional nested breakdown. */
export type ContextSection = {
  label: string
  tokens: number
  detail?: string
  children?: ContextSection[]
}

/** Snapshot of the LLM context window for a given conversation. */
export type ContextSnapshot = {
  modelName: string
  sections: ContextSection[]
  totalTokens: number
  /** Model's context window if known, null for unrecognized models. */
  maxTokens: number | null
  /** True when token counts came from a char/4 fallback because tokenization failed. */
  approximate: boolean
}

/** One field inside a Discord-style embed. */
export type EmbedField = {
  name: string
  value: string
  inline?: boolean
}

/** Options for sending a structured embed (Discord-only today). */
export type EmbedOptions = {
  title: string
  description: string
  fields?: EmbedField[]
  footer?: string
  color?: number
}

/** Result of `ChatProvider.renderContext` — describes how the handler should send the output. */
export type ContextRendered =
  | { method: 'text'; content: string }
  | { method: 'formatted'; content: string }
  | { method: 'embed'; embed: EmbedOptions }
```

- [ ] **Step 2: Extend `ReplyFn` with the optional `embed` method**

Still in `src/chat/types.ts`, replace the existing `ReplyFn` type (lines 124–131) with:

```typescript
/** Reply function injected into handlers — the only way to send messages back to the user. */
export type ReplyFn = {
  text: (content: string, options?: ReplyOptions) => Promise<void>
  formatted: (markdown: string, options?: ReplyOptions) => Promise<void>
  file?: (file: ChatFile, options?: ReplyOptions) => Promise<void>
  typing: () => void
  redactMessage?: (replacementText: string) => Promise<void>
  buttons: (content: string, options: ButtonReplyOptions) => Promise<void>
  /** Optional: send a structured embed. Only Discord implements this today. */
  embed?: (options: EmbedOptions) => Promise<void>
}
```

- [ ] **Step 3: Extend `ChatProvider` with `renderContext`**

In the same file, add the `renderContext` method to the existing `ChatProvider` interface (after `setCommands`, around line 215):

```typescript
  /** Render a context snapshot into a platform-native representation. */
  renderContext(snapshot: ContextSnapshot): ContextRendered
```

The complete interface should now read:

```typescript
/** The core interface every chat platform provider must implement. */
export interface ChatProvider {
  readonly name: string
  /** Thread support capabilities */
  readonly threadCapabilities: ThreadCapabilities
  /** Set of supported capability strings */
  readonly capabilities: ReadonlySet<ChatCapability>
  /** Behavioral traits for this platform */
  readonly traits: ChatProviderTraits
  /** Environment/config requirements for startup */
  readonly configRequirements: readonly ChatProviderConfigRequirement[]

  /** Register a slash command handler (e.g., 'help' for /help). */
  registerCommand(name: string, handler: CommandHandler): void

  /** Register the catch-all handler for non-command messages. */
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void

  /** Register the handler for button/callback interactions (optional). */
  onInteraction?(handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void

  /** Send a formatted markdown message to a user by ID (for announcements). */
  sendMessage(userId: string, markdown: string): Promise<void>

  /**
   * Resolve a username to a user ID. Returns null if not found or not supported.
   * The `users.resolve` capability signals full username-resolution support.
   */
  resolveUserId?(username: string, context: ResolveUserContext): Promise<string | null>

  /** Register the bot's command list with the platform (for command menus). */
  setCommands?(adminUserId: string): Promise<void>

  /** Render a context snapshot into a platform-native representation. */
  renderContext(snapshot: ContextSnapshot): ContextRendered

  /** Start the bot event loop. */
  start(): Promise<void>

  /** Graceful shutdown. */
  stop(): Promise<void>
}
```

- [ ] **Step 4: Typecheck**

Run:

```bash
bun typecheck
```

Expected: many new errors pointing at `TelegramChatProvider`, `DiscordChatProvider`, `MattermostChatProvider`, `createMockChat`, `createMockReply`, and any tests that construct a `ChatProvider` by hand — they now miss `renderContext`. That is expected — subsequent tasks implement these methods. Do **not** try to make typecheck green yet. Keep the failures as a worklist.

- [ ] **Step 5: Commit**

```bash
git add src/chat/types.ts
git commit -m "feat(chat): add ContextSnapshot, ContextRendered, EmbedOptions types"
```

---

### Task 3: Update `createMockReply` and `createMockChat` helpers

**Files:**

- Modify: `tests/utils/test-helpers.ts`

These helpers are used throughout the test suite. They must implement the new interface shape before any downstream test can compile.

- [ ] **Step 1: Write a failing assertion for the new `embed` stub**

Open `tests/utils/test-helpers.ts`. We are going to modify the helpers themselves; their own tests live implicitly across the suite. As a sanity check, add this ad-hoc verification temporarily to the bottom of `tests/commands/context.test.ts` (create the file if it does not exist yet, stubbing with just `import { test } from 'bun:test'`):

```typescript
import { test, expect } from 'bun:test'
import { createMockReply, createMockChat } from '../utils/test-helpers.js'

test('createMockReply exposes an embed stub', () => {
  const { reply } = createMockReply()
  expect(typeof reply.embed).toBe('function')
})

test('createMockChat implements renderContext', () => {
  const chat = createMockChat()
  expect(typeof chat.renderContext).toBe('function')
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun test tests/commands/context.test.ts
```

Expected: FAIL — either because `reply.embed` is undefined or because `chat.renderContext` is not a function.

- [ ] **Step 3: Update `createMockReply` to include `embed` and expose an embed log**

In `tests/utils/test-helpers.ts`, locate `MockReplyResult` (declared around line 190 — find it by searching for `MockReplyResult`) and the `createMockReply` function (line 204). Update both:

```typescript
export interface MockReplyResult {
  reply: ReplyFn
  textCalls: string[]
  redactCalls: string[]
  embedCalls: EmbedOptions[]
  getReplies: () => string[]
  getRedactions: () => string[]
  getEmbeds: () => EmbedOptions[]
}

export function createMockReply(): MockReplyResult {
  const textCalls: string[] = []
  const redactCalls: string[] = []
  const embedCalls: EmbedOptions[] = []
  const reply: ReplyFn = {
    text: (content: string): Promise<void> => {
      textCalls.push(content)
      return Promise.resolve()
    },
    formatted: (content: string): Promise<void> => {
      textCalls.push(content)
      return Promise.resolve()
    },
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
    redactMessage: (replacementText: string): Promise<void> => {
      redactCalls.push(replacementText)
      return Promise.resolve()
    },
    buttons: (content: string): Promise<void> => {
      textCalls.push(content)
      return Promise.resolve()
    },
    embed: (options: EmbedOptions): Promise<void> => {
      embedCalls.push(options)
      return Promise.resolve()
    },
  }
  return {
    reply,
    textCalls,
    redactCalls,
    embedCalls,
    getReplies: () => textCalls,
    getRedactions: () => redactCalls,
    getEmbeds: () => embedCalls,
  }
}
```

Note that `formatted` now pushes into `textCalls` — the existing `createMockReply` returned `Promise.resolve()` without recording. Our new command handler dispatches to `formatted`, so tests need to see what was sent. If any existing test asserted that `textCalls` contained only `text` calls, fix it in place when we find it.

- [ ] **Step 4: Import `EmbedOptions` in the helpers file**

At the top of `tests/utils/test-helpers.ts`, update the chat types import. Find the existing line:

```typescript
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
} from '../../src/chat/types.js'
```

Replace with:

```typescript
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  EmbedOptions,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
} from '../../src/chat/types.js'
```

- [ ] **Step 5: Update `createMockChat` to implement `renderContext`**

In the same file, update `createMockChat` (line 309). Find the `return { ... }` block and add a `renderContext` entry alongside `start`/`stop`:

```typescript
    renderContext: (snapshot: ContextSnapshot): ContextRendered => ({
      method: 'text',
      content: `mock renderContext: ${snapshot.modelName} total=${String(snapshot.totalTokens)}`,
    }),
```

The full return block should read:

```typescript
return {
  name: 'mock',
  threadCapabilities: {
    supportsThreads: true,
    canCreateThreads: false,
    threadScope: 'message',
  },
  capabilities: options.capabilities ?? DEFAULT_CHAT_CAPABILITIES,
  traits: options.traits ?? { observedGroupMessages: 'all' },
  configRequirements: options.configRequirements ?? [],
  registerCommand: (name: string, handler: CommandHandler): void => {
    options.commandHandlers?.set(name, handler)
  },
  onMessage: (handler): void => {
    options.onMessageHandler?.(handler)
  },
  ...(options.onInteractionHandler === undefined
    ? {}
    : (() => {
        const interactionHandler = options.onInteractionHandler
        return {
          onInteraction: (handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void => {
            interactionHandler(handler)
          },
        }
      })()),
  sendMessage: options.sendMessage ?? ((): Promise<void> => Promise.resolve()),
  resolveUserId:
    options.resolveUserId ??
    ((username: string, _context: ResolveUserContext): Promise<string | null> => {
      const clean = username.startsWith('@') ? username.slice(1) : username
      return Promise.resolve(clean)
    }),
  setCommands: options.setCommands ?? ((): Promise<void> => Promise.resolve()),
  renderContext: (snapshot: ContextSnapshot): ContextRendered => ({
    method: 'text',
    content: `mock renderContext: ${snapshot.modelName} total=${String(snapshot.totalTokens)}`,
  }),
  start: (): Promise<void> => Promise.resolve(),
  stop: (): Promise<void> => Promise.resolve(),
}
```

- [ ] **Step 6: Update any other mock chat factories in the file**

Search `tests/utils/test-helpers.ts` for other `createMockChat*` functions (`createMockChatWithCommandHandlers`, `createMockChatWithHandler`, `createMockChatForBot`, `createMockChatWithSentMessages` — found via grep at lines 349, 361, 377, 399). Each returns an object literal of type `ChatProvider`. Add the same `renderContext` implementation to each of them. If the factory spreads `createMockChat(...)` already, no change is needed — verify by reading each function body.

- [ ] **Step 7: Run the sanity tests from Step 1**

Run:

```bash
bun test tests/commands/context.test.ts
```

Expected: PASS on both `createMockReply exposes an embed stub` and `createMockChat implements renderContext`.

- [ ] **Step 8: Run the full test suite to find fallout**

Run:

```bash
bun test
```

Expected: the suite still has many failures from unimplemented `renderContext` on the real providers (Telegram/Discord/Mattermost class instances). That is expected. Any test that constructed a `ChatProvider`-typed literal inline will also fail — fix those in the same commit by adding a `renderContext` stub that throws `new Error('not used in this test')`. Search with:

```bash
grep -rn "ChatProvider = {" tests/ || true
grep -rn ": ChatProvider = {" tests/ || true
```

Add stubs inline where needed. Do not rewrite tests semantically; just add the missing method.

- [ ] **Step 9: Commit**

```bash
git add tests/utils/test-helpers.ts tests/commands/context.test.ts tests/
git commit -m "test(helpers): add renderContext and embed to mock chat and reply helpers"
```

---

### Task 4: Build the context grid utility

**Files:**

- Create: `src/commands/context-grid.ts`
- Create: `tests/commands/context-grid.test.ts`

The grid takes a `ContextSnapshot` and produces a fixed-size emoji grid that can be dropped into any renderer.

- [ ] **Step 1: Write the failing test**

Create `tests/commands/context-grid.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import type { ContextSnapshot } from '../../src/chat/types.js'
import { buildContextGrid, GRID_COLS, GRID_ROWS } from '../../src/commands/context-grid.js'

const baseSnapshot = (overrides: Partial<ContextSnapshot> = {}): ContextSnapshot => ({
  modelName: 'gpt-4o',
  totalTokens: 0,
  maxTokens: 128_000,
  approximate: false,
  sections: [],
  ...overrides,
})

describe('buildContextGrid', () => {
  test('returns a string with GRID_ROWS lines of GRID_COLS cells when maxTokens is known', () => {
    const snapshot = baseSnapshot({
      totalTokens: 1_000,
      sections: [{ label: 'System prompt', tokens: 1_000 }],
    })
    const grid = buildContextGrid(snapshot)
    const lines = grid.split('\n')
    expect(lines).toHaveLength(GRID_ROWS)
    for (const line of lines) {
      // Each cell is a single emoji (using Array.from for unicode-safe counting)
      expect(Array.from(line)).toHaveLength(GRID_COLS)
    }
  })

  test('assigns one cell per section when tokens are tiny', () => {
    const snapshot = baseSnapshot({
      totalTokens: 4,
      maxTokens: 128_000,
      sections: [
        { label: 'System prompt', tokens: 1 },
        { label: 'Memory context', tokens: 1 },
        { label: 'Conversation history', tokens: 1 },
        { label: 'Tools', tokens: 1 },
      ],
    })
    const grid = buildContextGrid(snapshot)
    expect(grid).toContain('🟦')
    expect(grid).toContain('🟩')
    expect(grid).toContain('🟨')
    expect(grid).toContain('🟪')
    expect(grid).toContain('⬜') // free space still dominates
  })

  test('fills the grid proportionally when usage is substantial', () => {
    const snapshot = baseSnapshot({
      totalTokens: 64_000, // 50% of 128_000
      sections: [{ label: 'System prompt', tokens: 64_000 }],
    })
    const grid = buildContextGrid(snapshot)
    const usedCells = Array.from(grid).filter((c) => c === '🟦').length
    expect(usedCells).toBeGreaterThanOrEqual(99)
    expect(usedCells).toBeLessThanOrEqual(101)
  })

  test('renders a single 20-cell row when maxTokens is null', () => {
    const snapshot = baseSnapshot({
      maxTokens: null,
      totalTokens: 400,
      sections: [
        { label: 'System prompt', tokens: 200 },
        { label: 'Tools', tokens: 200 },
      ],
    })
    const grid = buildContextGrid(snapshot)
    expect(grid.split('\n')).toHaveLength(1)
    expect(Array.from(grid)).toHaveLength(GRID_COLS)
    expect(grid).not.toContain('⬜') // no free-space cells without a known limit
  })

  test('produces an all-free grid when there are no sections', () => {
    const snapshot = baseSnapshot({
      totalTokens: 0,
      sections: [],
    })
    const grid = buildContextGrid(snapshot)
    const cells = Array.from(grid.replace(/\n/g, ''))
    expect(cells.every((c) => c === '⬜')).toBe(true)
  })

  test('caps oversized usage at full grid', () => {
    const snapshot = baseSnapshot({
      totalTokens: 200_000,
      sections: [{ label: 'System prompt', tokens: 200_000 }],
    })
    const grid = buildContextGrid(snapshot)
    const cells = Array.from(grid.replace(/\n/g, ''))
    expect(cells.every((c) => c === '🟦')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun test tests/commands/context-grid.test.ts
```

Expected: FAIL — cannot find module `../../src/commands/context-grid.js`.

- [ ] **Step 3: Implement the grid builder**

Create `src/commands/context-grid.ts`:

```typescript
import type { ContextSection, ContextSnapshot } from '../chat/types.js'

export const GRID_COLS = 20
export const GRID_ROWS = 10
const TOTAL_CELLS = GRID_COLS * GRID_ROWS

const FREE_CELL = '⬜'

const SECTION_EMOJIS: Record<string, string> = {
  'System prompt': '🟦',
  'Memory context': '🟩',
  'Conversation history': '🟨',
  Tools: '🟪',
}

const FALLBACK_EMOJI = '🟫'

function emojiForLabel(label: string): string {
  return SECTION_EMOJIS[label] ?? FALLBACK_EMOJI
}

type Allocation = { emoji: string; cells: number }

function allocateCells(sections: readonly ContextSection[], cellBudget: number, tokensPerCell: number): Allocation[] {
  if (tokensPerCell <= 0) return []

  const allocations: Allocation[] = []
  let assigned = 0
  for (const section of sections) {
    if (section.tokens <= 0) continue
    const rawCells = section.tokens / tokensPerCell
    const cells = Math.max(1, Math.round(rawCells))
    allocations.push({ emoji: emojiForLabel(section.label), cells })
    assigned += cells
  }

  // Trim from the largest allocation until we fit the budget (keep every section >= 1).
  while (assigned > cellBudget) {
    let largestIndex = -1
    let largestCells = 1
    for (let i = 0; i < allocations.length; i++) {
      const entry = allocations[i]!
      if (entry.cells > largestCells) {
        largestCells = entry.cells
        largestIndex = i
      }
    }
    if (largestIndex === -1) break
    allocations[largestIndex]!.cells -= 1
    assigned -= 1
  }

  return allocations
}

function assembleCells(allocations: readonly Allocation[], totalCells: number, fillFree: boolean): string[] {
  const cells: string[] = []
  for (const entry of allocations) {
    for (let i = 0; i < entry.cells; i++) cells.push(entry.emoji)
  }
  if (fillFree) {
    while (cells.length < totalCells) cells.push(FREE_CELL)
  }
  return cells.slice(0, totalCells)
}

function gridToString(cells: readonly string[], cols: number): string {
  const rows: string[] = []
  for (let i = 0; i < cells.length; i += cols) {
    rows.push(cells.slice(i, i + cols).join(''))
  }
  return rows.join('\n')
}

export function buildContextGrid(snapshot: ContextSnapshot): string {
  if (snapshot.maxTokens === null) {
    // Single-row bar: allocate only used cells, no free space.
    const used = Math.max(snapshot.totalTokens, 1)
    const tokensPerCell = used / GRID_COLS
    const allocations = allocateCells(snapshot.sections, GRID_COLS, tokensPerCell)
    const cells = assembleCells(allocations, GRID_COLS, false)
    // Pad with the fallback emoji only if allocations under-filled (defensive).
    while (cells.length < GRID_COLS) cells.push(FALLBACK_EMOJI)
    return gridToString(cells, GRID_COLS)
  }

  const tokensPerCell = snapshot.maxTokens / TOTAL_CELLS
  const usedCells = Math.min(TOTAL_CELLS, Math.round(snapshot.totalTokens / tokensPerCell))
  const allocations = allocateCells(snapshot.sections, usedCells, tokensPerCell)
  const cells = assembleCells(allocations, TOTAL_CELLS, true)
  return gridToString(cells, GRID_COLS)
}
```

- [ ] **Step 4: Run to verify it passes**

Run:

```bash
bun test tests/commands/context-grid.test.ts
```

Expected: PASS on all six tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/context-grid.ts tests/commands/context-grid.test.ts
git commit -m "feat(commands): add context grid builder for /context output"
```

---

### Task 5: Build the context collector

**Files:**

- Create: `src/commands/context-collector.ts`
- Create: `tests/commands/context-collector.test.ts`

The collector is the platform-agnostic core that assembles a `ContextSnapshot` from the user's live context. We use DI so tests can supply canned inputs and a fake tokenizer.

- [ ] **Step 1: Write the failing test**

Create `tests/commands/context-collector.test.ts`:

```typescript
import { describe, expect, test, beforeEach } from 'bun:test'
import type { ModelMessage } from 'ai'

import type { ContextCollectorDeps } from '../../src/commands/context-collector.js'
import { collectContext, resolveEncodingName, resolveMaxTokens } from '../../src/commands/context-collector.js'
import { mockLogger } from '../utils/test-helpers.js'

const makeDeps = (overrides: Partial<ContextCollectorDeps> = {}): ContextCollectorDeps => ({
  getMainModel: () => 'gpt-4o',
  buildSystemPrompt: () => 'BASE PROMPT BODY',
  buildInstructionsBlock: () => '',
  getProviderAddendum: () => '',
  getHistory: () => [] as readonly ModelMessage[],
  getMemoryMessage: () => null,
  getSummary: () => null,
  getFacts: () => [],
  getActiveToolDefinitions: () => ({}),
  getProviderName: () => 'kaneo',
  countTokens: (text: string) => Math.ceil(text.length / 4),
  ...overrides,
})

describe('collectContext', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns the resolved model name', async () => {
    const deps = makeDeps({ getMainModel: () => 'gpt-4.1-mini' })
    const snapshot = await collectContext('user1', deps)
    expect(snapshot.modelName).toBe('gpt-4.1-mini')
  })

  test('sums section tokens into totalTokens', async () => {
    const deps = makeDeps({
      countTokens: (text: string) => text.length, // deterministic
      buildSystemPrompt: () => 'AAAA', // 4 tokens
      getHistory: () => [{ role: 'user', content: 'BB' }], // 2 tokens (plus serialization framing, see below)
      getActiveToolDefinitions: () => ({ search_tasks: { description: 'C' } }),
    })
    const snapshot = await collectContext('user1', deps)
    expect(snapshot.totalTokens).toBe(snapshot.sections.reduce((acc, s) => acc + s.tokens, 0))
    expect(snapshot.totalTokens).toBeGreaterThan(0)
  })

  test('produces sections in the expected order with the expected labels', async () => {
    const snapshot = await collectContext('user1', makeDeps())
    expect(snapshot.sections.map((s) => s.label)).toEqual([
      'System prompt',
      'Memory context',
      'Conversation history',
      'Tools',
    ])
  })

  test('memory section has Summary and Known entities children', async () => {
    const deps = makeDeps({
      getSummary: () => 'brief summary',
      getFacts: () => [
        { identifier: '#1', title: 'A', url: '', last_seen: '2026-04-11' },
        { identifier: '#2', title: 'B', url: '', last_seen: '2026-04-11' },
      ],
      getMemoryMessage: () => 'Memory block',
    })
    const snapshot = await collectContext('user1', deps)
    const memory = snapshot.sections.find((s) => s.label === 'Memory context')!
    expect(memory.children?.map((c) => c.label)).toEqual(['Summary', 'Known entities'])
    expect(memory.children?.[1]?.detail).toBe('2 facts')
  })

  test('system prompt section has Base / Custom / Addendum children when non-empty', async () => {
    const deps = makeDeps({
      buildInstructionsBlock: () => '=== Custom instructions ===\n- use short words\n',
      getProviderAddendum: () => 'kaneo addendum',
    })
    const snapshot = await collectContext('user1', deps)
    const sysPrompt = snapshot.sections.find((s) => s.label === 'System prompt')!
    const labels = sysPrompt.children?.map((c) => c.label) ?? []
    expect(labels).toContain('Base instructions')
    expect(labels).toContain('Custom instructions')
    expect(labels).toContain('Provider addendum')
  })

  test('Conversation history detail shows message count', async () => {
    const deps = makeDeps({
      getHistory: () => [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'how are you' },
      ],
    })
    const snapshot = await collectContext('user1', deps)
    const convo = snapshot.sections.find((s) => s.label === 'Conversation history')!
    expect(convo.detail).toBe('3 messages')
  })

  test('Tools detail shows count and provider name', async () => {
    const deps = makeDeps({
      getActiveToolDefinitions: () => ({ a: {}, b: {}, c: {} }),
      getProviderName: () => 'kaneo',
    })
    const snapshot = await collectContext('user1', deps)
    const tools = snapshot.sections.find((s) => s.label === 'Tools')!
    expect(tools.detail).toBe('3 active, gated by kaneo')
  })

  test('returns maxTokens=null for unknown model', async () => {
    const deps = makeDeps({ getMainModel: () => 'some-random-new-model' })
    const snapshot = await collectContext('user1', deps)
    expect(snapshot.maxTokens).toBeNull()
  })

  test('returns maxTokens for known model prefix', async () => {
    const deps = makeDeps({ getMainModel: () => 'gpt-4o-2024-08-06' })
    const snapshot = await collectContext('user1', deps)
    expect(snapshot.maxTokens).toBe(128_000)
  })

  test('sets approximate=true when tokenizer throws', async () => {
    const deps = makeDeps({
      countTokens: () => {
        throw new Error('encoding failed')
      },
    })
    const snapshot = await collectContext('user1', deps)
    expect(snapshot.approximate).toBe(true)
    // Falls back to char/4 — must still produce non-zero counts for non-empty sections
    expect(snapshot.totalTokens).toBeGreaterThan(0)
  })

  test('handles completely empty state', async () => {
    const snapshot = await collectContext('user1', makeDeps())
    expect(snapshot.sections.find((s) => s.label === 'Memory context')?.tokens).toBe(0)
    expect(snapshot.sections.find((s) => s.label === 'Conversation history')?.tokens).toBe(0)
  })
})

describe('resolveEncodingName', () => {
  test('picks o200k_base for GPT-4o family', () => {
    expect(resolveEncodingName('gpt-4o')).toBe('o200k_base')
    expect(resolveEncodingName('gpt-4o-mini')).toBe('o200k_base')
    expect(resolveEncodingName('gpt-4.1')).toBe('o200k_base')
    expect(resolveEncodingName('o1-preview')).toBe('o200k_base')
    expect(resolveEncodingName('o3-mini')).toBe('o200k_base')
  })

  test('falls back to cl100k_base', () => {
    expect(resolveEncodingName('gpt-4-turbo')).toBe('cl100k_base')
    expect(resolveEncodingName('claude-sonnet-4-20250514')).toBe('cl100k_base')
    expect(resolveEncodingName('some-random-thing')).toBe('cl100k_base')
  })
})

describe('resolveMaxTokens', () => {
  test('matches exact known models', () => {
    expect(resolveMaxTokens('gpt-4o')).toBe(128_000)
    expect(resolveMaxTokens('gpt-4.1')).toBe(1_048_576)
  })

  test('matches by longest prefix', () => {
    expect(resolveMaxTokens('gpt-4o-2024-08-06')).toBe(128_000)
    expect(resolveMaxTokens('gpt-4.1-mini-preview')).toBe(1_048_576)
  })

  test('returns null for unknown', () => {
    expect(resolveMaxTokens('weird-model-name')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun test tests/commands/context-collector.test.ts
```

Expected: FAIL — cannot find module `../../src/commands/context-collector.js`.

- [ ] **Step 3: Implement the collector**

Create `src/commands/context-collector.ts`:

```typescript
import type { ModelMessage } from 'ai'

import type { ContextSection, ContextSnapshot } from '../chat/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:context-collector' })

type Fact = { identifier: string; title: string; url: string; last_seen: string }

export interface ContextCollectorDeps {
  /** Get the user's configured model name, or null if unset. */
  getMainModel: () => string | null
  /** Full system prompt the LLM would see. */
  buildSystemPrompt: () => string
  /** Custom instructions block (empty string when none). */
  buildInstructionsBlock: () => string
  /** Provider-specific prompt addendum (empty string when none). */
  getProviderAddendum: () => string
  /** Conversation history as the LLM would see it. */
  getHistory: () => readonly ModelMessage[]
  /** Assembled memory context message (null when none). */
  getMemoryMessage: () => string | null
  /** Raw summary string (null when none). */
  getSummary: () => string | null
  /** Known entities (facts). */
  getFacts: () => readonly Fact[]
  /** Active tool definitions the LLM would see (Vercel AI SDK ToolSet). */
  getActiveToolDefinitions: () => Record<string, unknown>
  /** Task provider name for the "gated by" detail line. */
  getProviderName: () => string
  /** Token counter. May throw on encoding load failure — caller handles the fallback. */
  countTokens: (text: string) => number
}

const FALLBACK_MODEL = 'unknown'

const MODEL_CONTEXT_WINDOWS: ReadonlyArray<readonly [prefix: string, tokens: number]> = [
  // Sorted so longer prefixes match first.
  ['gpt-4.1-nano', 1_048_576],
  ['gpt-4.1-mini', 1_048_576],
  ['gpt-4.1', 1_048_576],
  ['gpt-4o-mini', 128_000],
  ['gpt-4o', 128_000],
  ['gpt-4-turbo', 128_000],
  ['o4-mini', 200_000],
  ['o3-mini', 200_000],
  ['o1-preview', 128_000],
  ['o1-mini', 128_000],
  ['o1', 200_000],
  ['claude-haiku-4-5', 200_000],
  ['claude-sonnet-4', 200_000],
  ['claude-opus-4', 200_000],
]

export function resolveEncodingName(modelName: string): 'o200k_base' | 'cl100k_base' {
  if (/gpt-4o|gpt-4\.1|^o1|^o3|^o4/.test(modelName)) return 'o200k_base'
  return 'cl100k_base'
}

export function resolveMaxTokens(modelName: string): number | null {
  for (const [prefix, tokens] of MODEL_CONTEXT_WINDOWS) {
    if (modelName.startsWith(prefix)) return tokens
  }
  return null
}

function serializeMessage(message: ModelMessage): string {
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  return `${message.role}: ${content}`
}

function serializeHistory(history: readonly ModelMessage[]): string {
  return history.map(serializeMessage).join('\n')
}

function serializeTools(tools: Record<string, unknown>): string {
  try {
    return JSON.stringify(tools)
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to serialize tools')
    return Object.keys(tools).join(',')
  }
}

type SafeCounter = { count: (text: string) => number; approximate: boolean }

function makeSafeCounter(raw: (text: string) => number): SafeCounter {
  let approximate = false
  return {
    count: (text: string): number => {
      if (text.length === 0) return 0
      if (approximate) return Math.ceil(text.length / 4)
      try {
        return raw(text)
      } catch (error) {
        approximate = true
        log.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'Tokenizer threw, falling back to char/4 estimate',
        )
        return Math.ceil(text.length / 4)
      }
    },
    get approximate(): boolean {
      return approximate
    },
  }
}

function buildSystemPromptSection(deps: ContextCollectorDeps, counter: SafeCounter): ContextSection {
  const fullPrompt = deps.buildSystemPrompt()
  const customInstructions = deps.buildInstructionsBlock()
  const addendum = deps.getProviderAddendum()
  // Base instructions = the body after stripping custom instructions and addendum.
  // buildSystemPrompt composes as `${customInstructions}${BASE_PROMPT}${addendum}`,
  // so base-instructions tokens ≈ full - custom - addendum.
  // Note: BPE tokenization is not strictly additive (count(A+B) != count(A) + count(B))
  // due to token boundary effects. This is an approximation for display purposes.
  const totalTokens = counter.count(fullPrompt)
  const customTokens = counter.count(customInstructions)
  const addendumTokens = counter.count(addendum)
  const baseTokens = Math.max(0, totalTokens - customTokens - addendumTokens)

  const children: ContextSection[] = [{ label: 'Base instructions', tokens: baseTokens }]
  if (customTokens > 0) children.push({ label: 'Custom instructions', tokens: customTokens })
  if (addendumTokens > 0) children.push({ label: 'Provider addendum', tokens: addendumTokens })

  return { label: 'System prompt', tokens: totalTokens, children }
}

function buildMemorySection(deps: ContextCollectorDeps, counter: SafeCounter): ContextSection {
  const memoryMessage = deps.getMemoryMessage()
  const summary = deps.getSummary() ?? ''
  const facts = deps.getFacts()
  const factText = facts.map((f) => `${f.identifier}: ${f.title}`).join('\n')

  const totalTokens =
    memoryMessage === null ? counter.count(summary) + counter.count(factText) : counter.count(memoryMessage)
  const summaryTokens = counter.count(summary)
  const factsTokens = counter.count(factText)

  const children: ContextSection[] = [{ label: 'Summary', tokens: summaryTokens }]
  const factsChild: ContextSection = {
    label: 'Known entities',
    tokens: factsTokens,
    detail: `${String(facts.length)} fact${facts.length === 1 ? '' : 's'}`,
  }
  children.push(factsChild)

  return { label: 'Memory context', tokens: totalTokens, children }
}

function buildHistorySection(deps: ContextCollectorDeps, counter: SafeCounter): ContextSection {
  const history = deps.getHistory()
  const tokens = counter.count(serializeHistory(history))
  return {
    label: 'Conversation history',
    tokens,
    detail: `${String(history.length)} message${history.length === 1 ? '' : 's'}`,
  }
}

function buildToolsSection(deps: ContextCollectorDeps, counter: SafeCounter): ContextSection {
  const tools = deps.getActiveToolDefinitions()
  const count = Object.keys(tools).length
  const providerName = deps.getProviderName()
  const tokens = counter.count(serializeTools(tools))
  return {
    label: 'Tools',
    tokens,
    detail: `${String(count)} active, gated by ${providerName}`,
  }
}

export async function collectContext(contextId: string, deps: ContextCollectorDeps): Promise<ContextSnapshot> {
  log.debug({ contextId }, 'collectContext called')
  const modelName = deps.getMainModel() ?? FALLBACK_MODEL
  const counter = makeSafeCounter(deps.countTokens)

  const sections: ContextSection[] = [
    buildSystemPromptSection(deps, counter),
    buildMemorySection(deps, counter),
    buildHistorySection(deps, counter),
    buildToolsSection(deps, counter),
  ]

  const totalTokens = sections.reduce((acc, s) => acc + s.tokens, 0)
  const maxTokens = resolveMaxTokens(modelName)

  log.info(
    {
      contextId,
      modelName,
      totalTokens,
      maxTokens,
      approximate: counter.approximate,
      sectionTokens: sections.map((s) => ({ label: s.label, tokens: s.tokens })),
    },
    'Context collected',
  )

  return { modelName, sections, totalTokens, maxTokens, approximate: counter.approximate }
}
```

- [ ] **Step 4: Run to verify it passes**

Run:

```bash
bun test tests/commands/context-collector.test.ts
```

Expected: PASS on all tests. If any test fails because of how `buildSystemPromptSection` splits tokens, inspect the calculation — base tokens are derived as `total − custom − addendum`, which depends on `countTokens` being additive (which it is for the test's `length`-based stub).

- [ ] **Step 5: Commit**

```bash
git add src/commands/context-collector.ts tests/commands/context-collector.test.ts
git commit -m "feat(commands): add context collector with DI-driven token counting"
```

---

### Task 6: Wire the collector's `countTokens` to `ai-tokenizer`

**Files:**

- Modify: `src/commands/context-collector.ts`
- Modify: `tests/commands/context-collector.test.ts` (smoke test for the real tokenizer)

The collector accepts `countTokens` via DI for easy testing, but production needs a real implementation backed by `ai-tokenizer`. We expose it as `defaultCountTokens` and let callers pass it in.

- [ ] **Step 1: Write the failing smoke test**

Append to `tests/commands/context-collector.test.ts`:

```typescript
import { defaultCountTokens } from '../../src/commands/context-collector.js'

describe('defaultCountTokens', () => {
  test('returns a positive integer for non-empty text', () => {
    const n = defaultCountTokens('hello world', 'cl100k_base')
    expect(Number.isInteger(n)).toBe(true)
    expect(n).toBeGreaterThan(0)
  })

  test('returns 0 for empty text', () => {
    expect(defaultCountTokens('', 'cl100k_base')).toBe(0)
  })

  test('o200k_base encoding works', () => {
    const n = defaultCountTokens('hello world', 'o200k_base')
    expect(n).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun test tests/commands/context-collector.test.ts
```

Expected: FAIL on the three new tests — `defaultCountTokens` is not exported.

- [ ] **Step 3: Add `defaultCountTokens` to the collector**

At the top of `src/commands/context-collector.ts`, below the existing imports, add:

```typescript
import type { Tokenizer } from 'ai-tokenizer'
```

Then add these two helpers below `resolveMaxTokens` (but above `serializeMessage`):

```typescript
type EncodingName = 'o200k_base' | 'cl100k_base'

const tokenizerCache = new Map<EncodingName, Tokenizer>()

async function loadTokenizer(encoding: EncodingName): Promise<Tokenizer> {
  const cached = tokenizerCache.get(encoding)
  if (cached !== undefined) return cached
  const { Tokenizer: TokenizerCtor } = await import('ai-tokenizer')
  const encodingModule =
    encoding === 'o200k_base'
      ? await import('ai-tokenizer/encoding/o200k_base')
      : await import('ai-tokenizer/encoding/cl100k_base')
  const tokenizer = new TokenizerCtor(encodingModule)
  tokenizerCache.set(encoding, tokenizer)
  return tokenizer
}

/**
 * Synchronous wrapper used by the collector. On first call per encoding,
 * throws with a special marker so the caller can lazy-load via `prepareDefaultCountTokens`.
 */
export function defaultCountTokens(text: string, encoding: EncodingName): number {
  if (text.length === 0) return 0
  const tokenizer = tokenizerCache.get(encoding)
  if (tokenizer === undefined) {
    throw new Error(`tokenizer not loaded: ${encoding}`)
  }
  return tokenizer.count(text)
}

/**
 * Preload a tokenizer for the given encoding. Must be called before `collectContext`
 * uses the synchronous `defaultCountTokens`.
 */
export async function prepareDefaultCountTokens(encoding: EncodingName): Promise<void> {
  await loadTokenizer(encoding)
}
```

The reason for splitting prepare and count: `collectContext` is `async`, so we can `await prepareDefaultCountTokens` first, then hand `(text) => defaultCountTokens(text, encoding)` as the synchronous DI callback. If the `ai-tokenizer` import shape turns out to differ (see Task 1 Step 3), adjust `loadTokenizer` to match its real public API — but keep the same public shape (`defaultCountTokens(text, encoding)` / `prepareDefaultCountTokens(encoding)`).

- [ ] **Step 4: Run the smoke test**

Run:

```bash
bun test tests/commands/context-collector.test.ts
```

Expected: the three `defaultCountTokens` tests FAIL with `tokenizer not loaded` because we never called `prepareDefaultCountTokens`. Update the test to preload first:

```typescript
describe('defaultCountTokens', () => {
  beforeEach(async () => {
    await prepareDefaultCountTokens('cl100k_base')
    await prepareDefaultCountTokens('o200k_base')
  })

  test('returns a positive integer for non-empty text', () => {
    const n = defaultCountTokens('hello world', 'cl100k_base')
    expect(Number.isInteger(n)).toBe(true)
    expect(n).toBeGreaterThan(0)
  })

  test('returns 0 for empty text', () => {
    expect(defaultCountTokens('', 'cl100k_base')).toBe(0)
  })

  test('o200k_base encoding works', () => {
    const n = defaultCountTokens('hello world', 'o200k_base')
    expect(n).toBeGreaterThan(0)
  })
})
```

Also add `prepareDefaultCountTokens` to the existing import line near the top of the test file.

Run again:

```bash
bun test tests/commands/context-collector.test.ts
```

Expected: PASS on all tests.

If the tokenizer tests still fail because of an unexpected `ai-tokenizer` API shape, consult the package's README and fix `loadTokenizer`. The signature `tokenizer.count(text)` is from the project's public docs; if the real method is `tokenizer.countTokens(text)` or `encode(text).length`, adjust `defaultCountTokens` accordingly and do **not** change its public signature.

- [ ] **Step 5: Commit**

```bash
git add src/commands/context-collector.ts tests/commands/context-collector.test.ts
git commit -m "feat(commands): wire ai-tokenizer into context collector as default counter"
```

---

### Task 7: Rewrite the `/context` command handler

**Files:**

- Modify: `src/commands/context.ts`
- Modify: `src/bot.ts`
- Create: `tests/commands/context.test.ts` (expand the stub from Task 3)

The new handler:

1. Loads user config for `main_model`, active tools, and history via the production modules.
2. Builds a `ContextCollectorDeps` that plugs in the real helpers.
3. Calls `collectContext` and `chat.renderContext`.
4. Dispatches the rendered result via `reply.embed`, `reply.formatted`, or `reply.text`.

- [ ] **Step 1: Replace the stub test file**

Overwrite `tests/commands/context.test.ts` with:

```typescript
import { describe, expect, test, beforeEach } from 'bun:test'

import type { ChatProvider, ContextSnapshot, CommandHandler } from '../../src/chat/types.js'
import { registerContextCommand } from '../../src/commands/context.js'
import { createAuth, createDmMessage, createMockChat, createMockReply, mockLogger } from '../utils/test-helpers.js'

function captureCommand(chat: ChatProvider, commands: Map<string, CommandHandler>): CommandHandler {
  const handler = commands.get('context')
  if (handler === undefined) {
    throw new Error('context command not registered')
  }
  return handler
}

const snapshotDeps = (
  overrides?: Partial<import('../../src/commands/context.js').ContextCommandDeps>,
): import('../../src/commands/context.js').ContextCommandDeps => ({
  collectContext: async (): Promise<ContextSnapshot> => ({
    modelName: 'gpt-4o',
    sections: [
      { label: 'System prompt', tokens: 1000 },
      { label: 'Memory context', tokens: 500 },
      { label: 'Conversation history', tokens: 2000 },
      { label: 'Tools', tokens: 3000 },
    ],
    totalTokens: 6500,
    maxTokens: 128_000,
    approximate: false,
  }),
  ...overrides,
})

describe('registerContextCommand', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('available to non-admin users', async () => {
    const commands = new Map<string, CommandHandler>()
    const chat = createMockChat({ commandHandlers: commands })
    registerContextCommand(chat, snapshotDeps())

    const handler = captureCommand(chat, commands)
    const { reply, textCalls } = createMockReply()
    const msg = createDmMessage('some-regular-user')
    const auth = createAuth('some-regular-user', { isBotAdmin: false })

    await handler(msg, reply, auth)

    expect(textCalls.length).toBeGreaterThan(0)
  })

  test('does not reject unauthorized users before the bot dispatcher (auth gate is upstream)', async () => {
    const commands = new Map<string, CommandHandler>()
    const chat = createMockChat({ commandHandlers: commands })
    registerContextCommand(chat, snapshotDeps())

    const handler = captureCommand(chat, commands)
    const { reply, textCalls } = createMockReply()
    const msg = createDmMessage('user1')
    const auth = createAuth('user1', { allowed: false })

    await handler(msg, reply, auth)

    // Handler itself must return early on !auth.allowed without sending anything.
    expect(textCalls.length).toBe(0)
  })

  test('dispatches text output via reply.text', async () => {
    const commands = new Map<string, CommandHandler>()
    const chat: ChatProvider = {
      ...createMockChat({ commandHandlers: commands }),
      renderContext: () => ({ method: 'text', content: 'RAW TEXT PAYLOAD' }),
    }
    registerContextCommand(chat, snapshotDeps())
    const handler = captureCommand(chat, commands)

    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage('user1'), reply, createAuth('user1'))

    expect(textCalls).toContain('RAW TEXT PAYLOAD')
  })

  test('dispatches formatted output via reply.formatted', async () => {
    const commands = new Map<string, CommandHandler>()
    const chat: ChatProvider = {
      ...createMockChat({ commandHandlers: commands }),
      renderContext: () => ({ method: 'formatted', content: '**markdown**' }),
    }
    registerContextCommand(chat, snapshotDeps())
    const handler = captureCommand(chat, commands)

    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage('user1'), reply, createAuth('user1'))

    // Our updated createMockReply records formatted calls in textCalls.
    expect(textCalls).toContain('**markdown**')
  })

  test('dispatches embed output via reply.embed when available', async () => {
    const commands = new Map<string, CommandHandler>()
    const chat: ChatProvider = {
      ...createMockChat({ commandHandlers: commands }),
      renderContext: () => ({
        method: 'embed',
        embed: {
          title: 'Context · gpt-4o',
          description: '🟦🟦⬜',
          footer: '6,500 / 128,000 tokens',
          color: 0x2ecc71,
        },
      }),
    }
    registerContextCommand(chat, snapshotDeps())
    const handler = captureCommand(chat, commands)

    const { reply, embedCalls } = createMockReply()
    await handler(createDmMessage('user1'), reply, createAuth('user1'))

    expect(embedCalls).toHaveLength(1)
    expect(embedCalls[0]?.title).toBe('Context · gpt-4o')
  })

  test('falls back to reply.formatted when embed is requested but reply.embed is undefined', async () => {
    const commands = new Map<string, CommandHandler>()
    const chat: ChatProvider = {
      ...createMockChat({ commandHandlers: commands }),
      renderContext: () => ({
        method: 'embed',
        embed: {
          title: 'Context · gpt-4o',
          description: '🟦🟦⬜',
          footer: '6,500 / 128,000 tokens',
        },
      }),
    }
    registerContextCommand(chat, snapshotDeps())
    const handler = captureCommand(chat, commands)

    const { reply, textCalls } = createMockReply()
    delete (reply as { embed?: unknown }).embed
    await handler(createDmMessage('user1'), reply, createAuth('user1'))

    // Fallback should render something containing the title and description
    expect(textCalls.some((t) => t.includes('Context · gpt-4o'))).toBe(true)
    expect(textCalls.some((t) => t.includes('🟦🟦⬜'))).toBe(true)
  })

  test('reports collector errors with a friendly text message', async () => {
    const commands = new Map<string, CommandHandler>()
    const chat = createMockChat({ commandHandlers: commands })
    registerContextCommand(
      chat,
      snapshotDeps({
        collectContext: async () => {
          throw new Error('boom')
        },
      }),
    )
    const handler = captureCommand(chat, commands)

    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage('user1'), reply, createAuth('user1'))

    expect(textCalls.length).toBe(1)
    expect(textCalls[0]).toMatch(/could not build context view/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun test tests/commands/context.test.ts
```

Expected: FAIL — `registerContextCommand` still has the two-arg `(chat, adminUserId)` signature and imports from the old implementation.

- [ ] **Step 3: Replace `src/commands/context.ts` with the new implementation**

Overwrite the whole file with:

```typescript
import type { ModelMessage } from 'ai'

import { getCachedTools } from '../cache.js'
import type { ChatProvider, ContextRendered, ContextSnapshot } from '../chat/types.js'
import { getConfig } from '../config.js'
import { buildMessagesWithMemory } from '../conversation.js'
import { loadHistory } from '../history.js'
import { buildInstructionsBlock } from '../instructions.js'
import { logger } from '../logger.js'
import { loadFacts, loadSummary } from '../memory.js'
import { buildProviderForUser } from '../providers/factory.js'
import type { TaskProvider } from '../providers/types.js'
import { buildSystemPrompt } from '../system-prompt.js'
import { makeTools } from '../tools/index.js'

import {
  collectContext as defaultCollectContext,
  defaultCountTokens,
  prepareDefaultCountTokens,
  resolveEncodingName,
  type ContextCollectorDeps,
} from './context-collector.js'

const log = logger.child({ scope: 'commands:context' })

export interface ContextCommandDeps {
  /** The collector entry point — swap for tests. */
  collectContext: (contextId: string, collectorDeps: ContextCollectorDeps) => Promise<ContextSnapshot>
}

const defaultDeps: ContextCommandDeps = {
  collectContext: defaultCollectContext,
}

function safeBuildProvider(contextId: string): TaskProvider | null {
  try {
    return buildProviderForUser(contextId, false)
  } catch (error) {
    log.warn(
      { contextId, error: error instanceof Error ? error.message : String(error) },
      'Provider unavailable while building context view',
    )
    return null
  }
}

function buildMemoryMessageText(contextId: string, history: readonly ModelMessage[]): string | null {
  const { memoryMsg } = buildMessagesWithMemory(contextId, history)
  return memoryMsg === null ? null : memoryMsg.content
}

function buildCollectorDeps(contextId: string, provider: TaskProvider | null): ContextCollectorDeps {
  const modelName = getConfig(contextId, 'main_model')
  const encoding = resolveEncodingName(modelName ?? 'unknown')

  return {
    getMainModel: () => modelName,
    buildSystemPrompt: () =>
      provider === null ? buildInstructionsBlock(contextId) : buildSystemPrompt(provider, contextId),
    buildInstructionsBlock: () => buildInstructionsBlock(contextId),
    getProviderAddendum: () => (provider === null ? '' : provider.getPromptAddendum()),
    getHistory: () => loadHistory(contextId),
    getMemoryMessage: () => buildMemoryMessageText(contextId, loadHistory(contextId)),
    getSummary: () => loadSummary(contextId),
    getFacts: () => loadFacts(contextId),
    getActiveToolDefinitions: () => {
      const cached = getCachedTools(contextId)
      if (cached !== undefined && cached !== null) return cached as Record<string, unknown>
      if (provider === null) return {}
      return makeTools(provider, { storageContextId: contextId, chatUserId: contextId, mode: 'normal' }) as Record<
        string,
        unknown
      >
    },
    getProviderName: () => provider?.name ?? 'none',
    countTokens: (text: string): number => defaultCountTokens(text, encoding),
  }
}

function renderFallback(rendered: ContextRendered & { method: 'embed' }): string {
  const lines: string[] = []
  lines.push(rendered.embed.title)
  lines.push('')
  lines.push(rendered.embed.description)
  if (rendered.embed.fields !== undefined) {
    lines.push('')
    for (const field of rendered.embed.fields) {
      lines.push(`${field.name}: ${field.value}`)
    }
  }
  if (rendered.embed.footer !== undefined) {
    lines.push('')
    lines.push(rendered.embed.footer)
  }
  return lines.join('\n')
}

export function registerContextCommand(chat: ChatProvider, deps: ContextCommandDeps = defaultDeps): void {
  chat.registerCommand('context', async (msg, reply, auth) => {
    if (!auth.allowed) return

    log.debug({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/context command called')

    let snapshot: ContextSnapshot
    try {
      const modelName = getConfig(auth.storageContextId, 'main_model')
      if (modelName !== null) {
        await prepareDefaultCountTokens(resolveEncodingName(modelName))
      } else {
        await prepareDefaultCountTokens('cl100k_base')
      }
      const provider = safeBuildProvider(auth.storageContextId)
      const collectorDeps = buildCollectorDeps(auth.storageContextId, provider)
      snapshot = await deps.collectContext(auth.storageContextId, collectorDeps)
    } catch (error) {
      log.warn(
        {
          userId: msg.user.id,
          storageContextId: auth.storageContextId,
          error: error instanceof Error ? error.message : String(error),
        },
        '/context collector failed',
      )
      await reply.text('Sorry — could not build context view right now.')
      return
    }

    const rendered = chat.renderContext(snapshot)

    if (rendered.method === 'embed') {
      if (reply.embed !== undefined) {
        await reply.embed(rendered.embed)
      } else {
        await reply.formatted(renderFallback(rendered))
      }
    } else if (rendered.method === 'formatted') {
      await reply.formatted(rendered.content)
    } else {
      await reply.text(rendered.content)
    }

    log.info(
      {
        userId: msg.user.id,
        storageContextId: auth.storageContextId,
        totalTokens: snapshot.totalTokens,
        maxTokens: snapshot.maxTokens,
        method: rendered.method,
        approximate: snapshot.approximate,
      },
      '/context command executed',
    )
  })
}
```

- [ ] **Step 4: Update `bot.ts` to drop `adminUserId`**

In `src/bot.ts`, find line 51:

```typescript
registerContextCommand(chat, adminUserId)
```

Replace with:

```typescript
registerContextCommand(chat)
```

`adminUserId` is still used by the other calls (`registerClearCommand`, `registerAdminCommands`) so don't remove the parameter from `registerCommands` itself.

- [ ] **Step 5: Run the command tests**

Run:

```bash
bun test tests/commands/context.test.ts
```

Expected: PASS on all seven tests.

Note: the two sanity tests from Task 3 (`createMockReply exposes an embed stub` and `createMockChat implements renderContext`) should either be removed or left alone if you want to keep them. Either is fine.

- [ ] **Step 6: Run typecheck**

Run:

```bash
bun typecheck
```

Expected: the only remaining type errors are on `TelegramChatProvider`, `DiscordChatProvider`, and `MattermostChatProvider` missing `renderContext`. All other `ChatProvider` consumers should now compile.

- [ ] **Step 7: Commit**

```bash
git add src/commands/context.ts src/bot.ts tests/commands/context.test.ts
git commit -m "feat(commands): rewrite /context as visual snapshot dispatcher"
```

---

### Task 8: Telegram context renderer

**Files:**

- Create: `src/chat/telegram/context-renderer.ts`
- Create: `tests/chat/telegram/context-renderer.test.ts`
- Modify: `src/chat/telegram/index.ts`

Telegram output: one message. Header line (plain text), blank line, emoji grid (inline), blank line, monospace code block with the detail breakdown.

- [ ] **Step 1: Write the failing test**

Create `tests/chat/telegram/context-renderer.test.ts`:

````typescript
import { describe, expect, test } from 'bun:test'

import type { ContextSnapshot } from '../../../src/chat/types.js'
import { renderTelegramContext } from '../../../src/chat/telegram/context-renderer.js'

const snapshot: ContextSnapshot = {
  modelName: 'gpt-4o',
  totalTokens: 6_770,
  maxTokens: 128_000,
  approximate: false,
  sections: [
    {
      label: 'System prompt',
      tokens: 820,
      children: [
        { label: 'Base instructions', tokens: 650 },
        { label: 'Custom instructions', tokens: 120 },
        { label: 'Provider addendum', tokens: 50 },
      ],
    },
    {
      label: 'Memory context',
      tokens: 350,
      children: [
        { label: 'Summary', tokens: 180 },
        { label: 'Known entities', tokens: 170, detail: '12 facts' },
      ],
    },
    { label: 'Conversation history', tokens: 2_400, detail: '34 messages' },
    { label: 'Tools', tokens: 3_200, detail: '18 active, gated by kaneo' },
  ],
}

describe('renderTelegramContext', () => {
  test('returns a text method result', () => {
    const result = renderTelegramContext(snapshot)
    expect(result.method).toBe('text')
  })

  test('contains header with model and usage', () => {
    const result = renderTelegramContext(snapshot)
    if (result.method !== 'text') throw new Error('expected text')
    expect(result.content).toContain('gpt-4o')
    expect(result.content).toContain('6,770')
    expect(result.content).toContain('128,000')
    expect(result.content).toMatch(/5\.\d%/)
  })

  test('contains the emoji grid', () => {
    const result = renderTelegramContext(snapshot)
    if (result.method !== 'text') throw new Error('expected text')
    expect(result.content).toContain('🟦')
    expect(result.content).toContain('⬜')
  })

  test('wraps detail section in a code block', () => {
    const result = renderTelegramContext(snapshot)
    if (result.method !== 'text') throw new Error('expected text')
    expect(result.content).toContain('```')
    expect(result.content).toContain('System prompt')
    expect(result.content).toContain('820')
    expect(result.content).toContain('Conversation history')
    expect(result.content).toContain('34 messages')
  })

  test('omits percentage when maxTokens is null', () => {
    const result = renderTelegramContext({ ...snapshot, maxTokens: null })
    if (result.method !== 'text') throw new Error('expected text')
    expect(result.content).not.toMatch(/%/)
    expect(result.content).toContain('6,770 tokens')
  })

  test('notes approximate counts when applicable', () => {
    const result = renderTelegramContext({ ...snapshot, approximate: true })
    if (result.method !== 'text') throw new Error('expected text')
    expect(result.content).toMatch(/approximate/i)
  })
})
````

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun test tests/chat/telegram/context-renderer.test.ts
```

Expected: FAIL — cannot find module `../../../src/chat/telegram/context-renderer.js`.

- [ ] **Step 3: Implement the Telegram renderer**

Create `src/chat/telegram/context-renderer.ts`:

```typescript
import type { ContextRendered, ContextSection, ContextSnapshot } from '../types.js'
import { buildContextGrid } from '../../commands/context-grid.js'

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function buildHeader(snapshot: ContextSnapshot): string {
  const total = formatNumber(snapshot.totalTokens)
  if (snapshot.maxTokens === null) {
    return `Context · ${snapshot.modelName} · ${total} tokens`
  }
  const max = formatNumber(snapshot.maxTokens)
  const pct = ((snapshot.totalTokens / snapshot.maxTokens) * 100).toFixed(1)
  return `Context · ${snapshot.modelName} · ${total} / ${max} tokens (${pct}%)`
}

function formatSectionLine(section: ContextSection, indent: number): string {
  const pad = ' '.repeat(indent)
  const tokens = `${formatNumber(section.tokens)} tk`
  return `${pad}${section.label.padEnd(24 - indent)} ${tokens.padStart(10)}`
}

function buildDetail(snapshot: ContextSnapshot): string {
  const lines: string[] = []
  for (const section of snapshot.sections) {
    lines.push(formatSectionLine(section, 0))
    if (section.children !== undefined) {
      for (const child of section.children) {
        lines.push(formatSectionLine(child, 2))
      }
    }
    if (section.detail !== undefined) {
      lines.push(`  ${section.detail}`)
    }
  }
  return lines.join('\n')
}

export function renderTelegramContext(snapshot: ContextSnapshot): ContextRendered {
  const header = buildHeader(snapshot)
  const grid = buildContextGrid(snapshot)
  const detail = buildDetail(snapshot)
  const footer = snapshot.approximate ? '\n\n_token counts are approximate_' : ''
  const content = `${header}\n\n${grid}\n\n\`\`\`\n${detail}\n\`\`\`${footer}`
  return { method: 'text', content }
}
```

- [ ] **Step 4: Run the test**

Run:

```bash
bun test tests/chat/telegram/context-renderer.test.ts
```

Expected: PASS on all tests.

- [ ] **Step 5: Wire the renderer into `TelegramChatProvider`**

Open `src/chat/telegram/index.ts`. Add the import alongside the existing ones:

```typescript
import { renderTelegramContext } from './context-renderer.js'
```

Then, in the class body (after `threadCapabilities` and before other members is fine), add:

```typescript
  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return renderTelegramContext(snapshot)
  }
```

Also add the types to the existing `import type { ... } from '../types.js'` block at the top so the return type is known:

```typescript
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  ContextType,
  IncomingFile,
  IncomingMessage,
  ReplyFn,
  ReplyOptions,
  ResolveUserContext,
} from '../types.js'
```

- [ ] **Step 6: Typecheck Telegram**

Run:

```bash
bun typecheck
```

Expected: Telegram errors are gone. Discord and Mattermost still error on missing `renderContext`.

- [ ] **Step 7: Commit**

```bash
git add src/chat/telegram/context-renderer.ts src/chat/telegram/index.ts tests/chat/telegram/context-renderer.test.ts
git commit -m "feat(chat/telegram): implement renderContext with inline grid and monospace detail"
```

---

### Task 9: Mattermost context renderer

**Files:**

- Create: `src/chat/mattermost/context-renderer.ts`
- Create: `tests/chat/mattermost/context-renderer.test.ts`
- Modify: `src/chat/mattermost/index.ts`

Mattermost output: one formatted markdown message with bold header, emoji grid, then a markdown table for the detail.

- [ ] **Step 1: Write the failing test**

Create `tests/chat/mattermost/context-renderer.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import type { ContextSnapshot } from '../../../src/chat/types.js'
import { renderMattermostContext } from '../../../src/chat/mattermost/context-renderer.js'

const snapshot: ContextSnapshot = {
  modelName: 'gpt-4o',
  totalTokens: 6_770,
  maxTokens: 128_000,
  approximate: false,
  sections: [
    {
      label: 'System prompt',
      tokens: 820,
      children: [
        { label: 'Base instructions', tokens: 650 },
        { label: 'Custom instructions', tokens: 120 },
        { label: 'Provider addendum', tokens: 50 },
      ],
    },
    {
      label: 'Memory context',
      tokens: 350,
      children: [
        { label: 'Summary', tokens: 180 },
        { label: 'Known entities', tokens: 170, detail: '12 facts' },
      ],
    },
    { label: 'Conversation history', tokens: 2_400, detail: '34 messages' },
    { label: 'Tools', tokens: 3_200, detail: '18 active, gated by kaneo' },
  ],
}

describe('renderMattermostContext', () => {
  test('returns a formatted method result', () => {
    const result = renderMattermostContext(snapshot)
    expect(result.method).toBe('formatted')
  })

  test('contains bold header with model and usage', () => {
    const result = renderMattermostContext(snapshot)
    if (result.method !== 'formatted') throw new Error('expected formatted')
    expect(result.content).toContain('**Context**')
    expect(result.content).toContain('gpt-4o')
    expect(result.content).toContain('6,770')
    expect(result.content).toContain('128,000')
  })

  test('contains a markdown table', () => {
    const result = renderMattermostContext(snapshot)
    if (result.method !== 'formatted') throw new Error('expected formatted')
    expect(result.content).toContain('| Section')
    expect(result.content).toContain('| ------ | ------')
  })

  test('table rows use section emojis', () => {
    const result = renderMattermostContext(snapshot)
    if (result.method !== 'formatted') throw new Error('expected formatted')
    expect(result.content).toContain('| 🟦 **System prompt**')
    expect(result.content).toContain('| 🟩 **Memory context**')
    expect(result.content).toContain('| 🟨 **Conversation history**')
    expect(result.content).toContain('| 🟪 **Tools**')
  })

  test('contains the emoji grid', () => {
    const result = renderMattermostContext(snapshot)
    if (result.method !== 'formatted') throw new Error('expected formatted')
    expect(result.content).toContain('🟦')
    expect(result.content).toContain('⬜')
  })

  test('notes approximate counts when applicable', () => {
    const result = renderMattermostContext({ ...snapshot, approximate: true })
    if (result.method !== 'formatted') throw new Error('expected formatted')
    expect(result.content).toMatch(/_token counts are approximate_/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun test tests/chat/mattermost/context-renderer.test.ts
```

Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the Mattermost renderer**

Create `src/chat/mattermost/context-renderer.ts`:

```typescript
import type { ContextRendered, ContextSection, ContextSnapshot } from '../types.js'
import { buildContextGrid } from '../../commands/context-grid.js'

const SECTION_EMOJI: Record<string, string> = {
  'System prompt': '🟦',
  'Memory context': '🟩',
  'Conversation history': '🟨',
  Tools: '🟪',
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function buildHeader(snapshot: ContextSnapshot): string {
  const total = formatNumber(snapshot.totalTokens)
  if (snapshot.maxTokens === null) {
    return `**Context** · ${snapshot.modelName} · ${total} tokens`
  }
  const max = formatNumber(snapshot.maxTokens)
  const pct = ((snapshot.totalTokens / snapshot.maxTokens) * 100).toFixed(1)
  return `**Context** · ${snapshot.modelName} · ${total} / ${max} tokens (${pct}%)`
}

function emojiFor(label: string): string {
  return SECTION_EMOJI[label] ?? ' '
}

function topRow(section: ContextSection): string {
  return `| ${emojiFor(section.label)} **${section.label}** | ${formatNumber(section.tokens)} |`
}

function childRow(child: ContextSection): string {
  const label = child.detail === undefined ? child.label : `${child.label} (${child.detail})`
  return `| ↳ ${label} | ${formatNumber(child.tokens)} |`
}

function detailRow(detail: string): string {
  return `| ↳ ${detail} |  |`
}

function buildTable(snapshot: ContextSnapshot): string {
  const lines = ['| Section | Tokens |', '| ------ | ------:|']
  for (const section of snapshot.sections) {
    lines.push(topRow(section))
    if (section.children !== undefined) {
      for (const child of section.children) lines.push(childRow(child))
    }
    if (section.detail !== undefined) lines.push(detailRow(section.detail))
  }
  return lines.join('\n')
}

export function renderMattermostContext(snapshot: ContextSnapshot): ContextRendered {
  const header = buildHeader(snapshot)
  const grid = buildContextGrid(snapshot)
  const table = buildTable(snapshot)
  const footer = snapshot.approximate ? '\n\n_token counts are approximate_' : ''
  return { method: 'formatted', content: `${header}\n\n${grid}\n\n${table}${footer}` }
}
```

- [ ] **Step 4: Run the test**

Run:

```bash
bun test tests/chat/mattermost/context-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire the renderer into `MattermostChatProvider`**

Open `src/chat/mattermost/index.ts`. Update the imports:

```typescript
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  ContextType,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
} from '../types.js'
```

Then add the import:

```typescript
import { renderMattermostContext } from './context-renderer.js'
```

Add the method to the class body:

```typescript
  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return renderMattermostContext(snapshot)
  }
```

- [ ] **Step 6: Typecheck**

Run:

```bash
bun typecheck
```

Expected: Telegram and Mattermost gone from the error list; only Discord remains.

- [ ] **Step 7: Commit**

```bash
git add src/chat/mattermost/context-renderer.ts src/chat/mattermost/index.ts tests/chat/mattermost/context-renderer.test.ts
git commit -m "feat(chat/mattermost): implement renderContext with grid and markdown table"
```

---

### Task 10: Discord `reply.embed` implementation

**Files:**

- Modify: `src/chat/discord/reply-helpers.ts`
- Modify: `tests/chat/discord/reply-helpers.test.ts`

Before the Discord renderer can be used, `reply.embed` must exist. Add it as a new method on `createDiscordReplyFn`'s returned object using discord.js v14's `EmbedBuilder`.

- [ ] **Step 1: Write the failing test**

Open `tests/chat/discord/reply-helpers.test.ts`. Add a new `describe` block at the bottom:

```typescript
describe('createDiscordReplyFn().embed', () => {
  test('sends an embed via channel.send', async () => {
    const sent: unknown[] = []
    const channel = {
      id: 'chan-1',
      send: async (arg: unknown): Promise<{ id: string; edit: () => Promise<unknown> }> => {
        sent.push(arg)
        return { id: 'msg-1', edit: () => Promise.resolve(undefined) }
      },
      sendTyping: () => Promise.resolve(undefined),
    }
    const { createDiscordReplyFn } = await import('../../../src/chat/discord/reply-helpers.js')
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })

    expect(reply.embed).toBeDefined()
    await reply.embed!({
      title: 'Context · gpt-4o',
      description: '🟦🟦⬜',
      fields: [{ name: 'System prompt', value: '820 tk' }],
      footer: '6,770 / 128,000 tokens',
      color: 0x2ecc71,
    })

    expect(sent).toHaveLength(1)
    const payload = sent[0] as { embeds?: unknown[] }
    expect(Array.isArray(payload.embeds)).toBe(true)
    expect(payload.embeds).toHaveLength(1)
  })

  test('handles embeds without optional fields', async () => {
    const sent: unknown[] = []
    const channel = {
      id: 'chan-1',
      send: async (arg: unknown): Promise<{ id: string; edit: () => Promise<unknown> }> => {
        sent.push(arg)
        return { id: 'msg-1', edit: () => Promise.resolve(undefined) }
      },
      sendTyping: () => Promise.resolve(undefined),
    }
    const { createDiscordReplyFn } = await import('../../../src/chat/discord/reply-helpers.js')
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })

    await reply.embed!({
      title: 'Minimal',
      description: 'Just the basics',
    })
    expect(sent).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun test tests/chat/discord/reply-helpers.test.ts
```

Expected: FAIL — `reply.embed` is undefined.

- [ ] **Step 3: Implement `embed` on `createDiscordReplyFn`**

Open `src/chat/discord/reply-helpers.ts`. Update the imports to add `EmbedBuilder`:

```typescript
import { EmbedBuilder } from 'discord.js'

import { logger } from '../../logger.js'
import type { ButtonReplyOptions, ChatFile, EmbedOptions, ReplyFn, ReplyOptions } from '../types.js'
import { toActionRows } from './buttons.js'
import { chunkForDiscord } from './format-chunking.js'
import { formatLlmOutput } from './format.js'
```

Also update `SendableChannel.send` to accept an `embeds` array:

```typescript
export type SendableChannel = {
  id: string
  send: (arg: {
    content?: string
    components?: unknown[]
    embeds?: unknown[]
    reply?: { messageReference: string; failIfNotExists: boolean }
  }) => Promise<{ id: string; edit: (arg: { content?: string; components?: unknown[] }) => Promise<unknown> }>
  sendTyping: () => Promise<void>
}
```

Then add the `embed` method inside the returned object (alongside `buttons`):

```typescript
    embed: async (options: EmbedOptions): Promise<void> => {
      const builder = new EmbedBuilder().setTitle(options.title).setDescription(options.description)
      if (options.fields !== undefined) {
        builder.addFields(options.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline ?? false })))
      }
      if (options.footer !== undefined) {
        builder.setFooter({ text: options.footer })
      }
      if (options.color !== undefined) {
        builder.setColor(options.color)
      }
      const sent = await channel.send({ embeds: [builder.toJSON()] })
      lastBotMessage = sent
    },
```

- [ ] **Step 4: Run the test**

Run:

```bash
bun test tests/chat/discord/reply-helpers.test.ts
```

Expected: PASS on the two new embed tests, plus the existing tests still passing.

- [ ] **Step 5: Commit**

```bash
git add src/chat/discord/reply-helpers.ts tests/chat/discord/reply-helpers.test.ts
git commit -m "feat(chat/discord): add reply.embed method using discord.js EmbedBuilder"
```

---

### Task 11: Discord context renderer

**Files:**

- Create: `src/chat/discord/context-renderer.ts`
- Create: `tests/chat/discord/context-renderer.test.ts`
- Modify: `src/chat/discord/index.ts`

Discord output: an embed with title `Context · <model>`, description = emoji grid, fields for each section, footer = token usage, color based on utilization.

- [ ] **Step 1: Write the failing test**

Create `tests/chat/discord/context-renderer.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import type { ContextSnapshot } from '../../../src/chat/types.js'
import { renderDiscordContext } from '../../../src/chat/discord/context-renderer.js'

const snapshot: ContextSnapshot = {
  modelName: 'gpt-4o',
  totalTokens: 6_770,
  maxTokens: 128_000,
  approximate: false,
  sections: [
    {
      label: 'System prompt',
      tokens: 820,
      children: [
        { label: 'Base instructions', tokens: 650 },
        { label: 'Custom instructions', tokens: 120 },
        { label: 'Provider addendum', tokens: 50 },
      ],
    },
    {
      label: 'Memory context',
      tokens: 350,
      children: [
        { label: 'Summary', tokens: 180 },
        { label: 'Known entities', tokens: 170, detail: '12 facts' },
      ],
    },
    { label: 'Conversation history', tokens: 2_400, detail: '34 messages' },
    { label: 'Tools', tokens: 3_200, detail: '18 active, gated by kaneo' },
  ],
}

describe('renderDiscordContext', () => {
  test('returns embed method with Context title', () => {
    const result = renderDiscordContext(snapshot)
    expect(result.method).toBe('embed')
    if (result.method !== 'embed') throw new Error('expected embed')
    expect(result.embed.title).toBe('Context · gpt-4o')
  })

  test('description contains the emoji grid', () => {
    const result = renderDiscordContext(snapshot)
    if (result.method !== 'embed') throw new Error('expected embed')
    expect(result.embed.description).toContain('🟦')
    expect(result.embed.description).toContain('⬜')
  })

  test('has one field per top-level section', () => {
    const result = renderDiscordContext(snapshot)
    if (result.method !== 'embed') throw new Error('expected embed')
    expect(result.embed.fields?.map((f) => f.name)).toEqual([
      '🟦 System prompt',
      '🟩 Memory context',
      '🟨 Conversation history',
      '🟪 Tools',
    ])
  })

  test('section fields list child tokens in their values', () => {
    const result = renderDiscordContext(snapshot)
    if (result.method !== 'embed') throw new Error('expected embed')
    const systemField = result.embed.fields?.find((f) => f.name === '🟦 System prompt')
    expect(systemField?.value).toContain('820')
    expect(systemField?.value).toContain('Base instructions')
    expect(systemField?.value).toContain('Custom instructions')
    expect(systemField?.value).toContain('Provider addendum')
  })

  test('footer shows tokens + percentage', () => {
    const result = renderDiscordContext(snapshot)
    if (result.method !== 'embed') throw new Error('expected embed')
    expect(result.embed.footer).toContain('6,770')
    expect(result.embed.footer).toContain('128,000')
    expect(result.embed.footer).toMatch(/5\.\d%/)
  })

  test('color is green below 50% usage', () => {
    const result = renderDiscordContext(snapshot)
    if (result.method !== 'embed') throw new Error('expected embed')
    expect(result.embed.color).toBe(0x2ecc71)
  })

  test('color is yellow between 50% and 80% usage', () => {
    const result = renderDiscordContext({ ...snapshot, totalTokens: 80_000 })
    if (result.method !== 'embed') throw new Error('expected embed')
    expect(result.embed.color).toBe(0xf1c40f)
  })

  test('color is red above 80% usage', () => {
    const result = renderDiscordContext({ ...snapshot, totalTokens: 110_000 })
    if (result.method !== 'embed') throw new Error('expected embed')
    expect(result.embed.color).toBe(0xe74c3c)
  })

  test('footer omits percentage when maxTokens is null', () => {
    const result = renderDiscordContext({ ...snapshot, maxTokens: null })
    if (result.method !== 'embed') throw new Error('expected embed')
    expect(result.embed.footer).not.toMatch(/%/)
    expect(result.embed.footer).toContain('6,770 tokens')
  })

  test('notes approximate counts in footer when applicable', () => {
    const result = renderDiscordContext({ ...snapshot, approximate: true })
    if (result.method !== 'embed') throw new Error('expected embed')
    expect(result.embed.footer).toMatch(/approximate/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun test tests/chat/discord/context-renderer.test.ts
```

Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the Discord renderer**

Create `src/chat/discord/context-renderer.ts`:

```typescript
import type { ContextRendered, ContextSection, ContextSnapshot, EmbedField } from '../types.js'
import { buildContextGrid } from '../../commands/context-grid.js'

const COLOR_GREEN = 0x2ecc71
const COLOR_YELLOW = 0xf1c40f
const COLOR_RED = 0xe74c3c

const SECTION_EMOJI: Record<string, string> = {
  'System prompt': '🟦',
  'Memory context': '🟩',
  'Conversation history': '🟨',
  Tools: '🟪',
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function pickColor(snapshot: ContextSnapshot): number | undefined {
  if (snapshot.maxTokens === null) return undefined
  const ratio = snapshot.totalTokens / snapshot.maxTokens
  if (ratio < 0.5) return COLOR_GREEN
  if (ratio < 0.8) return COLOR_YELLOW
  return COLOR_RED
}

function buildFooter(snapshot: ContextSnapshot): string {
  const total = formatNumber(snapshot.totalTokens)
  const approximate = snapshot.approximate ? ' (approximate)' : ''
  if (snapshot.maxTokens === null) {
    return `${total} tokens${approximate}`
  }
  const max = formatNumber(snapshot.maxTokens)
  const pct = ((snapshot.totalTokens / snapshot.maxTokens) * 100).toFixed(1)
  return `${total} / ${max} tokens (${pct}%)${approximate}`
}

function emojiFor(label: string): string {
  return SECTION_EMOJI[label] ?? ' '
}

function buildFieldValue(section: ContextSection): string {
  const lines: string[] = [`${formatNumber(section.tokens)} tokens`]
  if (section.children !== undefined) {
    for (const child of section.children) {
      const suffix = child.detail === undefined ? '' : ` (${child.detail})`
      lines.push(`↳ ${child.label}${suffix}: ${formatNumber(child.tokens)}`)
    }
  }
  if (section.detail !== undefined) {
    lines.push(section.detail)
  }
  return lines.join('\n')
}

function buildFields(snapshot: ContextSnapshot): EmbedField[] {
  return snapshot.sections.map((section) => ({
    name: `${emojiFor(section.label)} ${section.label}`,
    value: buildFieldValue(section),
    inline: false,
  }))
}

export function renderDiscordContext(snapshot: ContextSnapshot): ContextRendered {
  const embed = {
    title: `Context · ${snapshot.modelName}`,
    description: buildContextGrid(snapshot),
    fields: buildFields(snapshot),
    footer: buildFooter(snapshot),
    ...(pickColor(snapshot) !== undefined ? { color: pickColor(snapshot)! } : {}),
  }
  return { method: 'embed', embed }
}
```

- [ ] **Step 4: Run the test**

Run:

```bash
bun test tests/chat/discord/context-renderer.test.ts
```

Expected: PASS on all ten tests.

- [ ] **Step 5: Wire the renderer into `DiscordChatProvider`**

Open `src/chat/discord/index.ts`. Update the imports:

```typescript
import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  ContextRendered,
  ContextSnapshot,
  IncomingMessage,
  ReplyFn,
  ResolveUserContext,
  ThreadCapabilities,
} from '../types.js'
```

Add the renderer import:

```typescript
import { renderDiscordContext } from './context-renderer.js'
```

Add the method to the class body:

```typescript
  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return renderDiscordContext(snapshot)
  }
```

- [ ] **Step 6: Typecheck**

Run:

```bash
bun typecheck
```

Expected: PASS — no errors.

- [ ] **Step 7: Commit**

```bash
git add src/chat/discord/context-renderer.ts src/chat/discord/index.ts tests/chat/discord/context-renderer.test.ts
git commit -m "feat(chat/discord): implement renderContext with embed fields and color coding"
```

---

### Task 12: Full suite verification and final polish

**Files:**

- Run commands only (no source changes unless fixes are needed)

- [ ] **Step 1: Run lint**

Run:

```bash
bun lint
```

Expected: PASS. Fix any oxlint errors in the new files — common ones are `no-unused-vars` on imports and `strict-boolean-expressions` on nullable checks. Remember: never add lint-disable comments.

- [ ] **Step 2: Run format**

Run:

```bash
bun format
```

Then:

```bash
bun format:check
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
bun test
```

Expected: PASS. The most likely failure mode is old tests constructing inline `ChatProvider` literals without `renderContext`. Grep for `name: 'mock'` and fix any that still have an incomplete object literal. Also grep for direct uses of `createMockReply().reply.formatted` in tests that expected it to not be captured (now it populates `textCalls`).

- [ ] **Step 4: Run knip**

Run:

```bash
bun knip
```

Expected: PASS. If knip flags unused exports in `src/commands/context-collector.ts` (e.g., `resolveEncodingName` or `resolveMaxTokens`), confirm they are consumed by `context.ts` or a test. Both functions are tested directly and one is used inside the handler, so knip should accept them.

- [ ] **Step 5: Manual smoke test**

Start the bot against a test user and run `/context` on each platform that is configured in your local env. Confirm:

- Telegram: receives one message with header, inline emoji grid, and a monospace code block.
- Discord: receives a single embed with colored sidebar, description grid, and per-section fields.
- Mattermost: receives one formatted message with bold header, inline emoji grid, and markdown table.

(If you can only test one platform locally, skip the others — CI + unit tests cover the logic.)

- [ ] **Step 6: Final commit**

If any fixes landed in Steps 1-4, commit them:

```bash
git add -A
git commit -m "chore: lint, format, and test fallout from /context redesign"
```

If nothing changed, skip this commit.

---

## Self-Review Results

**Spec coverage:**

- Data Model (ContextSection, ContextSnapshot, ContextRendered) → Task 2 ✓
- Token counting via `ai-tokenizer` with encoding resolution → Tasks 1, 5, 6 ✓
- `MODEL_CONTEXT_WINDOWS` lookup with prefix matching → Task 5 ✓
- Fallback to `chars/4` when tokenizer throws → Task 5 ✓
- Visual grid builder (20×10, min-1-cell, single-row fallback) → Task 4 ✓
- Telegram renderer (inline grid + monospace detail) → Task 8 ✓
- Discord renderer (embed with fields, color coding) → Task 11 ✓
- Mattermost renderer (grid + markdown table) → Task 9 ✓
- `ChatProvider.renderContext` interface extension → Task 2 + 8/9/11 wiring ✓
- `ReplyFn.embed?` optional method → Task 2 + Task 10 implementation ✓
- Command handler dispatches via method kind with embed fallback → Task 7 ✓
- Rewritten handler is available to all authorized users (not admin-only) → Task 7 ✓
- `registerContextCommand(chat)` (no `adminUserId`) → Task 7 Step 4 ✓
- File structure matches spec → all task file paths align ✓
- Testing: collector, grid, command, three renderers, Discord embed method → Tasks 4, 5, 7, 8, 9, 10, 11 ✓

**Placeholder scan:** No TBD, TODO, or "implement later" text. All code blocks are complete. One contingency noted (ai-tokenizer API shape) — Task 6 instructs the implementer to adjust `loadTokenizer` and `defaultCountTokens` wiring without changing public signatures if the real API differs.

**Type consistency:**

- `ContextSnapshot` has `approximate: boolean` — used by Telegram, Discord, Mattermost renderers and test fixtures (all include it).
- `ContextRendered` is a discriminated union on `method`; every `method === 'embed'` branch accesses `.embed`, every `'text'`/`'formatted'` branch accesses `.content` — consistent across handler and renderers.
- `EmbedOptions` fields (`title`, `description`, `fields?`, `footer?`, `color?`) used consistently in Task 2 definition, Task 10 Discord `reply.embed`, and Task 11 Discord renderer.
- `ContextCollectorDeps` fields used in Task 5 implementation match the ones referenced in Task 7 `buildCollectorDeps` (`getMainModel`, `buildSystemPrompt`, `buildInstructionsBlock`, `getProviderAddendum`, `getHistory`, `getMemoryMessage`, `getSummary`, `getFacts`, `getActiveToolDefinitions`, `getProviderName`, `countTokens`).
- `registerContextCommand` signature change from `(chat, adminUserId)` to `(chat, deps?)` — caller in `bot.ts` updated in Task 7 Step 4.

No gaps found.
