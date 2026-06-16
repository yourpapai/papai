<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack Dedicated-Field Localization & Teaching Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make YouTrack `create_task`/`update_task` set fields reliably in localized projects by resolving dedicated `status`/`assignee`/`priority` params to the real field by type, teaching the model the available field names on unknown-field errors, and bringing `update_task` to create-parity.

**Architecture:** Every field (dedicated or generic) is resolved to a `ProjectCustomField` — dedicated by type (unique-or-fail with a canonical-name tiebreak), generic by name — then flows through the existing `resolveCustomFieldValue` field engine. The hard-coded `legacyDedicatedPayload` is deleted. A shared builder serves both create and update. Unknown-field errors list the available names.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Zod v4, `bun:test`. Reference spec: `docs/superpowers/specs/2026-06-16-youtrack-dedicated-fields-and-teaching-errors-design.md`.

---

## Background / orientation (read first)

Key existing pieces (all under `plugins/task-provider-youtrack/`):

- `field-engine.ts` — `classifyFieldType(field)` returns `{ label, kind, multi, singleType?, multiType?, bundleSegment? }`. `label` is the base type string (`'state'`, `'enum'`, `'user'`, `'date'`, `'string'`, `'text'`, …); `kind` is the family (`'bundle'`, `'user'`, `'text'`, `'simple'`, `'date'`, `'period'`, `'unknown'`). `resolveCustomFieldValue(field, rawValue, { getBundleElements })` builds the `IssueCustomFieldPayload`. `capAllowedValues(values)` caps a list at 50. `normalize` (trim + lowercase) is currently **private**.
- `create-field-helpers.ts` — `collectCreateFieldPairs(params)` produces `{name, value, dedicated}[]` mapping `status`→`'State'` etc.; `resolveCreateFieldPair` looks a pair up by name, else falls back to `legacyDedicatedPayload` (the hard-coded `{name:'State', $type:'StateIssueCustomField'}` payloads — the bug). This file is to be rewritten.
- `task-helpers.ts` — `fetchProjectCustomFields(config, projectId, opts?)` (admin endpoint + opt-in issue-derived fallback), `validateRequiredCreateFields` (fetches schema, checks required, returns the `ProjectCustomField[]`), `buildCreateCustomFields` (create generic+dedicated → payloads), `markDedicatedParamFields` (marks `State`/`Priority`/… handled), `buildHandledFieldSet` (throws "Unknown custom field for create"), `buildWriteSafeCustomFields`/`buildWriteSafeCustomFieldPayload` (update path, string/text only), `buildProjectFieldsByName`.
- `operations/tasks.ts` — `createYouTrackTask` (calls `validateRequiredCreateFields` then `buildCreateIssueBody`→`buildCreateCustomFields`), `updateYouTrackTask`→`buildUpdateCustomFields` (`buildCustomFields` dedicated + `buildWriteSafeCustomFields` generic).

`ProjectCustomField` is `z.infer<typeof ProjectCustomFieldSchema>` (`schemas/bundle.ts`); `field` is optional, `field.name` is a `string` when present. `IssueCustomFieldPayload` is `{ name: string; $type: string; value: unknown }` (`field-engine.ts`).

Run tests with `bun test <path>` (serial) — the suites here use `setMockFetch`. Full gate: `bun run lint`, `bunx tsc --noEmit -p tsconfig.json`, `bun test tests/plugins/task-provider-youtrack/`.

---

## Task 1: Export `normalize` from the field engine

The dedicated resolver needs the same trim+lowercase normalization the engine uses. Promote it to an export. No behavior change.

**Files:**

- Modify: `plugins/task-provider-youtrack/field-engine.ts:117`

- [ ] **Step 1: Export `normalize`**

In `field-engine.ts`, change line 117 from:

```typescript
const normalize = (value: string): string => value.trim().toLocaleLowerCase()
```

to:

```typescript
export const normalize = (value: string): string => value.trim().toLocaleLowerCase()
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "field-engine" || echo "clean"`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add plugins/task-provider-youtrack/field-engine.ts
git commit -m "refactor(youtrack): export normalize from field-engine for reuse"
```

---

## Task 2: Teaching error for unknown field names (`field-name-error.ts`)

Shared helper that builds an "Unknown custom field … Available fields: …" error listing the schema's field names (capped), used by create and update.

**Files:**

- Create: `plugins/task-provider-youtrack/field-name-error.ts`
- Test: `tests/plugins/task-provider-youtrack/field-name-error.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/task-provider-youtrack/field-name-error.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { unknownFieldError } from '../../../plugins/task-provider-youtrack/field-name-error.js'

