<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kiss MCP Feature Parity — Plan F1: `mcp-figma` Full-Simplify + Token Pooling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Upgrade the migrated `mcp-figma` plugin from the moderate port (structure/dimensions/text only) to kiss's **full simplify** — a compact CSS-layout string per node plus text-style `globalVars` de-duplication — and add **token pooling with 429 rotation** to the Figma client.

**Architecture:** Port kiss `mcp/figma-mcp/simplify.ts` (the `layoutExtractor` + `textExtractor` + globalVars dedup) into papai-style modules under `plugins/mcp-figma/`, rewritten to papai's strict conventions (no `as` casts on `unknown`, `isRecord`/`str`/`num` guards, no `number` in boolean position). The traversal is **synchronous and pure** (drops kiss's `setImmediate` yielding and module-level style counter — the counter is threaded through a per-call context). The Figma REST client accepts a **comma-separated token pool** in the existing `token` context-config value and, on HTTP `429`, **rotates to the next token and retries** (bounded to one attempt per token, **no blocking sleeps** — a deliberate divergence from kiss's up-to-60s waits, which would stall the in-process bridge).

**Tech Stack:** Bun + `bun:test`; TypeScript (strict, `.js` imports); no new dependencies. The plugin runs on the injected `providerRuntime.httpFetch` (SSRF-validated); no magi/geofront changes.

**Source of truth:** kiss `mcp/figma-mcp/simplify.ts` (layout/text extractors, lines 280–423) and `mcp/figma-mcp/client.ts` (token pool + 429 handling, lines 87–204). Reference only — the papai port below is authoritative.

---

## Reference & carried process rules (Plans 1–9)

Read `plugins/mcp-figma/` for the current shape. Carry the fleet's process rules:

- FULL `bun run lint` + `bun run knip` before EVERY commit (the per-commit hook does NOT run knip; type-aware lint rules only surface in the full run).
- SPDX headers on every new `.ts`; `.js` extensions in all import paths; no lint-disable / type-ignore.
- **`strict-boolean-expressions`:** never put a `number` or `unknown` directly in a boolean position. Compare explicitly (`x !== 0`, `s !== undefined`). This bit prior plans — the code below already pre-empts it.
- **No `as` on `unknown`:** use the `isRecord`/`str`/`num` guards (mirrors the current `plugins/mcp-figma/format.ts`).
- `max-lines` 300/file, 50/function — the split below respects both; do not game the limit.
- `bunx oxfmt` changed files before each commit.
- `check:full`'s `test` step is `bun test --parallel` and flakes under port-9100 contention — run standalone `bun test` for gating and free the port first: `lsof -ti :9100 | xargs kill -9` (ignore "no such process").

## Output-shape change (breaking, intentional)

`simplifyFigmaResponse` currently returns `{ name, nodes: SimplifiedNode[] }` where each node has an inline `textStyle` object and no layout string. After F1 it returns `{ name, nodes, globalVars }` where:

- `node.layout` is a compact CSS string (e.g. `display:flex;flex-direction:row;justify-content:center;gap:8px;padding:16px`).
- `node.textStyle` is a **reference id** (e.g. `"s1"`) into `globalVars.styles`, de-duplicated across the tree.
- `node.layoutSizingHorizontal` / `layoutSizingVertical` carried when present.

`figma_get_file` and `figma_get_file_nodes` return the richer shape automatically (the client calls `simplifyFigmaResponse`). No tool signatures, schemas, or manifest change. The existing shape-asserting tests are updated in Task 3.

## File structure

```
plugins/mcp-figma/
  simplify-util.ts    # NEW: guards (isRecord/str/num), round2, generateCSSShorthand, hasFlexLayout, isInAutoLayoutFlow
  simplify-types.ts   # NEW: SimplifiedNode, GlobalVars, SimplifiedDesign, TraversalContext, ExtractorFn
  simplify-layout.ts  # NEW: layoutExtractor (+ split sub-helpers)
  simplify-text.ts    # NEW: textExtractor + buildTextStyle + dedupStyle
  simplify.ts         # NEW: processNode walker + simplifyFigmaResponse entry
  format.ts           # REWRITE: re-export simplifyFigmaResponse + types from simplify.ts; keep parseIds
  client.ts           # MODIFY: token pool + 429 rotation in request()
  index.ts            # UNCHANGED
  README.md           # MODIFY: document full-simplify output + token pooling
tests/plugins/
  mcp-figma-simplify.test.ts   # NEW: layout + text extractor unit tests (Tasks 1–2)
  mcp-figma-client.test.ts     # NEW: token-pool / 429-rotation tests (Task 4)
  mcp-figma.test.ts            # MODIFY: update shape assertions to full-simplify (Task 3)
docs/architecture/coding-stack-overview.md  # MODIFY: note the figma full-simplify upgrade (Task 5)
```

---

## Task 1: `simplify-util.ts` + `simplify-types.ts` + `simplify-layout.ts` (layout extractor)

**Files:** Create `plugins/mcp-figma/simplify-util.ts`, `plugins/mcp-figma/simplify-types.ts`, `plugins/mcp-figma/simplify-layout.ts`, `tests/plugins/mcp-figma-simplify.test.ts`.

- [ ] **Step 1: Write the failing test** — `tests/plugins/mcp-figma-simplify.test.ts` (layout portion). It calls `layoutExtractor` directly with a fresh context.

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { layoutExtractor } from '../../plugins/mcp-figma/simplify-layout.js'
import type { SimplifiedNode, TraversalContext } from '../../plugins/mcp-figma/simplify-types.js'
import { generateCSSShorthand, hasFlexLayout, isInAutoLayoutFlow } from '../../plugins/mcp-figma/simplify-util.js'

function freshContext(parent?: Record<string, unknown>): TraversalContext {
  return { globalVars: { styles: {} }, styleIndex: new Map<string, string>(), counter: { n: 0 }, parent }
}

function runLayout(node: Record<string, unknown>, parent?: Record<string, unknown>): SimplifiedNode {
  const result: SimplifiedNode = { id: 'x', name: 'x', type: 'FRAME' }
  layoutExtractor(node, result, freshContext(parent))
  return result
}

describe('simplify-util', () => {
  test('generateCSSShorthand collapses equal sides', () => {
    expect(generateCSSShorthand({ top: 8, right: 8, bottom: 8, left: 8 })).toBe('8px')
    expect(generateCSSShorthand({ top: 8, right: 4, bottom: 8, left: 4 })).toBe('8px 4px')
    expect(generateCSSShorthand({ top: 1, right: 2, bottom: 3, left: 4 })).toBe('1px 2px 3px 4px')
  })

  test('hasFlexLayout + isInAutoLayoutFlow', () => {
    expect(hasFlexLayout({ layoutMode: 'HORIZONTAL' })).toBe(true)
    expect(hasFlexLayout({ layoutMode: 'NONE' })).toBe(false)
    const parent = { layoutMode: 'VERTICAL' }
    expect(isInAutoLayoutFlow({}, parent)).toBe(true)
    expect(isInAutoLayoutFlow({ layoutPositioning: 'ABSOLUTE' }, parent)).toBe(false)
    expect(isInAutoLayoutFlow({}, undefined)).toBe(false)
  })
})

describe('layoutExtractor', () => {
  test('flex row with justify/align/gap/padding', () => {
    const node = {
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'MAX',
      itemSpacing: 8,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    }
    expect(runLayout(node).layout).toBe(
      'display:flex;flex-direction:row;justify-content:center;align-items:flex-end;gap:8px;padding:16px',
    )
  })

  test('non-flex node with only align-self emits align-self', () => {
    expect(runLayout({ layoutAlign: 'CENTER' }).layout).toBe('align-self:center')
  })

  test('non-flex node with nothing emits no layout', () => {
    expect(runLayout({}).layout).toBeUndefined()
  })

  test('non-autolayout child gets left/top relative to parent', () => {
    const parent = { layoutMode: 'NONE', absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 100 } }
    const node = { absoluteBoundingBox: { x: 25, y: 50, width: 10, height: 10 } }
    expect(runLayout(node, parent).layout).toBe('left:15px;top:30px')
  })

  test('FIXED-sized autolayout child keeps width/height', () => {
    const parent = { layoutMode: 'VERTICAL', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 } }
    const node = {
      layoutMode: 'HORIZONTAL',
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'HUG',
      absoluteBoundingBox: { x: 0, y: 0, width: 42.005, height: 12 },
    }
    const out = runLayout(node, parent)
    expect(out.layoutSizingHorizontal).toBe('FIXED')
    expect(out.width).toBe(42.01)
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `bun test tests/plugins/mcp-figma-simplify.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Create `plugins/mcp-figma/simplify-util.ts`.**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function generateCSSShorthand(p: { top: number; right: number; bottom: number; left: number }): string {
  const { top, right, bottom, left } = p
  if (top === right && right === bottom && bottom === left) return `${top}px`
  if (top === bottom && left === right) return `${top}px ${left}px`
  return `${top}px ${right}px ${bottom}px ${left}px`
}

export function hasFlexLayout(node: Record<string, unknown>): boolean {
  const mode = node['layoutMode']
  return mode === 'HORIZONTAL' || mode === 'VERTICAL'
}

export function isInAutoLayoutFlow(
  node: Record<string, unknown>,
  parent: Record<string, unknown> | undefined,
): boolean {
  if (parent === undefined || !hasFlexLayout(parent)) return false
  return node['layoutPositioning'] !== 'ABSOLUTE'
}
```

- [ ] **Step 4: Create `plugins/mcp-figma/simplify-types.ts`.**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface GlobalVars {
  styles: Record<string, Record<string, unknown>>
}

export interface SimplifiedNode {
  id: string
  name: string
  type: string
  text?: string
  textStyle?: string
  layout?: string
  layoutSizingHorizontal?: string
  layoutSizingVertical?: string
  width?: number
  height?: number
  children?: SimplifiedNode[]
}

export interface SimplifiedDesign {
  name: string
  nodes: SimplifiedNode[]
  globalVars: GlobalVars
}

export interface TraversalContext {
  globalVars: GlobalVars
  styleIndex: Map<string, string>
  counter: { n: number }
  parent?: Record<string, unknown>
}

export type ExtractorFn = (node: Record<string, unknown>, result: SimplifiedNode, context: TraversalContext) => void
```

- [ ] **Step 5: Create `plugins/mcp-figma/simplify-layout.ts`** (each helper < 50 lines; `layoutExtractor` composes them).

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ExtractorFn, SimplifiedNode } from './simplify-types.js'
import { generateCSSShorthand, hasFlexLayout, isInAutoLayoutFlow, isRecord, num, round2, str } from './simplify-util.js'

function alignSelfPart(node: Record<string, unknown>): string | undefined {
  const la = str(node['layoutAlign'])
  if (la === 'MAX') return 'align-self:flex-end'
  if (la === 'CENTER') return 'align-self:center'
  if (la === 'STRETCH') return 'align-self:stretch'
  return undefined
}

function relativePositionParts(node: Record<string, unknown>, parent: Record<string, unknown> | undefined): string[] {
  if (parent === undefined || isInAutoLayoutFlow(node, parent)) return []
  const nodeBox = node['absoluteBoundingBox']
  const parentBox = parent['absoluteBoundingBox']
  if (!isRecord(nodeBox) || !isRecord(parentBox)) return []
  const nx = num(nodeBox['x'])
  const ny = num(nodeBox['y'])
  const px = num(parentBox['x'])
  const py = num(parentBox['y'])
  if (nx === undefined || ny === undefined || px === undefined || py === undefined) return []
  return [`left:${round2(nx - px)}px`, `top:${round2(ny - py)}px`]
}

function justifyContentPart(node: Record<string, unknown>): string | undefined {
  const pa = str(node['primaryAxisAlignItems'])
  if (pa === 'MAX') return 'justify-content:flex-end'
  if (pa === 'CENTER') return 'justify-content:center'
  if (pa === 'SPACE_BETWEEN') return 'justify-content:space-between'
  return undefined
}

function alignItemsPart(node: Record<string, unknown>): string | undefined {
  const ca = str(node['counterAxisAlignItems'])
  if (ca === 'MAX') return 'align-items:flex-end'
  if (ca === 'CENTER') return 'align-items:center'
  if (ca === 'BASELINE') return 'align-items:baseline'
  return undefined
}

function paddingPart(node: Record<string, unknown>): string | undefined {
  const top = num(node['paddingTop']) ?? 0
  const right = num(node['paddingRight']) ?? 0
  const bottom = num(node['paddingBottom']) ?? 0
  const left = num(node['paddingLeft']) ?? 0
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return undefined
  return `padding:${generateCSSShorthand({ top, right, bottom, left })}`
}

function flexParts(node: Record<string, unknown>, mode: 'row' | 'column'): string[] {
  const parts: string[] = ['display:flex', `flex-direction:${mode}`]
  const jc = justifyContentPart(node)
  if (jc !== undefined) parts.push(jc)
  const ai = alignItemsPart(node)
  if (ai !== undefined) parts.push(ai)
  if (node['layoutWrap'] === 'WRAP') parts.push('flex-wrap:wrap')
  const gap = num(node['itemSpacing'])
  if (gap !== undefined && gap > 0) parts.push(`gap:${gap}px`)
  const pad = paddingPart(node)
  if (pad !== undefined) parts.push(pad)
  return parts
}

function applySizing(
  node: Record<string, unknown>,
  result: SimplifiedNode,
  parent: Record<string, unknown> | undefined,
): void {
  const lsh = str(node['layoutSizingHorizontal'])
  if (lsh !== undefined) result.layoutSizingHorizontal = lsh
  const lsv = str(node['layoutSizingVertical'])
  if (lsv !== undefined) result.layoutSizingVertical = lsv
  if (parent === undefined || !isInAutoLayoutFlow(node, parent)) return
  const box = node['absoluteBoundingBox']
  if (!isRecord(box)) return
  if (lsh === 'FIXED') {
    const w = num(box['width'])
    if (w !== undefined) result.width = round2(w)
  }
  if (lsv === 'FIXED') {
    const h = num(box['height'])
    if (h !== undefined) result.height = round2(h)
  }
}

export const layoutExtractor: ExtractorFn = (node, result, context) => {
  const parent = context.parent
  const parts: string[] = []
  const selfPart = alignSelfPart(node)
  if (selfPart !== undefined) parts.push(selfPart)
  parts.push(...relativePositionParts(node, parent))

  const mode = hasFlexLayout(node) ? (node['layoutMode'] === 'HORIZONTAL' ? 'row' : 'column') : 'none'
  if (mode === 'none') {
    if (parts.length > 0) result.layout = parts.join(';')
    return
  }
  parts.push(...flexParts(node, mode))
  result.layout = parts.join(';')
  applySizing(node, result, parent)
}
```

- [ ] **Step 6: Run to verify pass.** `bun test tests/plugins/mcp-figma-simplify.test.ts` → PASS (the `layoutExtractor` + `simplify-util` describes; the text describe is added in Task 2).
- [ ] **Step 7: Gate.** `bun run typecheck` clean; FULL `bun run lint` → 0 errors; `bun run knip` — the three new files are imported by the test now and by `simplify.ts`/`format.ts` in Task 3; if knip flags any as unused at this point, add a temporary `["files"]` ignore entry to `knip.jsonc` for it (REMOVE those in Task 3 once `format.ts` consumes them). Must be clean.
- [ ] **Step 8: Commit.** `bunx oxfmt` changed files, then:

```bash
git add plugins/mcp-figma/simplify-util.ts plugins/mcp-figma/simplify-types.ts plugins/mcp-figma/simplify-layout.ts tests/plugins/mcp-figma-simplify.test.ts knip.jsonc
git commit -m "feat(mcp-figma): port kiss layout extractor (CSS-layout string)"
```

---

## Task 2: `simplify-text.ts` (text extractor + globalVars dedup)

**Files:** Create `plugins/mcp-figma/simplify-text.ts`; extend `tests/plugins/mcp-figma-simplify.test.ts`.

- [ ] **Step 1: Add the failing test** (append to `tests/plugins/mcp-figma-simplify.test.ts`).

```typescript
import { textExtractor } from '../../plugins/mcp-figma/simplify-text.js'

describe('textExtractor + globalVars dedup', () => {
  test('extracts text + maps a de-duplicated style reference', () => {
    const ctx = freshContext()
    const a: SimplifiedNode = { id: 'a', name: 'A', type: 'TEXT' }
    textExtractor(
      { type: 'TEXT', characters: 'Hello', style: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600 } },
      a,
      ctx,
    )
    const b: SimplifiedNode = { id: 'b', name: 'B', type: 'TEXT' }
    textExtractor(
      { type: 'TEXT', characters: 'World', style: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600 } },
      b,
      ctx,
    )
    expect(a.text).toBe('Hello')
    expect(a.textStyle).toBe('s1')
    expect(b.textStyle).toBe('s1') // identical style → same id (deduped)
    expect(Object.keys(ctx.globalVars.styles)).toEqual(['s1'])
    expect(ctx.globalVars.styles['s1']).toEqual({ fontFamily: 'Inter', fontSize: 14, fontWeight: 600 })
  })

  test('distinct styles get distinct ids; default values dropped', () => {
    const ctx = freshContext()
    const n: SimplifiedNode = { id: 'n', name: 'N', type: 'TEXT' }
    textExtractor(
      {
        type: 'TEXT',
        characters: 'x',
        style: {
          fontFamily: 'Inter',
          fontStyle: 'Regular', // dropped (default)
          textCase: 'ORIGINAL', // dropped (default)
          textAlignHorizontal: 'CENTER', // kept → textAlign
          letterSpacing: 0, // dropped (0)
          lineHeightPx: 20.004, // kept, rounded
        },
      },
      n,
      ctx,
    )
    expect(n.textStyle).toBe('s1')
    expect(ctx.globalVars.styles['s1']).toEqual({ fontFamily: 'Inter', textAlign: 'CENTER', lineHeightPx: 20 })
  })

  test('non-TEXT node is untouched', () => {
    const ctx = freshContext()
    const r: SimplifiedNode = { id: 'r', name: 'R', type: 'RECTANGLE' }
    textExtractor({ type: 'RECTANGLE', characters: 'nope' }, r, ctx)
    expect(r.text).toBeUndefined()
    expect(r.textStyle).toBeUndefined()
    expect(Object.keys(ctx.globalVars.styles)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `bun test tests/plugins/mcp-figma-simplify.test.ts` → FAIL (`simplify-text` missing).

- [ ] **Step 3: Create `plugins/mcp-figma/simplify-text.ts`.**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ExtractorFn, TraversalContext } from './simplify-types.js'
import { isRecord, num, round2, str } from './simplify-util.js'

function buildTextStyle(rawStyle: Record<string, unknown>): Record<string, unknown> {
  const style: Record<string, unknown> = {}
  const ff = str(rawStyle['fontFamily'])
  if (ff !== undefined) style['fontFamily'] = ff
  const fw = num(rawStyle['fontWeight'])
  if (fw !== undefined) style['fontWeight'] = fw
  const fsz = num(rawStyle['fontSize'])
  if (fsz !== undefined) style['fontSize'] = fsz
  const fst = str(rawStyle['fontStyle'])
  if (fst !== undefined && fst !== 'Regular') style['fontStyle'] = fst
  const lh = num(rawStyle['lineHeightPx'])
  if (lh !== undefined) style['lineHeightPx'] = round2(lh)
  const ls = num(rawStyle['letterSpacing'])
  if (ls !== undefined && ls !== 0) style['letterSpacing'] = round2(ls)
  const tc = str(rawStyle['textCase'])
  if (tc !== undefined && tc !== 'ORIGINAL') style['textCase'] = tc
  const ta = str(rawStyle['textAlignHorizontal'])
  if (ta !== undefined && ta !== 'LEFT') style['textAlign'] = ta
  const td = str(rawStyle['textDecoration'])
  if (td !== undefined && td !== 'NONE') style['textDecoration'] = td
  const ml = num(rawStyle['maxLines'])
  if (ml !== undefined) {
    style['maxLines'] = ml
    const tt = str(rawStyle['textTruncation'])
    if (tt !== undefined && tt !== 'DISABLED') style['textTruncation'] = tt
  }
  const ps = num(rawStyle['paragraphSpacing'])
  if (ps !== undefined && ps !== 0) style['paragraphSpacing'] = ps
  return style
}

function dedupStyle(context: TraversalContext, style: Record<string, unknown>): string {
  const key = JSON.stringify(style)
  const existing = context.styleIndex.get(key)
  if (existing !== undefined) return existing
  context.counter.n += 1
  const id = `s${context.counter.n}`
  context.styleIndex.set(key, id)
  context.globalVars.styles[id] = style
  return id
}

export const textExtractor: ExtractorFn = (node, result, context) => {
  if (node['type'] !== 'TEXT') return
  const characters = str(node['characters'])
  if (characters !== undefined) result.text = characters
  const rawStyle = node['style']
  if (!isRecord(rawStyle)) return
  const style = buildTextStyle(rawStyle)
  if (Object.keys(style).length === 0) return
  result.textStyle = dedupStyle(context, style)
}
```

- [ ] **Step 4: Run to verify pass.** `bun test tests/plugins/mcp-figma-simplify.test.ts` → all PASS.
- [ ] **Step 5: Gate.** `bun run typecheck`; FULL `bun run lint`; `bun run knip` (if `simplify-text.ts` is flagged unused, add a temporary `["files"]` ignore, removed in Task 3). Clean.
- [ ] **Step 6: Commit.** `bunx oxfmt` changed files, then:

```bash
git add plugins/mcp-figma/simplify-text.ts tests/plugins/mcp-figma-simplify.test.ts knip.jsonc
git commit -m "feat(mcp-figma): port kiss text extractor with globalVars dedup"
```

---

## Task 3: `simplify.ts` walker + `format.ts` facade; update shape-asserting tests

**Files:** Create `plugins/mcp-figma/simplify.ts`; rewrite `plugins/mcp-figma/format.ts`; modify `tests/plugins/mcp-figma.test.ts`; clean up any temporary knip ignores from Tasks 1–2.

- [ ] **Step 1: Create `plugins/mcp-figma/simplify.ts`** (the synchronous walker + entry point).

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { layoutExtractor } from './simplify-layout.js'
import { textExtractor } from './simplify-text.js'
import type { ExtractorFn, GlobalVars, SimplifiedDesign, SimplifiedNode, TraversalContext } from './simplify-types.js'
import { isRecord, num, round2, str } from './simplify-util.js'

const extractors: ExtractorFn[] = [layoutExtractor, textExtractor]

function isVisible(node: Record<string, unknown>): boolean {
  return node['visible'] !== false
}

function processNode(node: unknown, context: TraversalContext): SimplifiedNode | null {
  if (!isRecord(node) || !isVisible(node)) return null
  const type0 = str(node['type']) ?? ''
  const result: SimplifiedNode = {
    id: str(node['id']) ?? '',
    name: str(node['name']) ?? '',
    type: type0 === 'VECTOR' ? 'IMAGE-SVG' : type0,
  }
  const box = node['absoluteBoundingBox']
  if (isRecord(box)) {
    const w = num(box['width'])
    const h = num(box['height'])
    if (w !== undefined) result.width = round2(w)
    if (h !== undefined) result.height = round2(h)
  }
  for (const extractor of extractors) extractor(node, result, context)
  const children = node['children']
  if (Array.isArray(children)) {
    const childContext: TraversalContext = { ...context, parent: node }
    const kids = children
      .map((child) => processNode(child, childContext))
      .filter((n): n is SimplifiedNode => n !== null)
    if (kids.length > 0) result.children = kids
  }
  return result
}

function rootNodes(apiResponse: Record<string, unknown>): unknown[] {
  const nodes = apiResponse['nodes']
  if (isRecord(nodes)) {
    const first = Object.values(nodes)[0]
    if (isRecord(first) && isRecord(first['document'])) return [first['document']]
    return []
  }
  const document = apiResponse['document']
  if (isRecord(document)) {
    const children = document['children']
    return Array.isArray(children) ? children : []
  }
  return []
}

function designName(apiResponse: Record<string, unknown>): string {
  const name = str(apiResponse['name'])
  if (name !== undefined) return name
  const document = apiResponse['document']
  if (isRecord(document)) return str(document['name']) ?? ''
  return ''
}

export function simplifyFigmaResponse(apiResponse: unknown): SimplifiedDesign {
  const globalVars: GlobalVars = { styles: {} }
  if (!isRecord(apiResponse)) return { name: '', nodes: [], globalVars }
  const context: TraversalContext = { globalVars, styleIndex: new Map<string, string>(), counter: { n: 0 } }
  const nodes = rootNodes(apiResponse)
    .map((node) => processNode(node, context))
    .filter((n): n is SimplifiedNode => n !== null)
  return { name: designName(apiResponse), nodes, globalVars }
}
```

- [ ] **Step 2: Rewrite `plugins/mcp-figma/format.ts`** as the public facade (keeps `client.ts`'s `import { parseIds, simplifyFigmaResponse } from './format.js'` working).

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export { simplifyFigmaResponse } from './simplify.js'
export type { GlobalVars, SimplifiedDesign, SimplifiedNode } from './simplify-types.js'

export function parseIds(raw: string): string[] {
  return raw
    .split(/[,;]+/u)
    .map((s) => s.trim().replace(/^I/u, ''))
    .filter((s) => s.length > 0)
}
```

- [ ] **Step 3: Remove any temporary knip `["files"]` ignores** added for `simplify-*.ts` in Tasks 1–2 (they are now all reachable from `format.ts` ← `client.ts` ← `index.ts`).

- [ ] **Step 4: Update `tests/plugins/mcp-figma.test.ts`** shape assertions. Replace the `describe('mcp-figma simplify')` expectation and any tool-execution expectations that assert the OLD moderate node shape. The GetFile fixture at the top of the file now expects the full-simplify output. The corrected first assertion:

```typescript
expect(simplifyFigmaResponse(apiResponse)).toEqual({
  name: 'Doc',
  nodes: [
    {
      id: '1:1',
      name: 'Frame',
      type: 'FRAME',
      layout: 'display:flex;flex-direction:column',
      width: 100.13,
      height: 50,
      children: [
        {
          id: '1:2',
          name: 'Label',
          type: 'TEXT',
          text: 'Hi',
          textStyle: 's1',
        },
      ],
    },
  ],
  globalVars: { styles: { s1: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600, lineHeightPx: 20 } } },
})
```

> Note the shape shifts: `layoutMode: 'VERTICAL'` becomes `layout: 'display:flex;flex-direction:column'`; the inline `textStyle` object becomes reference `'s1'` resolved in `globalVars.styles`; the hidden `RECTANGLE` is still dropped. For any OTHER shape-asserting case in this file (tool-execution tests that pipe a Figma JSON through `figma_get_file`), update the expected object to the full-simplify shape the same way — run the test, read the actual output from the failure diff, and lock it in (the extractors are already unit-tested in Tasks 1–2, so mirroring the real output is safe). Do NOT weaken assertions to partial matches; assert the full object.

- [ ] **Step 5: Run.** `lsof -ti :9100 | xargs kill -9` (ignore errors), then `bun test tests/plugins/mcp-figma.test.ts tests/plugins/mcp-figma-simplify.test.ts` → PASS.
- [ ] **Step 6: Gate.** `bun run typecheck`; FULL `bun run lint`; `bun run knip` clean (no leftover temporary ignores; `plugins/mcp-figma/index.ts": ["exports"]` stays).
- [ ] **Step 7: Commit.** `bunx oxfmt` changed files, then:

```bash
git add plugins/mcp-figma/simplify.ts plugins/mcp-figma/format.ts tests/plugins/mcp-figma.test.ts knip.jsonc
git commit -m "feat(mcp-figma): full-simplify walker + globalVars output shape"
```

---

## Task 4: Figma client token pool + 429 rotation

**Files:** Modify `plugins/mcp-figma/client.ts`; create `tests/plugins/mcp-figma-client.test.ts`.

- [ ] **Step 1: Write the failing test** — `tests/plugins/mcp-figma-client.test.ts`.

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { FigmaClient } from '../../plugins/mcp-figma/client.js'

interface Captured {
  url: string
  token: string | undefined
}

function scriptedFetch(
  statuses: number[],
  body: unknown,
): {
  httpFetch: (url: string, init: RequestInit | undefined) => Promise<Response>
  captured: Captured[]
} {
  const captured: Captured[] = []
  let i = 0
  const httpFetch = (url: string, init: RequestInit | undefined): Promise<Response> => {
    const headers = new Headers(init?.headers)
    captured.push({ url, token: headers.get('X-Figma-Token') ?? undefined })
    const status = statuses[Math.min(i, statuses.length - 1)]
    i += 1
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  }
  return { httpFetch, captured }
}

describe('FigmaClient token pool + 429 rotation', () => {
  test('single token, 200 → returns simplified design', async () => {
    const { httpFetch, captured } = scriptedFetch([200], { name: 'D', document: { children: [] } })
    const client = new FigmaClient({ token: 'tok1', httpFetch })
    const out = await client.getFile('KEY')
    expect(out).toEqual({ name: 'D', nodes: [], globalVars: { styles: {} } })
    expect(captured).toHaveLength(1)
    expect(captured[0]?.token).toBe('tok1')
  })

  test('pool of 2, first token 429 then second 200 → rotates and succeeds', async () => {
    const { httpFetch, captured } = scriptedFetch([429, 200], { name: 'D', document: { children: [] } })
    const client = new FigmaClient({ token: 'tokA, tokB', httpFetch })
    await client.getFile('KEY')
    expect(captured).toHaveLength(2)
    expect(captured[0]?.token).toBe('tokA')
    expect(captured[1]?.token).toBe('tokB') // rotated
  })

  test('all tokens 429 → clean rate-limited error, one attempt per token', async () => {
    const { httpFetch, captured } = scriptedFetch([429], {})
    const client = new FigmaClient({ token: 'tokA,tokB', httpFetch })
    await expect(client.getFile('KEY')).rejects.toThrow(/429.*exhausted/u)
    expect(captured).toHaveLength(2) // tried each token exactly once, no infinite loop, no sleeps
  })

  test('non-429 error surfaces immediately without rotation', async () => {
    const { httpFetch, captured } = scriptedFetch([500], {})
    const client = new FigmaClient({ token: 'tokA,tokB', httpFetch })
    await expect(client.getFile('KEY')).rejects.toThrow(/Figma API 500/u)
    expect(captured).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `bun test tests/plugins/mcp-figma-client.test.ts` → FAIL (current client has no pool/rotation; single-token constructor + `getFile` may throw differently).

- [ ] **Step 3: Modify `plugins/mcp-figma/client.ts`** — replace the constructor + `request` (keep every public method below `request` unchanged). New top of class:

```typescript
export class FigmaClient {
  private readonly tokens: string[]
  private readonly httpFetch: HttpFetch
  private readonly baseUrl: string

  constructor(options: FigmaClientOptions) {
    this.httpFetch = options.httpFetch
    this.baseUrl = (options.baseUrl ?? 'https://api.figma.com').replace(/\/+$/u, '')
    // The context `token` value may carry a comma-separated pool: "tok1,tok2" — rotated on 429.
    this.tokens = options.token
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    if (this.tokens.length === 0) {
      throw new Error('Figma token is empty')
    }
  }

  private async request(path: string): Promise<unknown> {
    const pool = this.tokens
    // One attempt per token: on 429 rotate to the next token and retry immediately (no blocking sleep).
    for (let attempt = 0; attempt < pool.length; attempt++) {
      const token = pool[attempt % pool.length]
      const res = await this.httpFetch(`${this.baseUrl}${path}`, {
        headers: {
          'X-Figma-Token': token ?? '',
          Accept: 'application/json',
        },
      })
      if (res.ok) {
        return res.json()
      }
      if (res.status === 429) {
        continue // rate limited — rotate to the next token
      }
      throw new Error(`Figma API ${res.status} for ${path}`)
    }
    throw new Error(`Figma API 429 (rate limited) for ${path}: all ${pool.length} token(s) exhausted`)
  }
```

> Keep `FigmaClientOptions` (`token: string`), `HttpFetch`, `isRecord`, `arrayOr`, and all methods (`getFile`…`getComments`) exactly as they are. Only the two members above change. `token ?? ''` satisfies the `noUncheckedIndexedAccess` element type (`string | undefined`).

- [ ] **Step 4: Run to verify pass.** `bun test tests/plugins/mcp-figma-client.test.ts` → PASS.
- [ ] **Step 5: Gate.** `bun run typecheck`; FULL `bun run lint`; `bun run knip` clean.
- [ ] **Step 6: Commit.** `bunx oxfmt` changed files, then:

```bash
git add plugins/mcp-figma/client.ts tests/plugins/mcp-figma-client.test.ts
git commit -m "feat(mcp-figma): comma-separated token pool with 429 rotation"
```

---

## Task 5: README + docs + listing verification + full gate

**Files:** Modify `plugins/mcp-figma/README.md`, `docs/architecture/coding-stack-overview.md`; verify `tests/mcp-server/mcp-figma-listing.test.ts` still green.

- [ ] **Step 1: Update `plugins/mcp-figma/README.md`.** Add an "Output shape (full simplify)" subsection: nodes carry a compact CSS `layout` string, dimensions, and a `textStyle` reference resolved in a top-level `globalVars.styles` table (de-duplicated across the tree). Add a "Token pooling" note under configuration: the `token` field accepts a single Figma PAT or a **comma-separated pool** (`tok1,tok2,tok3`); on HTTP 429 the client rotates to the next token and retries once per token, then surfaces a rate-limited error (no blocking wait). Keep it consistent with the existing README's tone.

- [ ] **Step 2: Update `docs/architecture/coding-stack-overview.md`.** Find the `mcp-figma` mention in the migrated-plugins surface and note it now ships kiss's **full simplify** (CSS-layout string + `globalVars` text-style dedup) and **token pooling / 429 rotation** — i.e. figma parity is complete, not the moderate subset.

- [ ] **Step 3: Verify listing unchanged.** `lsof -ti :9100 | xargs kill -9` (ignore errors), then `bun test tests/mcp-server/mcp-figma-listing.test.ts tests/plugins/mcp-figma-schema.test.ts` → PASS. The tool set (7 tools) and schemas are unchanged; only the response bodies of `figma_get_file`/`figma_get_file_nodes` are richer. If the listing test asserts nothing about response bodies (it should not), no change is needed.

- [ ] **Step 4: Full gate.** `lsof -ti :9100 | xargs kill -9`; then `bun run check:full` → 12/12 green (flake caveat: if the `test` step fails under contention, re-run standalone `bun test` to confirm it is environmental, not a regression). If green, commit:

```bash
git add plugins/mcp-figma/README.md docs/architecture/coding-stack-overview.md
git commit -m "docs(mcp-figma): document full-simplify output + token pooling"
```

---

## Self-review (plan author)

- **Spec coverage (F1):** (a) CSS-layout string extractor → Task 1 (`simplify-layout.ts`, `layoutExtractor`); (b) text-style `globalVars` dedup → Task 2 (`simplify-text.ts`, `dedupStyle`); (c) token pooling / 429 rotation → Task 4 (`client.ts`). Acceptance gate (pure-shaper table tests + mocked-429 rotation test + full lint/knip/check:full + listing unchanged) → Tasks 1–5. Redaction unaffected (figma is not AI-redacted) — no `mcpResponseRedaction` touched.
- **Type consistency:** `SimplifiedNode`/`GlobalVars`/`SimplifiedDesign`/`TraversalContext`/`ExtractorFn` defined once in `simplify-types.ts`, imported everywhere. `simplifyFigmaResponse(apiResponse: unknown): SimplifiedDesign` is the single entry, re-exported by `format.ts`; `client.ts`'s existing import path is preserved. `str`/`num`/`isRecord`/`round2` live once in `simplify-util.ts`.
- **Deliberate divergences from kiss (documented):** synchronous traversal (no `setImmediate` yielding); style counter threaded through `TraversalContext` (no module-global `_styleCounter`), making the function pure/reentrant; round-robin token rotation with **no blocking sleeps** (kiss sleeps up to 60s honoring `Retry-After`) — appropriate because the plugin runs in-process in the MCP bridge and must not stall it; one attempt per token then a clean exhausted error. Node fields limited to layout + text + sizing + dimensions (kiss additionally extracted fills/strokes/effects/borderRadius/component props — out of F1 scope per the spec: "CSS-layout extractor + globalVars style dedup"). YAGNI.
- **strict-boolean-expressions pre-emption:** all numeric/padding checks use `!== 0`; all optional reads use `!== undefined`; no `number`/`unknown` in a boolean position.
- **knip:** new `simplify-*.ts` files are reachable from `index.ts` after Task 3; temporary `["files"]` ignores (if needed in Tasks 1–2) are removed in Task 3 Step 3. `index.ts": ["exports"]` stays.
- **Placeholders:** none — every module and test is specified inline. Task 3 Step 4's "mirror the real output" instruction applies only to secondary tool-execution assertions whose exact expected object depends on fixtures already in the file; the extractors they exercise are fully unit-tested in Tasks 1–2.

## Follow-ups (this plan + carried)

- **F1 does NOT thread `abortSignal`** into the rotated `httpFetch` calls — that remains the deferred cross-cutting item (§5 of the roadmap spec). If added later, thread it through `request()` and each `execute`.
- Carried (roadmap §5, deferred): per-plugin redaction-prompt override, `mcp_redaction` settings-UI + unset/DELETE, `abortSignal` threading (all plugin clients), teamcity envelope flattening (F3), mattermost binary delivery (F5), gitlab read completeness (F2) + write tools (F4), the dead `key === 'key'` branch in `mcp-sentry/format.ts`, and the magi-side `npm_publish` + `ask` fail-open fix.
- **Next in sequence:** F2 (GitLab read completeness — Link-header pagination + `jobUrl` parsing).
