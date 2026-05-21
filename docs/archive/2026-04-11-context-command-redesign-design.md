<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# /context Command Redesign

Replaces the admin-only file-export `/context` command with a visual context window display available to all authorized users. Inspired by Claude Code's `/context` — shows a proportional emoji grid of token usage by category, followed by platform-specific detail.

## Goals

- Make `/context` available to all authorized users (not admin-only)
- Replace file upload with inline graphical representation
- Show all four LLM context sources: system prompt, memory, conversation history, tools
- Provide accurate token counts via real tokenization
- Show context window utilization against known model limits
- Render platform-adaptive detail below the shared grid

## Architecture

```
/context handler (src/commands/context.ts)
  --> ContextCollector (src/commands/context-collector.ts)
        --> gathers system prompt, memory, history, tools
        --> tokenizes each section via ai-tokenizer
        --> resolves maxTokens from model name
        --> returns ContextSnapshot
  --> chat.renderContext(snapshot)
        --> platform adapter renders grid + detail
        --> returns ContextRendered { method, content, embedOptions? }
  --> handler dispatches via reply.text / reply.formatted / reply.embed
```

## Data Model

### ContextSection

```typescript
type ContextSection = {
  label: string // "System prompt", "Conversation history", etc.
  tokens: number // actual token count
  detail?: string // e.g. "34 messages (trimmed from 48)"
  children?: ContextSection[]
}
```

### ContextSnapshot

```typescript
type ContextSnapshot = {
  modelName: string
  sections: ContextSection[]
  totalTokens: number
  maxTokens: number | null // null for unknown models
}
```

### Sections tree

```
├── System prompt
│   ├── Base instructions
│   ├── Custom instructions (N)
│   └── Provider addendum
├── Memory context
│   ├── Summary
│   └── Known entities (N)
├── Conversation history
│   └── N messages (trimmed from M)
└── Tools (N active)
    └── Gated by: <provider> provider
```

### ContextRendered

```typescript
type ContextRendered = {
  method: 'text' | 'formatted' | 'embed'
  content: string
  embedOptions?: EmbedOptions
}
```

## Token Counting

### Library

`ai-tokenizer` — pure JS, no WASM, first-class Vercel AI SDK support, >=97% accuracy for major models, 5-7x faster than tiktoken.

### Encoding selection

```typescript
function resolveEncoding(modelName: string): string {
  if (modelName.match(/gpt-4o|gpt-4.1|o1|o3|o4/)) return 'o200k_base'
  return 'cl100k_base' // safe default for Claude, GPT-4, unknowns
}
```

Encoding is lazy-loaded on first use (2-8MB), cached in module scope.

### Model context window map

```typescript
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4.1': 1_048_576,
  'gpt-4.1-mini': 1_048_576,
  'gpt-4.1-nano': 1_048_576,
  'gpt-4-turbo': 128_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  // extensible
}
```

Prefix matching for model variants (e.g. `gpt-4o-2024-08-06` matches `gpt-4o`). Returns `null` for unrecognized models.

### What gets tokenized

Each section's text content is tokenized independently:

- **System prompt:** full string from `buildSystemPrompt()`
- **Custom instructions:** text from `buildInstructionsBlock()`
- **Provider addendum:** string from `provider.getPromptAddendum()`
- **Memory context:** assembled memory message from `buildMessagesWithMemory()`
- **History:** each message serialized as role:content pairs (mirrors what the LLM receives)
- **Tools:** JSON-serialized tool definitions from `getActiveTools()`

### Fallback

If tokenizer fails to load, falls back to `Math.ceil(chars / 4)` and appends a note: "Token counts are approximate."

## Visual Grid

A 20-column grid where each cell represents a proportional chunk of the context window. Uses colored square emoji (inherently colored, renders on all platforms without code blocks):

| Symbol | Category             |
| ------ | -------------------- |
| `🟦`   | System prompt        |
| `🟩`   | Memory context       |
| `🟨`   | Conversation history |
| `🟪`   | Tools                |
| `⬜`   | Free space           |

### Grid sizing

- 20 columns, fixed at 10 rows = 200 cells total
- Each cell = `maxTokens / 200` tokens
- Minimum 1 cell per non-empty category (nothing disappears at small percentages)
- When `maxTokens` is null (unknown model): single-row (20 cells) proportional bar showing only used categories, no free space cells

### Example (6,770 / 128,000 tokens)

```
🟦🟦🟪🟪🟨🟨🟨🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜
⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜
⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜
...
```

## Platform Renderers

Each `ChatProvider` implements a `renderContext(snapshot: ContextSnapshot): ContextRendered` method. The shared grid builder lives in `src/commands/context-grid.ts`.

### ChatProvider interface addition

```typescript
// src/chat/types.ts
interface ChatProvider {
  // ... existing methods ...
  renderContext(snapshot: ContextSnapshot): ContextRendered
}
```

### Telegram

Returns `{ method: 'text' }`. Grid as inline emoji, detail in a monospace code block:

