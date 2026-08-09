<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AdminApp Review Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 17 findings in `docs/ux-reviews/AdminApp.md` — make the admin app usable below 900px, keep its navigation on screen, stop its charts rendering at several times their requested size, and give it the focus ring, scroll-container awareness, and honest status signals the settings app already has.

**Architecture:** The admin shell adopts the layout the settings shell already proved: `Shell bodyScroll={false}`, a grid that fills the shell body, a main column that owns the scroll, and a rail that fills its grid track rather than sticking. The two duplicate `scrollspy.ts` modules collapse into one shared module that takes a scroll root. Chart primitives (`Bars`, `Spark`) gain a fluid branch that honours the caller's height instead of treating it as an aspect-ratio denominator. Content fixes are independent single-file edits.

**Tech Stack:** Bun · Svelte 5 runes · strict TypeScript · Zod v4 · `bun:test` · Playwright via `@crvy/strybk` · Storybook + MSW fixtures · oxfmt.

**Source spec:** [`docs/superpowers/specs/2026-08-06-adminapp-findings-design.md`](../specs/2026-08-06-adminapp-findings-design.md)

## Global Constraints

- Runtime **Bun**; **Svelte 5 runes**; strict TypeScript; **`.js` extension in import paths**.
- Formatter is **oxfmt** — run `bun run format`, never prettier.
- New files carry BUSL-1.1 headers — run `bun license:headers` after creating any file.
- **Never add lint-disable or type-ignore comments** — fix the underlying issue.
- A `max-lines` / `max-lines-per-function` failure is a design signal: split the file, do not compress formatting.
- Client tests run as `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`. A bare `bun test tests/client/...` matches nothing and reports success without executing.
- Server/script tests run as `bun test <path>`.
- Never hand-edit inside a visual spec's `@generated-begin` / `@generated-end auto-screenshots` region; regenerate with `bun run shoot:gen`.
- `docs/ux-reviews/_BACKLOG.md` is generated — regenerate with `bun run ux:backlog`, never hand-edit.
- Never pass `--no-verify` to `git commit`.
- Spacing values that land on the 4px scale use `--s1`..`--s9` (`client/shared/tokens.css:68-76`). Font size is explicitly **out of scope** — the repo has no shared type scale (deferred finding `settings-app-no-shared-type-scale`).
- Error extraction idiom: `error instanceof Error ? error.message : String(error)`.
- Structural code queries go through the `codeindex` MCP server, not `grep`, inside `src/` and `client/`.

---

## File Structure

**Created**

| File                                             | Responsibility                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `client/shared/scrollspy.ts`                     | The single `useScrollSpy` both apps import; takes an optional scroll `root` |
| `client/admin/components/AdminJumpMenu.svelte`   | Below-900px section navigation for admin; flat `Select` over `adminSections` |
| `tests/client/shared/scrollspy.test.ts`          | Merged coverage for the shared spy, including the `root` argument          |

**Deleted**

| File                                       | Why                                                     |
| ------------------------------------------ | ------------------------------------------------------- |
| `client/admin/scrollspy.ts`                | Superseded by `client/shared/scrollspy.ts`              |
| `client/settings/scrollspy.ts`             | Superseded by `client/shared/scrollspy.ts`              |
| `tests/client/admin/scrollspy.test.ts`     | Merged into `tests/client/shared/scrollspy.test.ts`     |
| `tests/client/settings/scrollspy.test.ts`  | Merged into `tests/client/shared/scrollspy.test.ts`     |

**Modified**

| File                                                 | Change                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `client/admin/admin.css`                             | Rail rules removed; grid fills + scrolls; 900px breakpoint; focus ring     |
| `client/admin/AdminApp.svelte`                        | `bodyScroll={false}`, main element ref, spy root, shared spy import        |
| `client/admin/components/AdminSidebarPanel.svelte`    | Sole home for rail styling; nav a11y; live `tools` quick stat              |
| `client/admin/components/AdminTopBar.svelte`          | Jump menu, health-bound pill, ticking `last refreshed`                     |
| `client/admin/sections/OverviewSection.svelte`        | KPI grid `auto-fit`, `active` subline, fluid `Spark`, empty branches       |
| `client/admin/sections/RemindersSection.svelte`       | Wrapped in `Panel`, named Load button                                      |
| `client/admin/sections/MemosSection.svelte`           | `Field`-wrapped user id, named Load button                                 |
| `client/admin/global-stats.svelte.ts`                 | `error` field; both failure paths set it                                   |
| `client/settings/SettingsApp.svelte`                  | Shared spy import                                                          |
| `client/shared/ui/Bars.svelte`                        | Fluid branch honours `height`; renders nothing on an empty series          |
| `client/shared/ui/Spark.svelte`                       | Gains a fluid branch; `width` loses its default                            |
| `client/shared/helpers.ts`                            | `hasSeriesData` — the one definition of "this chart has anything to show"  |
| `client/stories/msw/handlers.ts`                      | `statsHandlers.empty` becomes genuinely empty                              |
| `tests/client/admin/admin-css.test.ts`                | Assertions for every `admin.css` change                                    |
| `tests/client/shared/ui/Bars.test.ts`                 | Fluid height; two old-behaviour tests rewritten for the empty branch       |
| `tests/client/shared/ui/Spark.test.ts`                | Fluid branch and the empty branch                                          |
| `tests/client/shared/helpers.test.ts`                 | `hasSeriesData`                                                            |
| `tests/visual/admin/AdminApp.spec.ts`                 | Post-fix manual states                                                     |
| `tests/scripts/ux-backlog.test.ts`                    | Review-document count 20 → 21                                              |
| `docs/ux-reviews/AdminApp.md`                         | 17 findings closed, all nine dimensions re-scored                          |
| `docs/ux-reviews/_BACKLOG.md`                         | Regenerated                                                                |

---

### Task 1: Land the review artifacts

The worktree already carries the review output from the review session: the findings document, the regenerated backlog, and the six manual visual states that produced the evidence. They are uncommitted, and `tests/scripts/ux-backlog.test.ts` still asserts 20 review documents while 21 now exist — so the suite is red before any of this plan's work starts. Commit them and fix the count first, so every later task starts from green.

**Files:**

- Commit: `docs/ux-reviews/AdminApp.md` (untracked), `docs/ux-reviews/_BACKLOG.md` (modified), `tests/visual/admin/AdminApp.spec.ts` (modified)
- Modify: `tests/scripts/ux-backlog.test.ts:232`

**Interfaces:**

- Consumes: nothing.
- Produces: a green baseline. The finding ids listed in `docs/ux-reviews/AdminApp.md` are the ids Task 18 closes.

- [ ] **Step 1: Run the backlog test to see it fail**

```bash
bun test tests/scripts/ux-backlog.test.ts
```

Expected: FAIL on `covers every review document` — `expect(received).toHaveLength(20)` / `Received length: 21`.

- [ ] **Step 2: Bump the expected count**

In `tests/scripts/ux-backlog.test.ts`, replace:

```typescript
  test('covers every review document', async () => {
    const reviews = await collectReviews()
    expect(reviews).toHaveLength(20)
    expect(reviews.every((review) => review.findings.length > 0)).toBe(true)
  })
```

with:

```typescript
  test('covers every review document', async () => {
    const reviews = await collectReviews()
    expect(reviews).toHaveLength(21)
    expect(reviews.every((review) => review.findings.length > 0)).toBe(true)
  })
```

- [ ] **Step 3: Run the backlog test to verify it passes**

```bash
bun test tests/scripts/ux-backlog.test.ts
```

Expected: PASS, all tests green.

- [ ] **Step 4: Format**

```bash
bun run format
```

- [ ] **Step 5: Commit**

```bash
git add docs/ux-reviews/AdminApp.md docs/ux-reviews/_BACKLOG.md tests/visual/admin/AdminApp.spec.ts tests/scripts/ux-backlog.test.ts
git commit -m "docs(ux): land the AdminApp review findings and its evidence states"
```

---

### Task 2: One shared scroll spy

`client/admin/scrollspy.ts` and `client/settings/scrollspy.ts` are the same module apart from the `root` parameter only the settings copy carries. Collapse them into `client/shared/scrollspy.ts` with the settings signature, merge the two test files, and delete the originals. This is a pure move — no behaviour changes for either app yet. Task 4 is what actually passes a `root` from admin.

**Files:**

- Create: `client/shared/scrollspy.ts`
- Create: `tests/client/shared/scrollspy.test.ts`
- Delete: `client/admin/scrollspy.ts`, `client/settings/scrollspy.ts`
- Delete: `tests/client/admin/scrollspy.test.ts`, `tests/client/settings/scrollspy.test.ts`
- Modify: `client/admin/AdminApp.svelte:14`, `client/settings/SettingsApp.svelte:26`

**Interfaces:**

- Consumes: nothing.
- Produces:

```typescript
export interface ScrollSpyHandle {
  start: () => void
  stop: () => void
}

export const useScrollSpy = (
  sectionIds: readonly string[],
  onChange: (id: string) => void,
  root?: Element | null,
): ScrollSpyHandle
```

Imported by later tasks as `import { useScrollSpy } from '../shared/scrollspy.js'` (from `client/admin/`).

Note: `tests/scripts/mutation/coverage-runner.test.ts` contains the string `'tests/client/settings/scrollspy.test.ts'` in four places. Those are literal path fixtures for a path-classification function, not references to a file on disk. **Do not change them** — the test passes either way, and rewriting them adds churn to an unrelated suite.

- [ ] **Step 1: Write the merged failing test**

