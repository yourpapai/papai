<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin / Core Separation — Phase 2: Module Foundation & Orchestrator Decoupling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the net-new **Trusted Module** system (the `src/modules/` convention, a `ModuleLifecycle`/`TrustedModule` port, a composition root that loads modules and runs their migrations), and prove it with one real behavior: a `coding` module that registers a who-may-use resolver into a new `OperatorAllowlistPort`, letting the core orchestrator delete its last `resolveCodingGuardrails` import — behavior-preserving — locked by an extended architecture guard test.

**Architecture:** Hexagonal ports & adapters + a two-tier extensibility model (Trusted Modules + Plugins) from spec `docs/superpowers/specs/2026-07-02-plugin-core-separation-design.md`. A **composition root** (`src/composition/`) wires trusted in-repo modules once at startup: it runs each module's DB migrations through the existing `runMigrations` mechanism and calls each module's `onActivate()`. The `coding` module's `onActivate()` registers a resolver into the process-wide `OperatorAllowlistPort`; the orchestrator consults that port instead of importing the coding feature.

**Tech Stack:** Bun + strict TypeScript, Zod v4, `bun:test`. Imports use the `.js` extension.

---

## Scope & Deferred (read first)

This is **plan 2 of the spec's strangler rollout**. It covers spec rollout step **1 (the deferred remainder: `ports/` module convention + composition root)** and the **self-contained, highest-value slice of step 3** (removing the orchestrator's last coding coupling via a module + port). It is the substrate every later coding-module step builds on.

**In scope:**

- `src/ports/module.ts` — the `TrustedModule` / `ModuleLifecycle` port (types only: `id`, optional `migrations`, optional `onActivate()`).
- `src/ports/operator-allowlist.ts` — `OperatorAllowlistPort` (`register`/`resolve`), factory, and process-wide singleton. Default resolver returns `'members'`.
- `src/db/index.ts` — `applyModuleMigrations(migrations, db?)`: a generic, feature-agnostic entry that runs a module's migrations through the existing `runMigrations` against the shared DB + bookkeeping table.
- `src/composition/` — the composition root: `trusted-modules.ts` (static registry) + `load-trusted-modules.ts` (migrate-all-then-activate-all loader with dependency injection for tests).
- `src/modules/coding/module.ts` — the first real trusted module: registers a `whoMayUse` resolver into `OperatorAllowlistPort` on `onActivate()`.
- Wire `loadTrustedModules()` into `src/index.ts` immediately after `initDb()`.
- Refactor `src/llm-orchestrator-tools.ts` to read the allowlist via `operatorAllowlistPort.resolve(pi)`; delete the `resolveCodingGuardrails` import.
- Extend `tests/architecture-guard.test.ts` to (a) ban the word `coding` in `src/ports/**` and (b) assert the orchestrator no longer names the coding feature.

**Deliberately deferred (do NOT build here — YAGNI):**

- **Relocating `src/coding-credentials/` and `src/coding-repos/` into `src/modules/coding/`.** This slice leaves those directories where they are; the `coding` module _bridges_ to `resolveCodingGuardrails` via a normal import. Relocation (with module-owned migrations) is Phase 2b.
- **`CredentialVaultPort` + removing `codingSecrets`/`codingRepos` from `PluginToolRuntimeContext`.** That is Phase 2c and carries an unresolved design fork (does the acp plugin become a trusted module, or stay a plugin binding a vault port via permission?) that must be decided first.
- **The `coding` module owning any DB tables.** It contributes **no migrations** in this slice (`migrations` is absent). The loader's migration path is fully built and unit-tested with a fake module, but no real table ownership changes — keeping this slice strictly behavior-preserving.
- **The Kaneo legacy-repair leak** (`src/index.ts` `activatedPluginIds.includes('task-provider-kaneo')` → `runKaneoLegacyRepair()`). Untouched here; it becomes a `ModuleLifecycle` concern in a later task-tracker phase.

