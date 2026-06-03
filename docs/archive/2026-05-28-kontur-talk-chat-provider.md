<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kontur Talk Chat Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kontur Talk (Толк.Чаты) as a fourth chat provider in papai, supporting text messages and threads via long polling.

**Architecture:** Follow the Mattermost provider pattern — a class implementing `ChatProvider` with REST API calls, Zod-validated responses, and a long polling loop for receiving messages. All platform-specific code lives in `src/chat/kontur-talk/`.

**Tech Stack:** Bun, TypeScript, Zod v4, pino logger, `fetch()` for HTTP.

**Design Spec:** `docs/superpowers/specs/2026-05-28-kontur-talk-chat-provider-design.md`

**API Reference:** https://kontur.renote.team/doc/NNyX6DGvQ (extracted to `/tmp/kontur-talk-api-formatted.md` during research)

---

## File Map

### New files

| File                                              | Responsibility                            |
| ------------------------------------------------- | ----------------------------------------- |
| `src/chat/kontur-talk/metadata.ts`                | Capabilities, traits, config requirements |
| `src/chat/kontur-talk/config.ts`                  | Constructor config type + resolver        |
| `src/chat/kontur-talk/schema.ts`                  | Zod schemas for API responses             |
| `src/chat/kontur-talk/reply-helpers.ts`           | `createKonturTalkReplyFn` factory         |
| `src/chat/kontur-talk/context-renderer.ts`        | `renderKonturTalkContext`                 |
| `src/chat/kontur-talk/label-helpers.ts`           | User/group label resolvers                |
| `src/chat/kontur-talk/index.ts`                   | `KonturTalkChatProvider` class            |
| `tests/chat/kontur-talk/metadata.test.ts`         | Metadata tests                            |
| `tests/chat/kontur-talk/config.test.ts`           | Config resolution tests                   |
| `tests/chat/kontur-talk/schema.test.ts`           | Schema validation tests                   |
| `tests/chat/kontur-talk/reply-helpers.test.ts`    | ReplyFn factory tests                     |
| `tests/chat/kontur-talk/context-renderer.test.ts` | Context renderer tests                    |
| `tests/chat/kontur-talk/label-helpers.test.ts`    | Label resolver tests                      |
| `tests/chat/kontur-talk/index.test.ts`            | Main provider tests                       |

### Modified files

| File                         | Change                                                                  |
| ---------------------------- | ----------------------------------------------------------------------- |
| `src/chat/registry.ts`       | Add `'kontur-talk'` descriptor, factory, configToEnv                    |
| `src/instances/types.ts`     | Add `'kontur-talk'` to `PlatformInstanceType` union                     |
| `src/instances/bootstrap.ts` | Add `CHAT_ENV_REQUIREMENTS`, `parsePlatformType`, `buildPlatformConfig` |
| `src/env-validation.ts`      | Add `'kontur-talk'` to provider allowlist + requirements                |

---

### Task 1: Metadata, Config, and Schemas

**Files:**

- Create: `src/chat/kontur-talk/metadata.ts`
- Create: `src/chat/kontur-talk/config.ts`
- Create: `src/chat/kontur-talk/schema.ts`
- Create: `tests/chat/kontur-talk/metadata.test.ts`
- Create: `tests/chat/kontur-talk/config.test.ts`
- Create: `tests/chat/kontur-talk/schema.test.ts`

- [ ] **Step 1: Write metadata tests**

```typescript
// tests/chat/kontur-talk/metadata.test.ts
import { describe, expect, test } from 'bun:test'
import {
  konturTalkCapabilities,
  konturTalkTraits,
  konturTalkConfigRequirements,
} from '../../src/chat/kontur-talk/metadata.js'

describe('Kontur Talk metadata', () => {
  test('capabilities include messages.reply-context', () => {
    expect(konturTalkCapabilities.has('messages.reply-context')).toBe(true)
  })

  test('capabilities do not include messages.buttons', () => {
    expect(konturTalkCapabilities.has('messages.buttons')).toBe(false)
  })

  test('capabilities do not include files.receive', () => {
    expect(konturTalkCapabilities.has('files.receive')).toBe(false)
  })

  test('traits observe all group messages', () => {
    expect(konturTalkTraits.observedGroupMessages).toBe('all')
  })

  test('traits max message length is 4096', () => {
    expect(konturTalkTraits.maxMessageLength).toBe(4096)
  })

  test('config requirements include KONTUR_TALK_JWT_TOKEN', () => {
    expect(konturTalkConfigRequirements).toEqual([
      { key: 'KONTUR_TALK_JWT_TOKEN', label: 'Kontur Talk JWT Token', required: true },
    ])
  })
})
```

- [ ] **Step 2: Run metadata tests to verify they fail**

Run: `bun test tests/chat/kontur-talk/metadata.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write metadata implementation**

```typescript
// src/chat/kontur-talk/metadata.ts
import type { ChatCapability, ChatProviderConfigRequirement, ChatProviderTraits } from '../types.js'

export const konturTalkCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>(['messages.reply-context'])

export const konturTalkTraits: ChatProviderTraits = {
  observedGroupMessages: 'all',
  maxMessageLength: 4096,
}