Create `tests/client/shared/scrollspy.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { useScrollSpy } from '../../../client/shared/scrollspy.js'

type MockEntry = Pick<IntersectionObserverEntry, 'isIntersecting' | 'target' | 'intersectionRatio'>

interface Recorded {
  callback: (entries: MockEntry[]) => void
  targets: Element[]
  root: Element | Document | null
  rootMargin: string | undefined
}

let observers: Recorded[] = []
const RealObserver = globalThis.IntersectionObserver

class TrackingObserver {
  private readonly record: Recorded
  constructor(cb: (entries: MockEntry[]) => void, options?: IntersectionObserverInit) {
    this.record = {
      callback: cb,
      targets: [],
      root: options?.root ?? null,
      rootMargin: options?.rootMargin,
    }
    observers.push(this.record)
  }
  observe(el: Element): void {
    this.record.targets.push(el)
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: readonly number[] = []
}

beforeEach(() => {
  observers = []
  document.body.innerHTML = `
    <section id="overview"></section>
    <section id="billing"></section>
    <section id="stats"></section>
  `
  Reflect.set(globalThis, 'IntersectionObserver', TrackingObserver)
})

afterEach(() => {
  observers = []
  globalThis.IntersectionObserver = RealObserver
  document.body.innerHTML = ''
})

describe('useScrollSpy', () => {
  test('start and stop are idempotent and return a handle', () => {
    const spy = useScrollSpy(['overview', 'billing'], () => undefined)
    expect(typeof spy.start).toBe('function')
    expect(typeof spy.stop).toBe('function')
    spy.start()
    spy.start()
    expect(observers).toHaveLength(1)
    spy.stop()
    spy.stop()
  })

  test('observes every provided id and forwards the active one', () => {
    const seen: string[] = []
    const spy = useScrollSpy(['overview', 'billing', 'stats'], (id) => {
      seen.push(id)
    })
    spy.start()
    expect(observers).toHaveLength(1)
    expect(observers[0]?.targets).toHaveLength(3)
    const billingEl = document.querySelector('#billing')!
    observers[0]?.callback([{ isIntersecting: true, intersectionRatio: 1, target: billingEl } satisfies MockEntry])
    expect(seen).toEqual(['billing'])
    spy.stop()
  })

  test('ignores non-intersecting entries', () => {
    let active: string | null = 'overview'
    const spy = useScrollSpy(['overview', 'billing'], (id) => {
      active = id
    })
    spy.start()
    const billingEl = document.querySelector('#billing')!
    observers[0]?.callback([{ isIntersecting: false, intersectionRatio: 0, target: billingEl } satisfies MockEntry])
    expect(active).toBe('overview')
    spy.stop()
  })

  test('observes the viewport when no root is given', () => {
    useScrollSpy(['overview'], () => undefined).start()
    expect(observers).toHaveLength(1)
    expect(observers[0]!.root).toBeNull()
    expect(observers[0]!.rootMargin).toBe('-30% 0px -60% 0px')
  })

  test('observes the given element when a root is passed', () => {
    document.body.innerHTML = '<div id="scroller"><section id="overview"></section></div>'
    const scroller = document.querySelector<HTMLElement>('#scroller')!
    useScrollSpy(['overview'], () => undefined, scroller).start()
    expect(observers).toHaveLength(1)
    expect(observers[0]!.root).toBe(scroller)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/scrollspy.test.ts
```

Expected: FAIL — `Cannot find module '../../../client/shared/scrollspy.js'`.

- [ ] **Step 3: Create the shared module**

Create `client/shared/scrollspy.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface ScrollSpyHandle {
  start: () => void
  stop: () => void
}

export const useScrollSpy = (
  sectionIds: readonly string[],
  onChange: (id: string) => void,
  /** The scroll container to measure against. null observes the viewport. */
  root: Element | null = null,
): ScrollSpyHandle => {
  let observer: IntersectionObserver | null = null

  const start = (): void => {
    if (observer !== null) return
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const id = entry.target.id
          if (sectionIds.includes(id)) onChange(id)
        }
      },
      { root, rootMargin: '-30% 0px -60% 0px' },
    )
    for (const id of sectionIds) {
      const el = document.getElementById(id)
      if (el !== null) observer.observe(el)
    }
  }

  const stop = (): void => {
    observer?.disconnect()
    observer = null
  }

  return { start, stop }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/scrollspy.test.ts
```

Expected: PASS, 5 pass.

- [ ] **Step 5: Repoint both apps and delete the originals**

In `client/admin/AdminApp.svelte` line 14, replace:

```typescript
  import { useScrollSpy } from './scrollspy.js'
```