**Behavior invariant:** operator who-may-use gating must be identical before and after. Before: the orchestrator called `resolveCodingGuardrails(pi).whoMayUse` (default `'members'` when unset). After: it calls `operatorAllowlistPort.resolve(pi)`, whose default resolver returns `'members'`, and which — once the `coding` module's `onActivate()` runs at startup — resolves through the exact same `resolveCodingGuardrails(pi).whoMayUse`. Same value, same filter.

**Architecture-guard scoping note:** the guard scans `src/ports/**` (must never name a feature) and the specific orchestrator file. It intentionally does **not** scan `src/composition/**` or `src/modules/**` — the composition root is the one wiring layer permitted to name modules (`import { codingModule }`), and a module directory obviously names its own feature. The enforceable invariant is that the **kernel and ports** never name a feature.

---

## File Structure

**Create:**

- `src/ports/module.ts` — `TrustedModule` interface (`id`, `migrations?`, `onActivate?`). Types only; the `migrations` field reuses the existing `Migration` type via a **type-only** import (no runtime coupling). Feature-agnostic — the architecture guard scans `src/ports/**`.
- `src/ports/operator-allowlist.ts` — `WhoMayUse` type, `OperatorAllowlistResolver`, `OperatorAllowlistPort` interface, `createOperatorAllowlistPort()` factory, `operatorAllowlistPort` singleton. Feature-agnostic.
- `src/composition/trusted-modules.ts` — `TRUSTED_MODULES: readonly TrustedModule[]`, the static in-repo module registry. Starts empty; Task 6 adds the coding module. (Composition root — may name modules; not guard-scanned.)
- `src/composition/load-trusted-modules.ts` — `loadTrustedModules(modules?, runMigrationsFn?)`: runs all module migrations, then calls all `onActivate()` hooks.
- `src/modules/coding/module.ts` — `codingModule: TrustedModule` + the exported `codingWhoMayUseResolver`.
- `tests/ports/operator-allowlist.test.ts`
- `tests/db/module-migrations.test.ts`
- `tests/composition/load-trusted-modules.test.ts`
- `tests/modules/coding/module.test.ts`

**Modify:**

- `src/db/index.ts` — add the exported `applyModuleMigrations` helper.
- `src/composition/trusted-modules.ts` — Task 6 populates the registry with `codingModule`.
- `src/index.ts` — `await loadTrustedModules()` immediately after the `initDb()` try/catch.
- `src/llm-orchestrator-tools.ts` — swap `resolveCodingGuardrails(pi).whoMayUse` → `operatorAllowlistPort.resolve(pi)`; delete the `resolveCodingGuardrails` import.
- `tests/architecture-guard.test.ts` — extend the banned-name set and add the orchestrator assertion.

---

## Task 1: `TrustedModule` / `ModuleLifecycle` port (`src/ports/module.ts`)

**Files:**

- Create: `src/ports/module.ts`

This is a pure-type port (no runtime behavior), so there is no unit test — it is validated by `tsc` and consumed by Tasks 4–6. Do **not** invent a vacuous runtime test for a types-only file.

- [ ] **Step 1: Write the port**

Create `src/ports/module.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Migration } from '../db/migrate.js'

/**
 * A privileged, in-repo **Trusted Module** (Tier 1). Unlike a sandboxed plugin, a module may
 * own DB tables (via `migrations`) and bind directly to ports. Modules are wired once at the
 * composition root (`src/composition/`), never by the kernel.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard test scans `src/ports/**`
 * for feature/provider names. Do not reference concrete module or feature names here.
 */
