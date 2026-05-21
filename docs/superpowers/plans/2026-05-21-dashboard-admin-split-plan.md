# Dashboard / Admin Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the unified `/dashboard` route and static bundle into a live, ephemeral engineer observability page (`/debug`) and a durable, configuration/records operator page (`/admin`), preserving security, styling, and compatibility.

**Architecture:** We will extract core UI components, utility helpers, modal primitives, and API types into a clean, shared client layer (`client/shared/`). Then, we will generalize `scripts/build-client.ts` to support multi-bundle builds. Next, server-side routing will be adjusted to serve `/debug`, `/admin`, and a 301 redirect for `/dashboard`. Finally, components will be migrated, unused code deleted, and tests ported.

**Tech Stack:** Svelte 5, TypeScript, Zod v4, Bun, Drizzle ORM

---

## Track A — Shared primitives, no behavior change yet

### Task 1: Create Shared Client skeleton

**Files:**

- Create: `client/shared/helpers.ts`
- Create: `client/shared/api-types.ts`
- Create: `client/shared/fetcher-helpers.ts`
- Create: `client/shared/Modal.svelte`
- Create: `client/shared/PropertiesTable.svelte`
- Create: `client/shared/TreeView.svelte`
- Create: `client/shared/StatusDot.svelte`
- Create: `client/shared/PanelShell.svelte`
- Test: `tests/client/shared/Modal.test.ts`
- Test: `tests/client/shared/fetcher-helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/client/shared/fetcher-helpers.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { errorMessageFrom, readBody, requireOk } from '../../../client/shared/fetcher-helpers.js'

describe('fetcher-helpers', () => {
  test('errorMessageFrom extracts error string', () => {
    expect(errorMessageFrom({ error: 'failed' }, 'fallback')).toBe('failed')
    expect(errorMessageFrom({}, 'fallback')).toBe('fallback')
  })

  test('readBody extracts json', async () => {
    const res = new Response(JSON.stringify({ ok: true }))
    expect(await readBody(res)).toEqual({ ok: true })
  })

  test('requireOk throws on non-ok', () => {
    const res = { ok: false, status: 500 } as Response
    expect(() => requireOk(res, { error: 'server error' })).toThrow('server error')
  })
})
```

Create `tests/client/shared/Modal.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { mount, unmount } from 'svelte'
import Modal from '../../../client/shared/Modal.svelte'

describe('Modal.svelte', () => {
  test('renders title and content when open', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    let closed = false
    const component = mount(Modal, {
      target,
      props: {
        open: true,
        title: 'Test Modal',
        onClose: () => {
          closed = true
        },
        body: () => {
          const div = document.createElement('div')
          div.textContent = 'Modal Content'
          return div
        },
      },
    })
    expect(target.innerHTML).toContain('Test Modal')
    expect(target.innerHTML).toContain('Modal Content')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test:client tests/client/shared/`
Expected: FAIL due to missing files and compile errors.

- [ ] **Step 3: Write minimal implementation**

Create `client/shared/helpers.ts`:

```typescript
const LEVEL_NAMES: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
}

export function levelName(level: number): string {
  return LEVEL_NAMES[level] ?? `L${level}`
}

export function levelClass(level: number): string {
  if (level >= 50) return 'log-error'
  if (level >= 40) return 'log-warn'
  if (level >= 30) return 'log-info'
  return 'log-debug'
}

export function formatTime(ts: number | string): string {
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts)
  return d.toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatUptime(startedAt: number): string {
  const ms = Date.now() - startedAt
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h${m}m`
  return `${m}m${s % 60}s`
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function escapeHtml(str: string): string {
  return str.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
}
```

Create `client/shared/api-types.ts`:

```typescript
import type {
  Fact,
  Instruction,
  Session,
  Wizard,
  SchedulerInfo,
  PollersInfo,
  MessageCacheInfo,
  TokenInfo,
  ToolCall,
  LlmTrace,
  LogEntry,
  StateInitEvent,
  StateStatsEvent,
  CacheEvent,
  UserIdEvent,
  SchedulerTickEvent,
  PollerEvent,
  MessageCacheEvent,
  Turn,
  Notification,
  ToolFailure,
} from '../../src/debug/schemas.js'
import type { GlobalStats, StatsWindow, SubjectStats } from '../../src/stats/types.js'

export type {
  Fact,
  Instruction,
  Session,
  Wizard,
  SchedulerInfo,
  PollersInfo,
  MessageCacheInfo,
  TokenInfo,
  ToolCall,
  LlmTrace,
  LogEntry,
  StateInitEvent,
  StateStatsEvent,
  CacheEvent,
  UserIdEvent,
  SchedulerTickEvent,
  PollerEvent,
  MessageCacheEvent,
  Turn,
  Notification,
  ToolFailure,
  GlobalStats,
  StatsWindow,
  SubjectStats,
}

