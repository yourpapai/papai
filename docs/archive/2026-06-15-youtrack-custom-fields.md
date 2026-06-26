<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack Custom-Field Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bot reliably create YouTrack tasks by understanding each project's custom-field schema — resolving field values against the project's bundles, supporting any required field type on create, exposing a schema-discovery tool, and returning errors that teach the model the valid values.

**Architecture:** A unified, schema-driven field engine in the YouTrack plugin maps any `ProjectCustomField` to the correct `IssueCustomField` payload and resolves bundle-backed values (state/enum/version/build/ownedField) by safe-exact name match against cached bundle elements. `create_task`'s value-building routes through this engine; required-field detection honors YouTrack `defaultValues`; a new `describe_project` tool and richer validation errors feed the model the field names and allowed values it needs.

**Tech Stack:** TypeScript (strict, `.js` import paths), Bun runtime + `bun test`, Zod v4, Vercel AI SDK `tool()`. YouTrack REST API (`youtrackFetch`).

**Branch:** `feat/youtrack-custom-fields` (already created; the design spec is committed at `docs/superpowers/specs/2026-06-15-youtrack-custom-fields-design.md`).

---

## Conventions & gotchas (read once)

- **Import paths use `.js`** even for `.ts` files. Plugin code imports shared types via `papai/plugin-types` (→ `src/providers/public-types.ts`).
- **TDD write-hook scope is `src/` and `client/` only** — files under `plugins/` are NOT hook-gated, but we still write tests first per repo convention. `src/` files (the new tool, the interface/barrel edits) ARE gated: write the test first. Type-only edits to `src/providers/types.ts` / `public-types.ts` carry no behavior; if the test-first hook objects, commit them together with the consuming tool task (Task 7) which has tests. Verify with `bun run typecheck`.
- **Run a single test file:** `bun test <path>` (serial). Full suite is `bun run test`.
- **`YouTrackClassifiedError(reason, appError)`** — the first arg becomes `error.message`, which the tool-wrapper surfaces to the model. Embed allowed values in that string so the model sees them.
- **`youtrackFetch(config, method, path, { query?, body? })`** returns raw `unknown`; callers validate with Zod.
- Run `bun run format` before committing (the pre-commit hook checks format + license headers; new files need the BUSL header — copy from any existing file in the same dir).

## File structure

```
src/providers/
  types.ts                         EDIT  add ProjectFieldDescriptor + optional describeProjectFields()
  public-types.ts                  EDIT  re-export ProjectFieldDescriptor
src/tools/
  describe-project.ts              NEW   describe_project tool
  create-task.ts                   EDIT  schema/description: point at describe_project
  tools-builder.ts                 EDIT  register describe_project when supported
plugins/task-provider-youtrack/
  schemas/bundle.ts                EDIT  defaultValues on ProjectCustomField + BundleElement schema
  constants.ts                     EDIT  PROJECT_CUSTOM_FIELD_FIELDS adds defaultValues
  bundle-values.ts                 NEW   cached bundle-element fetcher (BundleElementFetcher)
  field-engine.ts                  NEW   classifyFieldType + resolveCustomFieldValue + formatAllowed
  task-helpers.ts                  EDIT  required-detection (defaultValues + teaching errors); async engine-based buildCreateCustomFields; export fetchProjectCustomFields
  operations/tasks.ts              EDIT  await buildCreateCustomFields(config, …)
  operations/project-fields.ts     NEW   describeYouTrackProjectFields()
  provider.ts                      EDIT  describeProjectFields delegate
  prompt-addendum.ts               EDIT  mention describe_project
tests/plugins/task-provider-youtrack/
  field-engine.test.ts             NEW
  bundle-values.test.ts            NEW
  operations/project-fields.test.ts NEW
  operations/tasks.test.ts         EDIT  new create cases
  task-helpers.test.ts             EDIT/NEW required-detection cases
tests/tools/
  describe-project.test.ts         NEW
```

---

## Task 1: Schema — fetch `defaultValues` + add bundle-element schema

**Files:**

- Modify: `plugins/task-provider-youtrack/constants.ts:56-57`
- Modify: `plugins/task-provider-youtrack/schemas/bundle.ts:26-54`

- [ ] **Step 1: Extend `PROJECT_CUSTOM_FIELD_FIELDS` to request `defaultValues`**

In `constants.ts`, replace the `PROJECT_CUSTOM_FIELD_FIELDS` constant:

```typescript
export const PROJECT_CUSTOM_FIELD_FIELDS =
  'id,$type,canBeEmpty,isPublic,field(id,name,localizedName,$type,fieldType(id,presentation)),bundle(id,$type),defaultValues(name,localizedName)'
```

- [ ] **Step 2: Add `defaultValues` to `ProjectCustomFieldSchema` and add `BundleElement` schemas**

In `schemas/bundle.ts`, add `defaultValues` to `ProjectCustomFieldSchema` (after the `bundle` block, before the closing `})`):

```typescript
  defaultValues: z
    .array(z.object({ name: z.string(), localizedName: z.string().nullable().optional() }))
    .optional(),
```

Then append these exports at the end of the file:

