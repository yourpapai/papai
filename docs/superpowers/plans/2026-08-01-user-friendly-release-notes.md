<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# User-Friendly Release Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generated release notes understandable to non-technical users by classifying changelog entries (dropping internal ones) before writing a benefit-framed announcement.

**Architecture:** Two-pass pipeline inside `humanizeChangelog` (`src/announcements/humanize.ts`). Pass 1 selects user-facing entries via structured output (`generateText` + `Output.object`, AI SDK v7); pass 2 writes the friendly announcement from survivors only. Public signature unchanged; callers untouched.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK v7 (`generateText`, `Output.object`), Zod v4, bun:test.

Spec: `docs/superpowers/specs/2026-08-01-user-friendly-release-notes-design.md`

## Global Constraints

- Strict TypeScript; **`.js` extension in import paths**.
- Zod v4: `import { z } from 'zod'`.
- AI SDK v7: use `generateText({ ..., output: Output.object({ schema }) })` and read `result.output`. **`generateObject` is deprecated — do not use it.**
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- No lint-disable or type-ignore comments (hook-blocked).
- Modified files already carry the BUSL-1.1 header — keep it.
- Commit style: conventional commits, e.g. `feat(announcements): ...`.
- Tests: DI-first via the existing `HumanizeChangelogDeps` seam; no `mock.module`.

---

### Task 1: Classification schema + `generateStructured` dep (no behavior change)

**Files:**
- Modify: `src/announcements/humanize.ts`
- Test: `tests/announcements/humanize.test.ts`

**Interfaces:**
- Produces (used by Tasks 2–3):
  - `classifiedEntriesSchema` — zod object `{ entries: Array<{ kind: 'new' | 'improvement' | 'fix'; text: string }> }`
  - `type ClassifiedEntries = z.infer<typeof classifiedEntriesSchema>`
  - `HumanizeChangelogDeps.generateStructured: (opts: { model: LanguageModel; system: string; prompt: string }) => Promise<ClassifiedEntries>`

- [ ] **Step 1: Write the failing schema tests**

In `tests/announcements/humanize.test.ts`, add `classifiedEntriesSchema` to the import from `../../src/announcements/humanize.js` and add this describe block:

```typescript
describe('classifiedEntriesSchema', () => {
  test('accepts new, improvement, and fix kinds', () => {
    const result = classifiedEntriesSchema.safeParse({
      entries: [
        { kind: 'new', text: 'a' },
        { kind: 'improvement', text: 'b' },
        { kind: 'fix', text: 'c' },
      ],
    })
    expect(result.success).toBe(true)
  })

  test('rejects unknown kinds', () => {
    const result = classifiedEntriesSchema.safeParse({ entries: [{ kind: 'chore', text: 'x' }] })
    expect(result.success).toBe(false)
  })
})
```

Also update the `deps()` factory so the file typechecks once the dep is added:

```typescript
const twoEntries = {
  entries: [
    { kind: 'new' as const, text: 'feat: edit a message to update the task' },
    { kind: 'fix' as const, text: 'fix: stale memory results' },
  ],
}

function deps(over: Partial<HumanizeChangelogDeps>): HumanizeChangelogDeps {
  return {
    resolveConfig: () => okConfig,
    buildModel: (): LanguageModel => 'test-model',
    generate: () => Promise.resolve({ text: 'Humanized!' }),
    generateStructured: () => Promise.resolve(twoEntries),
    ...over,
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/announcements/humanize.test.ts`
Expected: FAIL — module has no export `classifiedEntriesSchema`.

- [ ] **Step 3: Add the schema, type, and dep**

In `src/announcements/humanize.ts`:

Update imports:

```typescript
import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
```

Add after the `log` declaration:

```typescript
export const classifiedEntriesSchema = z.object({
  entries: z.array(
    z.object({
      kind: z.enum(['new', 'improvement', 'fix']),
      text: z.string(),
    }),
  ),
})

export type ClassifiedEntries = z.infer<typeof classifiedEntriesSchema>
```

Extend the deps interface:

```typescript
export interface HumanizeChangelogDeps {
  resolveConfig: () => LlmConfigResult
  buildModel: (apiKey: string, baseUrl: string, modelName: string) => LanguageModel
  generate: (opts: { model: LanguageModel; system: string; prompt: string }) => Promise<{ text: string }>
  generateStructured: (opts: { model: LanguageModel; system: string; prompt: string }) => Promise<ClassifiedEntries>
}
```

Add the default implementation to `defaultDeps`:

```typescript
const defaultDeps: HumanizeChangelogDeps = {
  resolveConfig: resolveAdminLlmConfig,
  buildModel: buildChatModel,
  generate: async (opts) => {
    const result = await generateText(opts)
    return { text: result.text }
  },
  generateStructured: async (opts) => {
    const result = await generateText({ ...opts, output: Output.object({ schema: classifiedEntriesSchema }) })
    return result.output
  },
}
```

Do NOT change `humanizeChangelog` yet — behavior is unchanged in this task.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/announcements/humanize.test.ts`
Expected: PASS (all existing tests plus the two new schema tests).

- [ ] **Step 5: Commit**

```bash
git add src/announcements/humanize.ts tests/announcements/humanize.test.ts
git commit -m "feat(announcements): structured classification schema and dep for changelog humanizer"
```

---

### Task 2: Wire the classify pass into `humanizeChangelog`

**Files:**
- Modify: `src/announcements/humanize.ts`
- Modify: `docs/architecture/behaviors.md` (version-release-announcements bullet, line ~28)
- Test: `tests/announcements/humanize.test.ts`

**Interfaces:**
- Consumes: `classifiedEntriesSchema`, `ClassifiedEntries`, `generateStructured` (Task 1).
- Produces:
  - `EMPTY_RELEASE_NOTE: string` — exported constant returned when zero entries survive classification.
  - `humanizeChangelog` behavior change: pass 1 classifies the raw section; pass 2 receives `JSON.stringify(classified.entries)`; zero survivors → `EMPTY_RELEASE_NOTE`; classify failure → `null`.

- [ ] **Step 1: Write the failing tests**

In `tests/announcements/humanize.test.ts`, add `EMPTY_RELEASE_NOTE` to the import. **Replace** the existing test `'returns trimmed model text and passes raw as prompt'` with:

```typescript
test('classifies first, then writes from surviving entries only', async () => {
  let classifyPrompt = ''
  let writePrompt = ''
  const seenModel: { apiKey?: string; baseUrl?: string; model?: string } = {}
  const result = await humanizeChangelog(
    '### Added\n- thing',
    deps({
      buildModel: (apiKey, baseUrl, model) => {
        seenModel.apiKey = apiKey
        seenModel.baseUrl = baseUrl
        seenModel.model = model
        return 'test-model'
      },
      generateStructured: (opts) => {
        classifyPrompt = opts.prompt
        return Promise.resolve(twoEntries)
      },
      generate: (opts) => {
        writePrompt = opts.prompt
        return Promise.resolve({ text: '  ✨ New\n- Thing  ' })
      },
    }),
  )
  expect(result).toBe('✨ New\n- Thing')
  expect(classifyPrompt).toContain('### Added')
  expect(writePrompt).not.toContain('### Added')
  expect(writePrompt).toContain('stale memory results')
  expect(seenModel).toEqual({ apiKey: 'k', baseUrl: 'https://llm.example', model: 'main' })
})

test('returns the empty-release note when nothing survives classification', async () => {
  const result = await humanizeChangelog('raw', deps({ generateStructured: () => Promise.resolve({ entries: [] }) }))
  expect(result).toBe(EMPTY_RELEASE_NOTE)
})

test('does not call the write pass when nothing survives', async () => {
  let writeCalled = false
  await humanizeChangelog(
    'raw',
    deps({
      generateStructured: () => Promise.resolve({ entries: [] }),
      generate: () => {
        writeCalled = true
        return Promise.resolve({ text: 'x' })
      },
    }),
  )
  expect(writeCalled).toBe(false)
})

test('returns null when the classify pass throws', async () => {
  const result = await humanizeChangelog(
    'raw',
    deps({ generateStructured: () => Promise.reject(new Error('boom')) }),
  )
  expect(result).toBeNull()
})
```

Keep the existing `'returns null when LLM config is missing'`, `'returns null when the model throws'`, and `'returns null when the model returns only whitespace'` tests unchanged (the last two now exercise the write pass, which is correct).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/announcements/humanize.test.ts`
Expected: FAIL — `EMPTY_RELEASE_NOTE` is not exported; the replaced happy-path test fails because the write pass receives the raw section.

- [ ] **Step 3: Implement the classify pass**

In `src/announcements/humanize.ts`, add after the schema:

```typescript
const CLASSIFY_SYSTEM_PROMPT = [
  'You select which software changelog entries matter to end users of a chat bot.',
  'Rules:',
  '- Keep only changes a non-technical user would notice or benefit from: new capabilities, improvements to speed, reliability or usability, and bug fixes.',
  '- Drop internal changes: build, ci, test, chore, refactor, deps, docs, formatting, and other internal plumbing.',
  '- When in doubt, drop the entry.',
  '- For each kept entry set kind: "new" for a new capability, "improvement" when something works better or faster now, "fix" when a problem is gone.',
  '- Keep "text" close to the original entry. Do not rewrite for tone; that happens later.',
].join('\n')

export const EMPTY_RELEASE_NOTE = 'This release is all behind-the-scenes improvements — nothing new to learn.'
```