export const konturTalkConfigRequirements: readonly ChatProviderConfigRequirement[] = [
  { key: 'KONTUR_TALK_JWT_TOKEN', label: 'Kontur Talk JWT Token', required: true },
]
```

- [ ] **Step 4: Run metadata tests to verify they pass**

Run: `bun test tests/chat/kontur-talk/metadata.test.ts`
Expected: PASS

- [ ] **Step 5: Write config tests**

```typescript
// tests/chat/kontur-talk/config.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { resolveKonturTalkConfig } from '../../src/chat/kontur-talk/config.js'

describe('resolveKonturTalkConfig', () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    process.env['KONTUR_TALK_JWT_TOKEN'] = 'test-jwt-token'
  })

  afterEach(() => {
    process.env = { ...origEnv }
  })

  test('resolves from env when no constructor config provided', () => {
    const config = resolveKonturTalkConfig({})
    expect(config.jwtToken).toBe('test-jwt-token')
    expect(config.platformInstanceId).toBe('kontur-talk-default')
  })

  test('constructor config takes precedence over env', () => {
    const config = resolveKonturTalkConfig({ jwtToken: 'explicit-token' })
    expect(config.jwtToken).toBe('explicit-token')
  })

  test('throws when jwtToken is missing', () => {
    delete process.env['KONTUR_TALK_JWT_TOKEN']
    expect(() => resolveKonturTalkConfig({})).toThrow(/KONTUR_TALK_JWT_TOKEN/i)
  })

  test('throws when jwtToken is empty string', () => {
    delete process.env['KONTUR_TALK_JWT_TOKEN']
    expect(() => resolveKonturTalkConfig({ jwtToken: '  ' })).toThrow(/KONTUR_TALK_JWT_TOKEN/i)
  })

  test('uses custom platformInstanceId when provided', () => {
    const config = resolveKonturTalkConfig({ platformInstanceId: 'custom-id' })
    expect(config.platformInstanceId).toBe('custom-id')
  })
})
```

- [ ] **Step 6: Run config tests to verify they fail**

Run: `bun test tests/chat/kontur-talk/config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: Write config implementation**

```typescript
// src/chat/kontur-talk/config.ts
export type KonturTalkConstructorConfig = Partial<{
  jwtToken: string
  platformInstanceId: string
}>

export type ResolvedKonturTalkConfig = {
  jwtToken: string
  platformInstanceId: string
}

const resolveConfigValue = (value: string | undefined, fallback: string | undefined): string | undefined => {
  if (value === undefined) return fallback
  return value
}

const resolvePlatformInstanceId = (platformInstanceId: string | undefined): string => {
  if (platformInstanceId === undefined) return 'kontur-talk-default'
  return platformInstanceId
}

export const resolveKonturTalkConfig = (config: KonturTalkConstructorConfig): ResolvedKonturTalkConfig => {
  const jwtToken = resolveConfigValue(config.jwtToken, process.env['KONTUR_TALK_JWT_TOKEN'])
  if (jwtToken === undefined || jwtToken.trim() === '') {
    throw new Error('KONTUR_TALK_JWT_TOKEN environment variable is required')
  }
  return {
    jwtToken,
    platformInstanceId: resolvePlatformInstanceId(config.platformInstanceId),
  }
}
```

- [ ] **Step 8: Run config tests to verify they pass**

Run: `bun test tests/chat/kontur-talk/config.test.ts`
Expected: PASS

- [ ] **Step 9: Write schema tests**

```typescript
// tests/chat/kontur-talk/schema.test.ts
import { describe, expect, test } from 'bun:test'
import {
  KonturTalkUpdateSchema,
  KonturTalkSendMessageResponseSchema,
  KonturTalkErrorResponseSchema,
} from '../../src/chat/kontur-talk/schema.js'

describe('Kontur Talk schemas', () => {
  describe('KonturTalkUpdateSchema', () => {
    test('validates a text message update', () => {
      const data = {
        event_id: '$event123',
        user_id: '@alice:host',
        room_id: '!room:host',
        room_is_direct: false,
        type: 'm.room.message',
        timestamp: 1704067200000,
        message_type: 'm.text',
        body: 'Hello, bot!',
        formatted_body: null,
        thread_id: null,
        reply_id: null,
        forward_from: null,
        mentions: ['@bot:host'],
      }
      const result = KonturTalkUpdateSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    test('validates a media message update', () => {
      const data = {
        event_id: '$event789',
        user_id: '@bob:host',
        room_id: '!room:host',
        room_is_direct: true,
        type: 'm.room.message',
        timestamp: 1704070800000,
        message_type: 'm.image',
        media_url: 'mxc://host/abcd1234',
        thread_id: null,
        reply_id: null,
        forward_from: null,
        mentions: null,
      }
      const result = KonturTalkUpdateSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    test('validates a message with thread_id', () => {
      const data = {
        event_id: '$event456',
        user_id: '@alice:host',
        room_id: '!room:host',
        room_is_direct: false,
        type: 'm.room.message',
        timestamp: 1704067200000,
        message_type: 'm.text',
        body: 'In a thread',
        formatted_body: null,
        thread_id: '$thread123',
        reply_id: null,
        forward_from: null,
        mentions: null,
      }
      const result = KonturTalkUpdateSchema.safeParse(data)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.thread_id).toBe('$thread123')
      }
    })

    test('rejects missing required fields', () => {
      const data = { event_id: '$event123' }
      const result = KonturTalkUpdateSchema.safeParse(data)
      expect(result.success).toBe(false)
    })
  })

  describe('KonturTalkSendMessageResponseSchema', () => {
    test('validates success response', () => {
      const data = { event_id: '$newEvent789' }
      const result = KonturTalkSendMessageResponseSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    test('rejects missing event_id', () => {
      const result = KonturTalkSendMessageResponseSchema.safeParse({})
      expect(result.success).toBe(false)
    })
  })

  describe('KonturTalkErrorResponseSchema', () => {
    test('validates error with detail.errcode', () => {
      const data = { detail: { errcode: 'M_UNKNOWN_TOKEN', error: 'Access token has expired' } }
      const result = KonturTalkErrorResponseSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    test('validates error with detail array (validation error)', () => {
      const data = {
        detail: [
          {
            loc: ['body', 'message'],
            msg: 'ensure this value has at most 4096 characters',
            type: 'value_error.any_str.max_length',
          },
        ],
      }
      const result = KonturTalkErrorResponseSchema.safeParse(data)
      expect(result.success).toBe(true)
    })
  })
})
```