with (the import must sit in the shared-import block above the `./admin.svelte.js` block, matching the file's existing grouping):

```typescript
  import { useScrollSpy } from '../shared/scrollspy.js'
```

In `client/settings/SettingsApp.svelte` line 26, replace:

```typescript
  import { useScrollSpy } from './scrollspy.js'
```

with:

```typescript
  import { useScrollSpy } from '../shared/scrollspy.js'
```

Then:

```bash
git rm client/admin/scrollspy.ts client/settings/scrollspy.ts tests/client/admin/scrollspy.test.ts tests/client/settings/scrollspy.test.ts
```

- [ ] **Step 6: Verify nothing still imports the deleted modules**

```bash
grep -rn "scrollspy" client/ tests/ --exclude-dir=node_modules
```

Expected: only `client/shared/scrollspy.ts`, `tests/client/shared/scrollspy.test.ts`, the two repointed imports, and the four literal path strings in `tests/scripts/mutation/coverage-runner.test.ts`.

- [ ] **Step 7: Typecheck, lint, format**

```bash
bun run typecheck && bun run lint && bun run format
```

Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add -A client/shared/scrollspy.ts client/admin client/settings tests/client
git commit -m "refactor(client): one shared scroll spy for admin and settings"
```

---

### Task 3: One home for the rail's styling

`.admin-sidebar` is declared twice — globally in `admin.css:14-41` and scoped in `AdminSidebarPanel.svelte`. Svelte's scoping hash gives the component (0,3,0) against the global's (0,2,0), so the component wins **per declared property only**; every property it does not declare still resolves from `admin.css`. That is why the hovered link is a bordered box and the active link is a left accent bar — one control, two visual languages. Move every `.admin-sidebar*` rule into the component and snap the surviving values onto the spacing scale.

**Files:**

- Modify: `client/admin/admin.css` (delete lines 14-41)
- Modify: `client/admin/components/AdminSidebarPanel.svelte` (style block)
- Modify: `tests/client/admin/admin-css.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `admin.css` no longer mentions `.admin-sidebar` at all. Task 4 adds `height: 100%` / `overflow-y: auto` to the component's `.admin-sidebar`; Task 5 adds `display: none` inside the component's own 900px query.

- [ ] **Step 1: Write the failing CSS assertions**

Append to the `describe('admin.css', …)` block in `tests/client/admin/admin-css.test.ts`:

```typescript
  test('the rail is styled in AdminSidebarPanel only, not in the global sheet', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).not.toContain('.admin-sidebar')
  })

  test('the rail declares its own hover and active states in one place', async () => {
    const url = new URL('../../../client/admin/components/AdminSidebarPanel.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    expect(svelte).toContain('.admin-sidebar__link:hover')
    expect(svelte).toContain('.admin-sidebar__link--active')
  })

  test('the rail spends the shared spacing scale rather than one-off px', async () => {
    const url = new URL('../../../client/admin/components/AdminSidebarPanel.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    const rail = svelte.match(/\.admin-sidebar \{[^}]*\}/u)
    expect(rail).not.toBeNull()
    const [rule] = rail!
    expect(rule).toContain('gap: var(--s2)')
    expect(rule).toContain('padding: var(--s3)')
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/admin-css.test.ts
```

Expected: FAIL — the first new test reports the `admin.css` string still contains `.admin-sidebar`; the third reports `gap: var(--s2)` missing.

- [ ] **Step 3: Delete the global rail rules**

In `client/admin/admin.css`, delete lines 14-41 in their entirety — the `.admin-sidebar`, `.admin-sidebar a`, and `.admin-sidebar a:hover, .admin-sidebar a.active` blocks:

```css
.admin-sidebar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px;
  border-right: 1px solid var(--border);
  background: var(--surface-1);
  position: sticky;
  top: 0;
  align-self: start;
  max-height: 100vh;
  overflow-y: auto;
}

.admin-sidebar a {
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 2px;
  color: var(--text-muted);
  text-decoration: none;
}

.admin-sidebar a:hover,
.admin-sidebar a.active {
  border-color: var(--strong);
  background: var(--surface-2);
  color: var(--text);
}
```

Leave `.eyebrow` above it and `.admin-section-header` below it untouched.

Also delete the `.admin-sidebar` block from inside the `@media (max-width: 720px)` query (currently `admin.css:161-167`):

```css
  .admin-sidebar {
    flex-flow: row wrap;
    border-right: 0;
    border-bottom: 1px solid var(--border);
    position: static;
    max-height: none;
  }
```

The query keeps its `.admin-grid` and `.admin-section-header` blocks. Task 5 moves the query itself to 900px.

- [ ] **Step 4: Rewrite the component's style block**

Replace the entire `<style>` block in `client/admin/components/AdminSidebarPanel.svelte` with:

```svelte
<style>
  .admin-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s3);
    background: var(--surface-1);
    border-right: 1px solid var(--border);
    min-height: 100vh;
  }
  /* 2px is below the 4px scale on purpose: this is a hairline marker, not spacing. */
  .admin-sidebar__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .admin-sidebar__link {
    color: var(--text-muted);
    text-decoration: none;
    padding: var(--s2);
    font-family: var(--font-mono);
    font-size: 12px;
    border-left: 2px solid transparent;
  }
  .admin-sidebar__link:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .admin-sidebar__link--active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: var(--surface-2);
  }
  .admin-sidebar__kvs {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }
</style>
```

`min-height: 100vh` stays for now — Task 4 is what removes it, and removing it here without the grid changes would collapse the rail to its content height against an unchanged grid.

- [ ] **Step 5: Run the CSS tests to verify they pass**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/admin-css.test.ts
```

Expected: PASS, 5 pass.

- [ ] **Step 6: Prove every token still resolves**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/token-references.test.ts
```

Expected: PASS.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add client/admin/admin.css client/admin/components/AdminSidebarPanel.svelte tests/client/admin/admin-css.test.ts
git commit -m "fix(admin): style the nav rail in one place, on the spacing scale"
```

---

### Task 4: Scroll ownership — the rail stops riding off the top

`AdminApp.svelte` renders `<Shell>` with no `bodyScroll` prop, so `.ui-shell__body` owns the page scroll. The rail sits inside that scroller as `position: sticky; top: 0` with `min-height: 100vh`. A sticky box travels only within its own area, so once the page exceeds one viewport the rail leaves the top and never returns. Adopt the shape `SettingsApp` runs: the shell body stops scrolling, the grid fills it, the main column owns the scroll, and the rail fills its track and scrolls inside it. The scroll spy then needs that main column as its `root`, because after this change its `-30%/-60%` margins would otherwise be computed over a box the user cannot scroll.

**Files:**

- Modify: `client/admin/AdminApp.svelte`
- Modify: `client/admin/admin.css` (`.admin-grid`, `.admin-grid__main`)
- Modify: `client/admin/components/AdminSidebarPanel.svelte` (`.admin-sidebar`)
- Modify: `tests/client/admin/admin-css.test.ts`

**Interfaces:**

- Consumes: `useScrollSpy(sectionIds, onChange, root)` from Task 2 — `client/shared/scrollspy.js`.
- Produces: `.admin-grid__main` is the app's scroll container. Task 5's breakpoint rules assume `.admin-grid` is a flex child of the shell body.

- [ ] **Step 1: Write the failing CSS assertions**

Append to `tests/client/admin/admin-css.test.ts`:

```typescript
  test('the grid fills the remaining height so its columns can scroll independently', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    const m = css.match(/\.admin-grid \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [grid] = m!
    expect(grid).toContain('flex: 1 1 auto')
    expect(grid).toContain('min-height: 0')
  })

  test('the main column owns its own scroll', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    const m = css.match(/\.admin-grid__main \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [main] = m!
    expect(main).toContain('overflow-y: auto')
  })

  test('the rail fills its track instead of being a sticky 100vh box', async () => {
    const url = new URL('../../../client/admin/components/AdminSidebarPanel.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    const m = svelte.match(/\.admin-sidebar \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [rail] = m!
    expect(rail).toContain('height: 100%')
    expect(rail).toContain('overflow-y: auto')
    expect(rail).not.toContain('100vh')
    expect(rail).not.toContain('position: sticky')
  })

  test('the admin shell body does not double as a page scroller', async () => {
    const url = new URL('../../../client/admin/AdminApp.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    expect(svelte).toContain('bodyScroll={false}')
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/admin-css.test.ts
```

Expected: FAIL on all four new tests — `flex: 1 1 auto` missing, `overflow-y: auto` missing, the rail still carrying `min-height: 100vh`, and `bodyScroll={false}` absent.

- [ ] **Step 3: Make the grid fill and the main column scroll**

In `client/admin/admin.css`, replace:

```css
.admin-grid {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 0;
  min-height: 0;
}

.admin-grid__main {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
  min-width: 0;
}
```

with:

```css
.admin-grid {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 0;
  flex: 1 1 auto;
  min-height: 0;
}

.admin-grid__main {
  display: flex;
  flex-direction: column;
  gap: var(--s6);
  padding: var(--s6);
  min-width: 0;
  overflow-y: auto;
}
```

- [ ] **Step 4: Make the rail fill its track**

In `client/admin/components/AdminSidebarPanel.svelte`, replace the `.admin-sidebar` rule:

```css
  .admin-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s3);
    background: var(--surface-1);
    border-right: 1px solid var(--border);
    min-height: 100vh;
  }
```

with:

```css
  .admin-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s3);
    background: var(--surface-1);
    border-right: 1px solid var(--border);
    /* Fills its grid track and scrolls inside it. No sticky/100vh box: that box was
       taller than the scrollport it sat in, and being sticky, the outer scroll could
       never bring its tail into view. */
    height: 100%;
    overflow-y: auto;
  }
```

- [ ] **Step 5: Hand the shell's scroll to the main column and give the spy its root**

Replace the whole `<script>` and markup of `client/admin/AdminApp.svelte` (lines 6-60) with:

```svelte
<script lang="ts">
  import { onMount } from 'svelte'

  import { useScrollSpy } from '../shared/scrollspy.js'
  import Shell from '../shared/ui/Shell.svelte'

  import { adminSections, adminState, refreshAll, setSection } from './admin.svelte.js'
  import AdminSidebarPanel from './components/AdminSidebarPanel.svelte'
  import AdminTopBar from './components/AdminTopBar.svelte'
  import BillingSection from './sections/BillingSection.svelte'
  import IdentitiesSection from './sections/IdentitiesSection.svelte'
  import MemosSection from './sections/MemosSection.svelte'
  import OverviewSection from './sections/OverviewSection.svelte'
  import RemindersSection from './sections/RemindersSection.svelte'
  import StatsSection from './sections/StatsSection.svelte'

  const sectionIds = adminSections.map((s) => s.id)

  // The scroll container after the shell stopped scrolling; the spy measures against it.
  let mainEl: HTMLElement | null = $state(null)

  onMount(() => {
    void refreshAll()
    const initial = window.location.hash.replace(/^#/u, '')
    if (sectionIds.includes(initial)) {
      const target = document.querySelector<HTMLElement>(`#${initial}`)
      if (target !== null) target.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
    }
    const spy = useScrollSpy(
      sectionIds,
      (id) => {
        setSection(id as typeof adminState.currentSection)
        if (window.location.hash !== `#${id}`) {
          window.history.replaceState(null, '', `#${id}`)
        }
      },
      mainEl,
    )
    spy.start()
    return (): void => spy.stop()
  })
</script>

<Shell bodyScroll={false}>
  {#snippet topBar()}
    <AdminTopBar />
  {/snippet}
  {#snippet children()}
    <div class="admin-grid">
      <h1 class="sr-only">Admin</h1>
      <AdminSidebarPanel activeId={adminState.currentSection} />
      <main class="admin-grid__main" bind:this={mainEl}>
        <OverviewSection />
        <BillingSection />
        <StatsSection />
        <MemosSection />
        <RemindersSection />
        <IdentitiesSection />
      </main>
    </div>
  {/snippet}
</Shell>
```

- [ ] **Step 6: Run the CSS tests to verify they pass**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/admin-css.test.ts
```

Expected: PASS, 9 pass.

- [ ] **Step 7: Run the admin client suite**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin
```

Expected: PASS.

- [ ] **Step 8: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/admin tests/client/admin
git commit -m "fix(admin): give the main column the scroll so the rail stays on screen"
```

---

### Task 5: Narrow-viewport navigation

`admin.css` tries to reflow the rail at `max-width: 720px`, but that plain selector was (0,1,0) against the component's scoped (0,2,0) — the direction never flipped, and nothing lifted the `100vh`. At 640px and 720px the rail filled the frame and no admin content was on screen. Move the cutover to 900px (the reasoning is recorded at `settings.css:152-154`: against a fixed 220px rail, a 760px viewport leaves the content column ~492px — narrower than the 608px it gets at 640px where the rail is already gone), hide the rail below it, and add a jump menu to the top bar. The rail's `active` quick stat has no home in Overview, so it joins the `subjects` tile's subline; `DM` and `tools` already duplicate Overview KPIs and need no port.

**Files:**

- Create: `client/admin/components/AdminJumpMenu.svelte`
- Modify: `client/admin/admin.css` (breakpoint)
- Modify: `client/admin/components/AdminSidebarPanel.svelte` (breakpoint)
- Modify: `client/admin/components/AdminTopBar.svelte` (render the menu)
- Modify: `client/admin/sections/OverviewSection.svelte` (`active` in the subjects subline)
- Modify: `tests/client/admin/admin-css.test.ts`

**Interfaces:**

- Consumes: `adminSections` and `adminState` from `client/admin/admin.svelte.js`; `Select` from `client/shared/ui/Select.svelte` with props `{ value, options?: { value: string; label: string }[], groups?, onChange?, testid?, block?, ariaLabelledby? }`.
- Produces: `AdminJumpMenu` with `Props { activeId: string }`; testid `admin-jump-select`; label id `admin-jump-label`.

**Resolved ambiguity:** the spec says the label "uses the admin app's own `.admin-topbar__lbl`". That class is declared inside `AdminTopBar.svelte`'s scoped style block, so it cannot reach a child component's markup. `AdminJumpMenu` therefore declares its own `.admin-jump__lbl` with the same three declarations, carrying a comment naming the deferred `settings-app-no-shared-type-scale` finding. It must **not** use `.t-label` — that utility lives at `settings.css:92` and `admin.html` never loads it.

- [ ] **Step 1: Write the failing CSS assertions**

Append to `tests/client/admin/admin-css.test.ts`:

```typescript
  test('the single-column cutover happens at 900px, above the squeeze band', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).toContain('@media (max-width: 900px)')
    expect(css).not.toContain('@media (max-width: 720px)')
  })

  test('the rail hides below the cutover and the jump menu appears', async () => {
    const railUrl = new URL('../../../client/admin/components/AdminSidebarPanel.svelte', import.meta.url)
    const rail = await Bun.file(railUrl).text()
    expect(rail).toMatch(/@media \(max-width: 900px\) \{\s*\.admin-sidebar \{\s*display: none;/u)

    const jumpUrl = new URL('../../../client/admin/components/AdminJumpMenu.svelte', import.meta.url)
    const jump = await Bun.file(jumpUrl).text()
    expect(jump).toMatch(/@media \(max-width: 900px\) \{\s*\.admin-jump \{\s*display: flex;/u)
  })

  test('the jump menu names itself without the settings-only type utility', async () => {
    const jumpUrl = new URL('../../../client/admin/components/AdminJumpMenu.svelte', import.meta.url)
    const jump = await Bun.file(jumpUrl).text()
    expect(jump).toContain('id="admin-jump-label"')
    expect(jump).toContain('ariaLabelledby="admin-jump-label"')
    expect(jump).not.toContain('t-label')
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/admin-css.test.ts
```

Expected: FAIL — `@media (max-width: 720px)` still present, and `AdminJumpMenu.svelte` does not exist (`Bun.file(...).text()` rejects with ENOENT).

- [ ] **Step 3: Create the jump menu**

Create `client/admin/components/AdminJumpMenu.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Select from '../../shared/ui/Select.svelte'

  import { adminSections } from '../admin.svelte.js'

  interface Props {
    activeId: string
  }

  let { activeId }: Props = $props()

  // Admin's six sections are ungrouped, so this is a flat `options` list rather than the
  // `groups` the settings jump menu builds from its collapsible sidebar groups.
  const options = adminSections.map((section) => ({ value: section.id, label: section.label }))

  function onChange(id: string): void {
    window.location.hash = `#${id}`
  }
</script>

<div class="admin-jump">
  <span class="admin-jump__lbl" id="admin-jump-label">Jump to</span>
  <!-- This menu is not wrapped in a Field, so the shared Select never picks up a label id
       from Field context; pass this span's id explicitly so the select still gets an
       accessible name. -->
  <Select
    value={activeId}
    {options}
    {onChange}
    block
    testid="admin-jump-select"
    ariaLabelledby="admin-jump-label" />
</div>

<style>
  .admin-jump {
    display: none;
    flex-direction: column;
    gap: var(--s1);
    width: 100%;
  }
  /* Repeats AdminTopBar's `.admin-topbar__lbl` because Svelte scoping keeps that class
     inside its own component, and the settings-only `.t-label` utility is not loaded by
     admin.html. This is the concrete cost of the deferred `settings-app-no-shared-type-scale`. */
  .admin-jump__lbl {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  @media (max-width: 900px) {
    .admin-jump {
      display: flex;
    }
  }
</style>
```

- [ ] **Step 4: Render it in the top bar**

In `client/admin/components/AdminTopBar.svelte`, add to the import block (after the `TopBar` import, in the `../` group):

```typescript
  import { adminState, refreshAll, setWindow } from '../admin.svelte.js'
  import { logout } from '../auth.js'
  import { adminGlobals } from '../global-stats.svelte.js'
  import type { StatsWindow } from '../global-stats.svelte.js'

  import AdminJumpMenu from './AdminJumpMenu.svelte'
```

and replace the `secondaryRow` snippet body's closing so the menu renders below the existing row:

```svelte
  {#snippet secondaryRow()}
    <div class="admin-topbar__secondary">
      <span class="admin-topbar__lbl">window</span>
      <Seg
        options={['1d', '7d', '30d', 'all']}
        value={adminGlobals.window}
        onChange={(v) => setWindow(v as StatsWindow)} />
      <span class="admin-topbar__spacer"></span>
      <span class="admin-topbar__lbl">last refreshed</span>
      <span class="admin-topbar__stat">{refreshedLabel}</span>
      <Btn variant="ghost" size="sm" onClick={() => void refreshAll()}>
        {#snippet children()}refresh all{/snippet}
      </Btn>
    </div>
    <AdminJumpMenu activeId={adminState.currentSection} />
  {/snippet}
```

- [ ] **Step 5: Move the breakpoint and hide the rail**

In `client/admin/admin.css`, replace:

```css
@media (max-width: 720px) {
  .admin-grid {
    grid-template-columns: 1fr;
  }

  .admin-section-header {
    flex-direction: column;
    align-items: stretch;
  }
}
```

with:

```css
/* Below this the rail hides and the jump menu takes over. 900px, not 720px: with a
   fixed 220px rail, a 760px viewport leaves the content column ~492px -- narrower than
   the 608px it gets at 640px, where the rail is already gone. */
@media (max-width: 900px) {
  .admin-grid {
    grid-template-columns: 1fr;
  }

  .admin-section-header {
    flex-direction: column;
    align-items: stretch;
  }
}
```

In `client/admin/components/AdminSidebarPanel.svelte`, append to its `<style>` block, after `.admin-sidebar__kvs`:

```css
  @media (max-width: 900px) {
    .admin-sidebar {
      display: none;
    }
  }
```

- [ ] **Step 6: Give `active` a home in Overview**

In `client/admin/sections/OverviewSection.svelte`, replace the `subjectsSub` derivation:

```typescript
  const subjectsSub = $derived(
    adminGlobals.data?.subjects === undefined
      ? undefined
      : `${adminGlobals.data.subjects.dmTotal} dm · ${adminGlobals.data.subjects.groupTotal} group`,
  )
```

with (the rail's `active` quick stat hides below 900px, and this is its only other home):

```typescript
  const subjectsSub = $derived.by(() => {
    const subjects = adminGlobals.data?.subjects
    if (subjects === undefined) return undefined
    const base = `${subjects.dmTotal} dm · ${subjects.groupTotal} group`
    const active = adminGlobals.data?.active?.activeIn30d
    return active === undefined ? base : `${base} · ${active} active 30d`
  })
```

- [ ] **Step 7: Run the CSS tests to verify they pass**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/admin-css.test.ts
```

Expected: PASS, 12 pass.

- [ ] **Step 8: Stamp headers, typecheck, lint, format**

```bash
bun license:headers && bun run typecheck && bun run lint && bun run format
```

Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add client/admin tests/client/admin
git commit -m "fix(admin): hide the rail below 900px and give the top bar a jump menu"
```

---

### Task 6: Focus ring and nav semantics

`admin.css` declares no `:focus-visible` rule and `admin.html` loads only that sheet. The shared primitives carry their own rings, so the gap lands exactly on the bare elements — the six nav links and the top-bar links. Separately, `<nav>` has no accessible name and the current section is marked with a class only.

**Files:**

- Modify: `client/admin/admin.css`
- Modify: `client/admin/components/AdminSidebarPanel.svelte`
- Modify: `tests/client/admin/admin-css.test.ts`

**Interfaces:**

- Consumes: `--focus-ring` / `--focus-ring-offset` from `client/shared/tokens.css:39-40`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/admin/admin-css.test.ts`:

```typescript
  test('the focus ring uses the shared tokens rather than a copied literal', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    const m = css.match(/[^}]*:focus-visible \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [rule] = m!
    expect(rule).toContain('outline: var(--focus-ring)')
    expect(rule).toContain('outline-offset: var(--focus-ring-offset)')
    expect(css).not.toContain('rgba(82, 224, 138, 0.4)')
  })

  test('the nav is named and the current section is announced, not only coloured', async () => {
    const url = new URL('../../../client/admin/components/AdminSidebarPanel.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    expect(svelte).toContain('aria-label="Admin sections"')
    expect(svelte).toContain('aria-current={activeId === item.id ? \'true\' : undefined}')
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/admin-css.test.ts
```

Expected: FAIL — no `:focus-visible` match in `admin.css`, no `aria-label` in the panel.

- [ ] **Step 3: Add the focus ring**

In `client/admin/admin.css`, insert immediately after the `.eyebrow` block (before `.admin-section-header`):

```css
/* The shared primitives carry their own rings; this covers the bare elements the admin
   shell renders itself -- the nav links and the top-bar links. */
.ui-shell :focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}
```

- [ ] **Step 4: Name the nav and announce the current link**

In `client/admin/components/AdminSidebarPanel.svelte`, replace the `<nav>` block:

```svelte
    <nav class="admin-sidebar__nav">
      {#each items as item (item.id)}
        <a
          class="admin-sidebar__link"
          class:admin-sidebar__link--active={activeId === item.id}
          href={`#${item.id}`}>
          {item.label}
        </a>
      {/each}
    </nav>
```

with:

```svelte
    <nav class="admin-sidebar__nav" aria-label="Admin sections">
      {#each items as item (item.id)}
        <a
          class="admin-sidebar__link"
          class:admin-sidebar__link--active={activeId === item.id}
          aria-current={activeId === item.id ? 'true' : undefined}
          href={`#${item.id}`}>
          {item.label}
        </a>
      {/each}
    </nav>
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/admin-css.test.ts
```

Expected: PASS, 14 pass.

- [ ] **Step 6: Prove every token still resolves**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/token-references.test.ts
```

Expected: PASS.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add client/admin tests/client/admin
git commit -m "fix(admin): add a keyboard focus ring and name the section nav"
```

---

### Task 7: `Bars` renders at the height it was asked for

`Bars.svelte`'s width-less branch renders `viewBox="0 0 {intrinsicW} {height}"` with `preserveAspectRatio="none"` under `.ui-bars--fluid { width: 100%; height: auto }`. The caller's `height` becomes an aspect-ratio denominator, so the rendered height is the container width scaled by `height / intrinsicW` — `OverviewSection` asks for 56px and gets roughly 320px in a ~570px panel, pushing five of six sections below the fold. Pin the fluid branch to the requested height and keep `preserveAspectRatio="none"` so bars still stretch horizontally, which is what that attribute was for.

**Files:**

- Modify: `client/shared/ui/Bars.svelte`
- Modify: `tests/client/shared/ui/Bars.test.ts` (it already exists with five tests — append, do not replace)

**Interfaces:**

- Consumes: nothing.
- Produces: `Bars` props unchanged (`{ data: number[] | undefined; width?: number; height?: number; color?: string }`). Four call sites, all under `client/admin/` — `OverviewSection.svelte:126`, `StatsPanel.svelte:232`, `StatsPanel.svelte:260`, `SubjectDetail.svelte:61` — all shrink to their intended height. Task 16 adds the empty-series branch on top of the `{#snippet bars()}` this task introduces.

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe('Bars.svelte', …)` block in `tests/client/shared/ui/Bars.test.ts`, matching that file's `document.body.innerHTML = '<div id="root"></div>'` mounting style:

```typescript
  test('the fluid branch renders at the requested height, not an aspect ratio', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Bars, { target, props: { data: [1, 2, 3], height: 56 } })
    const svg = target.querySelector('svg')!
    expect(svg.getAttribute('style')).toContain('height: 56px')
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none')
    expect(svg.getAttribute('height')).toBeNull()
    void unmount(component)
  })

  test('every bar stays inside the requested height', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Bars, { target, props: { data: [10, 5, 0], height: 56 } })
    for (const rect of target.querySelectorAll('rect')) {
      const y = Number(rect.getAttribute('y'))
      const h = Number(rect.getAttribute('height'))
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y + h).toBeLessThanOrEqual(56)
    }
    void unmount(component)
  })
```

The file's existing `svg uses viewBox when width is omitted` test already covers the fluid branch's `viewBox`, and `renders one rect per data point` covers the fixed branch — do not duplicate them.

- [ ] **Step 2: Run it to verify it fails**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Bars.test.ts
```

Expected: FAIL on `the fluid branch renders at the requested height` — the svg has no `style` attribute. The five pre-existing tests still pass.

- [ ] **Step 3: Fix the fluid branch**

Replace the markup and style of `client/shared/ui/Bars.svelte` (everything from line 22 to the end) with:

```svelte
{#snippet bars()}
  {#each safeData as v, i (i)}
    {@const h = Math.max(0, (v / max) * (height - 4))}
    <rect x={i * bw + 1} y={height - h} width={bw - 2} height={h} fill={color} fill-opacity="0.85" />
  {/each}
{/snippet}

{#if width !== undefined}
  <svg {width} {height} class="ui-bars" aria-hidden="true">
    {@render bars()}
  </svg>
{:else}
  <!-- `preserveAspectRatio="none"` is here to stretch the bars horizontally to fill the
       panel. Without an explicit height it also stretched them vertically, turning the
       caller's `height` into an aspect-ratio denominator. -->
  <svg
    viewBox="0 0 {intrinsicW} {height}"
    preserveAspectRatio="none"
    class="ui-bars ui-bars--fluid"
    style="height: {height}px"
    aria-hidden="true">
    {@render bars()}
  </svg>
{/if}

<style>
  .ui-bars {
    display: block;
  }
  .ui-bars--fluid {
    width: 100%;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Bars.test.ts
```

Expected: PASS, 7 pass.

- [ ] **Step 5: Run the shared and admin client suites**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared tests/client/admin
```

Expected: PASS.

- [ ] **Step 6: Stamp headers, typecheck, format, commit**

```bash
bun license:headers && bun run typecheck && bun run format
git add client/shared/ui/Bars.svelte tests/client/shared/ui/Bars.test.ts
git commit -m "fix(ui): render fluid Bars at the requested height"
```

---

### Task 8: `Spark` can fill its panel

`OverviewSection.svelte:122` renders `<Spark data={sparkData} />` with no dimensions, taking the defaults `width = 120, height = 28`. The `.admin-overview__spark` figure is `width: 100%`, but the SVG's own `width` attribute pins it at 120px, so it reads as a stray dark wedge in a ~570px panel. Give `Spark` the same two-branch structure `Bars` now has.

**Files:**

- Modify: `client/shared/ui/Spark.svelte`
- Modify: `tests/client/shared/ui/Spark.test.ts` (it already exists with two tests — append, do not replace)

**Interfaces:**

- Consumes: the fluid-branch shape established in Task 7.
- Produces: `Spark` props become `{ data: number[]; width?: number; height?: number; color?: string; fill?: boolean }` — `width` loses its `120` default and is now optional. `OverviewSection.svelte:122` is the only call site and already omits it, so it becomes fluid with no markup change.

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe('Spark.svelte', …)` block in `tests/client/shared/ui/Spark.test.ts`:

```typescript
  test('omitting width renders a fluid svg at the requested height', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Spark, { target, props: { data: [1, 4, 2], height: 28 } })
    const svg = target.querySelector('svg')!
    expect(svg.getAttribute('width')).toBeNull()
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none')
    expect(svg.getAttribute('style')).toContain('height: 28px')
    void unmount(component)
  })

  test('the fluid path spans the intrinsic viewBox width, not the old fixed default', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Spark, { target, props: { data: [1, 2, 3, 4, 5], height: 28 } })
    const svg = target.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 28')
    expect(target.querySelector('path[data-role="line"]')!.getAttribute('d')).toContain('100,')
    void unmount(component)
  })
```

The file's existing first test passes `width: 100` and keeps asserting the fixed branch; its second test passes no width and now exercises the fluid branch, which still renders a line path and no area path — both keep passing unchanged.

- [ ] **Step 2: Run it to verify it fails**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Spark.test.ts
```

Expected: FAIL on `omitting width renders a fluid svg` — `width` is `"120"`, not null.

- [ ] **Step 3: Give `Spark` a fluid branch**

Replace `client/shared/ui/Spark.svelte` lines 6-44 (the script, markup, and style) with:

```svelte
<script lang="ts">
  interface Props {
    data: number[]
    /** Omit for a fluid spark that fills its container at `height`. */
    width?: number
    height?: number
    color?: string
    fill?: boolean
  }

  let { data, width, height = 28, color = 'var(--accent)', fill = true }: Props = $props()

  const intrinsicW = $derived(width ?? Math.max(data.length * 10, 100))

  const linePath = $derived.by(() => {
    if (data.length === 0) return ''
    const max = Math.max(...data, 1)
    const min = Math.min(...data, 0)
    const range = max - min || 1
    const pts = data.map((v, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * intrinsicW
      const y = height - ((v - min) / range) * (height - 2) - 1
      return `${x},${y}`
    })
    return `M ${pts.join(' L ')}`
  })

  const areaPath = $derived(`${linePath} L ${intrinsicW},${height} L 0,${height} Z`)
</script>

{#snippet paths()}
  {#if fill}
    <path data-role="area" d={areaPath} fill={color} fill-opacity="0.1" />
  {/if}
  <path data-role="line" d={linePath} fill="none" stroke={color} stroke-width="1.25" />
{/snippet}

{#if width !== undefined}
  <svg {width} {height} class="ui-spark">
    {@render paths()}
  </svg>
{:else}
  <svg
    viewBox="0 0 {intrinsicW} {height}"
    preserveAspectRatio="none"
    class="ui-spark ui-spark--fluid"
    style="height: {height}px">
    {@render paths()}
  </svg>
{/if}

<style>
  .ui-spark {
    display: block;
  }
  .ui-spark--fluid {
    width: 100%;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Spark.test.ts
```

Expected: PASS, 4 pass.

- [ ] **Step 5: Confirm no caller relied on the old default**

```bash
grep -rn "<Spark" client/ --exclude-dir=node_modules
```

Expected: one hit, `client/admin/sections/OverviewSection.svelte:122`, which passes no `width` and now renders fluid. If any other call site appears, it either passes an explicit `width` (unaffected) or must be given `width={120}` to preserve its current size — report that in the task report.

- [ ] **Step 6: Typecheck, format, commit**

```bash
bun license:headers && bun run typecheck && bun run format
git add client/shared/ui/Spark.svelte tests/client/shared/ui/Spark.test.ts
git commit -m "fix(ui): let Spark fill its container instead of pinning at 120px"
```

---

### Task 9: KPI tiles wrap instead of ellipsing

`OverviewSection.svelte:150-155` pins `grid-template-columns: repeat(5, minmax(0, 1fr))` with no breakpoint, so five tiles keep splitting whatever width remains after the 220px rail. `MetricCard.svelte:55-58` then clips the value with `text-overflow: ellipsis` — at 760px the tiles read `3…`, `2…`, `2…` where the real figures are 3,541 / 27.6k / 2.5 MB.

**Files:**

- Modify: `client/admin/sections/OverviewSection.svelte` (style block)
- Modify: `tests/client/admin/admin-css.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing.

**Out of scope, deliberately:** `StatsPanel.svelte` has its own KPI grids. The review never scrolled into the Stats section, so they stay untouched rather than receive an unreviewed change.

- [ ] **Step 1: Write the failing test**

Append to `tests/client/admin/admin-css.test.ts`:

```typescript
  test('KPI tiles wrap to a second row rather than ellipsing their headline value', async () => {
    const url = new URL('../../../client/admin/sections/OverviewSection.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    const m = svelte.match(/\.overview__kpis \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [kpis] = m!
    expect(kpis).toContain('repeat(auto-fit, minmax(160px, 1fr))')
    expect(kpis).not.toContain('repeat(5,')
  })
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/admin-css.test.ts
```

Expected: FAIL — `repeat(5, minmax(0, 1fr))` still present.

- [ ] **Step 3: Make the grid wrap**

In `client/admin/sections/OverviewSection.svelte`, replace:

```css
  .overview__kpis {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
    padding: 12px;
  }
```

with:

```css
  /* 160px fits the widest realistic value (`27.6k` at the tile's headline size) inside
     the 128px left after MetricCard's `padding: 14px 16px`, so tiles wrap to a second
     row rather than ellipsing a headline number. */
  .overview__kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--s2);
    padding: var(--s3);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/admin-css.test.ts
```

Expected: PASS, 16 pass.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add client/admin/sections/OverviewSection.svelte tests/client/admin/admin-css.test.ts
git commit -m "fix(admin): let the overview KPI tiles wrap instead of truncating"
```

---

### Task 10: `refreshGlobals` stops swallowing failures

`global-stats.svelte.ts:82-96` returns early on both failure paths — `if (!res.ok) return` and `if (!parsed.success) return` — leaving `data` and `fetchedAt` at their stale values while `loading` flips back to false in the `finally`. A failed refresh is indistinguishable from a successful one: nothing on screen changes and nothing is recorded. This is a new finding (`admin-app-global-refresh-fails-silently`) that the design surfaced, and it is a prerequisite for Task 11 — the status pill has no health signal to bind to until this field exists.

**Files:**

- Modify: `client/admin/global-stats.svelte.ts`
- Modify: `tests/client/admin/global-stats.svelte.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

```typescript
export const adminGlobals = $state({
  window: '30d' as StatsWindow,
  loading: false,
  data: null as GlobalStats | null,
  fetchedAt: null as number | null,
  error: null as string | null,
})
```

Task 11 reads `adminGlobals.error` and `adminGlobals.loading`.

- [ ] **Step 1: Write the failing tests**

Append to the existing top-level `describe` in `tests/client/admin/global-stats.svelte.test.ts` (follow that file's existing fetch-stubbing pattern; if it uses `setMockFetch()` / `restoreFetch()` from `tests/utils/test-helpers.ts`, use those rather than introducing a second mechanism):

```typescript
  test('records the status when the request fails and keeps the last good data', async () => {
    adminGlobals.data = { window: '30d' }
    adminGlobals.error = null
    setMockFetch(() => new Response('nope', { status: 503 }))
    await refreshGlobals()
    expect(adminGlobals.error).toBe('request failed with status 503')
    expect(adminGlobals.data).toEqual({ window: '30d' })
    expect(adminGlobals.loading).toBe(false)
    restoreFetch()
  })

  test('records the status when the body does not match the schema', async () => {
    adminGlobals.error = null
    setMockFetch(() => Response.json({ subjects: { dmTotal: 'lots' } }))
    await refreshGlobals()
    expect(adminGlobals.error).toBe('response did not match the expected shape')
    expect(adminGlobals.loading).toBe(false)
    restoreFetch()
  })

  test('clears a previous error on a successful refresh', async () => {
    adminGlobals.error = 'request failed with status 503'
    setMockFetch(() => Response.json({ window: '30d', subjects: { dmTotal: 1, groupTotal: 0, growthLast30d: [] } }))
    await refreshGlobals()
    expect(adminGlobals.error).toBeNull()
    expect(adminGlobals.data?.subjects?.dmTotal).toBe(1)
    restoreFetch()
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/global-stats.svelte.test.ts
```

Expected: FAIL — `Property 'error' does not exist` at typecheck, or `expect(undefined).toBe('request failed with status 503')` at runtime.

- [ ] **Step 3: Add the error field and set it on both failure paths**

In `client/admin/global-stats.svelte.ts`, replace lines 75-97:

```typescript
export const adminGlobals = $state({
  window: '30d' as StatsWindow,
  loading: false,
  data: null as GlobalStats | null,
  fetchedAt: null as number | null,
})

export async function refreshGlobals(): Promise<void> {
  adminGlobals.loading = true
  try {
    const res = await fetch(`/stats/global?window=${encodeURIComponent(adminGlobals.window)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return
    const body = await readBody(res)
    const parsed = GlobalStatsSchema.safeParse(body)
    if (!parsed.success) return
    adminGlobals.data = parsed.data
    adminGlobals.fetchedAt = Date.now()
  } finally {
    adminGlobals.loading = false
  }
}
```

with:

```typescript
export const adminGlobals = $state({
  window: '30d' as StatsWindow,
  loading: false,
  data: null as GlobalStats | null,
  fetchedAt: null as number | null,
  /** Why the last refresh failed, or null when the last refresh succeeded. */
  error: null as string | null,
})

export async function refreshGlobals(): Promise<void> {
  adminGlobals.loading = true
  adminGlobals.error = null
  try {
    const res = await fetch(`/stats/global?window=${encodeURIComponent(adminGlobals.window)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      // Stale data stays on screen: the last good numbers are more useful than a blank
      // dashboard, and the pill in the top bar is what says they are stale.
      adminGlobals.error = `request failed with status ${res.status}`
      return
    }
    const body = await readBody(res)
    const parsed = GlobalStatsSchema.safeParse(body)
    if (!parsed.success) {
      adminGlobals.error = 'response did not match the expected shape'
      return
    }
    adminGlobals.data = parsed.data
    adminGlobals.fetchedAt = Date.now()
  } finally {
    adminGlobals.loading = false
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/global-stats.svelte.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/admin/global-stats.svelte.ts tests/client/admin/global-stats.svelte.test.ts
git commit -m "fix(admin): record why a global-stats refresh failed instead of swallowing it"
```

---

### Task 11: The status pill reports something real

`AdminTopBar.svelte:29` renders `<Pill tone="accent" dot>configured</Pill>` as a literal. Nothing in `GlobalStatsSchema` describes instance health or configuration, so the green dot claims a check that is not being made — including in the `Empty data` story, where the instance has no subjects. Bind it to fetch health, the one signal the client actually has.

| Condition                     | Tone      | Text      |
| ----------------------------- | --------- | --------- |
| `adminGlobals.loading`        | `neutral` | `loading` |
| `adminGlobals.error !== null` | `warn`    | `stale`   |
| otherwise                     | `accent`  | `live`    |

`warn` rather than `danger`: the numbers on screen are stale, not wrong.

**Files:**

- Modify: `client/admin/components/AdminTopBar.svelte`
- Modify: `tests/client/admin/components/AdminTopBar.test.ts` (create it if the directory has no such file, using the sibling component tests' pattern)

**Interfaces:**

- Consumes: `adminGlobals.loading` and `adminGlobals.error` from Task 10.
- Produces: a `health` derivation local to `AdminTopBar`; nothing later depends on it.

**A real instance-health endpoint stays out of scope.** Genuine configuration health (task provider assigned, LLM credentials present, chat instances connected) is server work with its own schema, route, and `/stats/*` anonymity review.

- [ ] **Step 1: Write the failing test**

Add to `tests/client/admin/components/AdminTopBar.test.ts`:

```typescript
  test('the status pill reports fetch health rather than a hardcoded claim', async () => {
    const url = new URL('../../../../client/admin/components/AdminTopBar.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    expect(svelte).not.toContain('configured')
    expect(svelte).toContain("{ tone: 'neutral' as const, text: 'loading' }")
    expect(svelte).toContain("{ tone: 'warn' as const, text: 'stale' }")
    expect(svelte).toContain("{ tone: 'accent' as const, text: 'live' }")
  })
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/components/AdminTopBar.test.ts
```

Expected: FAIL — `configured` is still present.

- [ ] **Step 3: Bind the pill**

In `client/admin/components/AdminTopBar.svelte`, add below the `refreshedLabel` derivation:

```typescript
  // `warn`, not `danger`: the numbers on screen are stale, not wrong.
  const health = $derived.by(() => {
    if (adminGlobals.loading) return { tone: 'neutral' as const, text: 'loading' }
    if (adminGlobals.error !== null) return { tone: 'warn' as const, text: 'stale' }
    return { tone: 'accent' as const, text: 'live' }
  })
```

and replace line 29:

```svelte
      <Pill tone="accent" dot>{#snippet children()}configured{/snippet}</Pill>
```

with:

```svelte
      <Pill tone={health.tone} dot>{#snippet children()}{health.text}{/snippet}</Pill>
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/components/AdminTopBar.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/admin/components/AdminTopBar.svelte tests/client/admin/components
git commit -m "fix(admin): bind the status pill to fetch health"
```

---

### Task 12: "last refreshed" ticks

`AdminTopBar.svelte:17-23` reads `Date.now()` inside `$derived.by` with no ticker in its dependency set, so the label only recomputes when other admin state changes. Every screenshot reads `0s ago`, including ones taken long after the fixture loaded. 1s granularity is required because the label renders seconds below one minute.

**Files:**

- Modify: `client/admin/components/AdminTopBar.svelte`
- Modify: `tests/client/admin/components/AdminTopBar.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `tests/client/admin/components/AdminTopBar.test.ts`:

```typescript
  test('the refreshed label reads a ticking state, not Date.now() inside the derivation', async () => {
    const url = new URL('../../../../client/admin/components/AdminTopBar.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    const m = svelte.match(/const refreshedLabel = \$derived\.by\(\(\) => \{[\s\S]*?\n  \}\)/u)
    expect(m).not.toBeNull()
    const [derivation] = m!
    expect(derivation).not.toContain('Date.now()')
    expect(derivation).toContain('now - adminState.lastRefreshedAt')
    expect(svelte).toContain('let now = $state(Date.now())')
    expect(svelte).toContain('clearInterval(handle)')
  })
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/components/AdminTopBar.test.ts
```

Expected: FAIL — the derivation still contains `Date.now()`.

- [ ] **Step 3: Add the ticker**

In `client/admin/components/AdminTopBar.svelte`, replace the `refreshedLabel` derivation:

```typescript
  const refreshedLabel = $derived.by(() => {
    if (adminState.lastRefreshedAt === null) return 'never'
    const seconds = Math.max(0, Math.floor((Date.now() - adminState.lastRefreshedAt) / 1000))
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ago`
  })
```

with:

```typescript
  // 1s, because the label renders seconds below one minute. Reading `now` rather than
  // calling Date.now() is what puts the tick in the derivation's dependency set.
  let now = $state(Date.now())

  $effect(() => {
    const handle = setInterval(() => {
      now = Date.now()
    }, 1000)
    return (): void => {
      clearInterval(handle)
    }
  })

  const refreshedLabel = $derived.by(() => {
    if (adminState.lastRefreshedAt === null) return 'never'
    const seconds = Math.max(0, Math.floor((now - adminState.lastRefreshedAt) / 1000))
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ago`
  })
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/components/AdminTopBar.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/admin/components/AdminTopBar.svelte tests/client/admin/components
git commit -m "fix(admin): tick the last-refreshed label instead of freezing it"
```

---

### Task 13: The `tools` quick stat carries a number

`AdminSidebarPanel.svelte:40` is `<KV k="tools" v="—" />` — a literal, unlike lines 38-39 which read from `adminGlobals.data`. It renders as a permanently dead row below two rows that do carry numbers. Bind it to the same derivation the Overview `tools` tile already uses, extracted so the two cannot drift apart.

**Files:**

- Modify: `client/admin/global-stats.svelte.ts` (export the derivation)
- Modify: `client/admin/sections/OverviewSection.svelte` (consume it)
- Modify: `client/admin/components/AdminSidebarPanel.svelte` (consume it)
- Modify: `tests/client/admin/global-stats.svelte.test.ts`

**Interfaces:**

- Consumes: `adminGlobals` from Task 10.
- Produces:

```typescript
export interface ToolTotals {
  total: number
  ok: number
  fail: number
}

/** Totals over `toolMix.topTools`, or null when the stats payload has no tool mix. */
export function toolTotalsFrom(stats: GlobalStats | null): ToolTotals | null
```

Both `OverviewSection` and `AdminSidebarPanel` import it from `client/admin/global-stats.svelte.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/client/admin/global-stats.svelte.test.ts`:

```typescript
  test('toolTotalsFrom sums counts and splits them by success rate', () => {
    const totals = toolTotalsFrom({
      toolMix: {
        topTools: [
          { toolName: 'a', count: 100, successRate: 0.9 },
          { toolName: 'b', count: 10, successRate: 1 },
        ],
        errorTypeCounts: {},
      },
    })
    expect(totals).toEqual({ total: 110, ok: 100, fail: 10 })
  })

  test('toolTotalsFrom returns null when there is no tool mix', () => {
    expect(toolTotalsFrom(null)).toBeNull()
    expect(toolTotalsFrom({})).toBeNull()
  })
```

Add `toolTotalsFrom` to the file's existing import from `../../../client/admin/global-stats.svelte.js`.

- [ ] **Step 2: Run it to verify it fails**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/global-stats.svelte.test.ts
```

Expected: FAIL — `toolTotalsFrom is not a function` / no exported member.

- [ ] **Step 3: Export the derivation**

Append to `client/admin/global-stats.svelte.ts`:

```typescript
export interface ToolTotals {
  total: number
  ok: number
  fail: number
}

/**
 * Totals over `toolMix.topTools`. Shared so the Overview `tools` tile and the rail's
 * `tools` quick stat cannot drift apart.
 */
export function toolTotalsFrom(stats: GlobalStats | null): ToolTotals | null {
  const tools = stats?.toolMix?.topTools
  if (tools === undefined) return null
  let total = 0
  let ok = 0
  for (const t of tools) {
    total += t.count
    ok += Math.round(t.count * t.successRate)
  }
  return { total, ok, fail: total - ok }
}
```

- [ ] **Step 4: Consume it in Overview**

In `client/admin/sections/OverviewSection.svelte`, replace:

```typescript
  const toolTotals = $derived.by(() => {
    const tools = adminGlobals.data?.toolMix?.topTools
    if (tools === undefined) return null
    let total = 0
    let ok = 0
    for (const t of tools) {
      total += t.count
      ok += Math.round(t.count * t.successRate)
    }
    return { total, ok, fail: total - ok }
  })
```

with:

```typescript
  const toolTotals = $derived(toolTotalsFrom(adminGlobals.data))
```

and change its import line from:

```typescript
  import { adminGlobals } from '../global-stats.svelte.js'
```

to:

```typescript
  import { adminGlobals, toolTotalsFrom } from '../global-stats.svelte.js'
```

- [ ] **Step 5: Consume it in the rail**

In `client/admin/components/AdminSidebarPanel.svelte`, add to the script block:

```typescript
  const toolTotal = $derived(toolTotalsFrom(adminGlobals.data)?.total ?? '—')
```

and change its `adminGlobals` import to `import { adminGlobals, toolTotalsFrom } from '../global-stats.svelte.js'`, then replace:

```svelte
      <KV k="tools" v="—" />
```

with:

```svelte
      <KV k="tools" v={toolTotal} />
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin
```

Expected: PASS.

- [ ] **Step 7: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/admin tests/client/admin
git commit -m "fix(admin): bind the tools quick stat to the same totals as the overview tile"
```

---

### Task 14: Reminders gets the card frame its siblings have

`RemindersSection.svelte:72` opens `<section id="reminders" class="admin-section">` without the `admin-data-section` class or the wrapping `Panel` that `MemosSection.svelte:83` and `IdentitiesSection.svelte:76` both use. Between two bordered, titled cards, its controls float on the page background with no header and no border.

**Files:**

- Modify: `client/admin/sections/RemindersSection.svelte`
- Modify: `tests/client/admin/sections/RemindersSection.test.ts` (create it if absent, following the sibling section tests' pattern)

**Interfaces:**

- Consumes: `Panel` from `client/shared/ui/Panel.svelte` — props `{ title?, count?, body: Snippet, action?: Snippet, dense?, flat?, pad? }`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `tests/client/admin/sections/RemindersSection.test.ts`:

```typescript
  test('the section is carded and framed like its siblings', async () => {
    const url = new URL('../../../../client/admin/sections/RemindersSection.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    expect(svelte).toContain('class="admin-data-section admin-section"')
    expect(svelte).toContain('<Panel title="reminders">')
  })
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/sections/RemindersSection.test.ts
```

Expected: FAIL — `class="admin-section"` has no `admin-data-section`.

- [ ] **Step 3: Wrap it in a Panel**

In `client/admin/sections/RemindersSection.svelte`, replace the markup block (lines 72-129) with:

```svelte
<section id="reminders" class="admin-data-section admin-section" bind:this={rootEl}>
  <Panel title="reminders">
    {#snippet action()}
      <Toolbar>
        <Field label="user id">
          <Input value={userId} onInput={(v) => (userId = v)} placeholder="user id" testid="reminders-user-id" />
        </Field>
        <Btn
          variant="primary"
          size="sm"
          testid="reminders-load"
          disabled={userId.trim() === '' || loading}
          onClick={() => {
            void loadReminders()
          }}>
          {#snippet children()}{loading ? 'Loading reminders…' : 'Load reminders'}{/snippet}
        </Btn>
      </Toolbar>
    {/snippet}
    {#snippet body()}
      {#if error !== null}
        <p class="status-error">{error}</p>
      {:else if hasLoaded && recurring.length === 0 && deferred.length === 0}
        <p class="placeholder">No reminders found</p>
      {:else}
        <div class="reminders__grid">
          <Panel title="recurring tasks" count={recurring.length}>
            {#snippet body()}
              {#if recurring.length === 0}
                <p class="placeholder">No recurring reminders</p>
              {:else}
                <ul class="reminders__list">
                  {#each recurring as r (r.id)}
                    <li class="reminders__row">
                      <div class="reminders__row-main">
                        <span class="reminders__title">{r.title}</span>
                        <span class="reminders__sub">{r.rrule ?? 'one-shot'}</span>
                      </div>
                      <StatusPill status={r.enabled ? 'enabled' : 'paused'} />
                    </li>
                  {/each}
                </ul>
              {/if}
            {/snippet}
          </Panel>

          <Panel title="Reminders & alerts" count={deferred.length}>
            {#snippet body()}
              {#if deferred.length === 0}
                <p class="placeholder">No reminders or alerts yet</p>
              {:else}
                <ul class="reminders__list">
                  {#each deferred as d (d.id)}
                    <li class="reminders__row">
                      <div class="reminders__row-main">
                        <span class="reminders__title">{d.prompt}</span>
                        <span class="reminders__sub">fires at {d.fireAt}</span>
                      </div>
                      <StatusPill status={d.status} />
                    </li>
                  {/each}
                </ul>
              {/if}
            {/snippet}
          </Panel>
        </div>
      {/if}
    {/snippet}
  </Panel>
</section>
```

The `Load reminders` label change is Task 15's other half landing here because the button moves in this edit; Task 15 covers the Memos side.

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/sections/RemindersSection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/admin/sections/RemindersSection.svelte tests/client/admin/sections
git commit -m "fix(admin): frame the reminders section like its sibling data sections"
```

---

### Task 15: Both "user id" lookups name what they load

`MemosSection.svelte:92` and `RemindersSection.svelte:75` share the `user id` placeholder and the `Load` button label. Memos' input has no `Field` wrapper at all, so it carries only a placeholder where Reminders carries a real label. Scrolled together they appear twice in one screen with nothing naming what either loads.

**Files:**

- Modify: `client/admin/sections/MemosSection.svelte`
- Modify: `tests/client/admin/sections/MemosSection.test.ts` (create it if absent)

**Interfaces:**

- Consumes: `Field` from `client/shared/ui/Field.svelte`; Reminders' side was already done in Task 14.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `tests/client/admin/sections/MemosSection.test.ts`:

```typescript
  test('the user id input is labelled and the button names what it loads', async () => {
    const url = new URL('../../../../client/admin/sections/MemosSection.svelte', import.meta.url)
    const svelte = await Bun.file(url).text()
    expect(svelte).toContain('<Field label="user id">')
    expect(svelte).toContain("loading ? 'Loading memos…' : 'Load memos'")
  })
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/sections/MemosSection.test.ts
```

Expected: FAIL — no `Field` wrapper.

- [ ] **Step 3: Label the input and name the button**

In `client/admin/sections/MemosSection.svelte`, add to the import block (alphabetical, after `DataTable`):

```typescript
  import Field from '../../shared/ui/Field.svelte'
```

Then replace:

```svelte
        <Input value={userId} onInput={(v) => (userId = v)} placeholder="user id" testid="memos-user-id" />
```

with:

```svelte
        <Field label="user id">
          <Input value={userId} onInput={(v) => (userId = v)} placeholder="user id" testid="memos-user-id" />
        </Field>
```

and replace:

```svelte
          {#snippet children()}{loading ? 'Loading…' : 'Load'}{/snippet}
```

with:

```svelte
          {#snippet children()}{loading ? 'Loading memos…' : 'Load memos'}{/snippet}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/admin/sections/MemosSection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Confirm no test asserted the old label**

```bash
grep -rn "memos-load\|reminders-load" tests/ --exclude-dir=node_modules
```

Expected: only testid selectors. If any test asserts the literal text `Load`, update it to `Load memos` / `Load reminders` and report that in the task report.

- [ ] **Step 6: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/admin/sections/MemosSection.svelte tests/client/admin/sections
git commit -m "fix(admin): label the memos lookup and name both Load buttons"
```

---

### Task 16: A designed empty state

The `admin-empty` fixture zeroes `subjects` only; LLM calls, tools, tokens, storage, surface mix, and both charts stay fully populated in the `Empty data` story. No admin surface renders a zero-data treatment, so what a fresh instance actually shows is neither designed nor captured. Make the fixture genuinely empty — every `GlobalStats` sub-object present with zeroed counts and empty arrays, which is what a migrated-but-unused instance returns — and give the charts and the surface-mix panel a zero-data branch. KPI tiles keep rendering `0`, which is meaningful information, not an empty state.

**Files:**

- Modify: `client/shared/helpers.ts`
- Modify: `client/shared/ui/Bars.svelte`, `client/shared/ui/Spark.svelte`
- Modify: `client/admin/sections/OverviewSection.svelte`
- Modify: `client/stories/msw/handlers.ts`
- Modify: `tests/client/shared/ui/Bars.test.ts` — **two existing tests assert the behaviour this task deliberately changes** (`renders empty svg for undefined data` expects an svg with zero rects; `renders flat baseline for all-zero data` expects four rects). Rewrite both to assert no svg at all. This is the intended behaviour change, not a test being bent to fit.
- Modify: `tests/client/shared/ui/Spark.test.ts`
- Modify: `tests/client/shared/helpers.test.ts`

**Interfaces:**

- Consumes: `EmptyState` — `{ title: string; icon?: string; hint?: string; action?: Snippet }` (`client/shared/ui/EmptyState.svelte:9-15`); the default icon is used, no hint — an admin dashboard with no traffic yet needs no next step.
- Produces:

```typescript
/** True when a series has at least one positive, finite value worth charting. */
export function hasSeriesData(data: readonly number[] | undefined): boolean
```

exported from `client/shared/helpers.ts` and used by `Bars`, `Spark`, and `OverviewSection` so the chart and its empty state cannot disagree.

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/shared/helpers.test.ts`, adding `hasSeriesData` to that file's existing import from `../../../client/shared/helpers.js`:

```typescript
describe('hasSeriesData', () => {
  test('is false for undefined, empty, and all-zero series', () => {
    expect(hasSeriesData(undefined)).toBe(false)
    expect(hasSeriesData([])).toBe(false)
    expect(hasSeriesData([0, 0, 0])).toBe(false)
  })

  test('is false for a series of non-finite values', () => {
    expect(hasSeriesData([Number.NaN, Number.POSITIVE_INFINITY])).toBe(false)
  })

  test('is true as soon as one positive finite value is present', () => {
    expect(hasSeriesData([0, 0, 1])).toBe(true)
  })
})
```

In `tests/client/shared/ui/Bars.test.ts`, **rewrite** the two tests that assert the old behaviour. Replace:

```typescript
  test('renders empty svg for undefined data', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Bars, { target, props: { data: undefined, width: 200, height: 40 } })
    expect(target.querySelector('svg')).not.toBeNull()
    expect(target.querySelectorAll('rect').length).toBe(0)
    void unmount(component)
  })
```

with:

```typescript
  test('renders nothing at all for undefined data', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Bars, { target, props: { data: undefined, width: 200, height: 40 } })
    expect(target.querySelector('svg')).toBeNull()
    void unmount(component)
  })
```

and replace:

```typescript
  test('renders flat baseline for all-zero data', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Bars, { target, props: { data: [0, 0, 0, 0], width: 200, height: 40 } })
    expect(target.querySelectorAll('rect').length).toBe(4)
    void unmount(component)
  })
```

with (an all-zero series is a chart with nothing to show; the caller renders an empty state in its place):

```typescript
  test('renders nothing at all for an all-zero series', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Bars, { target, props: { data: [0, 0, 0, 0], width: 200, height: 40 } })
    expect(target.querySelector('svg')).toBeNull()
    void unmount(component)
  })
```

Append to `tests/client/shared/ui/Spark.test.ts`:

```typescript
  test('renders nothing at all for an empty series', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Spark, { target, props: { data: [] } })
    expect(target.querySelector('svg')).toBeNull()
    void unmount(component)
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared
```

Expected: FAIL — `hasSeriesData` is not exported; the three rewritten/new component tests all still find an svg.

- [ ] **Step 3: Add the shared predicate**

Append to `client/shared/helpers.ts`:

```typescript
/**
 * True when a series has at least one positive, finite value worth charting. Shared so a
 * chart and the empty state that replaces it can never disagree about which one shows.
 */
export function hasSeriesData(data: readonly number[] | undefined): boolean {
  return data !== undefined && data.some((v) => Number.isFinite(v) && v > 0)
}
```

- [ ] **Step 4: Guard both charts**

In `client/shared/ui/Bars.svelte`, add to the script:

```typescript
  import { hasSeriesData } from '../helpers.js'
```

and wrap the existing `{#if width !== undefined} … {/if}` block in:

```svelte
{#if hasSeriesData(safeData)}
  {#if width !== undefined}
    …unchanged fixed branch…
  {:else}
    …unchanged fluid branch…
  {/if}
{/if}
```

In `client/shared/ui/Spark.svelte`, add:

```typescript
  import { hasSeriesData } from '../helpers.js'
```

and wrap its `{#if width !== undefined} … {/if}` block the same way, in `{#if hasSeriesData(data)} … {/if}`.

- [ ] **Step 5: Give the callers an empty branch**

In `client/admin/sections/OverviewSection.svelte`, add to the imports:

```typescript
  import { fmtBytes, fmtNum, formatTokens, hasSeriesData } from '../../shared/helpers.js'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
```

add a derivation beside `surfaceMix`:

```typescript
  const hasSurfaceMix = $derived(surfaceMix.some((row) => row.n > 0))
```

replace the chart body:

```svelte
            <div class="overview__chart-body">
              <figure class="admin-overview__spark">
                <Spark data={sparkData} />
                <figcaption class="overview__caption">new subjects per day (dm + group) · last 30d</figcaption>
              </figure>
              <figure class="overview__bars-wrap">
                <Bars data={barsData} height={56} />
                <figcaption class="overview__caption">top tools by successful calls · all time</figcaption>
              </figure>
            </div>
```

with:

```svelte
            <div class="overview__chart-body">
              {#if hasSeriesData(sparkData) || hasSeriesData(barsData)}
                <figure class="admin-overview__spark">
                  <Spark data={sparkData} />
                  <figcaption class="overview__caption">new subjects per day (dm + group) · last 30d</figcaption>
                </figure>
                <figure class="overview__bars-wrap">
                  <Bars data={barsData} height={56} />
                  <figcaption class="overview__caption">top tools by successful calls · all time</figcaption>
                </figure>
              {:else}
                <EmptyState title="No activity yet" />
              {/if}
            </div>
```

and replace the surface-mix body:

```svelte
            <div class="overview__mix">
              {#each surfaceMix as row (row.label)}
                <Meter label={row.label} value={row.n} total={row.total} />
              {/each}
            </div>
```

with:

```svelte
            {#if hasSurfaceMix}
              <div class="overview__mix">
                {#each surfaceMix as row (row.label)}
                  <Meter label={row.label} value={row.n} total={row.total} />
                {/each}
              </div>
            {:else}
              <EmptyState title="No subjects yet" />
            {/if}
```

- [ ] **Step 6: Make the fixture genuinely empty**

In `client/stories/msw/handlers.ts`, replace `statsHandlers.empty`:

```typescript
  empty: [
    http.get('/stats/global', () =>
      HttpResponse.json(makeGlobalStats({ subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] } })),
    ),
    http.get('/stats/subject/:id', ({ params }) =>
      HttpResponse.json(makeSubjectStats({ storageContextId: String(params['id']) })),
    ),
  ],
```

with (what a migrated-but-unused instance returns — every sub-object present, all counts zero):

```typescript
  empty: [
    http.get('/stats/global', () =>
      HttpResponse.json(
        makeGlobalStats({
          subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] },
          active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
          storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
          identityMix: { byProvider: {}, kaneoWorkspaces: 0 },
          surfaceMix: {
            subjectsWithRecurring: 0,
            subjectsWithDeferred: 0,
            subjectsWithMemos: 0,
            subjectsWithInstructions: 0,
          },
          webFetches: { topHosts: [] },
          toolMix: { topTools: [], errorTypeCounts: {}, totalCalls: 0, totalSuccessRate: 0, toolCallGrowth30d: [] },
          llmUsage: {
            totalCalls: 0,
            mainCalls: 0,
            smallCalls: 0,
            embeddingCalls: 0,
            inputTokensTotal: 0,
            outputTokensTotal: 0,
          },
          tokenUsageByDay: [],
        }),
      ),
    ),
    http.get('/stats/subject/:id', ({ params }) =>
      HttpResponse.json(makeSubjectStats({ storageContextId: String(params['id']) })),
    ),
  ],
```

`distributions` is left at its default: no admin surface reads it, and zeroing percentile buckets would need a helper this change does not otherwise require.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared tests/client/admin
```

Expected: PASS.

- [ ] **Step 8: Typecheck, lint, format, commit**

```bash
bun license:headers && bun run typecheck && bun run lint && bun run format
git add client tests/client
git commit -m "feat(admin): design the zero-data state and make the empty fixture empty"
```

---

### Task 17: Visual states for the fixed shell

The manual states committed in Task 1 were shot against the broken shell: they name the 720px breakpoint that no longer exists and capture a rail that no longer sticks. Replace them with the states that prove the fixes, and regenerate the two generated shots (the `Empty data` story now renders a genuinely empty fixture).

**Files:**

- Modify: `tests/visual/admin/AdminApp.spec.ts` (below `@generated-end auto-screenshots` only)
- Regenerate: `.storybook-shots/**/AdminApp.spec.ts/` baselines

**Interfaces:**

- Consumes: everything from Tasks 3-16.
- Produces: the visual evidence Task 18 cites in the review document's `Resolved:` lines.

**Prerequisite:** Storybook must be running (`bun storybook`) and Chromium installed (`bunx playwright install chromium`).

- [ ] **Step 1: Replace the manual region**

Replace everything in `tests/visual/admin/AdminApp.spec.ts` from `// ---- depth-B review states (dims 6, 7, 8, 9) ----` to end of file with:

```typescript
// ---- post-fix states (dims 6, 7, 8, 9) ----

// 900px is the exact cutover: the rail is still present at this width.
test('AdminApp — breakpoint edge', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.setViewportSize({ width: 900, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// 940px is the first width above the cutover: a fixed 220px rail against a ~700px
// content column, which is where the section cards squeeze hardest.
test('AdminApp — just above breakpoint', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.setViewportSize({ width: 940, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// Below the cutover the rail is gone and the jump menu is the whole navigation model.
test('AdminApp — narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage.getByTestId('admin-jump-select')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})

// Hover on a rail link — hover and active must now read as one visual language.
test('AdminApp — sidebar link hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.getByRole('link', { name: 'Identities' }).hover()
  await expect(sharedPage).toHaveScreenshot()
})

// A short viewport is what exposed the sticky/100vh rail: the quick stats below the
// links must still be reachable by scrolling inside the rail itself.
test('AdminApp — short viewport', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.setViewportSize({ width: 1280, height: 600 })
  await expect(sharedPage).toHaveScreenshot()
})

// The rail used to ride off the top once the page passed one viewport. Scrolling the
// main column to the last section must leave the whole rail in place.
test('AdminApp — identities section scrolled into view', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'admin-adminapp--default')
  await sharedPage.locator('#identities').scrollIntoViewIfNeeded()
  await expect(sharedPage.getByRole('link', { name: 'Overview' })).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})
```

- [ ] **Step 2: Regenerate the auto-screenshot region**

```bash
bun run shoot:gen
```

Expected: the `@generated-begin`/`@generated-end` region still lists `Default` and `Empty data` — the story names did not change.

- [ ] **Step 3: Shoot the whole spec**

```bash
bun shoot -g AdminApp
```

Expected: the two generated shots and the six manual shots all write new baselines. Delete the stale baselines for the removed test names first if the runner reports orphans:

```bash
git status --short .storybook-shots
```

- [ ] **Step 4: Read the new baselines and confirm the fixes are visible**

Read these PNGs with the Read tool under `.storybook-shots/**/AdminApp.spec.ts/`:

- `AdminApp-narrow-*.png` — no rail, jump menu present in the top bar, admin content on screen
- `AdminApp-identities-section-scrolled-into-view-*.png` — the rail starts at `Overview`, not mid-list
- `AdminApp-Default-*.png` — the tool-mix bars are a ~56px strip, not a ~320px block
- `AdminApp-Empty-data-*.png` — `No activity yet` and `No subjects yet` where the charts were

Report anything that does not match in the task report rather than accepting the baseline.

- [ ] **Step 5: Commit**

```bash
git add tests/visual/admin/AdminApp.spec.ts .storybook-shots
git commit -m "test(visual): re-shoot AdminApp against the fixed shell"
```

---

### Task 18: Close the findings

Every finding in `docs/ux-reviews/AdminApp.md` is now either fixed or explicitly out of scope. Record that, add the seventeenth finding this design surfaced, re-score all nine dimensions from what the new shots show, and regenerate the backlog.

**Files:**

- Modify: `docs/ux-reviews/AdminApp.md`
- Regenerate: `docs/ux-reviews/_BACKLOG.md`

**Interfaces:**

- Consumes: the finding ids and dimension scorecard already in the document; the new baselines from Task 17.
- Produces: nothing.

**Backlog vocabulary — the parser enforces this** (`scripts/ux-backlog-lib.ts`, proven by `tests/scripts/ux-backlog.test.ts`):

- `Status` is one of `open`, `fixed`, `superseded`, `wont-fix`, `deferred`. There is **no `partial`**.
- `fixed` / `superseded` / `wont-fix` / `deferred` each require a `**Resolved:**` line.
- A partially-fixed finding stays `open` with its text narrowed to the residue, keeping its id.
- Ids are kebab-case, section-prefixed, hand-assigned, never reused, never derived from the heading.
- `**Date:**` means *last reviewed* — set it to today.

- [ ] **Step 1: Add the seventeenth finding**

Insert into `docs/ux-reviews/AdminApp.md` in severity order among the Med findings:

```markdown
### [Med] A failed global-stats refresh is indistinguishable from a successful one

- **Id:** admin-app-global-refresh-fails-silently
- **Status:** fixed
- **Resolved:** sub-project `2026-08-06-adminapp-findings`, Task 10
- **Dimension:** 4. Feedback & state
- **Source:** `client/admin/global-stats.svelte.ts:88` returned early on `!res.ok` and again on a schema mismatch, leaving `data` and `fetchedAt` stale while `loading` flipped back to false.
- **Suggested fix:** Record the failure on `adminGlobals.error` and let the top-bar pill report it.
```

- [ ] **Step 2: Mark each of the 16 original findings**

For each id below, set `- **Status:** fixed` and add `- **Resolved:** sub-project `2026-08-06-adminapp-findings`, Task N` immediately after it:

| Id                                       | Task |
| ---------------------------------------- | ---- |
| `admin-app-narrow-rail-buries-content`   | 5    |
| `admin-app-sticky-rail-scrolls-away`     | 4    |
| `admin-app-bars-height-ignored`          | 7    |
| `admin-app-no-focus-ring`                | 6    |
| `admin-app-kpi-values-truncate`          | 9    |
| `admin-app-sidebar-styled-twice`         | 3    |
| `admin-app-active-link-not-announced`    | 6    |
| `admin-app-scrollspy-root-unset`         | 4    |
| `admin-app-refreshed-label-frozen`       | 12   |
| `admin-app-status-pill-hardcoded`        | 11   |
| `admin-app-reminders-section-uncarded`   | 14   |
| `admin-app-spark-fixed-width`            | 8    |
| `admin-app-quick-stat-tools-hardcoded`   | 13   |
| `admin-app-empty-state-undesigned`       | 16   |
| `admin-app-duplicate-load-controls`      | 15   |
| `admin-app-hardcoded-px-spacing`         | 3    |

If any finding is only partially addressed, leave it `open` and narrow its text to what specifically remains — do not mark it `fixed`.

- [ ] **Step 3: Re-score all nine dimensions and set the date**

Set `**Date:** 2026-08-06` and rewrite the scorecard from the Task 17 baselines, not from the previous scorecard. The five `fail` rows should have moved; state one line of rationale per dimension citing what the new shots show. Severity is re-assignable — a High may legitimately become a Low.

- [ ] **Step 4: Regenerate the backlog**

```bash
bun run ux:backlog
```

Expected: it prints the section/finding totals and rewrites `docs/ux-reviews/_BACKLOG.md`.

- [ ] **Step 5: Verify the backlog test passes**

```bash
bun test tests/scripts/ux-backlog.test.ts
```

Expected: PASS — in particular `is current — regenerating in memory reproduces it exactly` and `covers every review document` (21).

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add docs/ux-reviews
git commit -m "docs(ux): close the AdminApp findings"
```

---

## Final Verification

Run after Task 18, before finishing the branch.

- [ ] **Full check**

```bash
bun run check:full
```

Expected: typecheck, lint, format check, and the full test suite all pass.

- [ ] **Client suites explicitly**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client
```

Expected: PASS. The bare `bun test tests/client/...` form matches nothing and reports a false success — do not substitute it.

- [ ] **Security scan**

```bash
bun security
```

Expected: no findings.

- [ ] **Mutation ratchet**

```bash
bun test:mutate:changed
```

Expected: every changed file at or above its floor in `scripts/mutation/baseline.json`. If a file lands below its floor, add the missing test rather than lowering the baseline.

- [ ] **Visual regression**

```bash
bun shoot -g AdminApp
```

Expected: no unexpected diffs against the baselines committed in Task 17.