```
Context · gpt-4o · 6,770 / 128,000 tokens (5.3%)

🟦🟦🟪🟪🟨🟨🟨🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜
⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜
...

🟦 System prompt         820 tk
   Base instructions     650 tk
   Custom instructions    120 tk
   Provider addendum       50 tk
🟩 Memory context        350 tk
   Summary               180 tk
   Known entities (12)   170 tk
🟨 Conversation        2,400 tk
   34 messages
🟪 Tools (18 active)   3,200 tk
   Gated by: kaneo
```

Detail section wrapped in a code block for column alignment.

### Discord

Returns `{ method: 'embed', embedOptions: { ... } }`. Uses discord.js embed:

- **Title:** Context · gpt-4o
- **Description:** emoji grid
- **Fields:** one per category with token count and children detail
- **Footer:** `6,770 / 128,000 tokens (5.3%)`
- **Color:** green (#2ecc71) at <50%, yellow (#f1c40f) at 50-80%, red (#e74c3c) at >80%

### Mattermost

Returns `{ method: 'formatted' }`. Grid as inline emoji, detail as a markdown table:

```markdown
**Context** · gpt-4o · 6,770 / 128,000 tokens (5.3%)

🟦🟦🟪🟪🟨🟨🟨🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜
...

| Section                   | Tokens |
| :------------------------ | -----: |
| 🟦 **System prompt**      |    820 |
| ↳ Base instructions       |    650 |
| ↳ Custom instructions (2) |    120 |
| ↳ Provider addendum       |     50 |
| 🟩 **Memory context**     |    350 |
| ↳ Summary                 |    180 |
| ↳ Known entities (12)     |    170 |
| 🟨 **Conversation**       |  2,400 |
| ↳ 34 messages             |        |
| 🟪 **Tools (18 active)**  |  3,200 |
| ↳ Gated by: kaneo         |        |
```

## ReplyFn Extension

### EmbedOptions

```typescript
type EmbedField = {
  name: string
  value: string
  inline?: boolean
}

type EmbedOptions = {
  title: string
  description: string
  fields?: EmbedField[]
  footer?: string
  color?: number
}
```

### ReplyFn addition

```typescript
type ReplyFn = {
  // ... existing ...
  embed?: (options: EmbedOptions) => Promise<void>
}
```

Optional — only Discord implements it. Command handler checks existence before calling, falls back to `reply.formatted()`.

## Command Handler

### Location

`src/commands/context.ts` — replaces current implementation entirely.

### Registration

`registerContextCommand(chat)` — no `adminUserId` parameter. Standard authorization check via `auth.isAuthorized`.

### Flow

1. Verify user is authorized (standard auth, not admin-only)
2. Call `collectContext(storageContextId)`
3. Call `chat.renderContext(snapshot)` to get platform-specific output
4. Dispatch:
   - `embed` + `reply.embed` exists: call `reply.embed(embedOptions)`
   - `formatted`: call `reply.formatted(content)`
   - `text` or fallback: call `reply.text(content)`

### bot.ts change

Remove `adminUserId` from `registerContextCommand()` call signature.

## File Structure

```
src/commands/
  context.ts                          -- handler (rewritten)
  context-collector.ts                -- ContextCollector + types
  context-grid.ts                     -- shared grid builder

src/chat/types.ts                     -- ContextRendered, EmbedOptions, EmbedField types
                                      -- ChatProvider.renderContext() method
                                      -- ReplyFn.embed? addition

src/chat/telegram/context-renderer.ts
src/chat/discord/context-renderer.ts
src/chat/mattermost/context-renderer.ts
```

## Dependency

New: `ai-tokenizer` — pure JS tokenizer with Vercel AI SDK support.

## Testing

### context-collector.ts

- Collects all sections with correct token counts (DI with fake deps)
- Resolves encoding by model name (o200k for GPT-4o family, cl100k fallback)
- Looks up maxTokens for known models, returns null for unknown
- Handles empty state (no history, no summary, no facts, no instructions)
- Falls back to char estimation when tokenizer fails

### context-grid.ts

- Produces correct grid dimensions (20 cols, rows scaled)
- Minimum 1 cell per non-empty category
- Proportional distribution matches token ratios
- Unknown maxTokens produces single-row proportional bar
- Empty context produces all-free grid

### context-renderers (per platform)

- Telegram: returns `{ method: 'text' }` with grid + monospace detail
- Discord: returns `{ method: 'embed' }` with correct embed structure, color thresholds
- Mattermost: returns `{ method: 'formatted' }` with grid + markdown table

### context.ts (handler)

- Available to all authorized users (not admin-gated)
- Calls collector, passes snapshot to renderContext, dispatches by method
- Falls back from embed to formatted when reply.embed undefined

### reply.embed (Discord adapter)

- Translates EmbedOptions to discord.js EmbedBuilder
- Handles missing optional fields

### Not tested

- Actual tokenizer accuracy (ai-tokenizer's responsibility)
- Emoji rendering fidelity (visual QA)
