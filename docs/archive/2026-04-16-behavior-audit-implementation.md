<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Behavior Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-phase AI agent script that extracts behavioral descriptions from unit tests and evaluates them as user stories through non-technical personas.

**Architecture:** Entry point at `scripts/behavior-audit.ts` orchestrates two phases. Phase 1 iterates test files, parses individual test cases, and calls an AI agent per test to extract plain-language behaviors. Phase 2 iterates extracted behaviors and calls an AI agent per behavior to score UX from three personas. Both phases use resumable progress tracking via `reports/progress.json`.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`), Zod v4

**Spec:** `docs/superpowers/specs/2026-04-16-behavior-audit-design.md`

---

## File Structure

| File                                      | Responsibility                                                 |
| ----------------------------------------- | -------------------------------------------------------------- |
| `scripts/behavior-audit.ts`               | Entry point — orchestrate Phase 1 then Phase 2                 |
| `scripts/behavior-audit/config.ts`        | Hardcoded LLM config, timeouts, retry constants, paths         |
| `scripts/behavior-audit/domain-map.ts`    | Map test file path → domain string                             |
| `scripts/behavior-audit/test-parser.ts`   | Parse test file into individual test case descriptors          |
| `scripts/behavior-audit/tools.ts`         | AI SDK tool definitions: readFile, grep, findFiles, listDir    |
| `scripts/behavior-audit/progress.ts`      | Read/write/update `reports/progress.json`                      |
| `scripts/behavior-audit/personas.ts`      | Three persona prompt constants                                 |
| `scripts/behavior-audit/extract.ts`       | Phase 1 — per-test extraction agent loop                       |
| `scripts/behavior-audit/evaluate.ts`      | Phase 2 — per-behavior evaluation agent loop                   |
| `scripts/behavior-audit/report-writer.ts` | Write `.behaviors.md` files, domain story files, summary index |

No test files — this is a standalone analysis script, not production code.

---

### Task 1: Config Module

**Files:**

- Create: `scripts/behavior-audit/config.ts`

- [ ] **Step 1: Create config.ts with all constants**

```typescript
import { resolve } from 'node:path'

export const MODEL = 'qwen3-30b-a3b'
export const BASE_URL = 'http://localhost:1234/v1'

export const PROJECT_ROOT = resolve(import.meta.dir, '../..')

export const REPORTS_DIR = resolve(PROJECT_ROOT, 'reports')
export const BEHAVIORS_DIR = resolve(REPORTS_DIR, 'behaviors')
export const STORIES_DIR = resolve(REPORTS_DIR, 'stories')
export const PROGRESS_PATH = resolve(REPORTS_DIR, 'progress.json')

export const PHASE1_TIMEOUT_MS = 1_200_000
export const PHASE2_TIMEOUT_MS = 600_000
export const MAX_RETRIES = 3
export const RETRY_BACKOFF_MS = [100_000, 300_000, 900_000] as const
export const MAX_STEPS = 20

export const EXCLUDED_PREFIXES = [
  'tests/e2e/',
  'tests/client/',
  'tests/helpers/',
  'tests/scripts/',
  'tests/review-loop/',
  'tests/types/',
] as const
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit scripts/behavior-audit/config.ts`

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/config.ts
git commit -m "feat(behavior-audit): add config module with constants"
```

---

### Task 2: Domain Map

**Files:**

- Create: `scripts/behavior-audit/domain-map.ts`

- [ ] **Step 1: Create domain-map.ts**

```typescript
const DOMAIN_RULES: ReadonlyArray<readonly [string, string]> = [
  ['tests/tools/', 'tools'],
  ['tests/commands/', 'commands'],
  ['tests/chat/telegram/', 'chat-telegram'],
  ['tests/chat/mattermost/', 'chat-mattermost'],
  ['tests/chat/discord/', 'chat-discord'],
  ['tests/chat/', 'chat'],
  ['tests/providers/kaneo/', 'providers-kaneo'],
  ['tests/providers/youtrack/', 'providers-youtrack'],
  ['tests/providers/', 'providers'],
  ['tests/config-editor/', 'config-editor'],
  ['tests/group-settings/', 'group-settings'],
  ['tests/message-queue/', 'message-queue'],
  ['tests/deferred-prompts/', 'deferred-prompts'],
  ['tests/identity/', 'identity'],
  ['tests/web/', 'web'],
  ['tests/wizard/', 'wizard'],
  ['tests/debug/', 'debug'],
  ['tests/db/', 'db'],
  ['tests/message-cache/', 'message-cache'],
]

export function getDomain(testPath: string): string {
  for (const [prefix, domain] of DOMAIN_RULES) {
    if (testPath.startsWith(prefix)) return domain
  }
  return 'core'
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit scripts/behavior-audit/domain-map.ts`

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/domain-map.ts
git commit -m "feat(behavior-audit): add domain mapping for test paths"
```

---

### Task 3: Test Parser

**Files:**

- Create: `scripts/behavior-audit/test-parser.ts`

- [ ] **Step 1: Create the TestCase type and parser**

```typescript
export interface TestCase {
  readonly name: string
  readonly fullPath: string
  readonly source: string
  readonly startLine: number
  readonly endLine: number
}

export interface ParsedTestFile {
  readonly filePath: string
  readonly tests: readonly TestCase[]
}

function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function countNewlines(text: string, upTo: number): number {
  let count = 0
  for (let i = 0; i < upTo && i < text.length; i++) {
    if (text[i] === '\n') count++
  }
  return count
}