Replace the body of the `try` block in `humanizeChangelog` with:

```typescript
    const model = deps.buildModel(config.main.apiKey, config.main.baseUrl, config.main.model)
    const classified = await deps.generateStructured({ model, system: CLASSIFY_SYSTEM_PROMPT, prompt: rawSection })
    if (classified.entries.length === 0) return EMPTY_RELEASE_NOTE
    const { text } = await deps.generate({
      model,
      system: SYSTEM_PROMPT,
      prompt: JSON.stringify(classified.entries),
    })
    const trimmed = text.trim()
    return trimmed.length === 0 ? null : trimmed
```

(`SYSTEM_PROMPT` is replaced in Task 3; keep the name for now.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/announcements/humanize.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the behaviors doc**

In `docs/architecture/behaviors.md`, in the **Version release announcements** bullet, after the phrase "humanizes it **once** via the **central/global** LLM (`src/announcements/humanize.ts`, `resolveGlobalConfig` + `main_model`; never BYOK)", insert:

```
Humanization is two-pass: a classify pass drops entries with no end-user value (internal churn; when in doubt, drop), then a write pass produces benefit-framed plain-language lines grouped under "✨ New" / "⚡ Improvements" / "🛠 Fixes"; a release with zero surviving entries yields a behind-the-scenes one-liner instead of the raw changelog.
```

- [ ] **Step 6: Commit**

```bash
git add src/announcements/humanize.ts tests/announcements/humanize.test.ts docs/architecture/behaviors.md
git commit -m "feat(announcements): classify changelog entries before writing release notes"
```

---

### Task 3: Benefit-framed three-section write prompt

**Files:**
- Modify: `src/announcements/humanize.ts`
- Test: `tests/announcements/humanize.test.ts`

**Interfaces:**
- Consumes: `humanizeChangelog` orchestration (Task 2).
- Produces: `SYSTEM_PROMPT` replaced by a tone-only write prompt with a few-shot example and the three exact section headers `✨ New`, `⚡ Improvements`, `🛠 Fixes`.

- [ ] **Step 1: Write the failing test**

In `tests/announcements/humanize.test.ts`, add:

```typescript
test('write prompt demands plain benefit framing and the three sections', async () => {
  let writeSystem = ''
  await humanizeChangelog(
    'raw',
    deps({
      generate: (opts) => {
        writeSystem = opts.system
        return Promise.resolve({ text: 'ok' })
      },
    }),
  )
  expect(writeSystem).toContain('⚡ Improvements')
  expect(writeSystem).toContain('Example input')
  expect(writeSystem).toContain('benefit')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/announcements/humanize.test.ts`
Expected: FAIL — current prompt has no `⚡ Improvements` header and no example.

- [ ] **Step 3: Replace the write prompt**

In `src/announcements/humanize.ts`, replace the whole `SYSTEM_PROMPT` constant with:

```typescript
const SYSTEM_PROMPT = [
  'You turn a filtered list of changelog entries (a JSON array of {kind, text}) into a short, friendly release announcement for end users of a chat bot.',
  'Rules:',
  '- Write for non-technical users. Plain, warm, concise.',
  '- No jargon, config keys, module names, commit hashes, or scopes in parentheses.',
  '- Each item is one short line framed as a benefit: what the user can now do, or what annoyance is gone.',
  '- Group into sections with these exact headers when content exists: "✨ New", "⚡ Improvements", "🛠 Fixes". Omit a section entirely if it has no items.',
  '- Output only the announcement body. No preamble, no "here is", no version number.',
  'Example input:',
  '[{"kind":"new","text":"feat(telegram): pick up edited messages and update the task"},{"kind":"fix","text":"fix(memory): recall search returns stale results after compaction"}]',
  'Example output:',
  '✨ New',
  '- Changed your mind? Edit your message and the bot updates the task.',
  '',
  '🛠 Fixes',
  "- The bot's memory search always shows fresh results again.",
].join('\n')
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/announcements/humanize.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the neighboring announcement suites**

Run: `bun test tests/announcements/ tests/debug/settings/admin/`
Expected: PASS (no other suite consumes the changed internals; this confirms no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/announcements/humanize.ts tests/announcements/humanize.test.ts
git commit -m "feat(announcements): benefit-framed three-section release notes prompt"
```