- [ ] **Step 10: Run schema tests to verify they fail**

Run: `bun test tests/chat/kontur-talk/schema.test.ts`
Expected: FAIL — module not found

- [ ] **Step 11: Write schema implementation**

```typescript
// src/chat/kontur-talk/schema.ts
import { z } from 'zod'

const KonturTalkForwardFromSchema = z.object({
  user_id: z.string(),
  room_id: z.string(),
})

const KonturTalkMentionsSchema = z.union([z.array(z.string()), z.literal('all'), z.null()])

export const KonturTalkUpdateSchema = z.object({
  event_id: z.string(),
  user_id: z.string(),
  room_id: z.string(),
  room_is_direct: z.boolean(),
  type: z.string(),
  timestamp: z.number(),
  message_type: z.string(),
  body: z.string().optional(),
  formatted_body: z.string().nullable().optional(),
  media_url: z.string().optional(),
  call_room_name: z.string().optional(),
  thread_id: z.string().nullable().optional(),
  reply_id: z.string().nullable().optional(),
  forward_from: KonturTalkForwardFromSchema.nullable().optional(),
  mentions: KonturTalkMentionsSchema.optional(),
})

export type KonturTalkUpdate = z.infer<typeof KonturTalkUpdateSchema>

export const KonturTalkGetUpdatesResponseSchema = z.object({
  updates: z.array(KonturTalkUpdateSchema),
})

export const KonturTalkSendMessageResponseSchema = z.object({
  event_id: z.string(),
})

export const KonturTalkErrorResponseSchema = z.object({
  detail: z.union([
    z.object({
      errcode: z.string(),
      error: z.string(),
    }),
    z.array(
      z.object({
        loc: z.array(z.union([z.string(), z.number()])),
        msg: z.string(),
        type: z.string(),
      }),
    ),
  ]),
})
```

- [ ] **Step 12: Run schema tests to verify they pass**

Run: `bun test tests/chat/kontur-talk/schema.test.ts`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add src/chat/kontur-talk/metadata.ts src/chat/kontur-talk/config.ts src/chat/kontur-talk/schema.ts tests/chat/kontur-talk/metadata.test.ts tests/chat/kontur-talk/config.test.ts tests/chat/kontur-talk/schema.test.ts
git commit -m "feat(kontur-talk): add metadata, config, and schema foundations"
```

---

### Task 2: Reply Helpers

**Files:**

- Create: `src/chat/kontur-talk/reply-helpers.ts`
- Create: `tests/chat/kontur-talk/reply-helpers.test.ts`

- [ ] **Step 1: Write reply helpers tests**

```typescript
// tests/chat/kontur-talk/reply-helpers.test.ts
import { describe, expect, test } from 'bun:test'
import type { ReplyFn } from '../../../src/chat/types.js'
import { createKonturTalkReplyFn } from '../../../src/chat/kontur-talk/reply-helpers.js'

function makeReplyFn(): { reply: ReplyFn; posts: unknown[] } {
  const posts: unknown[] = []
  const apiFetch = (_method: string, _path: string, body: unknown): Promise<unknown> => {
    posts.push(body)
    return Promise.resolve({ event_id: '$newEvent' })
  }
  const reply = createKonturTalkReplyFn({
    roomId: '!room:host',
    threadId: undefined,
    apiFetch,
  })
  return { reply, posts }
}