export interface TrustedModule {
  /** Stable module id (feature-agnostic contract; the value lives in the module, not here). */
  readonly id: string
  /**
   * Migrations this module owns. Run through the shared `runMigrations` mechanism at load.
   * Ids must be numeric-prefixed (see `src/db/migrate.ts`) and must not collide with other
   * modules' or core's migration ids in the shared `migrations` bookkeeping table.
   */
  readonly migrations?: readonly Migration[]
  /** Called once after all modules' migrations have run. Registers resolvers/adapters into ports. */
  onActivate?(): void | Promise<void>
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun run typecheck`
Expected: clean (no errors). The `Migration` type resolves from `src/db/migrate.ts`; the import is type-only so it adds no runtime dependency.

- [ ] **Step 3: Commit**

```bash
git add src/ports/module.ts
git commit -m "feat(ports): add TrustedModule/ModuleLifecycle port"
```

---

## Task 2: `OperatorAllowlistPort` (`src/ports/operator-allowlist.ts`)

**Files:**

- Create: `src/ports/operator-allowlist.ts`
- Test: `tests/ports/operator-allowlist.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ports/operator-allowlist.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createOperatorAllowlistPort, operatorAllowlistPort } from '../../src/ports/operator-allowlist.js'

describe('OperatorAllowlistPort', () => {
  test('defaults to "members" when no resolver is registered', () => {
    const port = createOperatorAllowlistPort()
    expect(port.resolve('pi-1')).toBe('members')
  })

  test('resolves via the registered resolver', () => {
    const port = createOperatorAllowlistPort()
    port.register((pi) => (pi === 'pi-1' ? ['op-user'] : 'members'))
    expect(port.resolve('pi-1')).toEqual(['op-user'])
    expect(port.resolve('pi-2')).toBe('members')
  })

  test('last registration wins', () => {
    const port = createOperatorAllowlistPort()
    port.register(() => ['a'])
    port.register(() => ['b'])
    expect(port.resolve('x')).toEqual(['b'])
  })

  test('exposes a shared singleton', () => {
    expect(typeof operatorAllowlistPort.resolve).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ports/operator-allowlist.test.ts`
Expected: FAIL — module `../../src/ports/operator-allowlist.js` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

Create `src/ports/operator-allowlist.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Who may use operator-gated tools: everyone (`'members'`) or an explicit allowlist of chat user ids. */
export type WhoMayUse = 'members' | string[]

/** Resolves the who-may-use allowlist for a given platform instance. */
export type OperatorAllowlistResolver = (platformInstanceId: string) => WhoMayUse

/**
 * Lets core resolve the operator allowlist without importing the feature that owns the policy.
 * A trusted module registers the resolver at load; the orchestrator consults `resolve()`.
 * Default (no resolver registered) is `'members'` — everyone allowed — matching the historical
 * default when no guardrail policy is configured.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard test scans `src/ports/**`
 * for feature/provider names. Do not reference concrete module or feature names here.
 */
export interface OperatorAllowlistPort {
  register(resolver: OperatorAllowlistResolver): void
  resolve(platformInstanceId: string): WhoMayUse
}

/** Create an isolated port (used by tests and, as a singleton, by the runtime). */
export function createOperatorAllowlistPort(): OperatorAllowlistPort {
  let resolver: OperatorAllowlistResolver = () => 'members'
  return {
    register: (r) => {
      resolver = r
    },
    resolve: (platformInstanceId) => resolver(platformInstanceId),
  }
}

/** Process-wide singleton: a trusted module registers into it at load, the orchestrator reads it. */
export const operatorAllowlistPort: OperatorAllowlistPort = createOperatorAllowlistPort()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ports/operator-allowlist.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ports/operator-allowlist.ts tests/ports/operator-allowlist.test.ts
git commit -m "feat(ports): add OperatorAllowlistPort"
```

---

## Task 3: `applyModuleMigrations` (generic module-migration entry)

**Files:**

- Modify: `src/db/index.ts`
- Test: `tests/db/module-migrations.test.ts`

Context: `src/db/index.ts` already imports `runMigrations` and defines the private `getMigrationDb()` (returns the process `Database`) plus `export const initDb = () => runMigrations(getMigrationDb(), MIGRATIONS)`. This task adds a generic, feature-agnostic helper the composition root can call to run a module's migrations, keeping the `Database` handle encapsulated. The `db` param defaults to the real connection but is injectable for tests.

- [ ] **Step 1: Write the failing test**

Create `tests/db/module-migrations.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'

import { applyModuleMigrations } from '../../src/db/index.js'
import type { Migration } from '../../src/db/migrate.js'

describe('applyModuleMigrations', () => {
  test('applies a module migration to the given db and records it in the bookkeeping table', () => {
    const db = new Database(':memory:')
    const migration: Migration = {
      id: '9001_fake_module_table',
      up: (d) => d.run('CREATE TABLE fake_module (id TEXT)'),
    }
    applyModuleMigrations([migration], db)
    const table = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='fake_module'").all()
    expect(table.length).toBe(1)
    const recorded = db.query("SELECT id FROM migrations WHERE id = '9001_fake_module_table'").all()
    expect(recorded.length).toBe(1)
  })

  test('is idempotent — a second call skips the already-applied migration', () => {
    const db = new Database(':memory:')
    const migration: Migration = {
      id: '9001_fake',
      up: (d) => d.run('CREATE TABLE fake (id TEXT)'),
    }
    applyModuleMigrations([migration], db)
    // Would throw ("table fake already exists") if the migration ran twice.
    applyModuleMigrations([migration], db)
    expect(db.query("SELECT id FROM migrations WHERE id = '9001_fake'").all().length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/module-migrations.test.ts`
Expected: FAIL — `applyModuleMigrations` is not exported from `src/db/index.ts`.

- [ ] **Step 3: Add the helper**

In `src/db/index.ts` — no new imports are needed: the file already imports `Database` from `bun:sqlite`, the `Migration` type from `./migrate.js`, and `runMigrations` from `./migrate.js`.

Add the exported helper next to `initDb` (feature-agnostic — takes any `Migration[]`):

```ts
/**
 * Run a trusted module's migrations through the shared migration mechanism and bookkeeping
 * table. Generic: names no feature. `db` defaults to the process connection; tests inject one.
 */
export const applyModuleMigrations = (migrations: readonly Migration[], db: Database = getMigrationDb()): void => {
  runMigrations(db, migrations)
}
```

> If `getMigrationDb` is declared **below** `initDb` in the file, place `applyModuleMigrations` after `getMigrationDb`'s declaration (or rely on `const` hoisting of the arrow only if `getMigrationDb` is a hoisted `function` — to be safe, place `applyModuleMigrations` immediately after `initDb`, which already references `getMigrationDb`, guaranteeing it is in scope).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/db/module-migrations.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/index.ts tests/db/module-migrations.test.ts
git commit -m "feat(db): add applyModuleMigrations for trusted-module tables"
```

---

## Task 4: Composition root — registry + loader

**Files:**

- Create: `src/composition/trusted-modules.ts`
- Create: `src/composition/load-trusted-modules.ts`
- Test: `tests/composition/load-trusted-modules.test.ts`

The registry starts **empty**; Task 6 adds the coding module. The loader is injectable (modules + a migration-runner) so it can be unit-tested with fakes and no real DB.

- [ ] **Step 1: Write the failing test**

Create `tests/composition/load-trusted-modules.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { loadTrustedModules } from '../../src/composition/load-trusted-modules.js'
import type { Migration } from '../../src/db/migrate.js'
import type { TrustedModule } from '../../src/ports/module.js'

const noopMigration = (id: string): Migration => ({ id, up: () => {} })

describe('loadTrustedModules', () => {
  test('runs all migrations before any onActivate hook', async () => {
    const order: string[] = []
    const runMigrationsFn = (migs: readonly Migration[]): void => {
      for (const m of migs) order.push(`migrate:${m.id}`)
    }
    const modA: TrustedModule = {
      id: 'a',
      migrations: [noopMigration('9001_a')],
      onActivate: () => {
        order.push('activate:a')
      },
    }
    const modB: TrustedModule = {
      id: 'b',
      onActivate: () => {
        order.push('activate:b')
      },
    }
    await loadTrustedModules([modA, modB], runMigrationsFn)
    expect(order).toEqual(['migrate:9001_a', 'activate:a', 'activate:b'])
  })

  test('runs no migration for a module that declares none', async () => {
    let calls = 0
    await loadTrustedModules([{ id: 'y' }], () => {
      calls += 1
    })
    expect(calls).toBe(0)
  })

  test('awaits an async onActivate', async () => {
    const seen: string[] = []
    const mod: TrustedModule = {
      id: 'x',
      onActivate: async () => {
        await Promise.resolve()
        seen.push('done')
      },
    }
    await loadTrustedModules([mod], () => {})
    expect(seen).toEqual(['done'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/composition/load-trusted-modules.test.ts`
Expected: FAIL — modules `../../src/composition/load-trusted-modules.js` cannot be resolved.

- [ ] **Step 3a: Create the empty registry**

Create `src/composition/trusted-modules.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TrustedModule } from '../ports/module.js'

/**
 * The static registry of in-repo trusted modules, wired once at the composition root.
 * This is the one place permitted to name modules; the kernel never imports from `src/modules/`.
 */
export const TRUSTED_MODULES: readonly TrustedModule[] = []
```

- [ ] **Step 3b: Create the loader**

Create `src/composition/load-trusted-modules.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { applyModuleMigrations } from '../db/index.js'
import type { Migration } from '../db/migrate.js'
import type { TrustedModule } from '../ports/module.js'
import { TRUSTED_MODULES } from './trusted-modules.js'

/**
 * Load trusted modules: run every module's migrations first (so any module's `onActivate` can
 * assume all module tables exist), then call each `onActivate` in registry order. `runMigrationsFn`
 * is injectable for tests; production uses the real DB-backed `applyModuleMigrations`.
 */
export async function loadTrustedModules(
  modules: readonly TrustedModule[] = TRUSTED_MODULES,
  runMigrationsFn: (migrations: readonly Migration[]) => void = applyModuleMigrations,
): Promise<void> {
  for (const mod of modules) {
    if (mod.migrations !== undefined && mod.migrations.length > 0) {
      runMigrationsFn(mod.migrations)
    }
  }
  for (const mod of modules) {
    await mod.onActivate?.()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/composition/load-trusted-modules.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/composition/trusted-modules.ts src/composition/load-trusted-modules.ts tests/composition/load-trusted-modules.test.ts
git commit -m "feat(composition): add trusted-module registry + loader"
```

---

## Task 5: The `coding` trusted module (`src/modules/coding/module.ts`)

**Files:**

- Create: `src/modules/coding/module.ts`
- Test: `tests/modules/coding/module.test.ts`

Context: `resolveCodingGuardrails(platformInstanceId)` (in `src/coding-credentials/guardrails.ts`) returns `{ allowedAgents, whoMayUse, forceSharedKey }`, defaulting `whoMayUse` to `'members'` when unset. `setCodingGuardrails(platformInstanceId, g)` writes the policy. This module bridges that existing function to the `OperatorAllowlistPort` — it does **not** move any code.

- [ ] **Step 1: Write the failing test**

The guardrails store reads/writes the config cache + DB, so the test needs the same per-test reset the guardrails suite uses: `mockLogger()` + `await setupTestDb()` from `tests/utils/test-helpers.js` in a `beforeEach` (verified against `tests/coding-credentials/guardrails.test.ts`).

Create `tests/modules/coding/module.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setCodingGuardrails } from '../../../src/coding-credentials/guardrails.js'
import { codingModule, codingWhoMayUseResolver } from '../../../src/modules/coding/module.js'
import { operatorAllowlistPort } from '../../../src/ports/operator-allowlist.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('coding module', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('id is "coding"', () => {
    expect(codingModule.id).toBe('coding')
  })

  test('contributes no migrations in this phase', () => {
    expect(codingModule.migrations).toBeUndefined()
  })

  test('codingWhoMayUseResolver returns "members" when no guardrails are set', () => {
    expect(codingWhoMayUseResolver('pi-unset')).toBe('members')
  })

  test('codingWhoMayUseResolver returns the configured allowlist', () => {
    setCodingGuardrails('pi-x', { allowedAgents: ['claude'], whoMayUse: ['op-1'], forceSharedKey: false })
    expect(codingWhoMayUseResolver('pi-x')).toEqual(['op-1'])
  })

  test('onActivate registers the resolver into the operator-allowlist singleton', () => {
    setCodingGuardrails('pi-y', { allowedAgents: ['claude'], whoMayUse: ['op-2'], forceSharedKey: false })
    codingModule.onActivate?.()
    expect(operatorAllowlistPort.resolve('pi-y')).toEqual(['op-2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/modules/coding/module.test.ts`
Expected: FAIL — module `../../../src/modules/coding/module.js` cannot be resolved.

- [ ] **Step 3: Write the module**

Create `src/modules/coding/module.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveCodingGuardrails } from '../../coding-credentials/guardrails.js'
import type { TrustedModule } from '../../ports/module.js'
import { operatorAllowlistPort, type WhoMayUse } from '../../ports/operator-allowlist.js'

/** Who-may-use resolver for coding sessions: the platform-instance guardrail policy's allowlist. */
export const codingWhoMayUseResolver = (platformInstanceId: string): WhoMayUse =>
  resolveCodingGuardrails(platformInstanceId).whoMayUse

/**
 * The coding trusted module. On activation it registers the operator allowlist resolver so the
 * orchestrator can gate coding-session tools without importing the coding feature. (It owns no
 * tables yet — `coding-credentials`/`coding-repos` relocation is a later phase.)
 */
export const codingModule: TrustedModule = {
  id: 'coding',
  onActivate(): void {
    operatorAllowlistPort.register(codingWhoMayUseResolver)
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/modules/coding/module.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/coding/module.ts tests/modules/coding/module.test.ts
git commit -m "feat(modules): add coding module registering the operator allowlist resolver"
```

---

## Task 6: Register the coding module + wire loading at startup

**Files:**

- Modify: `src/composition/trusted-modules.ts`
- Modify: `src/index.ts`

No new test file — covered by Tasks 4/5 unit tests plus the full suite (Task 9). The behavior it enables (the orchestrator reading the port) is proven behavior-preserving in Task 7.

- [ ] **Step 1: Add the coding module to the registry**

Replace the contents of `src/composition/trusted-modules.ts` with:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { codingModule } from '../modules/coding/module.js'
import type { TrustedModule } from '../ports/module.js'

/**
 * The static registry of in-repo trusted modules, wired once at the composition root.
 * This is the one place permitted to name modules; the kernel never imports from `src/modules/`.
 */
export const TRUSTED_MODULES: readonly TrustedModule[] = [codingModule]
```

- [ ] **Step 2: Call the loader at startup**

In `src/index.ts`:

(a) Add the import alongside the other local (`./`) imports, respecting the file's import ordering (so `bun run format:check` stays green):

```ts
import { loadTrustedModules } from './composition/load-trusted-modules.js'
```

(b) The startup sequence currently is (around lines 64–71):

```ts
try {
  initDb()
} catch (error) {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'Database migration failed')
  process.exit(1)
}

seedSystemConfigFromEnv()
```

Insert the module-load call between the `initDb()` try/catch and `seedSystemConfigFromEnv()` — trusted modules load (and run their migrations) right after core DB init, before any plugin discovery/activation:

```ts
try {
  initDb()
} catch (error) {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'Database migration failed')
  process.exit(1)
}

await loadTrustedModules()

seedSystemConfigFromEnv()
```

> `src/index.ts` already uses top-level `await` (e.g. `await activatePlugins(...)` later in the file), so `await loadTrustedModules()` at module top level is valid.

- [ ] **Step 3: Confirm no regression + knip re-links the new modules**

Run: `bun test tests/composition/ tests/modules/ tests/ports/operator-allowlist.test.ts`
Expected: PASS.

Run: `bun run knip`
Expected: no output (exit 0). The chain `src/index.ts` → `load-trusted-modules.ts` → `trusted-modules.ts` → `coding/module.ts` → `operator-allowlist.ts`/`module.ts` is now fully reachable, so none of the new files are reported unused. (If knip still lists `operator-allowlist.ts` as unused, that is expected only until Task 7 wires the orchestrator to `resolve()` — note it and proceed; Task 7 closes it.)

- [ ] **Step 4: Commit**

```bash
git add src/composition/trusted-modules.ts src/index.ts
git commit -m "feat(composition): load trusted modules at startup"
```

---

## Task 7: Drive the orchestrator's who-may-use from the port

**Files:**

- Modify: `src/llm-orchestrator-tools.ts`

This is a behavior-preserving swap: the orchestrator stops importing the coding feature and reads the allowlist through `operatorAllowlistPort`. At startup the coding module (Task 6) has already registered the real resolver, so the resolved value is identical; when no module is loaded (or in unit tests that don't load modules), the port's default `'members'` matches `resolveCodingGuardrails`'s historical default.

- [ ] **Step 1: Confirm no test couples to the old import**

Run: `rg -n "resolveCodingGuardrails" tests`
Expected: hits only in `tests/coding-credentials/guardrails.test.ts` and `tests/coding-credentials/resolve-agent-secrets.test.ts` (they test the function directly — untouched by this swap). No orchestrator test references it. `tests/llm-orchestrator-who-may-use.test.ts` calls `applyWhoMayUseFilter` with an explicit `whoMayUse` argument (it does not go through the port), so it is unaffected.

- [ ] **Step 2: Make the edit**

In `src/llm-orchestrator-tools.ts`:

(a) Delete the import (currently line 14):

```ts
import { resolveCodingGuardrails } from './coding-credentials/guardrails.js'
```

(b) Add, alongside the other `./ports/` import (there is already `import { toolGateRegistry, type ToolGateRegistry } from './ports/tool-gate.js'` — place this near it, respecting import ordering):

```ts
import { operatorAllowlistPort } from './ports/operator-allowlist.js'
```

(c) In `buildFullToolSet`, replace the gating line (currently line 220):

```ts
const gatedTools =
  pi === undefined ? prefTools : applyWhoMayUseFilter(prefTools, resolveCodingGuardrails(pi).whoMayUse, chatUserId)
```

with:

```ts
const gatedTools =
  pi === undefined ? prefTools : applyWhoMayUseFilter(prefTools, operatorAllowlistPort.resolve(pi), chatUserId)
```

- [ ] **Step 3: Verify the coding import is gone and the suite is green**

Run: `rg -n "resolveCodingGuardrails|coding-credentials" src/llm-orchestrator-tools.ts`
Expected: no output.

Run: `bun test tests/llm-orchestrator-tools.test.ts tests/llm-orchestrator-who-may-use.test.ts`
Expected: PASS (no regressions — both suites still green).

- [ ] **Step 4: Commit**

```bash
git add src/llm-orchestrator-tools.ts
git commit -m "refactor(orchestrator): resolve who-may-use via OperatorAllowlistPort, drop coding import"
```

---

## Task 8: Extend the architecture guard

**Files:**

- Modify: `tests/architecture-guard.test.ts`

Lock the two wins this plan produced: `src/ports/**` must not name the coding feature, and the orchestrator must no longer couple to `coding-credentials`.

- [ ] **Step 1: Read the current guard**

Read `tests/architecture-guard.test.ts`. It currently defines `FEATURE_NAMES = /\b(kaneo|youtrack|magi)\b|plugin_acp__/iu`, a `scan(pattern)` helper over `src/ports/**/*.ts`, and two tests (ports feature-agnostic; orchestrator no longer names acp tools).

- [ ] **Step 2: Extend the banned-name set and add the orchestrator assertion**

(a) Add `coding` (word-boundary) to `FEATURE_NAMES`:

```ts
// Feature/provider names that must never appear in feature-agnostic core.
// Word boundaries so `magi` does not match "imaging" and `coding` does not match "encoding".
const FEATURE_NAMES = /\b(kaneo|youtrack|magi|coding)\b|plugin_acp__/iu
```

(b) Add a new test inside the existing `describe('architecture guard: core never names a feature', …)` block:

```ts
test('llm-orchestrator-tools.ts no longer couples to the coding feature', () => {
  const text = readFileSync('src/llm-orchestrator-tools.ts', 'utf8')
  expect(/coding-credentials|resolveCodingGuardrails/u.test(text)).toBe(false)
})
```

> Do not change the existing `src/ports/**` scan test or the existing `plugin_acp__` orchestrator assertion — only add `coding` to the shared regex and add the new test. Adding `coding` is safe: `src/ports/tool-gate.ts`, `src/ports/operator-allowlist.ts`, and `src/ports/module.ts` contain no `coding` word (verify in the next step).

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test tests/architecture-guard.test.ts`
Expected: PASS (3 tests). If the `src/ports/**` test fails, a ports file leaked the word `coding` — fix the port, do not weaken the regex. If the new orchestrator test fails, Task 7 was not completed.

- [ ] **Step 4: Commit**

```bash
git add tests/architecture-guard.test.ts
git commit -m "test(architecture): ban 'coding' in ports and lock orchestrator decoupling"
```

---

## Task 9: Full verification

- [ ] **Step 1: Build client bundles (needed by the debug suite) and run the full test suite**

The `tests/debug/*` suites require built client bundles in `public/`. If they are not present, build them first:

```bash
bun build:client
```

Run: `bun test`
Expected: PASS. Pay attention to the plugin, orchestrator, composition, ports, modules, and db suites — none should regress. (If `tests/debug/*` fail with "Missing client bundles in public/", run `bun build:client` and re-run.)

- [ ] **Step 2: Run the full check pipeline**

Run: `bun check:full`
Expected: all checks pass (lint, typecheck, format:check, license-headers, knip, tests, and the review-loop/client checks). Fix any format issues with `bun run format` and re-run.

> Note: if `knip` flags `operatorAllowlistPort`, `loadTrustedModules`, `applyModuleMigrations`, `codingModule`, or `TrustedModule` as unused, a wiring step (Task 6 or 7) was skipped — trace the caller rather than deleting the export.

- [ ] **Step 3: Manual startup spot-check (optional)**

Confirm the process boots cleanly (module load runs after `initDb`): the coding module's `onActivate` registers the resolver with no error in logs. In a group where coding guardrails set a restricted `whoMayUse` list, confirm a non-operator user still loses exactly the five acp session-action tools and an operator still sees them — identical to pre-refactor behavior (now resolved via the port + module rather than a direct orchestrator import).

- [ ] **Step 4: Final formatting commit (if any format fixes were applied)**

```bash
git add -A
git commit -m "chore: formatting for phase 2 module foundation"
```

---

## Done criteria

- `rg -n "resolveCodingGuardrails|coding-credentials" src/llm-orchestrator-tools.ts` → no output.
- `bun test tests/architecture-guard.test.ts` → green (3 tests, incl. `coding` now banned in `src/ports/**`).
- `bun check:full` → green.
- The Trusted Module system exists and is exercised: `src/ports/module.ts`, `src/composition/{trusted-modules,load-trusted-modules}.ts`, and `src/modules/coding/module.ts` are wired from `src/index.ts` via `loadTrustedModules()` after `initDb()`; the migration path is unit-tested with a fake module (`applyModuleMigrations` + loader migrate-before-activate ordering).
- Operator who-may-use gating is unchanged: the orchestrator resolves the allowlist through `OperatorAllowlistPort`, populated by the coding module's `onActivate()` (`resolveCodingGuardrails(pi).whoMayUse`), with a `'members'` default that matches the historical unset behavior.
- The next plan (Phase 2b — Coding module relocation) can now move `src/coding-credentials/` + `src/coding-repos/` into `src/modules/coding/`, give the coding module real `migrations` (relocating the `061`/`064`/`065`/`066` table ownership via `ModuleLifecycle`), and extend the architecture guard to broader globs — building on the module loader, composition root, and `applyModuleMigrations` established here.