export function parseTestFile(filePath: string, content: string): ParsedTestFile {
  const tests: TestCase[] = []
  const describeStack: string[] = []

  const testPattern = /\b(it|test)\s*\(\s*(['"`])(.*?)\2\s*,/g
  const describePattern = /\bdescribe\s*\(\s*(['"`])(.*?)\1\s*,/g

  // Collect all describe and test positions
  type Match = { type: 'describe' | 'test'; name: string; index: number }
  const matches: Match[] = []

  let m: RegExpExecArray | null = null
  while ((m = describePattern.exec(content)) !== null) {
    matches.push({ type: 'describe', name: m[2], index: m.index })
  }
  while ((m = testPattern.exec(content)) !== null) {
    matches.push({ type: 'test', name: m[3], index: m.index })
  }
  matches.sort((a, b) => a.index - b.index)

  // Simple approach: for each test match, extract its body by finding the callback's opening brace
  for (const match of matches) {
    if (match.type === 'describe') continue

    // Find the opening brace of the test callback
    const afterName = content.indexOf('{', match.index)
    if (afterName === -1) continue

    const closeBrace = findMatchingBrace(content, afterName)
    if (closeBrace === -1) continue

    const source = content.slice(match.index, closeBrace + 1)
    const startLine = countNewlines(content, match.index) + 1
    const endLine = countNewlines(content, closeBrace) + 1

    // Build full path from describe stack context
    // Look backwards from match.index to find enclosing describes
    const enclosing: string[] = []
    for (const dm of matches) {
      if (dm.type !== 'describe') continue
      if (dm.index >= match.index) break
      const dBrace = content.indexOf('{', dm.index)
      if (dBrace === -1) continue
      const dClose = findMatchingBrace(content, dBrace)
      if (dClose >= match.index) {
        enclosing.push(dm.name)
      }
    }

    const fullPath = [...enclosing, match.name].join(' > ')

    tests.push({
      name: match.name,
      fullPath,
      source,
      startLine,
      endLine,
    })
  }

  return { filePath, tests }
}
```

- [ ] **Step 2: Quick manual verification**

Run: `bun -e "import { parseTestFile } from './scripts/behavior-audit/test-parser.ts'; const content = await Bun.file('tests/tools/create-task.test.ts').text(); const result = parseTestFile('tests/tools/create-task.test.ts', content); console.log(result.tests.length, 'tests found'); result.tests.slice(0, 3).forEach(t => console.log(' -', t.fullPath))"`

Expected: Several tests found with describe-path names.

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/test-parser.ts
git commit -m "feat(behavior-audit): add test file parser for describe/it blocks"
```

---

### Task 4: Agent Tools

**Files:**

- Create: `scripts/behavior-audit/tools.ts`

- [ ] **Step 1: Create tools.ts with all four read-only tools**

```typescript
import { tool } from 'ai'
import { readdir, stat } from 'node:fs/promises'
import { resolve, relative, join } from 'node:path'
import { z } from 'zod'

import { PROJECT_ROOT } from './config.js'

function resolveSafe(inputPath: string): string | null {
  const resolved = resolve(PROJECT_ROOT, inputPath)
  if (!resolved.startsWith(PROJECT_ROOT)) return null
  return resolved
}

export function makeAuditTools() {
  return {
    readFile: tool({
      description: 'Read the contents of a file by project-relative path (e.g. "src/bot.ts")',
      parameters: z.object({
        path: z.string().describe('Project-relative file path'),
      }),
      execute: async ({ path }): Promise<string> => {
        const resolved = resolveSafe(path)
        if (resolved === null) return `Error: path "${path}" resolves outside project`
        try {
          return await Bun.file(resolved).text()
        } catch {
          return `Error: file not found: ${path}`
        }
      },
    }),

    grep: tool({
      description: 'Search for a regex pattern in src/ and tests/. Returns matching lines as "file:line:content".',
      parameters: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        directory: z.string().optional().describe('Subdirectory to search within (default: src/ and tests/)'),
      }),
      execute: async ({ pattern, directory }): Promise<string> => {
        const dirs = directory !== undefined ? [directory] : ['src', 'tests']
        const args = ['-rn', '--include=*.ts', '-E', pattern, ...dirs]
        try {
          const proc = Bun.spawn(['grep', ...args], {
            cwd: PROJECT_ROOT,
            stdout: 'pipe',
            stderr: 'pipe',
          })
          const output = await new Response(proc.stdout).text()
          await proc.exited
          const lines = output.trim().split('\n').filter(Boolean)
          if (lines.length > 100) {
            return lines.slice(0, 100).join('\n') + `\n... (${lines.length - 100} more matches truncated)`
          }
          return lines.length > 0 ? lines.join('\n') : 'No matches found'
        } catch {
          return `Error running grep for pattern: ${pattern}`
        }
      },
    }),

    findFiles: tool({
      description: 'Find files matching a glob-style name pattern (e.g. "*.test.ts", "bot.ts")',
      parameters: z.object({
        pattern: z.string().describe('File name pattern (passed to find -name)'),
      }),
      execute: async ({ pattern }): Promise<string> => {
        try {
          const proc = Bun.spawn(
            ['find', '.', '-name', pattern, '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*'],
            { cwd: PROJECT_ROOT, stdout: 'pipe', stderr: 'pipe' },
          )
          const output = await new Response(proc.stdout).text()
          await proc.exited
          const files = output.trim().split('\n').filter(Boolean)
          if (files.length > 50) {
            return files.slice(0, 50).join('\n') + `\n... (${files.length - 50} more files truncated)`
          }
          return files.length > 0 ? files.join('\n') : 'No files found'
        } catch {
          return `Error finding files with pattern: ${pattern}`
        }
      },
    }),

    listDir: tool({
      description: 'List the contents of a directory. Each entry shows whether it is a file or directory.',
      parameters: z.object({
        path: z.string().describe('Project-relative directory path'),
      }),
      execute: async ({ path }): Promise<string> => {
        const resolved = resolveSafe(path)
        if (resolved === null) return `Error: path "${path}" resolves outside project`
        try {
          const entries = await readdir(resolved)
          const results: string[] = []
          for (const entry of entries) {
            const entryPath = join(resolved, entry)
            const s = await stat(entryPath)
            results.push(s.isDirectory() ? `${entry}/` : entry)
          }
          return results.join('\n')
        } catch {
          return `Error: directory not found: ${path}`
        }
      },
    }),
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit scripts/behavior-audit/tools.ts`

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/tools.ts
git commit -m "feat(behavior-audit): add read-only agent tools (readFile, grep, findFiles, listDir)"
```

---

### Task 5: Personas

**Files:**

- Create: `scripts/behavior-audit/personas.ts`

- [ ] **Step 1: Create personas.ts with the three persona prompt strings**

```typescript
export const MARIA_PERSONA = `You are Maria, 35, an operations manager at a mid-size logistics company. You coordinate 12 people across two warehouses. You use Telegram for personal chats and WhatsApp groups with your team. You've never used a bot for work — your tasks live in spreadsheets and sticky notes. You heard about this bot from a colleague who said "just text it what you need done." You have no idea what a "project" or "status" means in software terms — to you a project is "the holiday sale prep" and a status is "done or not done." You are practical, impatient with anything that feels like extra work, and will abandon a feature if it takes more than two tries to understand. You value: things just working, clear confirmations, not losing track of what you asked for. You get frustrated by: jargon, having to remember exact commands, anything that feels like filling out a form.`

export const DANI_PERSONA = `You are Dani, 28, a freelance event photographer. You juggle 15-20 clients at any time — weddings, corporate events, portraits. You track everything in your head and Apple Notes. You downloaded Telegram because a client uses it, and someone told you this bot can help you keep track of deadlines. You're creative, scattered, and hate rigid systems. You'd message the bot the same way you'd text a friend: "remind me to send the Garcia wedding proofs by Friday" or "what do I have due this week?" You have zero tolerance for anything that feels like software — if the bot asks you to "specify a project identifier" you'll close the chat and never come back. You value: natural conversation, the bot understanding messy input, gentle reminders. You get frustrated by: required fields, technical error messages, having to set things up before you can use them.`

export const VIKTOR_PERSONA = `You are Viktor, 62, a retired high school history teacher. You volunteer at a community center organizing events, tutoring schedules, and supply drives. Your daughter set up Telegram for you and showed you this bot, saying it's "like a smart to-do list you can talk to." You type slowly, use full sentences with punctuation, and sometimes make typos. You don't know what an API is, what "sync" means, or why anything needs a "token." You are patient but easily confused by unexpected responses. If the bot says something you don't understand, you'll politely ask it to explain — but if it keeps being confusing, you'll assume you're doing something wrong and stop trying. You value: polite responses, clear step-by-step guidance, being told what to do next. You get frustrated by: cryptic abbreviations, being expected to know things nobody taught you, responses that assume familiarity with technology.`

export const ALL_PERSONAS = `### Persona 1: Maria — Operations Manager (Work)
${MARIA_PERSONA}

### Persona 2: Dani — Freelance Photographer (Daily Routine)
${DANI_PERSONA}

### Persona 3: Viktor — Retired Teacher (Personal Life)
${VIKTOR_PERSONA}`
```

- [ ] **Step 2: Commit**

```bash
git add scripts/behavior-audit/personas.ts
git commit -m "feat(behavior-audit): add three non-technical persona prompts"
```

---

### Task 6: Progress Module

**Files:**

- Create: `scripts/behavior-audit/progress.ts`

- [ ] **Step 1: Create progress types and read/write functions**

```typescript
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { PROGRESS_PATH } from './config.js'

type PhaseStatus = 'not-started' | 'in-progress' | 'done'

interface FailedEntry {
  readonly error: string
  readonly attempts: number
  readonly lastAttempt: string
}

interface Phase1Progress {
  status: PhaseStatus
  completedTests: Record<string, Record<string, 'done'>>
  failedTests: Record<string, FailedEntry>
  completedFiles: string[]
  stats: { filesTotal: number; filesDone: number; testsExtracted: number; testsFailed: number }
}

interface Phase2Progress {
  status: PhaseStatus
  completedBehaviors: Record<string, 'done'>
  failedBehaviors: Record<string, FailedEntry>
  stats: { behaviorsTotal: number; behaviorsDone: number; behaviorsFailed: number }
}

export interface Progress {
  version: 1
  startedAt: string
  phase1: Phase1Progress
  phase2: Phase2Progress
}

export function createEmptyProgress(filesTotal: number): Progress {
  return {
    version: 1,
    startedAt: new Date().toISOString(),
    phase1: {
      status: 'not-started',
      completedTests: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
    phase2: {
      status: 'not-started',
      completedBehaviors: {},
      failedBehaviors: {},
      stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
    },
  }
}

export async function loadProgress(): Promise<Progress | null> {
  try {
    const text = await Bun.file(PROGRESS_PATH).text()
    return JSON.parse(text) as Progress
  } catch {
    return null
  }
}

export async function saveProgress(progress: Progress): Promise<void> {
  await mkdir(dirname(PROGRESS_PATH), { recursive: true })
  await Bun.write(PROGRESS_PATH, JSON.stringify(progress, null, 2) + '\n')
}

export function isFileCompleted(progress: Progress, filePath: string): boolean {
  return progress.phase1.completedFiles.includes(filePath)
}

export function markTestDone(progress: Progress, filePath: string, testKey: string): void {
  if (progress.phase1.completedTests[filePath] === undefined) {
    progress.phase1.completedTests[filePath] = {}
  }
  progress.phase1.completedTests[filePath][testKey] = 'done'
  progress.phase1.stats.testsExtracted++
}

export function markTestFailed(progress: Progress, testKey: string, error: string): void {
  const existing = progress.phase1.failedTests[testKey]
  progress.phase1.failedTests[testKey] = {
    error,
    attempts: (existing?.attempts ?? 0) + 1,
    lastAttempt: new Date().toISOString(),
  }
  progress.phase1.stats.testsFailed++
}

export function markFileDone(progress: Progress, filePath: string): void {
  if (!progress.phase1.completedFiles.includes(filePath)) {
    progress.phase1.completedFiles.push(filePath)
    progress.phase1.stats.filesDone++
  }
}

export function markBehaviorDone(progress: Progress, behaviorKey: string): void {
  progress.phase2.completedBehaviors[behaviorKey] = 'done'
  progress.phase2.stats.behaviorsDone++
}

export function markBehaviorFailed(progress: Progress, behaviorKey: string, error: string): void {
  const existing = progress.phase2.failedBehaviors[behaviorKey]
  progress.phase2.failedBehaviors[behaviorKey] = {
    error,
    attempts: (existing?.attempts ?? 0) + 1,
    lastAttempt: new Date().toISOString(),
  }
  progress.phase2.stats.behaviorsFailed++
}

export function isBehaviorCompleted(progress: Progress, behaviorKey: string): boolean {
  return progress.phase2.completedBehaviors[behaviorKey] === 'done'
}

export function getFailedTestAttempts(progress: Progress, testKey: string): number {
  return progress.phase1.failedTests[testKey]?.attempts ?? 0
}

export function getFailedBehaviorAttempts(progress: Progress, behaviorKey: string): number {
  return progress.phase2.failedBehaviors[behaviorKey]?.attempts ?? 0
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit scripts/behavior-audit/progress.ts`

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/progress.ts
git commit -m "feat(behavior-audit): add resumable progress tracking"
```

---

### Task 7: Report Writer

**Files:**

- Create: `scripts/behavior-audit/report-writer.ts`

- [ ] **Step 1: Create behavior file writer**

```typescript
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { BEHAVIORS_DIR, STORIES_DIR } from './config.js'
import { getDomain } from './domain-map.js'

export interface ExtractedBehavior {
  readonly testName: string
  readonly fullPath: string
  readonly behavior: string
  readonly context: string
}

export interface EvaluatedBehavior {
  readonly testName: string
  readonly behavior: string
  readonly userStory: string
  readonly maria: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly dani: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly viktor: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
}

export async function writeBehaviorFile(testFilePath: string, behaviors: readonly ExtractedBehavior[]): Promise<void> {
  const domain = getDomain(testFilePath)
  const fileName = testFilePath.split('/').pop()!.replace('.test.ts', '.test.behaviors.md')
  const outPath = join(BEHAVIORS_DIR, domain, fileName)
  await mkdir(dirname(outPath), { recursive: true })

  const lines: string[] = [`# ${testFilePath}\n`]
  for (const b of behaviors) {
    lines.push(`## Test: "${b.fullPath}"\n`)
    lines.push(`**Behavior:** ${b.behavior}`)
    lines.push(`**Context:** ${b.context}\n`)
  }

  await Bun.write(outPath, lines.join('\n'))
}

function domainTitle(domain: string): string {
  return domain
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export async function writeStoryFile(domain: string, evaluations: readonly EvaluatedBehavior[]): Promise<void> {
  const outPath = join(STORIES_DIR, `${domain}.md`)
  await mkdir(dirname(outPath), { recursive: true })

  const lines: string[] = [`# ${domainTitle(domain)} — User Stories & UX Evaluation\n`]

  for (const e of evaluations) {
    lines.push(`## "${e.testName}"\n`)
    lines.push(`**User Story:** ${e.userStory}\n`)
    lines.push('| Persona | Discover | Use | Retain | Notes |')
    lines.push('|---------|----------|-----|--------|-------|')
    lines.push(
      `| Maria   | ${e.maria.discover}        | ${e.maria.use}   | ${e.maria.retain}      | ${e.maria.notes} |`,
    )
    lines.push(`| Dani    | ${e.dani.discover}        | ${e.dani.use}   | ${e.dani.retain}      | ${e.dani.notes} |`)
    lines.push(
      `| Viktor  | ${e.viktor.discover}        | ${e.viktor.use}   | ${e.viktor.retain}      | ${e.viktor.notes} |`,
    )
    lines.push('')
    if (e.flaws.length > 0) {
      lines.push('**Flaws:**\n')
      for (const flaw of e.flaws) lines.push(`- ${flaw}`)
      lines.push('')
    }
    if (e.improvements.length > 0) {
      lines.push('**Improvements:**\n')
      for (const imp of e.improvements) lines.push(`- ${imp}`)
      lines.push('')
    }
  }

  await Bun.write(outPath, lines.join('\n'))
}

interface DomainSummary {
  readonly domain: string
  readonly count: number
  readonly avgDiscover: number
  readonly avgUse: number
  readonly avgRetain: number
  readonly worstPersona: string
}

interface FailedItem {
  readonly testFile: string
  readonly testName: string
  readonly error: string
  readonly attempts: number
}

export async function writeIndexFile(
  summaries: readonly DomainSummary[],
  totalProcessed: number,
  totalFailed: number,
  flawFrequency: ReadonlyMap<string, number>,
  improvementFrequency: ReadonlyMap<string, number>,
  failedItems: readonly FailedItem[],
): Promise<void> {
  const outPath = join(STORIES_DIR, 'index.md')
  await mkdir(dirname(outPath), { recursive: true })

  const lines: string[] = [
    '# Behavior Audit Summary\n',
    `**Generated:** ${new Date().toISOString()}`,
    `**Tests processed:** ${totalProcessed}`,
    `**Behaviors failed:** ${totalFailed}\n`,
    '| Domain | Behaviors | Avg Discover | Avg Use | Avg Retain | Worst Persona |',
    '|--------|-----------|-------------|---------|------------|---------------|',
  ]

  for (const s of summaries) {
    lines.push(
      `| ${s.domain} | ${s.count} | ${s.avgDiscover.toFixed(1)} | ${s.avgUse.toFixed(1)} | ${s.avgRetain.toFixed(1)} | ${s.worstPersona} |`,
    )
  }
  lines.push('')

  const topFlaws = [...flawFrequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  if (topFlaws.length > 0) {
    lines.push('## Top 10 Flaws (by frequency)\n')
    for (const [i, [flaw, count]] of topFlaws.entries()) {
      lines.push(`${i + 1}. "${flaw}" (seen in ${count} behaviors)`)
    }
    lines.push('')
  }

  const topImprovements = [...improvementFrequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  if (topImprovements.length > 0) {
    lines.push('## Top 10 Improvements (by frequency)\n')
    for (const [i, [imp, count]] of topImprovements.entries()) {
      lines.push(`${i + 1}. "${imp}" (suggested for ${count} behaviors)`)
    }
    lines.push('')
  }

  if (failedItems.length > 0) {
    lines.push('## Failed Extractions\n')
    lines.push('| Test File | Test Name | Error | Attempts |')
    lines.push('|-----------|-----------|-------|----------|')
    for (const f of failedItems) {
      lines.push(`| ${f.testFile} | ${f.testName} | ${f.error} | ${f.attempts} |`)
    }
    lines.push('')
  }

  await Bun.write(outPath, lines.join('\n'))
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit scripts/behavior-audit/report-writer.ts`

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/report-writer.ts
git commit -m "feat(behavior-audit): add report writer for behaviors, stories, and index"
```

---

### Task 8: Phase 1 — Extract

**Files:**

- Create: `scripts/behavior-audit/extract.ts`

- [ ] **Step 1: Create extract.ts with the per-test agent loop**

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE1_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import type { Progress } from './progress.js'
import { getFailedTestAttempts, markFileDone, markTestDone, markTestFailed, saveProgress } from './progress.js'
import type { ExtractedBehavior } from './report-writer.js'
import { writeBehaviorFile } from './report-writer.js'
import type { ParsedTestFile, TestCase } from './test-parser.js'
import { makeAuditTools } from './tools.js'

const apiKey = process.env['OPENAI_API_KEY'] ?? 'no-key'
const provider = createOpenAICompatible({ name: 'behavior-audit', apiKey, baseURL: BASE_URL })
const model = provider(MODEL)

const SYSTEM_PROMPT = `You are a senior software analyst examining a unit test from a Telegram/Discord/Mattermost chat bot called "papai" that manages tasks via LLM tool-calling. Your job is to understand what real-world behavior this test verifies and describe it in plain language that a non-programmer could understand.

You have tools to read source files, search the codebase, find files, and list directories. Use them to understand the implementation behind the test — follow imports, read the functions being tested, understand the full chain from user input to bot response.

Respond with ONLY a JSON object:
{
  "behavior": "Plain-language description of what the bot does in this scenario, written as if explaining to someone who has never seen code. Start with 'When...' to describe the trigger, then describe what happens.",
  "context": "Technical context about HOW this works internally — what functions are called, what the data flow looks like. This is for developers reviewing the audit."
}`

function deriveImplPath(testPath: string): string {
  return testPath.replace(/^tests\//, 'src/').replace(/\.test\.ts$/, '.ts')
}

function buildUserMessage(testCase: TestCase, testFilePath: string): string {
  const implPath = deriveImplPath(testFilePath)
  return `**Test file:** ${testFilePath}
**Test name:** ${testCase.fullPath}
**Likely implementation file:** ${implPath}

\`\`\`typescript
${testCase.source}
\`\`\``
}

interface ExtractionResult {
  readonly behavior: string
  readonly context: string
}

function parseJsonResponse(text: string): ExtractionResult | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch === null) return null
    const parsed = JSON.parse(jsonMatch[0])
    if (typeof parsed.behavior === 'string' && typeof parsed.context === 'string') {
      return { behavior: parsed.behavior, context: parsed.context }
    }
    return null
  } catch {
    return null
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function extractSingleTest(
  testCase: TestCase,
  testFilePath: string,
  attempt: number,
): Promise<ExtractionResult | null> {
  const timeout = attempt > 0 ? PHASE1_TIMEOUT_MS * 2 : PHASE1_TIMEOUT_MS
  const tools = makeAuditTools()
  const start = Date.now()

  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: buildUserMessage(testCase, testFilePath),
      tools,
      maxSteps: MAX_STEPS,
      abortSignal: AbortSignal.timeout(timeout),
    })

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    const toolCallCount = result.steps.reduce((sum, s) => sum + (s.toolCalls?.length ?? 0), 0)
    const parsed = parseJsonResponse(result.text)

    if (parsed !== null) {
      console.log(`    ✓ (${elapsed}s, ${toolCallCount} tool calls)`)
      return parsed
    }

    console.log(`    ✗ malformed JSON (${elapsed}s)`)
    return null
  } catch (error) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    const msg = error instanceof Error ? error.message : String(error)
    console.log(`    ✗ ${msg} (${elapsed}s)`)
    return null
  }
}

export async function runPhase1(testFiles: readonly ParsedTestFile[], progress: Progress): Promise<void> {
  progress.phase1.status = 'in-progress'
  await saveProgress(progress)

  const totalFiles = testFiles.length
  let fileIndex = 0

  for (const testFile of testFiles) {
    fileIndex++
    if (progress.phase1.completedFiles.includes(testFile.filePath)) {
      console.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath} (skipped, already done)`)
      continue
    }

    console.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath}`)

    const behaviors: ExtractedBehavior[] = []
    const totalTests = testFile.tests.length
    let testIndex = 0

    for (const testCase of testFile.tests) {
      testIndex++
      const testKey = `${testFile.filePath}::${testCase.fullPath}`
      const previousAttempts = getFailedTestAttempts(progress, testKey)

      if (previousAttempts >= MAX_RETRIES) {
        console.log(`  [${testIndex}/${totalTests}] "${testCase.name}" (skipped, max retries reached)`)
        continue
      }

      process.stdout.write(`  [${testIndex}/${totalTests}] "${testCase.name}" `)

      let extracted: ExtractionResult | null = null
      let lastError = ''

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]
          console.log(`  [${testIndex}/${totalTests}] "${testCase.name}" ✗ retry ${attempt}/${MAX_RETRIES}`)
          await sleep(backoff)
          process.stdout.write(`  [${testIndex}/${totalTests}] "${testCase.name}" `)
        }

        extracted = await extractSingleTest(testCase, testFile.filePath, attempt)
        if (extracted !== null) break
        lastError = 'extraction failed'
      }

      if (extracted !== null) {
        behaviors.push({
          testName: testCase.name,
          fullPath: testCase.fullPath,
          behavior: extracted.behavior,
          context: extracted.context,
        })
        markTestDone(progress, testFile.filePath, testKey)
      } else {
        markTestFailed(progress, testKey, lastError)
      }
    }

    if (behaviors.length > 0) {
      await writeBehaviorFile(testFile.filePath, behaviors)
      console.log(`  → wrote ${behaviors.length} behaviors`)
    }

    markFileDone(progress, testFile.filePath)
    await saveProgress(progress)
  }

  progress.phase1.status = 'done'
  await saveProgress(progress)
  console.log(
    `\n[Phase 1 complete] ${progress.phase1.stats.filesDone} files, ${progress.phase1.stats.testsExtracted} behaviors extracted, ${progress.phase1.stats.testsFailed} failed`,
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit scripts/behavior-audit/extract.ts`

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/extract.ts
git commit -m "feat(behavior-audit): add Phase 1 extraction agent loop"
```

---

### Task 9: Phase 2 — Evaluate

**Files:**

- Create: `scripts/behavior-audit/evaluate.ts`

- [ ] **Step 1: Create evaluate.ts with the per-behavior agent loop**

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  BASE_URL,
  BEHAVIORS_DIR,
  MAX_RETRIES,
  MAX_STEPS,
  MODEL,
  PHASE2_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
} from './config.js'
import { getDomain } from './domain-map.js'
import { ALL_PERSONAS } from './personas.js'
import type { Progress } from './progress.js'
import {
  getFailedBehaviorAttempts,
  isBehaviorCompleted,
  markBehaviorDone,
  markBehaviorFailed,
  saveProgress,
} from './progress.js'
import type { EvaluatedBehavior } from './report-writer.js'
import { writeIndexFile, writeStoryFile } from './report-writer.js'
import { makeAuditTools } from './tools.js'

const apiKey = process.env['OPENAI_API_KEY'] ?? 'no-key'
const provider = createOpenAICompatible({ name: 'behavior-audit-eval', apiKey, baseURL: BASE_URL })
const model = provider(MODEL)

const SYSTEM_PROMPT = `${ALL_PERSONAS}

---

You are evaluating a single behavior of a Telegram chat bot from the perspective of all three personas above. You have tools to read source files, search the codebase, find files, and list directories. Use them to look at actual bot responses, error messages, system prompts, and command help text to judge the real UX — don't guess.

For each persona, evaluate:
- discover (1-5): Would they find and trigger this feature naturally?
- use (1-5): Could they use it successfully without help?
- retain (1-5): Would they keep using it after the first time?

Also identify the user story this behavior fulfills.

Respond with ONLY a JSON object:
{
  "userStory": "As a [user type], I want to [action] so that [benefit].",
  "maria": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "dani": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "viktor": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "flaws": ["flaw 1", "flaw 2"],
  "improvements": ["improvement 1", "improvement 2"]
}`

interface ParsedBehavior {
  readonly testFile: string
  readonly testName: string
  readonly behavior: string
  readonly context: string
  readonly domain: string
}

async function parseBehaviorFiles(): Promise<readonly ParsedBehavior[]> {
  const behaviors: ParsedBehavior[] = []

  async function walkDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walkDir(fullPath)
      } else if (entry.name.endsWith('.behaviors.md')) {
        const content = await Bun.file(fullPath).text()
        const testFileMatch = content.match(/^# (.+)$/m)
        const testFile = testFileMatch?.[1] ?? 'unknown'
        const domain = getDomain(testFile)

        const sections = content.split(/^## Test: /m).slice(1)
        for (const section of sections) {
          const nameMatch = section.match(/^"(.+?)"/)
          const behaviorMatch = section.match(/\*\*Behavior:\*\* (.+?)(?=\n\*\*Context:|\n##|\n$)/s)
          const contextMatch = section.match(/\*\*Context:\*\* (.+?)(?=\n##|\n$)/s)
          if (nameMatch !== null && behaviorMatch !== null) {
            behaviors.push({
              testFile,
              testName: nameMatch[1],
              behavior: behaviorMatch[1].trim(),
              context: contextMatch?.[1]?.trim() ?? '',
              domain,
            })
          }
        }
      }
    }
  }

  await walkDir(BEHAVIORS_DIR)
  return behaviors
}

function buildUserMessage(b: ParsedBehavior): string {
  return `**Domain:** ${b.domain}
**Test file:** ${b.testFile}
**Test name:** ${b.testName}

**Behavior:** ${b.behavior}

**Context:** ${b.context}`
}

interface EvalResult {
  readonly userStory: string
  readonly maria: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly dani: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly viktor: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
}

function parseJsonResponse(text: string): EvalResult | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch === null) return null
    const parsed = JSON.parse(jsonMatch[0])
    if (typeof parsed.userStory === 'string' && parsed.maria !== undefined) {
      return parsed as EvalResult
    }
    return null
  } catch {
    return null
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function evaluateSingleBehavior(b: ParsedBehavior, attempt: number): Promise<EvalResult | null> {
  const timeout = attempt > 0 ? PHASE2_TIMEOUT_MS * 2 : PHASE2_TIMEOUT_MS
  const tools = makeAuditTools()
  const start = Date.now()

  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: buildUserMessage(b),
      tools,
      maxSteps: MAX_STEPS,
      abortSignal: AbortSignal.timeout(timeout),
    })

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    const parsed = parseJsonResponse(result.text)

    if (parsed !== null) {
      console.log(`✓ (${elapsed}s)`)
      return parsed
    }

    console.log(`✗ malformed JSON (${elapsed}s)`)
    return null
  } catch (error) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    const msg = error instanceof Error ? error.message : String(error)
    console.log(`✗ ${msg} (${elapsed}s)`)
    return null
  }
}

export async function runPhase2(progress: Progress): Promise<void> {
  console.log('\n[Phase 2] Parsing behavior files...')
  const allBehaviors = await parseBehaviorFiles()
  progress.phase2.status = 'in-progress'
  progress.phase2.stats.behaviorsTotal = allBehaviors.length
  await saveProgress(progress)

  console.log(`[Phase 2] Evaluating ${allBehaviors.length} behaviors...\n`)

  const evaluationsByDomain = new Map<string, EvaluatedBehavior[]>()
  const flawFrequency = new Map<string, number>()
  const improvementFrequency = new Map<string, number>()

  let behaviorIndex = 0

  for (const b of allBehaviors) {
    behaviorIndex++
    const behaviorKey = `${b.testFile}::${b.testName}`

    if (isBehaviorCompleted(progress, behaviorKey)) {
      console.log(`  [${behaviorIndex}/${allBehaviors.length}] ${b.domain} :: "${b.testName}" (skipped)`)
      continue
    }

    const previousAttempts = getFailedBehaviorAttempts(progress, behaviorKey)
    if (previousAttempts >= MAX_RETRIES) {
      console.log(`  [${behaviorIndex}/${allBehaviors.length}] ${b.domain} :: "${b.testName}" (max retries)`)
      continue
    }

    process.stdout.write(`  [${behaviorIndex}/${allBehaviors.length}] ${b.domain} :: "${b.testName}" `)

    let evalResult: EvalResult | null = null
    let lastError = ''

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]
        await sleep(backoff)
        process.stdout.write(`  [${behaviorIndex}/${allBehaviors.length}] ${b.domain} :: "${b.testName}" `)
      }

      evalResult = await evaluateSingleBehavior(b, attempt)
      if (evalResult !== null) break
      lastError = 'evaluation failed'
    }

    if (evalResult !== null) {
      const evaluated: EvaluatedBehavior = {
        testName: b.testName,
        behavior: b.behavior,
        userStory: evalResult.userStory,
        maria: evalResult.maria,
        dani: evalResult.dani,
        viktor: evalResult.viktor,
        flaws: evalResult.flaws,
        improvements: evalResult.improvements,
      }

      if (!evaluationsByDomain.has(b.domain)) evaluationsByDomain.set(b.domain, [])
      evaluationsByDomain.get(b.domain)!.push(evaluated)

      for (const flaw of evalResult.flaws) {
        flawFrequency.set(flaw, (flawFrequency.get(flaw) ?? 0) + 1)
      }
      for (const imp of evalResult.improvements) {
        improvementFrequency.set(imp, (improvementFrequency.get(imp) ?? 0) + 1)
      }

      markBehaviorDone(progress, behaviorKey)
    } else {
      markBehaviorFailed(progress, behaviorKey, lastError)
    }

    // Save progress every 10 behaviors
    if (behaviorIndex % 10 === 0) await saveProgress(progress)
  }

  // Write story files per domain
  for (const [domain, evaluations] of evaluationsByDomain) {
    await writeStoryFile(domain, evaluations)
  }

  // Build summaries for index
  const summaries = [...evaluationsByDomain.entries()].map(([domain, evals]) => {
    const avgDiscover =
      evals.reduce((sum, e) => sum + (e.maria.discover + e.dani.discover + e.viktor.discover) / 3, 0) / evals.length
    const avgUse = evals.reduce((sum, e) => sum + (e.maria.use + e.dani.use + e.viktor.use) / 3, 0) / evals.length
    const avgRetain =
      evals.reduce((sum, e) => sum + (e.maria.retain + e.dani.retain + e.viktor.retain) / 3, 0) / evals.length

    const personaAvgs = {
      Maria: evals.reduce((s, e) => s + (e.maria.discover + e.maria.use + e.maria.retain) / 3, 0) / evals.length,
      Dani: evals.reduce((s, e) => s + (e.dani.discover + e.dani.use + e.dani.retain) / 3, 0) / evals.length,
      Viktor: evals.reduce((s, e) => s + (e.viktor.discover + e.viktor.use + e.viktor.retain) / 3, 0) / evals.length,
    }
    const worst = Object.entries(personaAvgs).sort((a, b) => a[1] - b[1])[0]

    return {
      domain,
      count: evals.length,
      avgDiscover,
      avgUse,
      avgRetain,
      worstPersona: `${worst[0]} (${worst[1].toFixed(1)})`,
    }
  })

  // Collect failed items
  const failedItems = Object.entries(progress.phase2.failedBehaviors).map(([key, entry]) => {
    const [testFile, ...nameParts] = key.split('::')
    return { testFile, testName: nameParts.join('::'), error: entry.error, attempts: entry.attempts }
  })

  await writeIndexFile(
    summaries,
    progress.phase2.stats.behaviorsDone,
    progress.phase2.stats.behaviorsFailed,
    flawFrequency,
    improvementFrequency,
    failedItems,
  )

  progress.phase2.status = 'done'
  await saveProgress(progress)
  console.log(
    `\n[Phase 2 complete] ${progress.phase2.stats.behaviorsDone} behaviors evaluated, ${progress.phase2.stats.behaviorsFailed} failed`,
  )
  console.log('→ reports/stories/index.md written')
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit scripts/behavior-audit/evaluate.ts`

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/evaluate.ts
git commit -m "feat(behavior-audit): add Phase 2 evaluation agent loop with three personas"
```