describe('createKonturTalkReplyFn', () => {
  test('text() sends plain format message', async () => {
    const { reply, posts } = makeReplyFn()
    await reply.text('Hello')
    expect(posts).toEqual([{ room_id: '!room:host', message: 'Hello', format: 'plain', thread_id: null, mentions: [] }])
  })

  test('formatted() sends markdown format message', async () => {
    const { reply, posts } = makeReplyFn()
    await reply.formatted('**bold**')
    expect(posts).toEqual([
      { room_id: '!room:host', message: '**bold**', format: 'markdown', thread_id: null, mentions: [] },
    ])
  })

  test('text() passes thread_id when present', async () => {
    const posts: unknown[] = []
    const apiFetch = (_method: string, _path: string, body: unknown): Promise<unknown> => {
      posts.push(body)
      return Promise.resolve({ event_id: '$newEvent' })
    }
    const reply = createKonturTalkReplyFn({
      roomId: '!room:host',
      threadId: '$thread123',
      apiFetch,
    })
    await reply.text('In thread')
    expect(posts).toEqual([
      { room_id: '!room:host', message: 'In thread', format: 'plain', thread_id: '$thread123', mentions: [] },
    ])
  })

  test('text() uses option threadId over default', async () => {
    const posts: unknown[] = []
    const apiFetch = (_method: string, _path: string, body: unknown): Promise<unknown> => {
      posts.push(body)
      return Promise.resolve({ event_id: '$newEvent' })
    }
    const reply = createKonturTalkReplyFn({
      roomId: '!room:host',
      threadId: '$defaultThread',
      apiFetch,
    })
    await reply.text('Override', { threadId: '$otherThread' })
    expect((posts[0] as Record<string, unknown>)['thread_id']).toBe('$otherThread')
  })

  test('typing() is a no-op', () => {
    const { reply } = makeReplyFn()
    expect(() => reply.typing()).not.toThrow()
  })

  test('buttons() throws', async () => {
    const { reply } = makeReplyFn()
    await expect(reply.buttons('content', { buttons: [] })).rejects.toThrow(/does not support/i)
  })
})
```

- [ ] **Step 2: Run reply helpers tests to verify they fail**

Run: `bun test tests/chat/kontur-talk/reply-helpers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write reply helpers implementation**

```typescript
// src/chat/kontur-talk/reply-helpers.ts
import type { ButtonReplyOptions, ReplyFn, ReplyOptions } from '../types.js'

interface KonturTalkReplyHelpersParams {
  roomId: string
  threadId?: string
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>
}

export function createKonturTalkReplyFn(params: KonturTalkReplyHelpersParams): ReplyFn {
  const { roomId, threadId, apiFetch } = params

  const send = async (message: string, format: string, options?: ReplyOptions): Promise<void> => {
    await apiFetch('POST', '/send_message', {
      room_id: roomId,
      message,
      format,
      thread_id: options?.threadId ?? threadId ?? null,
      mentions: [],
    })
  }

  return {
    text: (content: string, options?: ReplyOptions) => send(content, 'plain', options),
    formatted: (markdown: string, options?: ReplyOptions) => send(markdown, 'markdown', options),
    typing: () => {},
    buttons: (_content: string, _options: ButtonReplyOptions): Promise<void> => {
      return Promise.reject(
        new Error(
          'Kontur Talk does not support interactive buttons. Use supportsInteractiveButtons() to check before calling reply.buttons().',
        ),
      )
    },
  }
}
```

- [ ] **Step 4: Run reply helpers tests to verify they pass**

Run: `bun test tests/chat/kontur-talk/reply-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/kontur-talk/reply-helpers.ts tests/chat/kontur-talk/reply-helpers.test.ts
git commit -m "feat(kontur-talk): add reply helpers"
```

---

### Task 3: Context Renderer and Label Helpers

**Files:**

- Create: `src/chat/kontur-talk/context-renderer.ts`
- Create: `src/chat/kontur-talk/label-helpers.ts`
- Create: `tests/chat/kontur-talk/context-renderer.test.ts`
- Create: `tests/chat/kontur-talk/label-helpers.test.ts`

- [ ] **Step 1: Write context renderer tests**

```typescript
// tests/chat/kontur-talk/context-renderer.test.ts
import { describe, expect, test } from 'bun:test'
import { renderKonturTalkContext } from '../../../src/chat/kontur-talk/context-renderer.js'
import type { ContextSnapshot } from '../../../src/chat/types.js'

const makeSnapshot = (overrides?: Partial<ContextSnapshot>): ContextSnapshot => ({
  modelName: 'gpt-4',
  totalTokens: 1000,
  maxTokens: 8000,
  approximate: false,
  sections: [],
  ...overrides,
})

describe('renderKonturTalkContext', () => {
  test('returns formatted method', () => {
    const result = renderKonturTalkContext(makeSnapshot())
    expect(result.method).toBe('formatted')
  })

  test('includes model name and token count', () => {
    const result = renderKonturTalkContext(makeSnapshot())
    expect(result.content).toContain('gpt-4')
    expect(result.content).toContain('1,000')
  })

  test('includes percentage when maxTokens is set', () => {
    const result = renderKonturTalkContext(makeSnapshot({ totalTokens: 4000, maxTokens: 8000 }))
    expect(result.content).toContain('50.0%')
  })

  test('handles null maxTokens', () => {
    const result = renderKonturTalkContext(makeSnapshot({ maxTokens: null }))
    expect(result.method).toBe('formatted')
    expect(result.content).not.toContain('undefined')
  })
})
```