```typescript
export const BundleElementSchema = z.object({
  name: z.string(),
  localizedName: z.string().nullable().optional(),
  ordinal: z.number().optional(),
})

export const BundleElementListSchema = z.array(BundleElementSchema)
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no usages broken; `defaultValues` is additive/optional).

- [ ] **Step 4: Commit**

```bash
bun run format
git add plugins/task-provider-youtrack/constants.ts plugins/task-provider-youtrack/schemas/bundle.ts
git commit -m "feat(youtrack): fetch project field defaultValues + bundle-element schema"
```

---

## Task 2: Cached bundle-element fetcher

**Files:**

- Create: `plugins/task-provider-youtrack/bundle-values.ts`
- Test: `tests/plugins/task-provider-youtrack/bundle-values.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/task-provider-youtrack/bundle-values.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { makeBundleElementFetcher } from '../../../plugins/task-provider-youtrack/bundle-values.js'
import type { YouTrackConfig } from '../../../plugins/task-provider-youtrack/client.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const config: YouTrackConfig = { baseUrl: 'https://test.youtrack.cloud', token: 't' }

describe('makeBundleElementFetcher', () => {
  beforeEach(() => mockLogger())
  afterEach(() => restoreFetch())

  test('fetches bundle element names and caches by bundle id', async () => {
    let calls = 0
    setMockFetch((url) => {
      calls++
      expect(url).toContain('/api/admin/customFieldSettings/bundles/state/sb-1/values')
      return Promise.resolve(
        new Response(JSON.stringify([{ name: 'Open' }, { name: 'In Progress', localizedName: 'В работе' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    const fetcher = makeBundleElementFetcher(config)
    const first = await fetcher('state', 'sb-1')
    const second = await fetcher('state', 'sb-1')

    expect(first.map((e) => e.name)).toEqual(['Open', 'In Progress'])
    expect(first[1].localizedName).toBe('В работе')
    expect(calls).toBe(1) // second call served from cache
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/bundle-values.test.ts`
Expected: FAIL — `Cannot find module '.../bundle-values.js'`.

- [ ] **Step 3: Implement `bundle-values.ts`**

Create `plugins/task-provider-youtrack/bundle-values.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../src/logger.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import type { BundleElement, BundleElementFetcher } from './field-engine.js'
import { BundleElementListSchema } from './schemas/bundle.js'

const log = logger.child({ scope: 'youtrack:bundle-values' })

const BUNDLE_ELEMENT_FIELDS = 'name,localizedName,ordinal'
const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  elements: BundleElement[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

const cacheKey = (config: Readonly<YouTrackConfig>, segment: string, bundleId: string): string =>
  `${config.baseUrl}|${segment}|${bundleId}`

export const makeBundleElementFetcher = (config: Readonly<YouTrackConfig>): BundleElementFetcher => {
  return async (segment: string, bundleId: string): Promise<BundleElement[]> => {
    const key = cacheKey(config, segment, bundleId)
    const cached = cache.get(key)
    if (cached !== undefined && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      log.debug({ segment, bundleId }, 'bundle element cache hit')
      return cached.elements
    }
    const raw = await youtrackFetch(
      config,
      'GET',
      `/api/admin/customFieldSettings/bundles/${segment}/${bundleId}/values`,
      { query: { fields: BUNDLE_ELEMENT_FIELDS } },
    )
    const elements = BundleElementListSchema.parse(raw).map((e) => ({
      name: e.name,
      localizedName: e.localizedName ?? undefined,
    }))
    cache.set(key, { elements, fetchedAt: Date.now() })
    log.debug({ segment, bundleId, count: elements.length }, 'bundle elements fetched')
    return elements
  }
}
```

> Note: this imports `BundleElement`/`BundleElementFetcher` types from `field-engine.js` (Task 3). Implement Task 3's type exports first if your editor complains, or define Task 3 before running this test. The test only exercises runtime behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/bundle-values.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run format
git add plugins/task-provider-youtrack/bundle-values.ts tests/plugins/task-provider-youtrack/bundle-values.test.ts
git commit -m "feat(youtrack): cached bundle-element fetcher"
```

---

## Task 3: Field engine — classify + resolve any field type

**Files:**

- Create: `plugins/task-provider-youtrack/field-engine.ts`
- Test: `tests/plugins/task-provider-youtrack/field-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/task-provider-youtrack/field-engine.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { classifyFieldType, resolveCustomFieldValue } from '../../../plugins/task-provider-youtrack/field-engine.js'

const stateField = {
  $type: 'StateProjectCustomField',
  field: { name: 'State', fieldType: { id: 'state[1]' } },
  bundle: { id: 'sb-1', $type: 'StateBundle' },
}

const enumMultiField = {
  $type: 'EnumProjectCustomField',
  field: { name: 'Tags', fieldType: { id: 'enum[*]' } },
  bundle: { id: 'eb-1', $type: 'EnumBundle' },
}

const stateElements = [{ name: 'Open' }, { name: 'In Progress', localizedName: 'В работе' }, { name: 'Fixed' }]

const fetcher = (_segment: string, _bundleId: string) => Promise.resolve(stateElements)

describe('classifyFieldType', () => {
  test('classifies a single state field', () => {
    const c = classifyFieldType(stateField)
    expect(c.kind).toBe('bundle')
    expect(c.label).toBe('state')
    expect(c.multi).toBe(false)
    expect(c.singleType).toBe('StateIssueCustomField')
    expect(c.bundleSegment).toBe('state')
  })

  test('classifies a multi enum field', () => {
    const c = classifyFieldType(enumMultiField)
    expect(c.multi).toBe(true)
    expect(c.multiType).toBe('MultiEnumIssueCustomField')
    expect(c.bundleSegment).toBe('enum')
  })
})

describe('resolveCustomFieldValue', () => {
  test('resolves a state value case-insensitively against the bundle', async () => {
    const payload = await resolveCustomFieldValue(stateField, 'in progress', { getBundleElements: fetcher })
    expect(payload).toEqual({ name: 'State', $type: 'StateIssueCustomField', value: { name: 'In Progress' } })
  })

  test('resolves a state value by localized (Russian) name', async () => {
    const payload = await resolveCustomFieldValue(stateField, 'В работе', { getBundleElements: fetcher })
    expect(payload.value).toEqual({ name: 'In Progress' })
  })

  test('throws a teaching error listing allowed values when no match', async () => {
    await expect(resolveCustomFieldValue(stateField, 'to-do', { getBundleElements: fetcher })).rejects.toThrow(
      /not a valid value.*Open, In Progress, Fixed/,
    )
  })

  test('resolves multi enum values from a comma list', async () => {
    const payload = await resolveCustomFieldValue(enumMultiField, 'Open, Fixed', { getBundleElements: fetcher })
    expect(payload.$type).toBe('MultiEnumIssueCustomField')
    expect(payload.value).toEqual([{ name: 'Open' }, { name: 'Fixed' }])
  })

  test('builds a text payload without touching the bundle', async () => {
    const textField = { $type: 'TextProjectCustomField', field: { name: 'Notes', fieldType: { id: 'text' } } }
    const payload = await resolveCustomFieldValue(textField, 'hello', {
      getBundleElements: () => Promise.reject(new Error('should not fetch')),
    })
    expect(payload).toEqual({ name: 'Notes', $type: 'TextIssueCustomField', value: { text: 'hello' } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/field-engine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `field-engine.ts`**

Create `plugins/task-provider-youtrack/field-engine.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { providerError } from 'papai/plugin-types'
import type { z } from 'zod'

import { YouTrackClassifiedError } from './classify-error.js'
import { parseDueDateValue } from './due-date.js'
import type { ProjectCustomFieldSchema } from './schemas/bundle.js'

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>

export interface BundleElement {
  name: string
  localizedName?: string
}

export type BundleElementFetcher = (segment: string, bundleId: string) => Promise<BundleElement[]>

export interface IssueCustomFieldPayload {
  name: string
  $type: string
  value: unknown
}

export interface FieldClassification {
  label: string
  kind: 'bundle' | 'user' | 'text' | 'simple' | 'date' | 'period' | 'unknown'
  multi: boolean
  singleType?: string
  multiType?: string
  bundleSegment?: string
}

const ALLOWED_CAP = 50

interface TypeEntry {
  kind: FieldClassification['kind']
  label: string
  single: string
  multi: string
}

const TYPE_TABLE: Record<string, TypeEntry> = {
  enum: { kind: 'bundle', label: 'enum', single: 'SingleEnumIssueCustomField', multi: 'MultiEnumIssueCustomField' },
  state: { kind: 'bundle', label: 'state', single: 'StateIssueCustomField', multi: 'StateIssueCustomField' },
  version: {
    kind: 'bundle',
    label: 'version',
    single: 'SingleVersionIssueCustomField',
    multi: 'MultiVersionIssueCustomField',
  },
  ownedfield: {
    kind: 'bundle',
    label: 'ownedField',
    single: 'SingleOwnedIssueCustomField',
    multi: 'MultiOwnedIssueCustomField',
  },
  build: { kind: 'bundle', label: 'build', single: 'SingleBuildIssueCustomField', multi: 'MultiBuildIssueCustomField' },
  user: { kind: 'user', label: 'user', single: 'SingleUserIssueCustomField', multi: 'MultiUserIssueCustomField' },
  text: { kind: 'text', label: 'text', single: 'TextIssueCustomField', multi: 'TextIssueCustomField' },
  string: { kind: 'simple', label: 'string', single: 'SimpleIssueCustomField', multi: 'SimpleIssueCustomField' },
  integer: { kind: 'simple', label: 'integer', single: 'SimpleIssueCustomField', multi: 'SimpleIssueCustomField' },
  float: { kind: 'simple', label: 'float', single: 'SimpleIssueCustomField', multi: 'SimpleIssueCustomField' },
  date: { kind: 'date', label: 'date', single: 'DateIssueCustomField', multi: 'DateIssueCustomField' },
  'date and time': { kind: 'date', label: 'date', single: 'DateIssueCustomField', multi: 'DateIssueCustomField' },
  period: { kind: 'period', label: 'period', single: 'PeriodIssueCustomField', multi: 'PeriodIssueCustomField' },
}

const parseFieldTypeId = (id: string | undefined): { base: string; multi: boolean } => {
  const raw = (id ?? '').trim()
  const match = raw.match(/^(.*)\[(1|\*)\]$/)
  if (match !== null) return { base: match[1].trim().toLowerCase(), multi: match[2] === '*' }
  return { base: raw.toLowerCase(), multi: false }
}

const bundleSegmentFromType = (bundleType: string | undefined): string | undefined => {
  switch (bundleType) {
    case 'EnumBundle':
      return 'enum'
    case 'StateBundle':
      return 'state'
    case 'VersionBundle':
      return 'version'
    case 'OwnedFieldBundle':
      return 'ownedField'
    case 'BuildBundle':
      return 'build'
    default:
      return undefined
  }
}

export const classifyFieldType = (field: Readonly<ProjectCustomField>): FieldClassification => {
  const { base, multi } = parseFieldTypeId(field.field?.fieldType?.id)
  const entry = TYPE_TABLE[base]
  if (entry === undefined) {
    return { label: base === '' ? 'unknown' : base, kind: 'unknown', multi }
  }
  return {
    label: entry.label,
    kind: entry.kind,
    multi,
    singleType: entry.single,
    multiType: entry.multi,
    bundleSegment: entry.kind === 'bundle' ? bundleSegmentFromType(field.bundle?.$type) : undefined,
  }
}

export const formatAllowed = (values: readonly string[]): string => {
  if (values.length <= ALLOWED_CAP) return values.join(', ')
  return `${values.slice(0, ALLOWED_CAP).join(', ')}, …and ${values.length - ALLOWED_CAP} more`
}

export const capAllowedValues = (values: readonly string[]): string[] => {
  if (values.length <= ALLOWED_CAP) return [...values]
  return [...values.slice(0, ALLOWED_CAP), `…and ${values.length - ALLOWED_CAP} more`]
}

const fieldError = (fieldName: string, message: string): YouTrackClassifiedError =>
  new YouTrackClassifiedError(message, providerError.validationFailed(fieldName, message))

const normalize = (value: string): string => value.trim().toLocaleLowerCase()

const splitMulti = (raw: string, multi: boolean): string[] =>
  multi
    ? raw
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
    : [raw]

const matchBundleValue = (fieldName: string, raw: string, elements: readonly BundleElement[]): string => {
  const target = normalize(raw)
  const matches = elements.filter(
    (e) => normalize(e.name) === target || (e.localizedName !== undefined && normalize(e.localizedName) === target),
  )
  if (matches.length === 1) return matches[0].name
  throw fieldError(
    fieldName,
    `Field "${fieldName}": "${raw}" is not a valid value. Allowed values: ${formatAllowed(elements.map((e) => e.name))}`,
  )
}

export const resolveCustomFieldValue = async (
  field: Readonly<ProjectCustomField>,
  rawValue: string,
  ctx: Readonly<{ getBundleElements: BundleElementFetcher }>,
): Promise<IssueCustomFieldPayload> => {
  const name = field.field?.name
  if (name === undefined) throw fieldError('customFields', 'Custom field is missing a name')
  const c = classifyFieldType(field)
  switch (c.kind) {
    case 'text':
      return { name, $type: 'TextIssueCustomField', value: { text: rawValue } }
    case 'simple':
      return {
        name,
        $type: 'SimpleIssueCustomField',
        value: c.label === 'integer' || c.label === 'float' ? Number(rawValue) : rawValue,
      }
    case 'date':
      return { name, $type: 'DateIssueCustomField', value: parseDueDateValue(rawValue) }
    case 'period':
      return { name, $type: 'PeriodIssueCustomField', value: { presentation: rawValue } }
    case 'user': {
      const logins = splitMulti(rawValue, c.multi).map((v) => ({ login: v }))
      return { name, $type: c.multi ? c.multiType! : c.singleType!, value: c.multi ? logins : logins[0] }
    }
    case 'bundle': {
      const segment = c.bundleSegment
      const bundleId = field.bundle?.id
      if (segment === undefined || bundleId === undefined) {
        throw fieldError(name, `Field "${name}" has no resolvable value set on this project`)
      }
      const elements = await ctx.getBundleElements(segment, bundleId)
      const resolved = splitMulti(rawValue, c.multi).map((v) => ({ name: matchBundleValue(name, v, elements) }))
      return { name, $type: c.multi ? c.multiType! : c.singleType!, value: c.multi ? resolved : resolved[0] }
    }
    default:
      throw fieldError(
        name,
        `Field "${name}" has an unsupported type (${field.field?.fieldType?.id ?? 'unknown'}) for create_task`,
      )
  }
}
```

> The `c.multiType!`/`c.singleType!` non-null assertions are safe: for `user`/`bundle` kinds the table always populates both. If the repo's lint forbids `!`, replace with `c.multiType ?? c.singleType ?? 'SimpleIssueCustomField'` guarded by an explicit `if (c.singleType === undefined) throw fieldError(...)` line.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/field-engine.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
bun run format
git add plugins/task-provider-youtrack/field-engine.ts tests/plugins/task-provider-youtrack/field-engine.test.ts
git commit -m "feat(youtrack): schema-driven custom-field engine with safe-exact value resolution"
```

---

## Task 4: Required-field detection honors `defaultValues` + teaching errors

**Files:**

- Modify: `plugins/task-provider-youtrack/task-helpers.ts` (`buildHandledFieldSet` 61-89, `validateRequiredCreateFields` 140-179; export `fetchProjectCustomFields`)
- Test: `tests/plugins/task-provider-youtrack/task-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create (or extend) `tests/plugins/task-provider-youtrack/task-helpers.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { YouTrackConfig } from '../../../plugins/task-provider-youtrack/client.js'
import { validateRequiredCreateFields } from '../../../plugins/task-provider-youtrack/task-helpers.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const config: YouTrackConfig = { baseUrl: 'https://test.youtrack.cloud', token: 't' }

const queueResponses = (responses: unknown[]): void => {
  let i = 0
  setMockFetch(() => {
    const body = responses[Math.min(i, responses.length - 1)]
    i++
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  })
}

describe('validateRequiredCreateFields', () => {
  beforeEach(() => mockLogger())
  afterEach(() => restoreFetch())

  test('does not flag a required field that has a default value', async () => {
    queueResponses([
      [
        {
          $type: 'StateProjectCustomField',
          field: { name: 'State', fieldType: { id: 'state[1]' } },
          canBeEmpty: false,
          defaultValues: [{ name: 'Open' }],
          bundle: { id: 'sb-1', $type: 'StateBundle' },
        },
      ],
    ])
    const fields = await validateRequiredCreateFields(config, '0-1', 'TEST', {})
    expect(fields).toHaveLength(1) // returns, does not throw
  })

  test('teaching error lists allowed values for a required state field', async () => {
    queueResponses([
      // 1st fetch: project custom fields
      [
        {
          $type: 'StateProjectCustomField',
          field: { name: 'State', fieldType: { id: 'state[1]' } },
          canBeEmpty: false,
          bundle: { id: 'sb-1', $type: 'StateBundle' },
        },
      ],
      // 2nd fetch: bundle element values
      [{ name: 'Open' }, { name: 'In Progress', localizedName: 'В работе' }],
    ])
    await expect(validateRequiredCreateFields(config, '0-1', 'TEST', {})).rejects.toThrow(
      /requires these custom fields.*State.*Open, In Progress/,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/task-helpers.test.ts`
Expected: FAIL — current code over-reports (ignores `defaultValues`) and the error has no allowed values.

- [ ] **Step 3: Implement the changes in `task-helpers.ts`**

(a) Add imports near the top (after the existing imports):

```typescript
import { makeBundleElementFetcher } from './bundle-values.js'
import { classifyFieldType, formatAllowed } from './field-engine.js'
```

(b) Export `fetchProjectCustomFields` — change its declaration (line 41) from `const fetchProjectCustomFields = async (` to:

```typescript
export const fetchProjectCustomFields = async (
```

(c) Replace `buildHandledFieldSet` (lines 61-89) with the unknown-only check (the engine now supports all types, so drop the "Unsupported" throw):

```typescript
const buildHandledFieldSet = (
  projectFieldsByName: ReadonlyMap<string, ProjectCustomField & { readonly field: { readonly name: string } }>,
  customFields: ReadonlyArray<{ name: string; value: string }> | undefined,
): Set<string> => {
  const handledFields = new Set<string>()
  for (const fieldName of new Set((customFields ?? []).map((field) => field.name))) {
    if (!projectFieldsByName.has(fieldName)) {
      throw new YouTrackClassifiedError(
        `Unknown custom field for create: ${fieldName}`,
        providerError.validationFailed(
          'customFields',
          `${fieldName} is not a known project field for this YouTrack project`,
        ),
      )
    }
    handledFields.add(fieldName)
  }
  return handledFields
}
```

(d) Replace the required-fields computation + throw at the end of `validateRequiredCreateFields` (lines 166-178) with:

```typescript
const hasDefault = (field: ProjectCustomField): boolean => (field.defaultValues?.length ?? 0) > 0
const requiredFields = projectCustomFields.filter(
  (field) =>
    field.canBeEmpty === false &&
    !hasDefault(field) &&
    field.field?.name !== undefined &&
    !handledFields.has(field.field.name),
)
if (requiredFields.length === 0) return projectCustomFields

const fetchElements = makeBundleElementFetcher(config)
const described = await Promise.all(
  requiredFields.map(async (field) => {
    const name = field.field?.name ?? '(unnamed)'
    const c = classifyFieldType(field)
    if (c.kind !== 'bundle' || c.bundleSegment === undefined || field.bundle?.id === undefined) {
      return { name, label: name }
    }
    try {
      const allowed = (await fetchElements(c.bundleSegment, field.bundle.id)).map((e) => e.name)
      return { name, label: `${name} (one of: ${formatAllowed(allowed)})` }
    } catch {
      return { name, label: name }
    }
  }),
)
throw new YouTrackClassifiedError(
  `Project ${projectShortName} requires these custom fields: ${described.map((d) => d.label).join('; ')}`,
  providerError.workflowValidationFailed(
    projectId,
    'The project workflow requires additional custom fields before the task can be created. Call describe_project for the full schema and valid values.',
    described.map((d) => ({ name: d.name })),
  ),
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/task-provider-youtrack/task-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run format
git add plugins/task-provider-youtrack/task-helpers.ts tests/plugins/task-provider-youtrack/task-helpers.test.ts
git commit -m "feat(youtrack): required-field detection honors defaultValues + teaching errors"
```

---

## Task 5: Route `create_task` field-building through the engine

**Files:**

- Modify: `plugins/task-provider-youtrack/task-helpers.ts` (`buildCreateCustomFields` 180-195)
- Modify: `plugins/task-provider-youtrack/operations/tasks.ts:91` (await the now-async builder)
- Test: `tests/plugins/task-provider-youtrack/operations/tasks.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/plugins/task-provider-youtrack/operations/tasks.test.ts` inside the `describe('createYouTrackTask', …)` block. This uses a fetch sequence: project → project custom fields → state bundle values → POST issue. Add a local helper + test:

```typescript
test('resolves a localized State value against the bundle before POST', async () => {
  let postBody: unknown
  let call = 0
  setMockFetch((url, init) => {
    call++
    const json = (data: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    if (call === 1) return json({ id: '0-1', shortName: 'TEST' }) // GET project
    if (call === 2)
      return json([
        {
          $type: 'StateProjectCustomField',
          field: { name: 'State', fieldType: { id: 'state[1]' } },
          canBeEmpty: false,
          bundle: { id: 'sb-1', $type: 'StateBundle' },
        },
      ]) // GET project custom fields
    if (call === 3) return json([{ name: 'Open' }, { name: 'In Progress', localizedName: 'В работе' }]) // bundle values
    postBody = JSON.parse(String(init.body)) // POST /api/issues
    return json(makeIssueResponse())
  })

  await createYouTrackTask(config, { projectId: '0-1', title: 'T', status: 'in progress' })

  const body = postBody as { customFields: Array<{ name: string; $type: string; value: { name: string } }> }
  const state = body.customFields.find((f) => f.name === 'State')
  expect(state).toEqual({ name: 'State', $type: 'StateIssueCustomField', value: { name: 'In Progress' } })
})
```

> `makeIssueResponse()` and `config` already exist in this test file (see the existing `mockCreateTaskResponse` helper and fixtures). If `makeIssueResponse` is defined later in the file, hoist your test below it or reference the existing factory.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/operations/tasks.test.ts`
Expected: FAIL — current code sends `value: { name: 'in progress' }` verbatim (no bundle resolution).

- [ ] **Step 3: Rewrite `buildCreateCustomFields` (async, engine-based)**

In `task-helpers.ts`, add imports if not already present (from Task 4 you added `makeBundleElementFetcher`, `classifyFieldType`, `formatAllowed`; now also):

```typescript
import { resolveCustomFieldValue, type IssueCustomFieldPayload } from './field-engine.js'
```

Replace `buildCreateCustomFields` (lines 180-195) with:

```typescript
const legacyDedicatedPayload = (name: string, value: string): StandardCustomFieldPayload | undefined => {
  switch (name) {
    case 'State':
      return { name, $type: 'StateIssueCustomField', value: { name: value } }
    case 'Priority':
      return { name, $type: 'SingleEnumIssueCustomField', value: { name: value } }
    case 'Assignee':
      return { name, $type: 'SingleUserIssueCustomField', value: { login: value } }
    case YOUTRACK_DUE_DATE_FIELD_NAME:
      return { name, $type: 'DateIssueCustomField', value: parseDueDateValue(value) }
    default:
      return undefined
  }
}

export const buildCreateCustomFields = async (
  config: Readonly<YouTrackConfig>,
  params: Readonly<{
    status?: string
    priority?: string
    dueDate?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  }>,
  projectCustomFields: readonly ProjectCustomField[],
): Promise<Array<StandardCustomFieldPayload | IssueCustomFieldPayload>> => {
  const projectFieldsByName = buildProjectFieldsByName(projectCustomFields)
  const getBundleElements = makeBundleElementFetcher(config)
  const pairs: Array<{ name: string; value: string; dedicated: boolean }> = []
  if (params.status !== undefined) pairs.push({ name: 'State', value: params.status, dedicated: true })
  if (params.priority !== undefined) pairs.push({ name: 'Priority', value: params.priority, dedicated: true })
  if (params.assignee !== undefined) pairs.push({ name: 'Assignee', value: params.assignee, dedicated: true })
  if (params.dueDate !== undefined)
    pairs.push({ name: YOUTRACK_DUE_DATE_FIELD_NAME, value: params.dueDate, dedicated: true })
  for (const cf of params.customFields ?? []) pairs.push({ ...cf, dedicated: false })

  const payloads: Array<StandardCustomFieldPayload | IssueCustomFieldPayload> = []
  for (const pair of pairs) {
    const field = projectFieldsByName.get(pair.name)
    if (field === undefined) {
      const legacy = pair.dedicated ? legacyDedicatedPayload(pair.name, pair.value) : undefined
      if (legacy !== undefined) {
        payloads.push(legacy)
        continue
      }
      throw new YouTrackClassifiedError(
        `Unknown custom field for create: ${pair.name}`,
        providerError.validationFailed(
          'customFields',
          `${pair.name} is not a known project field for this YouTrack project`,
        ),
      )
    }
    payloads.push(await resolveCustomFieldValue(field, pair.value, { getBundleElements }))
  }
  return payloads
}
```

> `parseDueDateValue` is already imported in `task-helpers.ts` (line 14). `YouTrackConfig` type is imported (line 11). `StandardCustomFieldPayload` is defined locally (lines 26-30). Keep `buildCustomFields` and `buildWriteSafeCustomFields` unchanged — the update path still uses them.

- [ ] **Step 4: Wire the await in `operations/tasks.ts`**

In `createYouTrackTask`, change line 91 from:

```typescript
const customFields = buildCreateCustomFields(params, projectCustomFields)
```

to:

```typescript
const customFields = await buildCreateCustomFields(config, params, projectCustomFields)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/plugins/task-provider-youtrack/operations/tasks.test.ts`
Expected: PASS (new case + existing create cases still green).

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
bun run format
git add plugins/task-provider-youtrack/task-helpers.ts plugins/task-provider-youtrack/operations/tasks.ts tests/plugins/task-provider-youtrack/operations/tasks.test.ts
git commit -m "feat(youtrack): route create_task fields through the resolution engine"
```

---

## Task 6: `describeProjectFields` operation + provider delegate + interface

**Files:**

- Create: `plugins/task-provider-youtrack/operations/project-fields.ts`
- Modify: `plugins/task-provider-youtrack/provider.ts` (after `listProjects`, ~line 148)
- Modify: `src/providers/types.ts` (add `ProjectFieldDescriptor` + optional method after line 138)
- Modify: `src/providers/public-types.ts` (re-export type, lines 9-41 block)
- Test: `tests/plugins/task-provider-youtrack/operations/project-fields.test.ts`

- [ ] **Step 1: Add the shared `ProjectFieldDescriptor` type + interface method**

In `src/providers/types.ts`, add the interface (place it near the other exported domain types, e.g. just above `export interface TaskProvider`):

```typescript
export interface ProjectFieldDescriptor {
  name: string
  type: string
  multi: boolean
  required: boolean
  defaultValue?: string
  allowedValues?: string[]
}
```

Then inside `TaskProvider`, immediately after the `listProjects?(): Promise<Project[]>` line (138), add:

```typescript
  describeProjectFields?(projectId: string): Promise<ProjectFieldDescriptor[]>
```

In `src/providers/public-types.ts`, add `ProjectFieldDescriptor,` to the `export type { … } from './types.js'` block (keep alphabetical: after `Project,`).

- [ ] **Step 2: Write the failing test**

Create `tests/plugins/task-provider-youtrack/operations/project-fields.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { YouTrackConfig } from '../../../../plugins/task-provider-youtrack/client.js'
import { describeYouTrackProjectFields } from '../../../../plugins/task-provider-youtrack/operations/project-fields.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const config: YouTrackConfig = { baseUrl: 'https://test.youtrack.cloud', token: 't' }

describe('describeYouTrackProjectFields', () => {
  beforeEach(() => mockLogger())
  afterEach(() => restoreFetch())

  test('describes a required state field with allowed values', async () => {
    let call = 0
    setMockFetch(() => {
      call++
      const json = (d: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        )
      if (call === 1)
        return json([
          {
            $type: 'StateProjectCustomField',
            field: { name: 'State', fieldType: { id: 'state[1]' } },
            canBeEmpty: false,
            bundle: { id: 'sb-1', $type: 'StateBundle' },
          },
        ])
      return json([{ name: 'Open' }, { name: 'In Progress', localizedName: 'В работе' }])
    })

    const fields = await describeYouTrackProjectFields(config, '0-1')

    expect(fields).toEqual([
      {
        name: 'State',
        type: 'state',
        multi: false,
        required: true,
        defaultValue: undefined,
        allowedValues: ['Open', 'In Progress'],
      },
    ])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-youtrack/operations/project-fields.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `operations/project-fields.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ProjectFieldDescriptor } from 'papai/plugin-types'

import { logger } from '../../../src/logger.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { makeBundleElementFetcher } from '../bundle-values.js'
import { capAllowedValues, classifyFieldType } from '../field-engine.js'
import { fetchProjectCustomFields } from '../task-helpers.js'

const log = logger.child({ scope: 'provider:youtrack:project-fields' })

export const describeYouTrackProjectFields = async (
  config: Readonly<YouTrackConfig>,
  projectId: string,
): Promise<ProjectFieldDescriptor[]> => {
  log.debug({ projectId }, 'describeProjectFields')
  try {
    const fields = await fetchProjectCustomFields(config, projectId)
    const getBundleElements = makeBundleElementFetcher(config)
    const descriptors = await Promise.all(
      fields.map(async (field) => {
        const name = field.field?.name ?? '(unnamed)'
        const c = classifyFieldType(field)
        const required = field.canBeEmpty === false && (field.defaultValues?.length ?? 0) === 0
        const defaultValue = field.defaultValues?.[0]?.name
        let allowedValues: string[] | undefined
        if (c.kind === 'bundle' && c.bundleSegment !== undefined && field.bundle?.id !== undefined) {
          try {
            allowedValues = capAllowedValues(
              (await getBundleElements(c.bundleSegment, field.bundle.id)).map((e) => e.name),
            )
          } catch {
            allowedValues = undefined
          }
        }
        return { name, type: c.label, multi: c.multi, required, defaultValue, allowedValues }
      }),
    )
    log.info({ projectId, count: descriptors.length }, 'Project fields described')
    return descriptors
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId },
      'Failed to describe project fields',
    )
    throw classifyYouTrackError(error, { projectId })
  }
}
```

- [ ] **Step 5: Add the provider delegate**

In `plugins/task-provider-youtrack/provider.ts`, add the import near the other operation imports:

```typescript
import { describeYouTrackProjectFields } from './operations/project-fields.js'
```

And add the delegate method right after `listProjects()` in the `YouTrackProvider` class:

```typescript
  describeProjectFields(projectId: string): Promise<ProjectFieldDescriptor[]> {
    return describeYouTrackProjectFields(this.config, projectId)
  }
```

Add `ProjectFieldDescriptor` to the existing `import type { … } from 'papai/plugin-types'` in `provider.ts`.

- [ ] **Step 6: Run test + typecheck**

Run: `bun test tests/plugins/task-provider-youtrack/operations/project-fields.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
bun run format
git add src/providers/types.ts src/providers/public-types.ts plugins/task-provider-youtrack/operations/project-fields.ts plugins/task-provider-youtrack/provider.ts tests/plugins/task-provider-youtrack/operations/project-fields.test.ts
git commit -m "feat(youtrack): describeProjectFields operation + provider delegate"
```

---

## Task 7: `describe_project` tool + registration

**Files:**

- Create: `src/tools/describe-project.ts`
- Modify: `src/tools/tools-builder.ts` (`maybeAddProjectTools`, ~lines 70-80)
- Test: `tests/tools/describe-project.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/describe-project.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { makeDescribeProjectTool } from '../../src/tools/describe-project.js'
import type { ProjectFieldDescriptor, TaskProvider } from '../../src/providers/types.js'
import { getToolExecutor } from '../utils/test-helpers.js'

const descriptors: ProjectFieldDescriptor[] = [
  { name: 'State', type: 'state', multi: false, required: true, allowedValues: ['Open', 'Fixed'] },
]

const provider = {
  name: 'youtrack',
  describeProjectFields: (_projectId: string) => Promise.resolve(descriptors),
} as unknown as TaskProvider

describe('describe_project tool', () => {
  test('returns the project field descriptors', async () => {
    const execute = getToolExecutor(makeDescribeProjectTool(provider))
    const result = (await execute({ projectId: '0-1' })) as { projectId: string; fields: ProjectFieldDescriptor[] }
    expect(result.projectId).toBe('0-1')
    expect(result.fields).toEqual(descriptors)
  })
})
```

> `getToolExecutor` is the shared helper in `tests/utils/test-helpers.ts`. If its signature differs in this repo, call the tool's `execute` directly: `await makeDescribeProjectTool(provider).execute!({ projectId: '0-1' }, fakeToolOptions)`. Mirror the call style used by a sibling tool test such as `tests/tools/list-projects.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/describe-project.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools/describe-project.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:describe-project' })

export function makeDescribeProjectTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description:
      "Inspect a project's custom fields BEFORE creating or updating a task. Returns each field's name, type, whether it is required, its default, and allowed values (e.g. the valid State names, which may be localized). Call this proactively before creating a task in an unfamiliar project, or whenever create_task fails with a required/unknown-field error. Use the exact allowedValues when setting status, priority, or custom fields.",
    inputSchema: z.object({
      projectId: z.string().describe('Project ID — call list_projects first to obtain this'),
    }),
    execute: async ({ projectId }) => {
      const fields = (await provider.describeProjectFields?.(projectId)) ?? []
      log.info({ projectId, count: fields.length }, 'Described project fields')
      return { projectId, fields }
    },
  })
}
```

- [ ] **Step 4: Register the tool**

In `src/tools/tools-builder.ts`, add the import alongside the other tool factory imports:

```typescript
import { makeDescribeProjectTool } from './describe-project.js'
```

Inside `maybeAddProjectTools`, after the `list_projects` registration, add:

```typescript
if (provider.describeProjectFields !== undefined) tools['describe_project'] = makeDescribeProjectTool(provider)
```

- [ ] **Step 5: Run test + typecheck**

Run: `bun test tests/tools/describe-project.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
bun run format
git add src/tools/describe-project.ts src/tools/tools-builder.ts tests/tools/describe-project.test.ts
git commit -m "feat(tools): describe_project tool for YouTrack field discovery"
```

---

## Task 8: Update `create_task` guidance + prompt addendum

**Files:**

- Modify: `src/tools/create-task.ts` (description line 135; `status` 119; `customFields` 121-126)
- Modify: `plugins/task-provider-youtrack/prompt-addendum.ts`
- Test: `tests/tools/create-task.test.ts` (assert the new descriptions; if no such test exists, add a minimal schema-description assertion)

- [ ] **Step 1: Write the failing test**

Add to (or create) `tests/tools/create-task.test.ts` a test that asserts the updated guidance. Use the existing test harness in that file if present; otherwise:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { makeCreateTaskTool } from '../../src/tools/create-task.js'
import type { TaskProvider } from '../../src/providers/types.js'

const provider = { name: 'youtrack', supportsCustomFields: true } as unknown as TaskProvider

describe('create_task description', () => {
  test('points the model at describe_project for valid values', () => {
    const t = makeCreateTaskTool(provider)
    expect(t.description).toContain('describe_project')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/create-task.test.ts`
Expected: FAIL — current description does not mention `describe_project`.

- [ ] **Step 3: Update `create-task.ts`**

Change the tool description (line 135) to:

```typescript
    description:
      'Create a new task. Call list_projects first to get a valid projectId. For YouTrack, if the project has required custom fields call describe_project first to learn the field names and valid values (e.g. State names, which may be localized).',
```

Change the `status` field description (line 119) to:

```typescript
  status: z
    .string()
    .optional()
    .describe(
      "Status/State value. For YouTrack this must exactly match one of the project's State values — call describe_project to get them (they may be localized). For other providers, a status column slug (e.g. 'to-do', 'in-progress', 'done').",
    ),
```

Change the `customFields` field description (lines 121-126) to:

```typescript
  customFields: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional()
    .describe(
      'For YouTrack, set required project custom fields by name (any field type — enum, state, version, etc.). Call describe_project to discover field names and allowed values, and use those exact values. Prefer the dedicated status/priority/assignee/dueDate parameters where they apply.',
    ),
```

- [ ] **Step 4: Update the prompt addendum**

In `plugins/task-provider-youtrack/prompt-addendum.ts`, add this line to the array (e.g. right after the State line):

```typescript
  '- Before creating a task in a project you have not created in this turn, call `describe_project` to learn its required fields and the exact valid values (State/enum values may be localized). Use those exact values; do not invent slugs.',
```

- [ ] **Step 5: Run test + typecheck**

Run: `bun test tests/tools/create-task.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
bun run format
git add src/tools/create-task.ts plugins/task-provider-youtrack/prompt-addendum.ts tests/tools/create-task.test.ts
git commit -m "feat(tools): steer create_task toward describe_project for YouTrack field values"
```

---

## Final verification

- [ ] **Run the full check suite**

Run: `bun run typecheck && bun run knip && bun test tests/plugins/task-provider-youtrack tests/tools`
Expected: all PASS.

- [ ] **Run the broader suite**

Run: `bun run test`
Expected: PASS (no regressions in the update path or other providers).

- [ ] **Manual sanity (optional, against a real YouTrack):** with a project that requires `State`, ask the bot to create a task without specifying a state → it should call `describe_project`, then `create_task` with a valid State value, and succeed — reproducing the failing scenario from the spec's evidence table now resolving cleanly.

---

## Self-review notes (coverage vs spec)

- **D1 (no value resolution)** → Tasks 2-3, 5 (engine resolves State/Priority/enum against the bundle, before POST).
- **D2 (required non-dedicated fields unsettable)** → Tasks 3, 4, 5 (engine supports all bundle/user/text/date types; "Unsupported" gate removed).
- **D3 (no schema discovery)** → Tasks 6, 7 (`describe_project` tool).
- **D4 (errors don't teach)** → Tasks 3 (resolution error with allowed values), 4 (required error with allowed values), 8 (prompt guidance).
- **Required-detection honors `defaultValues`** → Tasks 1, 4.
- **Out of scope (per spec):** `update_task` generalization (still uses `buildCustomFields`/`buildWriteSafeCustomFields`, unchanged), group fields, fuzzy/synonym user resolution.