describe('unknownFieldError', () => {
  test('lists available field names in message and details', () => {
    const error = unknownFieldError('URL адеса', ['Cтaтус', 'Срочность'], 'create')
    expect(error.message).toContain('URL адеса')
    expect(error.message).toContain('Cтaтус')
    expect(error.message).toContain('Срочность')
    expect(error.message).toContain('create')
    expect(error.appError.code).toBe('validation-failed')
    expect(error.appError.field).toBe('customFields')
    expect(error.appError.reason).toContain('Cтaтус')
  })

  test('caps the available list at 50 names', () => {
    const names = Array.from({ length: 60 }, (_, i) => `Field${i}`)
    const error = unknownFieldError('X', names, 'update')
    expect(error.message).toContain('and 10 more')
    expect(error.message).toContain('update')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/field-name-error.test.ts`
Expected: FAIL — cannot find module `field-name-error.js`.

- [ ] **Step 3: Write the implementation**

Create `plugins/task-provider-youtrack/field-name-error.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { providerError } from 'papai/plugin-types'

import { YouTrackClassifiedError } from './classify-error.js'
import { capAllowedValues } from './field-engine.js'

/**
 * Teaching error for an unrecognized custom-field name. Lists the project's available field
 * names (capped) in both the message string (the channel the model reliably reads) and the
 * structured details, so the model can self-correct in the same turn.
 */
export const unknownFieldError = (
  name: string,
  availableNames: readonly string[],
  op: 'create' | 'update',
): YouTrackClassifiedError => {
  const listed = capAllowedValues([...availableNames]).join('; ')
  const message = `Unknown custom field "${name}" for ${op}. Available fields: ${listed}`
  return new YouTrackClassifiedError(message, providerError.validationFailed('customFields', message))
}
```

Note: `capAllowedValues` renders the overflow tail as `…and N more` (so 60 names → "and 10 more").

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/field-name-error.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/task-provider-youtrack/field-name-error.ts tests/plugins/task-provider-youtrack/field-name-error.test.ts
git commit -m "feat(youtrack): teaching error listing available field names"
```

---

## Task 3: Dedicated-field resolver (`dedicated-fields.ts`)

Resolve `status`/`assignee`/`priority`/`dueDate` to the actual `ProjectCustomField` by type, unique-or-fail, with a canonical-name tiebreak; `priority` requires a name match (enums are non-unique).

**Files:**

- Create: `plugins/task-provider-youtrack/dedicated-fields.ts`
- Test: `tests/plugins/task-provider-youtrack/dedicated-fields.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/task-provider-youtrack/dedicated-fields.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import type { z } from 'zod'

import { resolveDedicatedField } from '../../../plugins/task-provider-youtrack/dedicated-fields.js'
import type { ProjectCustomFieldSchema } from '../../../plugins/task-provider-youtrack/schemas/bundle.js'

type PCF = z.infer<typeof ProjectCustomFieldSchema>

const field = (name: string, typeId: string, bundleType?: string): PCF =>
  ({
    $type: 'ProjectCustomField',
    field: { name, fieldType: { id: typeId } },
    ...(bundleType === undefined ? {} : { bundle: { id: 'b-1', $type: bundleType } }),
  }) as PCF

const STATE = field('Cтaтус', 'state[1]', 'StateBundle')
const USER = field('Oтветствeнный', 'user[*]', 'UserBundle')
const URGENCY = field('Срочность', 'enum[1]', 'EnumBundle')
const TEAM = field('Командa', 'enum[*]', 'EnumBundle')

describe('resolveDedicatedField', () => {
  test('status resolves to the sole state-typed field regardless of localized name', () => {
    const resolved = resolveDedicatedField('state', [STATE, USER, URGENCY, TEAM])
    expect(resolved.field?.name).toBe('Cтaтус')
  })

  test('assignee resolves to the sole user-typed field', () => {
    const resolved = resolveDedicatedField('user', [STATE, USER, URGENCY])
    expect(resolved.field?.name).toBe('Oтветствeнный')
  })

  test('priority requires a canonical name match and rejects ambiguous enums', () => {
    expect(() => resolveDedicatedField('priority', [URGENCY, TEAM])).toThrow(/priority/iu)
  })

  test('priority resolves an enum field literally named Priority', () => {
    const priority = field('Priority', 'enum[1]', 'EnumBundle')
    const resolved = resolveDedicatedField('priority', [priority, URGENCY, TEAM])
    expect(resolved.field?.name).toBe('Priority')
  })

  test('two same-type fields disambiguate by canonical name (Assignee)', () => {
    const assignee = field('Assignee', 'user[1]', 'UserBundle')
    const reviewer = field('Reviewer', 'user[1]', 'UserBundle')
    const resolved = resolveDedicatedField('user', [assignee, reviewer])
    expect(resolved.field?.name).toBe('Assignee')
  })

  test('two same-type fields with no canonical name throw a teaching error', () => {
    const a = field('Owner', 'user[1]', 'UserBundle')
    const b = field('Watcher', 'user[1]', 'UserBundle')
    expect(() => resolveDedicatedField('user', [a, b])).toThrow(/Owner|Watcher/u)
  })

  test('no field of the requested type throws a teaching error', () => {
    expect(() => resolveDedicatedField('state', [USER, URGENCY])).toThrow(/state/iu)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/dedicated-fields.test.ts`
Expected: FAIL — cannot find module `dedicated-fields.js`.

- [ ] **Step 3: Write the implementation**

Create `plugins/task-provider-youtrack/dedicated-fields.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { providerError } from 'papai/plugin-types'
import type { z } from 'zod'

import { YouTrackClassifiedError } from './classify-error.js'
import { capAllowedValues, classifyFieldType, normalize } from './field-engine.js'
import type { ProjectCustomFieldSchema } from './schemas/bundle.js'

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>

export type DedicatedKind = 'state' | 'user' | 'priority' | 'date'

const CANONICAL_NAMES: Record<DedicatedKind, readonly string[]> = {
  state: ['state', 'статус'],
  user: ['assignee', 'ответственный'],
  priority: ['priority', 'приоритет'],
  date: ['due date', 'дедлайн'],
}

const matchesType = (field: Readonly<ProjectCustomField>, kind: DedicatedKind): boolean => {
  const c = classifyFieldType(field)
  switch (kind) {
    case 'state':
      return c.label === 'state'
    case 'priority':
      return c.label === 'enum'
    case 'user':
      return c.kind === 'user'
    case 'date':
      return c.kind === 'date'
  }
}

const matchesCanonicalName = (field: Readonly<ProjectCustomField>, names: readonly string[]): boolean => {
  const name = field.field?.name
  const localized = field.field?.localizedName ?? undefined
  return (
    (name !== undefined && names.includes(normalize(name))) ||
    (localized !== undefined && localized !== null && names.includes(normalize(localized)))
  )
}

const fieldName = (field: Readonly<ProjectCustomField>): string => field.field?.name ?? '(unnamed)'

const dedicatedError = (kind: DedicatedKind, candidates: readonly ProjectCustomField[]): YouTrackClassifiedError => {
  const names = capAllowedValues(candidates.map(fieldName)).join('; ')
  const detail =
    candidates.length === 0
      ? `No ${kind}-type field exists in this project. Use describe_project to see the fields, then set the value via customFields by name.`
      : `Multiple candidate fields for "${kind}" (${names}). Set the intended one explicitly via customFields by name.`
  return new YouTrackClassifiedError(detail, providerError.validationFailed('customFields', detail))
}

/**
 * Resolve a dedicated param (status/assignee/priority/dueDate) to the project's real field by
 * type. Unique → use it. Ambiguous → disambiguate by canonical name; still ambiguous → teaching
 * error. `priority` always requires a canonical name match because enum fields are non-unique.
 */
export const resolveDedicatedField = (
  kind: DedicatedKind,
  projectFields: readonly ProjectCustomField[],
): ProjectCustomField => {
  const candidates = projectFields.filter((f) => f.field?.name !== undefined && matchesType(f, kind))
  if (kind !== 'priority' && candidates.length === 1) {
    const only = candidates[0]
    if (only !== undefined) return only
  }
  const named = candidates.filter((f) => matchesCanonicalName(f, CANONICAL_NAMES[kind]))
  const pick = named[0]
  if (named.length === 1 && pick !== undefined) return pick
  throw dedicatedError(kind, candidates)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/dedicated-fields.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/task-provider-youtrack/dedicated-fields.ts tests/plugins/task-provider-youtrack/dedicated-fields.test.ts
git commit -m "feat(youtrack): resolve dedicated params to real fields by type"
```

---

## Task 4: Rewrite `create-field-helpers.ts` onto the resolver

Replace name-tagged pairs + `legacyDedicatedPayload` with kind-tagged pairs resolved through `resolveDedicatedField` / by-name, all producing `{ field, value }` for the engine.

**Files:**

- Modify: `plugins/task-provider-youtrack/create-field-helpers.ts` (full rewrite)
- Test: `tests/plugins/task-provider-youtrack/create-field-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/task-provider-youtrack/create-field-helpers.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import type { z } from 'zod'

import { collectFieldPairs, resolveFieldPair } from '../../../plugins/task-provider-youtrack/create-field-helpers.js'
import type { ProjectCustomFieldSchema } from '../../../plugins/task-provider-youtrack/schemas/bundle.js'

type PCF = z.infer<typeof ProjectCustomFieldSchema> & {
  field: { name: string }
}

const field = (name: string, typeId: string, bundleType?: string): PCF =>
  ({
    $type: 'ProjectCustomField',
    field: { name, fieldType: { id: typeId } },
    ...(bundleType === undefined ? {} : { bundle: { id: 'b-1', $type: bundleType } }),
  }) as PCF

const byName = (fields: PCF[]): Map<string, PCF> => new Map(fields.map((f) => [f.field.name, f]))

describe('collectFieldPairs', () => {
  test('tags dedicated params with a kind and generic fields by name', () => {
    const pairs = collectFieldPairs({
      status: 'Open',
      customFields: [{ name: 'URL', value: 'http://x' }],
    })
    expect(pairs).toContainEqual({
      source: 'dedicated',
      kind: 'state',
      value: 'Open',
    })
    expect(pairs).toContainEqual({
      source: 'generic',
      name: 'URL',
      value: 'http://x',
    })
  })
})

describe('resolveFieldPair', () => {
  test('dedicated status resolves to the localized state field', () => {
    const state = field('Cтaтус', 'state[1]', 'StateBundle')
    const resolved = resolveFieldPair({ source: 'dedicated', kind: 'state', value: 'Open' }, byName([state]), 'create')
    expect(resolved.field.field?.name).toBe('Cтaтус')
    expect(resolved.value).toBe('Open')
  })

  test('generic unknown field throws a teaching error listing available names', () => {
    const state = field('Cтaтус', 'state[1]', 'StateBundle')
    expect(() => resolveFieldPair({ source: 'generic', name: 'Nope', value: 'x' }, byName([state]), 'create')).toThrow(
      /Cтaтус/u,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/create-field-helpers.test.ts`
Expected: FAIL — `collectFieldPairs`/`resolveFieldPair` not exported.

- [ ] **Step 3: Rewrite the implementation**

Replace the entire contents of `plugins/task-provider-youtrack/create-field-helpers.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { z } from 'zod'

import { YOUTRACK_DUE_DATE_FIELD_NAME } from './constants.js'
import type { DedicatedKind } from './dedicated-fields.js'
import { resolveDedicatedField } from './dedicated-fields.js'
import { unknownFieldError } from './field-name-error.js'
import type { ProjectCustomFieldSchema } from './schemas/bundle.js'

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>
type NamedProjectCustomField = ProjectCustomField & {
  readonly field: { readonly name: string }
}

export type FieldPair =
  | { source: 'dedicated'; kind: DedicatedKind; value: string }
  | { source: 'generic'; name: string; value: string }

export type ResolvedFieldPair = { field: ProjectCustomField; value: string }

type DedicatedParams = Readonly<{
  status?: string
  priority?: string
  dueDate?: string
  assignee?: string
  customFields?: ReadonlyArray<{ name: string; value: string }>
}>

/** Collects dedicated params (tagged by field kind) and generic customFields into a flat list. */
export const collectFieldPairs = (params: DedicatedParams): FieldPair[] => {
  const pairs: FieldPair[] = []
  if (params.status !== undefined) pairs.push({ source: 'dedicated', kind: 'state', value: params.status })
  if (params.priority !== undefined)
    pairs.push({
      source: 'dedicated',
      kind: 'priority',
      value: params.priority,
    })
  if (params.assignee !== undefined) pairs.push({ source: 'dedicated', kind: 'user', value: params.assignee })
  if (params.dueDate !== undefined) pairs.push({ source: 'dedicated', kind: 'date', value: params.dueDate })
  for (const cf of params.customFields ?? []) pairs.push({ source: 'generic', name: cf.name, value: cf.value })
  return pairs
}

/** Resolves a pair to a concrete project field: dedicated by type, generic by name. */
export const resolveFieldPair = (
  pair: Readonly<FieldPair>,
  projectFieldsByName: ReadonlyMap<string, NamedProjectCustomField>,
  op: 'create' | 'update',
): ResolvedFieldPair => {
  if (pair.source === 'generic') {
    const field = projectFieldsByName.get(pair.name)
    if (field === undefined) throw unknownFieldError(pair.name, [...projectFieldsByName.keys()], op)
    return { field, value: pair.value }
  }
  const field = resolveDedicatedField(pair.kind, [...projectFieldsByName.values()])
  return { field, value: pair.value }
}

export { YOUTRACK_DUE_DATE_FIELD_NAME }
```

(The `YOUTRACK_DUE_DATE_FIELD_NAME` re-export keeps any existing import path stable; remove it later if unused.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/create-field-helpers.test.ts`
Expected: PASS (3 tests). Other suites will be red until Task 5 — that's expected.

- [ ] **Step 5: Commit**

```bash
git add plugins/task-provider-youtrack/create-field-helpers.ts tests/plugins/task-provider-youtrack/create-field-helpers.test.ts
git commit -m "refactor(youtrack): kind-tagged field pairs resolved via the engine"
```

---

## Task 5: Unify create on the shared builder + widen fallback gating

Add a shared `buildIssueCustomFields`, route create through it, make `markDedicatedParamFields` use resolved names, switch `buildHandledFieldSet` to the teaching error, and widen the create fallback gating to fire when any dedicated param is present.

**Files:**

- Modify: `plugins/task-provider-youtrack/task-helpers.ts`
- Modify: `plugins/task-provider-youtrack/operations/tasks.ts`
- Test: `tests/plugins/task-provider-youtrack/task-helpers.test.ts` (extend)

- [ ] **Step 1: Add the shared builder and helpers to `task-helpers.ts`**

In `task-helpers.ts`, update imports to use the new helpers:

```typescript
import { collectFieldPairs, resolveFieldPair } from './create-field-helpers.js'
import { resolveDedicatedField } from './dedicated-fields.js'
import { unknownFieldError } from './field-name-error.js'
```

(Remove the old `collectCreateFieldPairs`/`resolveCreateFieldPair` import.)

Add the shared builder (place near `buildCreateCustomFields`):

```typescript
export const buildIssueCustomFields = async (
  config: Readonly<YouTrackConfig>,
  params: Readonly<{
    status?: string
    priority?: string
    dueDate?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  }>,
  projectCustomFields: readonly ProjectCustomField[],
  op: 'create' | 'update',
): Promise<IssueCustomFieldPayload[]> => {
  const projectFieldsByName = buildProjectFieldsByName(projectCustomFields)
  const getBundleElements = makeBundleElementFetcher(config)
  const resolved = collectFieldPairs(params).map((pair) => resolveFieldPair(pair, projectFieldsByName, op))
  return Promise.all(resolved.map((r) => resolveCustomFieldValue(r.field, r.value, { getBundleElements })))
}
```

- [ ] **Step 2: Replace `markDedicatedParamFields` to use resolved names**

In `task-helpers.ts`, replace the existing `markDedicatedParamFields` with:

```typescript
const markDedicatedParamFields = (
  handledFields: Set<string>,
  params: Readonly<{
    status?: string
    priority?: string
    dueDate?: string
    assignee?: string
  }>,
  projectFieldsByName: ReadonlyMap<string, ProjectCustomField & { readonly field: { readonly name: string } }>,
): void => {
  const fields = [...projectFieldsByName.values()]
  for (const pair of collectFieldPairs(params)) {
    if (pair.source !== 'dedicated') continue
    try {
      handledFields.add(resolveDedicatedField(pair.kind, fields).field?.name ?? '')
    } catch {
      // Unresolvable dedicated param surfaces as a teaching error when payloads are built.
    }
  }
}
```

Update its call site in `validateRequiredCreateFields` to pass the by-name map (which it already builds):

```typescript
const projectFieldsByName = buildProjectFieldsByName(projectCustomFields)
const handledFields = buildHandledFieldSet(projectFieldsByName, params.customFields)
markDedicatedParamFields(handledFields, params, projectFieldsByName)
```

- [ ] **Step 3: Switch `buildHandledFieldSet` to the teaching error**

In `task-helpers.ts`, in `buildHandledFieldSet`, replace the `throw new YouTrackClassifiedError('Unknown custom field for create: ...', ...)` block with:

```typescript
if (!projectFieldsByName.has(fieldName)) {
  throw unknownFieldError(fieldName, [...projectFieldsByName.keys()], 'create')
}
```

- [ ] **Step 4: Widen the create fallback gating**

In `validateRequiredCreateFields`, change the `deriveFromIssueWhenEmpty` condition so dedicated params also trigger derivation:

```typescript
const needsSchema =
  (params.customFields?.length ?? 0) > 0 ||
  params.status !== undefined ||
  params.priority !== undefined ||
  params.assignee !== undefined ||
  params.dueDate !== undefined
const projectCustomFields = await fetchProjectCustomFields(config, projectId, {
  deriveFromIssueWhenEmpty: needsSchema,
  shortName: projectShortName,
})
```

- [ ] **Step 5: Route create through the shared builder in `operations/tasks.ts`**

In `operations/tasks.ts`, update the import (`buildCreateCustomFields` → `buildIssueCustomFields`) and in `buildCreateIssueBody` replace:

```typescript
const customFields = await buildCreateCustomFields(config, params, projectCustomFields)
```

with:

```typescript
const customFields = await buildIssueCustomFields(config, params, projectCustomFields, 'create')
```

- [ ] **Step 6: Delete the now-unused `buildCreateCustomFields`**

Remove `buildCreateCustomFields` from `task-helpers.ts` (replaced by `buildIssueCustomFields`). Leave `buildCustomFields` for now (Task 6 removes it). Run `bunx tsc --noEmit -p tsconfig.json` and fix any unused-import errors it surfaces.

- [ ] **Step 7: Add a create integration test for localized dedicated resolution**

Append to `tests/plugins/task-provider-youtrack/task-helpers.test.ts` (uses the existing `queueResponses`/`createUniqueYouTrackConfig` helpers in that file):

```typescript
describe('buildIssueCustomFields', () => {
  test('resolves a dedicated status to the localized state field via the engine', async () => {
    const config = createUniqueYouTrackConfig()
    const projectCustomFields = [
      {
        $type: 'StateProjectCustomField',
        field: { name: 'Cтaтус', fieldType: { id: 'state[1]' } },
        canBeEmpty: false,
        bundle: { id: 'sb-1', $type: 'StateBundle' },
      },
    ] as const
    // resolveCustomFieldValue fetches the state bundle values once.
    queueResponses([[{ name: 'Не разобрана' }, { name: 'Open' }]])

    const result = await buildIssueCustomFields(config, { status: 'Open' }, projectCustomFields, 'create')

    expect(result).toContainEqual({
      name: 'Cтaтус',
      $type: 'StateIssueCustomField',
      value: { name: 'Open' },
    })
  })
})
```

Add `buildIssueCustomFields` to the imports at the top of that test file.

- [ ] **Step 8: Run the focused tests**

Run: `bun test tests/plugins/task-provider-youtrack/task-helpers.test.ts tests/plugins/task-provider-youtrack/create-field-helpers.test.ts`
Expected: PASS. (The `operations/tasks.test.ts` mocks are fixed in Task 7.)

- [ ] **Step 9: Commit**

```bash
git add plugins/task-provider-youtrack/task-helpers.ts plugins/task-provider-youtrack/operations/tasks.ts tests/plugins/task-provider-youtrack/task-helpers.test.ts
git commit -m "feat(youtrack): create routes dedicated params through the schema engine"
```

---

## Task 6: Bring `update_task` to parity

Route update's custom fields through the same shared builder and issue-derived fallback; delete the string/text-only path; use the teaching error for unknown update fields.

**Files:**

- Modify: `plugins/task-provider-youtrack/task-helpers.ts`
- Modify: `plugins/task-provider-youtrack/operations/tasks.ts`
- Test: `tests/plugins/task-provider-youtrack/operations/tasks.test.ts` (extend)

- [ ] **Step 1: Write the failing update test**

In `tests/plugins/task-provider-youtrack/operations/tasks.test.ts`, inside the `updateYouTrackTask` describe block, add a test that sets a previously-"Unsupported" enum field. Use a URL-routed mock so the enum bundle + issue POST are answered by path:

```typescript
test('sets an enum custom field on update via the field engine', async () => {
  const projectFields = [
    {
      $type: 'EnumProjectCustomField',
      field: { name: 'Срочность', fieldType: { id: 'enum[1]' } },
      canBeEmpty: true,
      bundle: { id: 'eb-1', $type: 'EnumBundle' },
    },
  ]
  installFetchMock((url, init) => {
    const path = new URL(url).pathname
    const method = init.method ?? 'GET'
    if (method === 'POST' && path.startsWith('/api/issues/')) return jsonOk(makeIssueResponse())
    if (path.endsWith('/customFields') && path.startsWith('/api/admin/')) return jsonOk(projectFields)
    if (path.includes('/bundles/enum/')) return jsonOk([{ name: 'Срочно' }, { name: 'Не срочно' }])
    if (path.startsWith('/api/admin/projects/')) return jsonOk({ id: '0-1', shortName: 'TEST' })
    return jsonOk(makeIssueResponse())
  })

  await updateYouTrackTask(config, 'TEST-1', {
    projectId: '0-1',
    customFields: [{ name: 'Срочность', value: 'Срочно' }],
  })

  const body = getFetchBodyAt(findIssuesUpdateCallIndex(fetchMock.mock.calls))
  expect(body['customFields']).toContainEqual({
    name: 'Срочность',
    $type: 'SingleEnumIssueCustomField',
    value: { name: 'Срочно' },
  })
})
```

Add a small path-aware finder near the other helpers in this file:

```typescript
const findIssuesUpdateCallIndex = (calls: unknown[]): number =>
  calls.findIndex((call) => {
    const parsed = FetchCallSchema.safeParse(call)
    return (
      parsed.success && /\/api\/issues\/.+/u.test(new URL(parsed.data[0]).pathname) && parsed.data[1].method === 'POST'
    )
  })
```

(`installFetchMock` already receives `(url, init)`; `jsonOk` and `makeIssueResponse` already exist in this file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/operations/tasks.test.ts -t "sets an enum custom field on update"`
Expected: FAIL — current update path rejects enum fields as "Unsupported custom field for update".

- [ ] **Step 3: Rewrite `buildUpdateCustomFields` in `operations/tasks.ts`**

Replace the body of `buildUpdateCustomFields` so it fetches the schema (with fallback) and uses the shared builder for all fields:

```typescript
const buildUpdateCustomFields = async (
  config: Readonly<YouTrackConfig>,
  taskId: string,
  params: Readonly<{
    status?: string
    priority?: string
    dueDate?: string
    assignee?: string
    projectId?: string
    customFields?: Array<{ name: string; value: string }>
  }>,
): Promise<IssueCustomFieldPayload[]> => {
  const projectId = params.projectId ?? (await fetchIssueProjectId(config, taskId))
  const needsSchema =
    (params.customFields?.length ?? 0) > 0 ||
    params.status !== undefined ||
    params.priority !== undefined ||
    params.assignee !== undefined ||
    params.dueDate !== undefined
  if (!needsSchema) return []
  const projectCustomFields = await fetchProjectCustomFields(config, projectId, { deriveFromIssueWhenEmpty: true })
  return buildIssueCustomFields(config, params, projectCustomFields, 'update')
}
```

Update imports in `operations/tasks.ts`: import `buildIssueCustomFields`, `fetchProjectCustomFields`, and `IssueCustomFieldPayload` (type from `../field-engine.js`); drop `buildWriteSafeCustomFields` and `buildCustomFields`.

Update the two call sites in `updateYouTrackTask` that currently branch on `params.customFields` to simply:

```typescript
const customFields = await buildUpdateCustomFields(config, taskId, params)
if (customFields.length > 0) body['customFields'] = customFields
```

- [ ] **Step 4: Delete dead update helpers in `task-helpers.ts`**

Remove `buildCustomFields`, `buildWriteSafeCustomFields`, `buildWriteSafeCustomFieldPayload`, `buildCreateIssueCustomField`, `customFieldValidationError`, and the `NON_GENERIC_FIELD_NAMES` constant if now unused. Run `bunx tsc --noEmit -p tsconfig.json` and remove any imports it flags as unused (e.g. `parseDueDateValue` if no longer referenced).

- [ ] **Step 5: Run the update test**

Run: `bun test tests/plugins/task-provider-youtrack/operations/tasks.test.ts -t "sets an enum custom field on update"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/task-provider-youtrack/task-helpers.ts plugins/task-provider-youtrack/operations/tasks.ts tests/plugins/task-provider-youtrack/operations/tasks.test.ts
git commit -m "feat(youtrack): update_task parity via shared field engine + fallback"
```

---

## Task 7: Repair existing mocks for widened gating + full green

Dedicated-param create tests with an empty admin schema now trigger the issue-derived fetch, and the POST shifts position; old-name update tests change. Make the create/update mocks URL-routed and fix positional assertions.

**Files:**

- Modify: `tests/plugins/task-provider-youtrack/operations/tasks.test.ts`
- Modify: `tests/plugins/task-provider-youtrack/index.test.ts`

- [ ] **Step 1: Find the failures**

Run: `bun test tests/plugins/task-provider-youtrack/ 2>&1 | grep -E "\(fail\)"`
Expected: a list of create/update tests (mostly those passing `status`/`priority`/`assignee` against an empty admin schema, plus any asserting the old hard-coded `State`/`Assignee` payloads).

- [ ] **Step 2: Convert the shared create mocks to URL routing**

In `tests/plugins/task-provider-youtrack/operations/tasks.test.ts`, change `mockCreateTaskResponse` (and the other empty-`customFields` create helpers it shares logic with) to route by path so the fallback's extra calls are answered. Pattern:

```typescript
const mockCreateTaskResponse = (
  issueResponse: unknown,
  projectResponse: unknown = { id: '0-1', shortName: 'TEST' },
  customFieldsResponse: unknown = [],
  sampleIssueResponse: unknown = [],
): void => {
  installFetchMock((url, init) => {
    const path = new URL(url).pathname
    const method = init.method ?? 'GET'
    if (method === 'POST' && path === '/api/issues') return jsonOk(issueResponse)
    if (path.endsWith('/customFields') && path.startsWith('/api/admin/')) return jsonOk(customFieldsResponse)
    if (path === '/api/issues') return jsonOk(sampleIssueResponse) // issue-derived fallback fetch
    if (path.startsWith('/api/admin/projects/')) return jsonOk(projectResponse)
    return jsonOk(issueResponse)
  })
}
```

- [ ] **Step 3: Make POST assertions path-aware**

Replace `getFetchBodyAt(2)` / `getFetchUrlAt(2)` / `getFetchMethodAt(2)` in create tests with a finder targeting the create POST. Add near the existing helpers:

```typescript
const findCreateCallIndex = (): number =>
  fetchMock.mock.calls.findIndex((call) => {
    const parsed = FetchCallSchema.safeParse(call)
    return parsed.success && new URL(parsed.data[0]).pathname === '/api/issues' && parsed.data[1].method === 'POST'
  })
const getCreateBody = (): z.infer<typeof BodySchema> => getFetchBodyAt(findCreateCallIndex())
```

Update the affected assertions to use `getCreateBody()` (and `findCreateCallIndex()` for URL/method checks). For dedicated-param create tests that assert the sent custom field, update the expected payload from the old hard-coded `{ name: 'State', … }` to the schema-resolved field (provide the field in `customFieldsResponse` so the admin path is non-empty, OR provide it via `sampleIssueResponse` and assert the resolved name).

- [ ] **Step 4: Fix `index.test.ts` create tests**

In `tests/plugins/task-provider-youtrack/index.test.ts`, the `createTask` tests use `mockFetchSequence`. For the ones sending `priority`/`status`/`assignee`, either (a) add a non-empty admin `customFields` response containing the matching typed field so no fallback fires, or (b) switch them to a URL-routed `installFetchMock` like Step 2. Prefer (a) for minimal churn — e.g. for the priority test, return a `Priority` enum field from the customFields call and a bundle-values response. Update expected payloads to the engine shape (`SingleEnumIssueCustomField` with `value: { name: … }`).

- [ ] **Step 5: Run the full plugin suite**

Run: `bun test tests/plugins/task-provider-youtrack/`
Expected: PASS, 0 fail.

- [ ] **Step 6: Run the full gate**

Run: `bun run lint && bunx tsc --noEmit -p tsconfig.json && bun test tests/plugins/ tests/tools/ tests/providers/`
Expected: lint 0 errors; typecheck clean; all suites pass.

- [ ] **Step 7: Commit**

```bash
git add tests/plugins/task-provider-youtrack/operations/tasks.test.ts tests/plugins/task-provider-youtrack/index.test.ts
git commit -m "test(youtrack): URL-route create/update mocks for widened fallback gating"
```

---

## Self-review checklist (performed)

- **Spec coverage:** A → Tasks 2 + (5 step 3, 6); B → Tasks 1, 3, 4, 5; update_task parity → Task 6; widened gating + test repair → Tasks 5, 6, 7. Canonical-name tiebreak → Task 3. Backward-compat English projects → Task 3 tests + Task 7 updates.
- **Type consistency:** `FieldPair`/`ResolvedFieldPair`, `DedicatedKind`, `resolveDedicatedField`, `collectFieldPairs`, `resolveFieldPair`, `buildIssueCustomFields`, `unknownFieldError` are used with consistent signatures across tasks. `resolveCustomFieldValue` and `IssueCustomFieldPayload` are reused from `field-engine.ts` unchanged.
- **No placeholders:** every code step contains complete code or an exact transformation of a named existing block.

## Known limitations (from the spec)

- Due-date enrichment stays keyed on the resolved field name; localized date fields may not repopulate `dueDate` (best-effort).
- No fuzzy matching for generic field names; `priority` never auto-maps among multiple enums.