---

### Task 10: Entry Point

**Files:**

- Create: `scripts/behavior-audit.ts`

- [ ] **Step 1: Create the entry point that wires everything together**

```typescript
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { EXCLUDED_PREFIXES, PROJECT_ROOT } from './behavior-audit/config.js'
import { runPhase2 } from './behavior-audit/evaluate.js'
import { runPhase1 } from './behavior-audit/extract.js'
import { createEmptyProgress, loadProgress, saveProgress } from './behavior-audit/progress.js'
import { parseTestFile } from './behavior-audit/test-parser.js'

async function discoverTestFiles(): Promise<string[]> {
  const testDir = join(PROJECT_ROOT, 'tests')
  const files: string[] = []

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.name.endsWith('.test.ts')) {
        const relPath = relative(PROJECT_ROOT, fullPath)
        const excluded = EXCLUDED_PREFIXES.some((p) => relPath.startsWith(p))
        if (!excluded) files.push(relPath)
      }
    }
  }

  await walk(testDir)
  return files.sort()
}

async function main(): Promise<void> {
  console.log('Behavior Audit — discovering test files...\n')

  const testFilePaths = await discoverTestFiles()
  console.log(`Found ${testFilePaths.length} test files (after exclusions)\n`)

  let progress = await loadProgress()
  if (progress !== null) {
    console.log(
      `Resuming from progress.json (Phase 1: ${progress.phase1.status}, Phase 2: ${progress.phase2.status})\n`,
    )
  } else {
    progress = createEmptyProgress(testFilePaths.length)
    await saveProgress(progress)
  }

  // Phase 1
  if (progress.phase1.status !== 'done') {
    const parsedFiles = await Promise.all(
      testFilePaths.map(async (filePath) => {
        const content = await Bun.file(join(PROJECT_ROOT, filePath)).text()
        return parseTestFile(filePath, content)
      }),
    )
    await runPhase1(parsedFiles, progress)
  } else {
    console.log('[Phase 1] Already complete, skipping.\n')
  }

  // Phase 2
  if (progress.phase2.status !== 'done') {
    await runPhase2(progress)
  } else {
    console.log('[Phase 2] Already complete.\n')
  }

  console.log('\nBehavior audit complete.')
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit scripts/behavior-audit.ts`