export type RecurringTask = {
  id: string
  userId: string
  title: string
  rrule: string | null
  nextRun: string | null
  enabled: boolean
  lastRun: string | null
}

export type DeferredPrompt = {
  id: string
  createdByUserId: string
  prompt: string
  fireAt: string
  rrule: string | null
  status: string
}

export type Memo = {
  id: string
  userId: string
  content: string
  summary: string | null
  tags: readonly string[]
  status: string
  createdAt: string
  updatedAt: string
}

export type IdentityMappingEntry = {
  userId: string
  provider: string
  providerUserId: string | null
  providerUserLogin: string | null
  displayName: string | null
}

export type AuthorizedGroupEntry = {
  group_id: string
  added_by: string
  added_at: string
}

export type BillingWindow = '24h' | '7d' | '30d' | 'all'

export type BillingRoleTotals = {
  inputTokens: number
  outputTokens: number
  calls: number
}

export type BillingSubject = {
  storageContextId: string
  contextType: 'dm' | 'group'
  displayName: string | null
  totals: {
    main: BillingRoleTotals
    small: BillingRoleTotals
    embedding: BillingRoleTotals
  }
  toolCalls: number
  lastActiveAt: number
}

export type BillingRequestRow = {
  eventId: string
  occurredAt: number
  turnId: string | null
  chatUserId: string
  model: string
  modelRole: 'main' | 'small' | 'embedding'
  inputTokens: number | null
  outputTokens: number | null
  stepCount: number
  toolCallCount: number
  messageCount: number
  durationMs: number
  finishReason: string | null
  error: string | null
}

export type BillingDetail = {
  subject: BillingSubject
  requests: readonly BillingRequestRow[]
  truncated: boolean
}

export type AdminLlmKeyState = {
  value: string | null
  updatedAt: number | null
  updatedBy: string | null
}

export type AdminLlmSnapshot = {
  llm_apikey: AdminLlmKeyState
  llm_baseurl: AdminLlmKeyState
  main_model: AdminLlmKeyState
  small_model: AdminLlmKeyState
  embedding_model: AdminLlmKeyState
}
```

Create `client/shared/fetcher-helpers.ts`:

```typescript
import { z } from 'zod'

export const ErrorBodySchema = z.object({ error: z.string() })

export const errorMessageFrom = (body: unknown, fallback: string): string => {
  const parsed = ErrorBodySchema.safeParse(body)
  return parsed.success ? parsed.data.error : fallback
}

export const readBody = async (res: Response): Promise<unknown> => {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export const requireOk = (res: Response, body: unknown): void => {
  if (res.ok) return
  throw new Error(errorMessageFrom(body, `request failed with status ${res.status}`))
}
```

Create `client/shared/Modal.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    open: boolean
    title: string
    onClose: () => void
    body: Snippet
  }

  let { open, title, onClose, body }: Props = $props()

  function onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open) onClose()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="modal" onclick={onBackdropClick} role="presentation">
    <div class="modal-content">
      <div class="modal-header">
        <h3>{title}</h3>
        <button class="modal-close" aria-label="Close" onclick={onClose}>×</button>
      </div>
      <div class="modal-body">
        {@render body()}
      </div>
    </div>
  </div>
{/if}
```

Create `client/shared/PropertiesTable.svelte`:

```svelte
<script lang="ts">
  import TreeView from './TreeView.svelte'

  interface Props {
    obj: Record<string, unknown>
  }

  let { obj }: Props = $props()

  function isContainer(v: unknown): boolean {
    return v !== null && (Array.isArray(v) || typeof v === 'object')
  }

  const entries = $derived(Object.entries(obj))
</script>