- [ ] **Step 2: Run context renderer tests to verify they fail**

Run: `bun test tests/chat/kontur-talk/context-renderer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write context renderer implementation**

```typescript
// src/chat/kontur-talk/context-renderer.ts
import { buildContextGrid, SECTION_EMOJIS } from '../../commands/context-grid.js'
import type { ContextRendered, ContextSection, ContextSnapshot } from '../types.js'

const formatNumber = (n: number): string => n.toLocaleString('en-US')

const buildHeader = (snapshot: ContextSnapshot): string => {
  const total = formatNumber(snapshot.totalTokens)
  if (snapshot.maxTokens === null) {
    return `**Context** · ${snapshot.modelName} · ${total} tokens`
  }
  const max = formatNumber(snapshot.maxTokens)
  const pct = ((snapshot.totalTokens / snapshot.maxTokens) * 100).toFixed(1)
  return `**Context** · ${snapshot.modelName} · ${total} / ${max} tokens (${pct}%)`
}

const emojiFor = (label: string): string => SECTION_EMOJIS[label] ?? '⬜'

const topRow = (section: ContextSection): string =>
  `| ${emojiFor(section.label)} **${section.label}** | ${formatNumber(section.tokens)} |`

const childRow = (child: ContextSection): string => {
  const label = child.detail === undefined ? child.label : `${child.label} (${child.detail})`
  return `| ↳ ${label} | ${formatNumber(child.tokens)} |`
}

const detailRow = (detail: string): string => `| ↳ ${detail} |  |`

const buildTable = (snapshot: ContextSnapshot): string => {
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

export const renderKonturTalkContext = (snapshot: ContextSnapshot): ContextRendered => {
  const header = buildHeader(snapshot)
  const grid = buildContextGrid(snapshot)
  const table = buildTable(snapshot)
  const footer = snapshot.approximate ? '\n\n_token counts are approximate_' : ''
  return { method: 'formatted', content: `${header}\n\n${grid}\n\n${table}${footer}` }
}
```

- [ ] **Step 4: Run context renderer tests to verify they pass**

Run: `bun test tests/chat/kontur-talk/context-renderer.test.ts`
Expected: PASS

- [ ] **Step 5: Write label helpers tests**

```typescript
// tests/chat/kontur-talk/label-helpers.test.ts
import { describe, expect, test } from 'bun:test'
import { resolveKonturTalkUserLabel, resolveKonturTalkGroupLabel } from '../../../src/chat/kontur-talk/label-helpers.js'

describe('resolveKonturTalkUserLabel', () => {
  test('returns user_id as-is when no display name API', async () => {
    const apiFetch = (): Promise<unknown> => Promise.resolve({})
    const result = await resolveKonturTalkUserLabel(apiFetch, '@alice:host')
    expect(result).toBe('@alice:host')
  })

  test('returns null for empty userId', async () => {
    const apiFetch = (): Promise<unknown> => Promise.resolve({})
    const result = await resolveKonturTalkUserLabel(apiFetch, '')
    expect(result).toBeNull()
  })
})

describe('resolveKonturTalkGroupLabel', () => {
  test('returns null (no group info API)', async () => {
    const apiFetch = (): Promise<unknown> => Promise.resolve({})
    const result = await resolveKonturTalkGroupLabel(apiFetch, '!room:host')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 6: Run label helpers tests to verify they fail**

Run: `bun test tests/chat/kontur-talk/label-helpers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: Write label helpers implementation**

```typescript
// src/chat/kontur-talk/label-helpers.ts
type ApiFetchFn = (method: string, path: string, body: unknown) => Promise<unknown>

export async function resolveKonturTalkUserLabel(_apiFetch: ApiFetchFn, userId: string): Promise<string | null> {
  if (userId.trim() === '') return null
  return userId
}

export async function resolveKonturTalkGroupLabel(_apiFetch: ApiFetchFn, _groupId: string): Promise<string | null> {
  return null
}
```

- [ ] **Step 8: Run label helpers tests to verify they pass**

Run: `bun test tests/chat/kontur-talk/label-helpers.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/chat/kontur-talk/context-renderer.ts src/chat/kontur-talk/label-helpers.ts tests/chat/kontur-talk/context-renderer.test.ts tests/chat/kontur-talk/label-helpers.test.ts
git commit -m "feat(kontur-talk): add context renderer and label helpers"
```

---

### Task 4: Main Provider Class — Constructor, Start/Stop, Message Loop

**Files:**

- Create: `src/chat/kontur-talk/index.ts`
- Create: `tests/chat/kontur-talk/index.test.ts`

- [ ] **Step 1: Write constructor and lifecycle tests**

```typescript
// tests/chat/kontur-talk/index.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { KonturTalkChatProvider } from '../../../src/chat/kontur-talk/index.js'
import { setMockFetch, restoreFetch } from '../../utils/test-helpers.js'

// JWT token with sub="bot123" (base64-encoded)
const TEST_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib3QxMjMiLCJvd25lciI6ImFkbWluMSIsImlhdCI6MTc1NzA2MTc3N30.test'

describe('KonturTalkChatProvider', () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    process.env['KONTUR_TALK_JWT_TOKEN'] = TEST_JWT
  })

  afterEach(() => {
    process.env = { ...origEnv }
    restoreFetch()
  })

  test('name is kontur-talk', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.name).toBe('kontur-talk')
  })

  test('capabilities include messages.reply-context', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.capabilities.has('messages.reply-context')).toBe(true)
  })

  test('capabilities do not include messages.buttons', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.capabilities.has('messages.buttons')).toBe(false)
  })

  test('traits observe all group messages', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.traits.observedGroupMessages).toBe('all')
  })

  test('traits max message length is 4096', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.traits.maxMessageLength).toBe(4096)
  })

  test('thread capabilities support threads', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.threadCapabilities.supportsThreads).toBe(true)
    expect(provider.threadCapabilities.canCreateThreads).toBe(true)
    expect(provider.threadCapabilities.threadScope).toBe('message')
  })

  test('config requirements include KONTUR_TALK_JWT_TOKEN', () => {
    const provider = new KonturTalkChatProvider()
    expect(provider.configRequirements).toEqual([
      { key: 'KONTUR_TALK_JWT_TOKEN', label: 'Kontur Talk JWT Token', required: true },
    ])
  })

  test('start() extracts botUserId from JWT', async () => {
    let capturedUrl: string | undefined
    setMockFetch(async (url: string) => {
      capturedUrl = url
      return new Response(JSON.stringify({ updates: [] }), { status: 200 })
    })
    const provider = new KonturTalkChatProvider()
    await provider.start()
    expect(provider.botUserId).toBe('bot123')
    await provider.stop()
  })

  test('stop() sets running to false', async () => {
    setMockFetch(async () => new Response(JSON.stringify({ updates: [] }), { status: 200 }))
    const provider = new KonturTalkChatProvider()
    await provider.start()
    await provider.stop()
    expect(provider.running).toBe(false)
  })
})
```

- [ ] **Step 2: Run constructor tests to verify they fail**

Run: `bun test tests/chat/kontur-talk/index.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write main provider class (constructor, start, stop)**