- [ ] **Step 3: Smoke test with dry run**

Verify the script discovers test files correctly (this will fail at the LLM call, which is fine — we just want to see file discovery works):

Run: `OPENAI_API_KEY=test bun scripts/behavior-audit.ts 2>&1 | head -5`

Expected: Prints "Found N test files (after exclusions)" with N ≈ 250-300 (after exclusions).

- [ ] **Step 4: Add npm script to package.json**

Add to `package.json` scripts section:

```json
"audit:behavior": "bun scripts/behavior-audit.ts"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit.ts package.json
git commit -m "feat(behavior-audit): add entry point and npm script"
```

---

### Task 11: Add reports/ to .gitignore

**Files:**

- Modify: `.gitignore`

- [ ] **Step 1: Add behavior audit output dirs to .gitignore**

Add these lines under the existing `reports/` entries (if `reports/` is already ignored, verify the patterns cover the new subdirectories):

```
reports/behaviors/
reports/stories/
reports/progress.json
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore behavior audit output files"
```

---

### Task 12: End-to-End Verification

- [ ] **Step 1: Run knip to check for unused exports**

Run: `bun knip`

Expected: No new unused export warnings from the `scripts/behavior-audit/` directory.

- [ ] **Step 2: Run format check**

Run: `bun format`

- [ ] **Step 3: Run typecheck**

Run: `bun typecheck`

Expected: No new errors from `scripts/behavior-audit/` files.

- [ ] **Step 4: Final commit if format changed anything**

```bash
git add -A
git commit -m "chore: format behavior-audit scripts"
```