{#if entries.length === 0}
  <p class="tree-empty">No properties</p>
{:else}
  <div class="tree-container">
    <table class="tree-table">
      <tbody>
        {#each entries as [key, value] (key)}
          <tr>
            <td class="tree-key-cell">{key}</td>
            <td class="tree-value-cell">
              {#if isContainer(value)}
                <TreeView {value} />
              {:else}
                <TreeView {value} />
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
```

Create `client/shared/TreeView.svelte`:

```svelte
<script lang="ts">
  import Self from './TreeView.svelte'

  interface Props {
    value: unknown
    label?: string
    depth?: number
  }

  let { value, label = undefined, depth = 0 }: Props = $props()

  const MAX_DEPTH = 50

  function getValueType(v: unknown): string {
    if (v === null) return 'null'
    if (v === undefined) return 'undefined'
    if (Array.isArray(v)) return 'array'
    return typeof v
  }

  function formatPrimitive(v: unknown): string {
    if (v === null) return 'null'
    if (v === undefined) return 'undefined'
    if (typeof v === 'string') return `"${v}"`
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    return JSON.stringify(v)
  }

  const type = $derived(getValueType(value))
  const isContainer = $derived(type === 'array' || type === 'object')
  const entries = $derived.by(() => {
    if (type === 'array' && Array.isArray(value)) {
      return value.map((v: unknown, i): [string, unknown] => [String(i), v])
    }
    if (type === 'object' && typeof value === 'object' && value !== null) {
      return Object.entries(value as Record<string, unknown>)
    }
    return [] as Array<[string, unknown]>
  })
  const bracketOpen = $derived(type === 'array' ? '[' : '{')
  const bracketClose = $derived(type === 'array' ? ']' : '}')

  let collapsed = $state(depth >= 2)
</script>

{#if depth >= MAX_DEPTH}
  {#if label !== undefined}<span class="tree-key">{label}: </span>{/if}
  <span class="tree-bracket">...</span>
{:else}
{#if isContainer}
  {#if label !== undefined}<span class="tree-key">{label}: </span>{/if}
  {#if entries.length === 0}
    <span class="tree-bracket">{bracketOpen}{bracketClose}</span>
  {:else}
    <span
      class="tree-toggle"
      class:collapsed
      role="button"
      tabindex="0"
      onclick={() => (collapsed = !collapsed)}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          collapsed = !collapsed
        }
      }}>{collapsed ? '▶' : '▼'}</span>
    <span class="tree-bracket">{bracketOpen}</span>
    {#if !collapsed}
      {#if depth >= MAX_DEPTH}
        <span class="tree-bracket"> ... </span>
      {:else}
        <span class="tree-children">
          {#each entries as [k, v] (k)}
            <div class="tree-row" style="padding-left: {(depth + 1) * 12}px">
              <Self value={v} label={k} depth={depth + 1} />
            </div>
          {/each}
        </span>
      {/if}
    {/if}
    <span class="tree-bracket">{bracketClose}</span>
  {/if}
{:else}
  {#if label !== undefined}<span class="tree-key">{label}: </span>{/if}
  <span class="tree-{type}">{formatPrimitive(value)}</span>
{/if}
{/if}
```

Create `client/shared/StatusDot.svelte`:

```svelte
<script lang="ts">
  interface Props {
    connected: boolean
  }
  let { connected }: Props = $props()
</script>

<span class="status-dot {connected ? 'connected' : 'disconnected'}"></span>
```

Create `client/shared/PanelShell.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    count?: number | null
    children: Snippet
  }

  let { title, count = null, children }: Props = $props()
</script>

<section class="panel">
  <h2>
    {title}
    {#if count !== null}
      <span class="count-badge">{count}</span>
    {/if}
  </h2>
  {@render children()}
</section>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test:client tests/client/shared/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/shared tests/client/shared
git commit -m "feat(shared): extract shared client skeleton"
```

---

### Task 2: Migrate `client/debug/` to consume `client/shared/`

**Files:**

- Modify: `client/debug/components/Modal.svelte` (Delete)
- Modify: `client/debug/components/PropertiesTable.svelte` (Delete)
- Modify: `client/debug/components/TreeView.svelte` (Delete)
- Modify: `client/debug/helpers.ts` (Delete)
- Modify: `client/debug/dashboard-types.ts` (Keep `DashboardState` + imports of shared types)
- Modify: `client/debug/billing/fetchers.ts` (Import fetcher-helpers)
- Modify: `client/debug/stats/fetchers.ts` (Import fetcher-helpers)
- Modify Svelte components under `client/debug/` to import from `../../shared/` paths instead of locally.

- [ ] **Step 1: Write the failing tests**

Verify existing tests compile. Since we are changing imports, compilation issues in TypeScript will serve as failing tests.
Run `tsc` to make sure there are unresolved local imports if we delete files.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun typecheck` after deleting:

- `client/debug/components/Modal.svelte`
- `client/debug/components/PropertiesTable.svelte`
- `client/debug/components/TreeView.svelte`
- `client/debug/helpers.ts`
  Expected: Errors indicating imported modules do not exist.

- [ ] **Step 3: Write minimal implementation**

Rewrite Svelte component imports from:

- `import Modal from './Modal.svelte'` to `import Modal from '../../shared/Modal.svelte'`
- `import PropertiesTable from './PropertiesTable.svelte'` to `import PropertiesTable from '../../shared/PropertiesTable.svelte'`
- Helper imports to point to `../shared/helpers.js` or `../../shared/helpers.js`.

In `client/debug/dashboard-types.ts`, delete original types and import them:

```typescript
import type { DashboardState, DashboardWizard, DashboardStats } from './dashboard-types.js'
// and re-export other types from '../shared/api-types.js'
export * from '../shared/api-types.js'
```

In `client/debug/billing/fetchers.ts`:

```typescript
import { readBody, requireOk, errorMessageFrom } from '../../shared/fetcher-helpers.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun typecheck && bun test:client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git rm client/debug/components/Modal.svelte client/debug/components/PropertiesTable.svelte client/debug/components/TreeView.svelte client/debug/helpers.ts
git add client/debug
git commit -m "refactor(debug): migrate debug pages to use shared primitives"
```

---

### Task 3: Two-entrypoint build script

**Files:**

- Create: `client/shared/base.css` (Extract from `client/debug/dashboard.css`)
- Modify: `client/debug/dashboard.css` (Remove common rules)
- Modify: `scripts/build-client.ts` (Generalize build)
- Create: `tests/scripts/build-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/build-client.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

describe('build-client', () => {
  test('builds both bundles successfully', () => {
    const publicDir = path.resolve(import.meta.dir, '../../public')
    expect(fs.existsSync(path.join(publicDir, 'dashboard.html'))).toBe(true)
    expect(fs.existsSync(path.join(publicDir, 'dashboard.js'))).toBe(true)
    expect(fs.existsSync(path.join(publicDir, 'dashboard.css'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/build-client.test.ts`
Expected: PASS (if public files exist, but we will test our build helper dynamically).

- [ ] **Step 3: Write minimal implementation**

Create `client/shared/base.css` with dark theme fonts, `.panel`, `.modal` styling.
Modify `scripts/build-client.ts`:

```typescript
import fs from 'node:fs'
import path from 'node:path'
import { sveltePlugin } from './svelte-plugin.js'

const ROOT = path.resolve(import.meta.dir, '..')
export const PUBLIC_DIR = path.join(ROOT, 'public')

async function buildBundle(config: {
  entry: string
  htmlSrc: string
  jsName: string
  htmlName: string
  cssName: string
  baseCssPath: string
  localCssPath: string
}): Promise<void> {
  const collectedCss: string[] = []

  const result = await Bun.build({
    entrypoints: [config.entry],
    outdir: PUBLIC_DIR,
    format: 'iife',
    naming: config.jsName,
    plugins: [
      sveltePlugin({
        collectCss: (_filename, css) => {
          if (css.length > 0) collectedCss.push(css)
        },
      }),
    ],
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  fs.copyFileSync(config.htmlSrc, path.join(PUBLIC_DIR, config.htmlName))

  const baseCss = fs.readFileSync(config.baseCssPath, 'utf8')
  const localCss = fs.existsSync(config.localCssPath) ? fs.readFileSync(config.localCssPath, 'utf8') : ''
  const componentCss = collectedCss.join('\n')
  const finalCss = `${baseCss}\n\n${localCss}\n\n/* component-scoped styles */\n${componentCss}`
  fs.writeFileSync(path.join(PUBLIC_DIR, config.cssName), finalCss)
}

async function main(): Promise<void> {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true })

  // Build unified dashboard (v1 compatibility)
  await buildBundle({
    entry: path.join(ROOT, 'client', 'debug', 'index.ts'),
    htmlSrc: path.join(ROOT, 'client', 'debug', 'dashboard.html'),
    jsName: 'dashboard.js',
    htmlName: 'dashboard.html',
    cssName: 'dashboard.css',
    baseCssPath: path.join(ROOT, 'client', 'shared', 'base.css'),
    localCssPath: path.join(ROOT, 'client', 'debug', 'dashboard.css'),
  })

  console.log(`Build complete: ${PUBLIC_DIR}`)
}

await main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun build:client && bun test:client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/shared/base.css scripts/build-client.ts tests/scripts
git commit -m "build: generalize build-client.ts to support multiple bundle options"
```

---

## Track B — `/debug` page extraction

### Task 4: Carve out `DebugApp.svelte`

**Files:**

- Create: `client/debug/components/LiveContextCard.svelte`
- Create: `client/debug/DebugApp.svelte`
- Modify: `client/debug/App.svelte` (Thin wrapper wrapping DebugApp)
- Modify: `client/debug/dashboard.svelte.ts` (Prune admin reactive properties)
- Test: `tests/client/debug/components/DebugApp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/debug/components/DebugApp.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { mount, unmount } from 'svelte'
import DebugApp from '../../../../client/debug/DebugApp.svelte'

describe('DebugApp.svelte', () => {
  test('renders header, panels, and log explorer without admin blocks', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    const component = mount(DebugApp, { target })
    expect(target.innerHTML).toContain('papai debug')
    expect(target.innerHTML).not.toContain('Billing')
    expect(target.innerHTML).not.toContain('Memos')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/debug/components/DebugApp.test.ts`
Expected: FAIL (missing files)

- [ ] **Step 3: Write minimal implementation**

Create `client/debug/components/LiveContextCard.svelte`:

```svelte
<script lang="ts">
  import type { DashboardState } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
  }
  let { dashboard }: Props = $props()
</script>

<div class="live-context-card">
  <h3>Live Context</h3>
  {#each Array.from(dashboard.wizards.values()) as wizard}
    <div class="wizard-row">
      <span>User {wizard.userId}</span>
      <span>Step {wizard.currentStep}/{wizard.totalSteps}</span>
    </div>
  {/each}
</div>
```

Create `client/debug/DebugApp.svelte` by copying Svelte template from `client/debug/App.svelte` but removing:

- `MemosPanel`, `RemindersPanel`, `BillingPanel`, `StatsPanel` references.
- 3-column layout is reduced to 2 columns on the right (TurnsPanel, NotificationsPanel, ToolFailuresPanel, LiveContextCard) and LogExplorer at full-width.

Update `client/debug/App.svelte` to wrap `DebugApp`:

```svelte
<script lang="ts">
  import DebugApp from './DebugApp.svelte'
  import { dashboard } from './dashboard.svelte.js'
</script>

<DebugApp {dashboard} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test:client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/debug/DebugApp.svelte client/debug/components/LiveContextCard.svelte client/debug/App.svelte tests/client/debug/components/DebugApp.test.ts
git commit -m "feat(debug): carve out DebugApp containing only engineering panels"
```

---

### Task 5: Trim `client/debug/handlers-extras.ts`

**Files:**

- Modify: `client/debug/handlers-extras.ts` (Keep only config-editor events)
- Modify: `client/debug/sse.ts` (Remove registrations for admin SSE events)
- Create: `client/admin/handlers-admin-extras.ts` (Move trimmed handlers here as reference)

- [ ] **Step 1: Write the failing tests**

Create or modify `tests/client/debug/sse.test.ts` to assert that admin-scoped events (e.g. `memo:created`) do not trigger registry handlers in the debug state.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/debug/sse.test.ts`
Expected: Fail if assertions about deleted handlers fail.

- [ ] **Step 3: Write minimal implementation**

Modify `client/debug/handlers-extras.ts`:
Remove `handleRecurringEvent`, `handleDeferredEvent`, `handleMemoEvent`, `handleIdentityEvent`, `handleAuthEvent`.

Modify `client/debug/sse.ts` and remove the unregistered cases.

Save the removed code to `client/admin/handlers-admin-extras.ts` for future wiring.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test:client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/debug/handlers-extras.ts client/debug/sse.ts client/admin/handlers-admin-extras.ts
git commit -m "refactor(debug): trim admin-specific SSE handlers from debug bundle"
```

---

### Task 6: Rename `/dashboard` → `/debug`, add 301 redirect

**Files:**

- Rename: `client/debug/dashboard.html` to `client/debug/debug.html`
- Rename: `client/debug/dashboard.svelte.ts` to `client/debug/debug.svelte.ts`
- Rename: `client/debug/dashboard.css` to `client/debug/debug.css`
- Modify: `scripts/build-client.ts` (Point to new `debug.html` & rename JS output to `debug.js`)
- Modify: `src/debug/server.ts` (Add `/debug` static serving and 301 redirect for `/dashboard`)
- Modify: `tests/debug/server.test.ts` (Update assertions from dashboard to debug & assert 301 redirect)

- [ ] **Step 1: Write the failing tests**

Modify `tests/debug/server.test.ts` around line 129:

```typescript
test('GET /dashboard returns a 301 redirect to /debug', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/dashboard`, { redirect: 'manual' })
  expect(res.status).toBe(301)
  expect(res.headers.get('location')).toBe('/debug')
})

test('GET /debug returns debug HTML', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/debug`)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/server.test.ts`
Expected: FAIL (no `/debug` route, `/dashboard` returns 200 html instead of 301)

- [ ] **Step 3: Write minimal implementation**

Rename the client-side files using `git mv`.

Modify `scripts/build-client.ts` to output `debug.js`, `debug.html`, `debug.css`.

In `src/debug/server.ts`:
Modify `handleDashboardFile` to `handleDebugFile`:

```typescript
function handleDebugFile(pathname: string): Response {
  if (pathname === '/debug') {
    return new Response(Bun.file(path.join(PUBLIC_DIR, 'debug.html')))
  }
  if (pathname === '/debug.js') {
    return new Response(Bun.file(path.join(PUBLIC_DIR, 'debug.js')), {
      headers: { 'Content-Type': 'text/javascript' },
    })
  }
  if (pathname === '/debug.css') {
    return new Response(Bun.file(path.join(PUBLIC_DIR, 'debug.css')))
  }
  return new Response('Not found', { status: 404 })
}
```

In `routeRequest`:

```typescript
if (url.pathname === '/dashboard') {
  return new Response(null, {
    status: 301,
    headers: { Location: '/debug' },
  })
}
if (url.pathname === '/debug' || url.pathname === '/debug.js' || url.pathname === '/debug.css') {
  return handleDebugFile(url.pathname)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun build:client && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git mv client/debug/dashboard.html client/debug/debug.html
git mv client/debug/dashboard.svelte.ts client/debug/debug.svelte.ts
git mv client/debug/dashboard.css client/debug/debug.css
git add scripts/build-client.ts src/debug/server.ts tests/debug/server.test.ts
git commit -m "feat(server): rename dashboard route to debug and add 301 redirect"
```

---

## Track C — `/admin` page bring-up

### Task 7: Empty `/admin` bundle and route

**Files:**

- Create: `client/admin/admin.html`
- Create: `client/admin/index.ts`
- Create: `client/admin/AdminApp.svelte`
- Create: `client/admin/admin.svelte.ts`
- Create: `client/admin/admin.css`
- Create: `client/admin/components/NavSidebar.svelte`
- Modify: `scripts/build-client.ts` (Add `/admin` build config)
- Modify: `src/debug/server.ts` (Serve `/admin` files)
- Test: `tests/client/admin/AdminApp.test.ts`
- Test: `tests/debug/server.test.ts` (Assert `/admin` returns 200)

- [ ] **Step 1: Write the failing tests**

Create `tests/client/admin/AdminApp.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { mount, unmount } from 'svelte'
import AdminApp from '../../../client/admin/AdminApp.svelte'

describe('AdminApp.svelte', () => {
  test('renders topbar and navigation links', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    const component = mount(AdminApp, { target })
    expect(target.innerHTML).toContain('papai admin')
    expect(target.innerHTML).toContain('System')
    expect(target.innerHTML).toContain('Billing')
    void unmount(component)
  })
})
```

Add to `tests/debug/server.test.ts`:

```typescript
test('GET /admin returns admin HTML', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/admin`)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/html')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test`
Expected: FAIL (missing admin files, routes)

- [ ] **Step 3: Write minimal implementation**

Create `client/admin/admin.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>papai admin</title>
    <link rel="stylesheet" href="/admin.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="/admin.js"></script>
  </body>
</html>
```

Create `client/admin/index.ts`:

```typescript
import { mount } from 'svelte'
import AdminApp from './AdminApp.svelte'

const target = document.getElementById('app')
if (target) {
  mount(AdminApp, { target })
}
```

Create `client/admin/admin.svelte.ts`:

```typescript
export const adminState = $state({
  activeHash: '#system',
})
```

Create `client/admin/components/NavSidebar.svelte`:

```svelte
<script lang="ts">
  import { adminState } from '../admin.svelte.js'
</script>

<nav class="nav-sidebar">
  <h2>papai admin</h2>
  <a href="#system" class:active={adminState.activeHash === '#system'}>System</a>
  <a href="#billing" class:active={adminState.activeHash === '#billing'}>Billing</a>
  <a href="#stats" class:active={adminState.activeHash === '#stats'}>Stats</a>
  <a href="#memos" class:active={adminState.activeHash === '#memos'}>Memos</a>
  <a href="#reminders" class:active={adminState.activeHash === '#reminders'}>Reminders</a>
  <a href="#identities" class:active={adminState.activeHash === '#identities'}>Identities</a>
  <a href="#groups" class:active={adminState.activeHash === '#groups'}>Groups</a>
</nav>
```

Create `client/admin/AdminApp.svelte`:

```svelte
<script lang="ts">
  import NavSidebar from './components/NavSidebar.svelte'
  import { adminState } from './admin.svelte.js'

  $effect(() => {
    const handleHash = () => {
      adminState.activeHash = window.location.hash || '#system'
    }
    window.addEventListener('hashchange', handleHash)
    handleHash()
    return () => window.removeEventListener('hashchange', handleHash)
  })
</script>

<div class="admin-layout">
  <NavSidebar />
  <main class="admin-content">
    <header class="topbar">
      <h1>papai admin</h1>
    </header>
    <div class="section-pane">
      {#if adminState.activeHash === '#system'}
        <div>System Configuration</div>
      {:else}
        <div>Under Construction</div>
      {/if}
    </div>
  </main>
</div>
```

Create `client/admin/admin.css` with sidebar grids.

Add build configuration to `scripts/build-client.ts`:

```typescript
// Build admin dashboard
await buildBundle({
  entry: path.join(ROOT, 'client', 'admin', 'index.ts'),
  htmlSrc: path.join(ROOT, 'client', 'admin', 'admin.html'),
  jsName: 'admin.js',
  htmlName: 'admin.html',
  cssName: 'admin.css',
  baseCssPath: path.join(ROOT, 'client', 'shared', 'base.css'),
  localCssPath: path.join(ROOT, 'client', 'admin', 'admin.css'),
})
```

Add server routes in `src/debug/server.ts`:

```typescript
function handleAdminFile(pathname: string): Response {
  if (pathname === '/admin') {
    return new Response(Bun.file(path.join(PUBLIC_DIR, 'admin.html')))
  }
  if (pathname === '/admin.js') {
    return new Response(Bun.file(path.join(PUBLIC_DIR, 'admin.js')), {
      headers: { 'Content-Type': 'text/javascript' },
    })
  }
  if (pathname === '/admin.css') {
    return new Response(Bun.file(path.join(PUBLIC_DIR, 'admin.css')))
  }
  return new Response('Not found', { status: 404 })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun build:client && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/admin src/debug/server.ts scripts/build-client.ts tests/client/admin tests/debug/server.test.ts
git commit -m "feat(admin): build empty admin shell bundle and add static routing"
```

---

### Task 8: System section (Credentials form)

**Files:**

- Create: `client/admin/components/CredentialsForm.svelte`
- Create: `client/admin/sections/SystemSection.svelte`
- Modify: `client/admin/fetchers.ts`
- Modify: `src/debug/server.ts` (Add `GET /admin/system`)
- Test: `tests/client/admin/sections/SystemSection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/client/admin/sections/SystemSection.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { mount, unmount } from 'svelte'
import SystemSection from '../../../../client/admin/sections/SystemSection.svelte'

describe('SystemSection.svelte', () => {
  test('renders CredentialsForm and required env table', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    const component = mount(SystemSection, { target })
    expect(target.innerHTML).toContain('Credentials')
    expect(target.innerHTML).toContain('LLM API Key')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client`
Expected: FAIL (missing files)

- [ ] **Step 3: Write minimal implementation**

Move `client/debug/billing/CredentialsForm.svelte` to `client/admin/components/CredentialsForm.svelte` and adjust imports to point to `../../shared/fetcher-helpers.js`.

Create `client/admin/fetchers.ts`:

```typescript
import { readBody, requireOk } from '../shared/fetcher-helpers.js'
import type { AdminLlmSnapshot } from '../shared/api-types.js'

export const fetchAdminLlm = async (): Promise<AdminLlmSnapshot> => {
  const res = await fetch('/admin/llm')
  const body = await readBody(res)
  requireOk(res, body)
  return body as AdminLlmSnapshot
}
```

Add server endpoint `GET /admin/system` in `src/debug/server.ts` that outputs required environmental config state:

```typescript
function handleAdminSystem(): Response {
  return new Response(
    JSON.stringify({
      chatProvider: process.env['CHAT_PROVIDER'] ?? 'unknown',
      taskProvider: process.env['TASK_PROVIDER'] ?? 'unknown',
      debugServer: 'true',
      adminUserSet: process.env['ADMIN_USER_ID'] !== undefined ? 'true' : 'false',
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
}
```

Create `client/admin/sections/SystemSection.svelte` to wrap the credentials form and show the env table.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/admin src/debug/server.ts tests/client/admin
git commit -m "feat(admin): move LLM credentials form and build system config section"
```

---

### Task 9: Billing section

**Files:**

- Move: `client/debug/billing/SubjectsTable.svelte` to `client/admin/components/SubjectsTable.svelte`
- Move: `client/debug/billing/SubjectDetail.svelte` to `client/admin/components/SubjectDetail.svelte`
- Move: `client/debug/stats/SubjectStatsPanel.svelte` to `client/admin/components/SubjectStatsPanel.svelte`
- Create: `client/admin/sections/BillingSection.svelte`
- Delete: `client/debug/billing` directory
- Test: Port billing tests to `tests/client/admin/sections/BillingSection.test.ts`

- [ ] **Step 1: Write the failing tests**

Port `tests/client/debug/billing/BillingPanel.test.ts` to `tests/client/admin/sections/BillingSection.test.ts` pointing to the new `BillingSection` component.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client`
Expected: FAIL due to missing `BillingSection`.

- [ ] **Step 3: Write minimal implementation**

Create `client/admin/sections/BillingSection.svelte` composing the subjects table and detail modals.
Import and setup local fetchers inside `client/admin/fetchers.ts` (porting `fetchBillingSubjects` and `fetchBillingDetail` from the deleted files).

Update component imports inside `SubjectsTable.svelte`, `SubjectDetail.svelte`, and `SubjectStatsPanel.svelte` to use the shared types.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test:client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/admin tests/client/admin
git rm -r client/debug/billing
git commit -m "feat(admin): port billing section and component files to admin area"
```

---

### Task 10: Stats section

**Files:**

- Move: `client/debug/stats/StatsPanel.svelte` to `client/admin/components/StatsPanel.svelte`
- Create: `client/admin/sections/StatsSection.svelte`
- Delete: `client/debug/stats` directory
- Test: Port stats tests to `tests/client/admin/sections/StatsSection.test.ts`

- [ ] **Step 1: Write the failing tests**

Port `tests/client/debug/stats/StatsPanel.test.ts` to `tests/client/admin/sections/StatsSection.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `client/admin/sections/StatsSection.svelte` with `StatsPanel` embedded inside. Add global stats fetchers to `client/admin/fetchers.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test:client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/admin tests/client/admin
git rm -r client/debug/stats
git commit -m "feat(admin): move and setup global stats section"
```

---

### Task 11: Memos, Reminders, Identities, Groups sections

**Files:**

- Create: `client/admin/sections/MemosSection.svelte`
- Create: `client/admin/sections/RemindersSection.svelte`
- Create: `client/admin/sections/IdentitiesSection.svelte`
- Create: `client/admin/sections/GroupsSection.svelte`
- Delete: `client/debug/components/MemosPanel.svelte`, `RemindersPanel.svelte`, `ContextPanel.svelte`
- Test: Create tests under `tests/client/admin/sections/`

- [ ] **Step 1: Write the failing tests**

Create tests for each newly created section verifying that data-loading fetches are triggered on mount and rendered cleanly.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Write Svelte components for each section using pure REST fetches to `/memos`, `/recurring`, `/deferred`, `/identity`, `/auth/groups`.
Wire these sections into `client/admin/AdminApp.svelte`.
Delete the old Svelte files under `client/debug/components/`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test:client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git rm client/debug/components/MemosPanel.svelte client/debug/components/RemindersPanel.svelte client/debug/components/ContextPanel.svelte
git add client/admin tests/client/admin
git commit -m "feat(admin): build memos, reminders, identities, and groups sections"
```

---

## Track D — Tidy-up and polish

### Task 12: Cleanup

**Files:**

- Modify: `client/debug/App.svelte` (Delete / replace with clean mounting)
- Modify: `client/debug/debug.svelte.ts` (Prune unused reactive states)
- Modify: `client/shared/base.css` (De-duplicate styling rule classes)

- [ ] **Step 1: Write the failing tests**

Run `bun knip` to find unused exports, types, or fields.
Ensure there are no compile warnings.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun knip`
Expected: Warnings on unused components, files, or state variables.

- [ ] **Step 3: Write minimal implementation**

Prune state variables inside `client/debug/debug.svelte.ts` that were moved or no longer referenced (e.g., `memos`, `recurringTasks`, `billingSubjects`).

Ensure `client/debug/index.ts` mounts `DebugApp` directly instead of the legacy `App.svelte` wrapper. Remove `App.svelte`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun check:full`
Expected: PASS and clean build output.

- [ ] **Step 5: Commit**

```bash
git rm client/debug/App.svelte
git add client/debug
git commit -m "chore: prune dead states and delete legacy debug App.svelte"
```

---

### Task 13: Documentation

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Write the failing tests**

Verify documentation references are accurate.

- [ ] **Step 2: Run test to verify it fails**

Review doc strings manually for `/dashboard` references.

- [ ] **Step 3: Write minimal implementation**

Update `CLAUDE.md` "Anonymity contract for `/stats/*`" and server setup guides to explicitly list `/debug` as the engineer panel and `/admin` as the operator/backstage credentials/stats manager, noting the 301 redirection.

- [ ] **Step 4: Run test to verify it passes**

Confirm documents are clean and precise.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: update CLAUDE.md and README.md with debug and admin split"
```

---

### Task 14: Modal primitive: size + footer + Escape

**Files:**

- Modify: `client/shared/Modal.svelte` (Add `size` and `footer` snippets)
- Create: `client/shared/Confirm.svelte` (Thin Action Confirm dialog wrapper)
- Test: `tests/client/shared/Modal.test.ts` (Sized checks)

- [ ] **Step 1: Write the failing tests**

Update `tests/client/shared/Modal.test.ts` to assert modal renders with size classes (e.g. `modal--lg`) and renders the footer snippet when available.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Enhance `client/shared/Modal.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    open: boolean
    title: string
    size?: 'sm' | 'md' | 'lg' | 'xl'
    onClose: () => void
    body: Snippet
    footer?: Snippet
  }

  let { open, title, size = 'md', onClose, body, footer }: Props = $props()
</script>
<!-- Render modal with size class and conditional footer -->
```

Create `client/shared/Confirm.svelte` as a reusable component utilizing this enhanced primitive.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test:client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/shared tests/client/shared
git commit -m "feat(shared): support size-variant and footers in Modal primitive"
```

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-21-dashboard-admin-split-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