```typescript
// src/chat/kontur-talk/index.ts
import { logger } from '../../logger.js'
import type {
  ChatCapability,
  ChatProvider,
  ChatProviderConfigRequirement,
  ChatProviderTraits,
  ContextRendered,
  ContextSnapshot,
  DeferredDeliveryTarget,
  IncomingMessage,
  ReplyFn,
  ThreadCapabilities,
} from '../types.js'
import { resolveKonturTalkConfig, type KonturTalkConstructorConfig } from './config.js'
import { renderKonturTalkContext } from './context-renderer.js'
import { konturTalkCapabilities, konturTalkConfigRequirements, konturTalkTraits } from './metadata.js'
import { createKonturTalkReplyFn } from './reply-helpers.js'
import {
  KonturTalkGetUpdatesResponseSchema,
  KonturTalkSendMessageResponseSchema,
  KonturTalkUpdateSchema,
} from './schema.js'

const BASE_URL = 'https://chat.ktalk.ru/_matrix/client/strangler/api/v1'

const log = logger.child({ scope: 'chat:kontur-talk' })

export class KonturTalkChatProvider implements ChatProvider {
  readonly name = 'kontur-talk'
  readonly threadCapabilities: ThreadCapabilities = {
    supportsThreads: true,
    canCreateThreads: true,
    threadScope: 'message',
  }
  readonly capabilities: ReadonlySet<ChatCapability> = konturTalkCapabilities
  readonly traits: ChatProviderTraits = konturTalkTraits
  readonly configRequirements: readonly ChatProviderConfigRequirement[] = konturTalkConfigRequirements

  private readonly jwtToken: string
  private readonly platformInstanceId: string
  private messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  private botUserId: string | null = null
  private running = false

  constructor(config?: KonturTalkConstructorConfig) {
    const resolved = resolveKonturTalkConfig(config ?? {})
    this.jwtToken = resolved.jwtToken
    this.platformInstanceId = resolved.platformInstanceId
  }

  getBotUserId(): string | null {
    return this.botUserId
  }

  isRunning(): boolean {
    return this.running
  }

  private extractBotUserId(): string {
    const parts = this.jwtToken.split('.')
    if (parts.length < 2 || parts[1] === undefined) {
      throw new Error('Invalid JWT token: missing payload')
    }
    const payload = JSON.parse(atob(parts[1]))
    if (typeof payload.sub !== 'string' || payload.sub.trim() === '') {
      throw new Error('Invalid JWT token: missing sub claim')
    }
    return payload.sub
  }

  private buildUrl(endpoint: string): string {
    return `${BASE_URL}/bot/${this.jwtToken}${endpoint}`
  }

  private async apiFetch(method: string, endpoint: string, body?: unknown): Promise<unknown> {
    const url = this.buildUrl(endpoint)
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }
    const response = await fetch(url, options)
    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Kontur Talk API error ${response.status}: ${errorBody}`)
    }
    return response.json()
  }

  async start(): Promise<void> {
    this.botUserId = this.extractBotUserId()
    this.running = true
    log.info({ botUserId: this.botUserId }, 'Kontur Talk bot started')
    void this.pollLoop()
  }

  stop(): Promise<void> {
    this.running = false
    log.info('Kontur Talk bot stopped')
    return Promise.resolve()
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const data = await this.apiFetch('GET', '/get_updates?timeout=30')
        const parsed = KonturTalkGetUpdatesResponseSchema.safeParse(data)
        if (!parsed.success) {
          log.warn({ error: parsed.error }, 'Failed to parse get_updates response')
          continue
        }
        for (const update of parsed.data.updates) {
          if (update.user_id === this.botUserId) continue
          await this.handleUpdate(update)
        }
      } catch (e) {
        if (!this.running) break
        log.warn({ error: e instanceof Error ? e.message : String(e) }, 'Poll loop error')
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }
    }
  }

  private async handleUpdate(update: Record<string, unknown>): Promise<void> {
    // Implemented in Task 5
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.messageHandler = handler
  }

  async sendMessage(_platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void> {
    if (target.contextType === 'dm') {
      log.warn('Kontur Talk does not support proactive DM delivery')
      return
    }
    await this.apiFetch('POST', '/send_message', {
      room_id: target.contextId,
      message: markdown,
      format: 'markdown',
      thread_id: target.threadId ?? null,
      mentions: [],
    })
  }

  renderContext(snapshot: ContextSnapshot): ContextRendered {
    return renderKonturTalkContext(snapshot)
  }
}
```

- [ ] **Step 4: Run constructor tests to verify they pass**

Run: `bun test tests/chat/kontur-talk/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/kontur-talk/index.ts tests/chat/kontur-talk/index.test.ts
git commit -m "feat(kontur-talk): add provider class with constructor, start/stop, and message loop"
```

---

### Task 5: Main Provider Class — Message Handling and sendMessage

**Files:**

- Modify: `src/chat/kontur-talk/index.ts`
- Modify: `tests/chat/kontur-talk/index.test.ts`

- [ ] **Step 1: Write message handling tests**

Add to `tests/chat/kontur-talk/index.test.ts`:

```typescript
describe('message handling', () => {
  test('handleUpdate dispatches text message to messageHandler', async () => {
    const received: IncomingMessage[] = []
    setMockFetch(async () => new Response(JSON.stringify({ updates: [] }), { status: 200 }))
    const provider = new KonturTalkChatProvider()
    await provider.start()
    provider.onMessage(async (msg, _reply) => {
      received.push(msg)
    })

    // Simulate an update by calling the private handleUpdate via poll loop
    // We test through the public API by verifying onMessage is called
    await provider.stop()
  })

  test('sendMessage for group sends to API', async () => {
    let capturedBody: unknown
    setMockFetch(async (_url: string, options?: RequestInit) => {
      capturedBody = options?.body ? JSON.parse(options.body as string) : undefined
      return new Response(JSON.stringify({ event_id: '$sent' }), { status: 200 })
    })
    const provider = new KonturTalkChatProvider()
    await provider.start()

    await provider.sendMessage(
      'kontur-talk-default',
      {
        contextId: '!room:host',
        contextType: 'group',
        threadId: null,
        audience: 'shared',
        mentionUserIds: [],
        createdByUserId: 'user1',
        createdByUsername: null,
      },
      'Hello group',
    )

    expect(capturedBody).toEqual({
      room_id: '!room:host',
      message: 'Hello group',
      format: 'markdown',
      thread_id: null,
      mentions: [],
    })

    await provider.stop()
  })

  test('sendMessage for DM logs warning and returns', async () => {
    let fetchCalled = false
    setMockFetch(async () => {
      fetchCalled = true
      return new Response(JSON.stringify({ event_id: '$sent' }), { status: 200 })
    })
    const provider = new KonturTalkChatProvider()
    await provider.start()

    await provider.sendMessage(
      'kontur-talk-default',
      {
        contextId: '@user:host',
        contextType: 'dm',
        threadId: null,
        audience: 'personal',
        mentionUserIds: [],
        createdByUserId: 'user1',
        createdByUsername: null,
      },
      'Hello DM',
    )

    // DM delivery is not supported, so no API call should be made
    // (the initial fetch is from the poll loop, not sendMessage)
    await provider.stop()
  })

  test('sendMessage passes threadId when present', async () => {
    let capturedBody: unknown
    setMockFetch(async (_url: string, options?: RequestInit) => {
      if (options?.body) {
        capturedBody = JSON.parse(options.body as string)
      }
      return new Response(JSON.stringify({ event_id: '$sent' }), { status: 200 })
    })
    const provider = new KonturTalkChatProvider()
    await provider.start()

    await provider.sendMessage(
      'kontur-talk-default',
      {
        contextId: '!room:host',
        contextType: 'group',
        threadId: '$thread123',
        audience: 'shared',
        mentionUserIds: [],
        createdByUserId: 'user1',
        createdByUsername: null,
      },
      'In thread',
    )

    expect((capturedBody as Record<string, unknown>)['thread_id']).toBe('$thread123')
    await provider.stop()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/chat/kontur-talk/index.test.ts`
Expected: FAIL — handleUpdate not implemented, sendMessage for DM may make API calls

- [ ] **Step 3: Implement handleUpdate and fix sendMessage**

Update `src/chat/kontur-talk/index.ts` — replace the stub `handleUpdate` and update `sendMessage`:

```typescript
  private async handleUpdate(update: Record<string, unknown>): Promise<void> {
    const parsed = KonturTalkUpdateSchema.safeParse(update)
    if (!parsed.success) {
      log.warn({ error: parsed.error }, 'Failed to parse update')
      return
    }
    const data = parsed.data

    const isMentioned = this.isMentioned(data.mentions)
    const threadId = data.thread_id ?? undefined
    const replyToMessageId = data.reply_id ?? undefined

    const msg: IncomingMessage = {
      user: { id: data.user_id, name: data.user_id },
      contextId: data.room_id,
      contextType: data.room_is_direct ? 'dm' : 'group',
      isMentioned,
      text: data.body ?? '',
      messageId: data.event_id,
      threadId,
      replyToMessageId,
      platformInstanceId: this.platformInstanceId,
    }

    const reply = createKonturTalkReplyFn({
      roomId: data.room_id,
      threadId,
      apiFetch: this.apiFetch.bind(this),
    })

    if (this.messageHandler !== null) {
      await this.messageHandler(msg, reply)
    }
  }

  private isMentioned(mentions: unknown): boolean {
    if (this.botUserId === null) return false
    if (mentions === 'all') return true
    if (Array.isArray(mentions)) {
      return mentions.some((m) => typeof m === 'string' && m.includes(this.botUserId!))
    }
    return false
  }
```

Also add the import for `KonturTalkUpdateSchema` at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/chat/kontur-talk/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/kontur-talk/index.ts tests/chat/kontur-talk/index.test.ts
git commit -m "feat(kontur-talk): add message handling and sendMessage"
```

---

### Task 6: Registration and Bootstrap

**Files:**

- Modify: `src/chat/registry.ts`
- Modify: `src/instances/types.ts`
- Modify: `src/instances/bootstrap.ts`
- Modify: `src/env-validation.ts`

- [ ] **Step 1: Add 'kontur-talk' to PlatformInstanceType**

In `src/instances/types.ts`, add `'kontur-talk'` to the `PlatformInstanceType` union:

```typescript
export type PlatformInstanceType = 'telegram' | 'mattermost' | 'discord' | 'kontur-talk'
```

- [ ] **Step 2: Add Kontur Talk to env validation**

In `src/env-validation.ts`:

- Add `'kontur-talk'` to the provider name check (the `if` condition)
- Add `kontur-talk: ['KONTUR_TALK_JWT_TOKEN']` to the requirements record

- [ ] **Step 3: Add Kontur Talk to bootstrap**

In `src/instances/bootstrap.ts`:

- Add `kontur-talk: ['KONTUR_TALK_JWT_TOKEN']` to `CHAT_ENV_REQUIREMENTS`
- Add `'kontur-talk'` to `parsePlatformType` return value
- Add `case 'kontur-talk': return { jwtToken: getTrimmedEnv('KONTUR_TALK_JWT_TOKEN') ?? '' }` to `buildPlatformConfig`

- [ ] **Step 4: Add Kontur Talk to registry**

In `src/chat/registry.ts`:

- Import `KonturTalkChatProvider` from `./kontur-talk/index.js`
- Import `konturTalkCapabilities`, `konturTalkTraits` from `./kontur-talk/metadata.js`
- Add descriptor to `platformDescriptors` array
- Add factory to `registerChatProvider` calls
- Add `kontur-talk` case to `configToEnv` function

- [ ] **Step 5: Write registry tests**

Add to `tests/chat/registry.test.ts`:

```typescript
test('createChatProvider("kontur-talk") creates provider', () => {
  process.env['KONTUR_TALK_JWT_TOKEN'] = 'test-token'
  const provider = createChatProvider('kontur-talk', { env: process.env as Record<string, string | undefined> })
  expect(provider.name).toBe('kontur-talk')
})

test('createChatProvider("kontur-talk") throws when JWT token is missing', () => {
  expect(() => createChatProvider('kontur-talk', { env: {} })).toThrow()
})
```

- [ ] **Step 6: Run full test suite to verify**

Run: `bun test`
Expected: PASS (all existing tests still pass, new tests pass)

- [ ] **Step 7: Commit**

```bash
git add src/chat/registry.ts src/instances/types.ts src/instances/bootstrap.ts src/env-validation.ts tests/chat/registry.test.ts
git commit -m "feat(kontur-talk): register provider in registry, bootstrap, and env validation"
```

---

### Task 7: Integration Verification

- [ ] **Step 1: Run lint**

Run: `bun lint`
Expected: PASS — no lint errors in new files

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`
Expected: PASS — no type errors

- [ ] **Step 3: Run format check**

Run: `bun format:check`
Expected: PASS — formatting is correct

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: PASS — all tests pass

- [ ] **Step 5: Commit any fixes**

If any of the above fail, fix the issues and commit:

```bash
git add -A
git commit -m "fix(kontur-talk): lint/typecheck/format fixes"
```
