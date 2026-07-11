<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Hermetic E2E Core-Separation Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebase `plugin-core-separation` onto the hermetic master baseline and prove the unchanged harness passes through the trusted-module architecture.

**Architecture:** Preserve `PapaiRuntime` and every file under `tests/stories/**`. Add trusted-module activation and symmetric teardown behind production runtime dependencies, carry stable capability ids from the former ACP plugin to the coding module, include module-owned migrations in fresh worlds, and run compatibility mode against the explicit baseline SHA.

**Tech Stack:** Bun 1.3.x, TypeScript, existing trusted-module ports, hermetic story runner and manifest produced by the master-baseline plan.

**Depends on:** `docs/superpowers/plans/2026-07-12-hermetic-e2e-master-baseline.md` completed and merged into the base of `plugin-core-separation`.

---

## Hard proof rule

No task in this plan may modify, regenerate, or reformat any file under `tests/stories/**`. Before every commit, run the manifest comparison and `git diff --exit-code <baseline-sha> -- tests/stories`. A failure is a product/runtime incompatibility to diagnose, not permission to patch the harness.

### Task 1: Rebase onto the recorded baseline and verify the frozen harness

**Files:**

- No source modifications
- Read: `reports/stories/manifest.json` from the baseline CI artifact

- [ ] **Step 1: Record the explicit baseline**

Set `BASELINE_SHA` to the committed master baseline from Plan 1. Verify it contains `src/runtime/create-runtime.ts` and `tests/stories/harness/world.ts`:

```bash
git cat-file -e "$BASELINE_SHA:src/runtime/create-runtime.ts"
git cat-file -e "$BASELINE_SHA:tests/stories/harness/world.ts"
```

Expected: both commands exit 0.

- [ ] **Step 2: Rebase the refactor commits onto the recorded baseline**

In the `plugin-core-separation` worktree, identify the pre-refactor base and rebase the branch commits:

```bash
OLD_BASE=$(git merge-base plugin-core-separation "$BASELINE_SHA")
git rebase --onto "$BASELINE_SHA" "$OLD_BASE" plugin-core-separation
```

Resolve production-code conflicts by preserving the master `PapaiRuntime` public contract and moving trusted-module loading behind production deps. Do not resolve a `tests/stories/**` conflict by editing those files; restore their exact baseline blobs before continuing.

- [ ] **Step 3: Verify the frozen tree before code changes**

Run:

```bash
BASE_REF="$BASELINE_SHA" bun test:stories:compat --manifest-only
git diff --exit-code "$BASELINE_SHA" -- tests/stories
```

Expected: both commands exit 0. If either fails, stop and correct the integration before continuing.

- [ ] **Step 4: Run the unchanged stories to expose real incompatibilities**

Run: `BASE_REF="$BASELINE_SHA" bun test:stories:compat`

Expected at this stage: failures may report missing module cleanup, missing `coding-session.*` capability ids, or module migrations. Save the sanitized report as the RED evidence.

### Task 2: Make trusted-module activation symmetrically disposable

**Files:**

- Modify: `src/ports/module.ts`
- Modify: `src/composition/load-trusted-modules.ts`
- Modify: `src/ports/operator-allowlist.ts`
- Modify: `src/ports/membership-store.ts`
- Modify: `src/modules/coding/module.ts`
- Modify: `src/modules/task-tracker/module.ts`
- Modify: `tests/composition/load-trusted-modules.test.ts`
- Modify: `tests/modules/coding/module.test.ts`
- Modify: `tests/modules/task-tracker/module.test.ts`
- Modify: `tests/ports/operator-allowlist.test.ts`
- Modify: `tests/ports/membership-store.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Add tests proving:

- module cleanups run once in reverse activation order;
- contribution registries clear on cleanup;
- coding cleanup resets the operator allowlist to `'members'`;
- task-tracker cleanup unregisters the event subscriber and resets membership store/resolver;
- a failed later activation cleans already-activated modules.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
bun test tests/composition/load-trusted-modules.test.ts tests/modules/coding/module.test.ts tests/modules/task-tracker/module.test.ts tests/ports/operator-allowlist.test.ts tests/ports/membership-store.test.ts
```

Expected: FAIL because `TrustedModule.onActivate` cannot return cleanup and the two ports cannot reset.

- [ ] **Step 3: Extend the lifecycle contract**

Change the module contract to:

```typescript
export type ModuleCleanup = () => void | Promise<void>

export interface TrustedModule {
  readonly id: string
  readonly migrations?: readonly Migration[]
  readonly tools?: readonly ModuleTool[]
  readonly commands?: readonly ModuleCommand[]
  readonly promptFragments?: readonly ModulePromptFragment[]
  readonly settingsSections?: readonly SettingsSection[]
  readonly isEligibleForContext?: ModuleEligibilityPredicate
  onActivate?(): void | ModuleCleanup | Promise<void | ModuleCleanup>
}
```

Make `loadTrustedModules` return:

```typescript
export type LoadedTrustedModules = Readonly<{ stop(): Promise<void> }>
```

Collect returned cleanups, then add one cleanup that clears module tool, command, prompt, settings, and eligibility registries. On activation failure, stop the partial result before rethrowing.

- [ ] **Step 4: Add explicit port reset operations**

Add `reset(): void` to both ports. `OperatorAllowlistPort.reset()` restores the default resolver. `MembershipStorePort.reset()` clears the store and restores the no-op label resolver.

The coding module returns `() => operatorAllowlistPort.reset()`.

The task-tracker module retains and returns cleanup:

```typescript
onActivate(): () => void {
  membershipStorePort.register(taskProviderMembershipStore)
  const unsubscribe = registerMembershipSubscriber({
    ensure: (groupContextId, chatUserId) => membershipStorePort.ensureMember(groupContextId, chatUserId),
    markInactive: (groupContextId, chatUserId) => {
      membershipStorePort.markMemberInactive(groupContextId, chatUserId)
      return Promise.resolve()
    },
  })
  return () => {
    unsubscribe()
    membershipStorePort.reset()
  }
}
```

- [ ] **Step 5: Verify focused lifecycle tests**

Run the command from Step 2. Expected: exit 0.

- [ ] **Step 6: Verify frozen harness and commit**

```bash
BASE_REF="$BASELINE_SHA" bun test:stories:compat --manifest-only
git diff --exit-code "$BASELINE_SHA" -- tests/stories
git add src/ports src/composition src/modules tests/composition tests/modules tests/ports
git commit -m "feat(modules): add symmetric trusted-module lifecycle"
```

### Task 3: Load trusted modules behind the existing `PapaiRuntime`

**Files:**

- Modify: `src/runtime/production-deps.ts`
- Modify: `src/composition/load-trusted-modules.ts`
- Modify: `src/index.ts` only if rebase left direct module loading there
- Modify: `tests/runtime/production-deps.test.ts`
- Modify: `tests/index-startup.test.ts`

- [ ] **Step 1: Write failing runtime-order tests**

Assert this extension order:

```typescript
expect(events).toEqual([
  'database:start',
  'modules:migrate-and-activate',
  'plugins:discover-and-activate',
  'bot:setup',
  'chat:start',
])
```

Assert shutdown reverses the extension portion: plugins deactivate before trusted modules stop. Assert module activation failure prevents plugin activation and still closes the database.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/runtime/production-deps.test.ts tests/index-startup.test.ts`

Expected: FAIL while `src/index.ts` or another branch-specific path loads modules outside runtime ownership.

- [ ] **Step 3: Compose module and plugin phases in production deps**

The production `extensions.start` must call `loadTrustedModules()` first, retain its `LoadedTrustedModules`, then execute the existing plugin discovery/compatibility/activation phase. `extensions.stop` deactivates plugins and then calls `loadedModules.stop()`.

Remove direct `loadTrustedModules()` from `src/index.ts`. Do not change `PapaiRuntime`, `ScenarioWorld`, or any file under `tests/stories/**`.

- [ ] **Step 4: Verify runtime and architecture guards**

Run:

```bash
bun test tests/runtime/production-deps.test.ts tests/index-startup.test.ts tests/architecture-guard.test.ts
bun typecheck
```

Expected: exit 0.

- [ ] **Step 5: Verify frozen harness and commit**

```bash
BASE_REF="$BASELINE_SHA" bun test:stories:compat --manifest-only
git diff --exit-code "$BASELINE_SHA" -- tests/stories
git add src/runtime/production-deps.ts src/composition/load-trusted-modules.ts src/index.ts tests/runtime/production-deps.test.ts tests/index-startup.test.ts
git commit -m "refactor(composition): own modules in PapaiRuntime"
```

### Task 4: Preserve coding-session capability ids through module tools

**Files:**

- Modify: `src/ports/module-tools.ts`
- Modify: `src/tools/module-tool-set.ts`
- Modify: `src/modules/coding/acp/contributions.ts`
- Modify: `src/modules/coding/acp/tools.ts`
- Modify: `src/modules/coding/acp/session-tools.ts`
- Modify: `src/modules/coding/acp/continue-tool.ts`
- Modify: `tests/tools/module-tool-set.test.ts`
- Modify: `tests/modules/coding/acp/contributions.test.ts`

- [ ] **Step 1: Write failing capability preservation tests**

Assert that the coding module declares the same ids established on master, including `coding-session.start`, and that `buildModuleToolSet` registers `module_coding__start_session` for that id in the runtime catalog. Assert duplicates fail.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/tools/module-tool-set.test.ts tests/modules/coding/acp/contributions.test.ts`

Expected: FAIL because `ModuleTool` lacks `capabilityId` and module tool assembly does not receive the catalog.

- [ ] **Step 3: Extend module contribution metadata**

Add optional `capabilityId?: string` to `ModuleTool`. Thread the same `ToolCapabilityCatalog` used by plugin/core tool assembly into `buildModuleToolSet`; register capability ids after collision and eligibility checks and before wrapping execution.

Assign the exact `coding-session.*` ids from the master ACP implementation to corresponding coding-module tools. Do not restore `plugin_acp__*` wire names; focused preference-migration tests continue proving the intentional namespace migration.

- [ ] **Step 4: Verify focused tests and the unchanged coding-session story**

Run:

```bash
bun test tests/tools/module-tool-set.test.ts tests/modules/coding/acp/contributions.test.ts
BASE_REF="$BASELINE_SHA" bun test:stories:compat --test-name-pattern "coding session"
```

Expected: exit 0. The story source remains unchanged while fake magi observes the same semantic request.

- [ ] **Step 5: Verify frozen harness and commit**

```bash
BASE_REF="$BASELINE_SHA" bun test:stories:compat --manifest-only
git diff --exit-code "$BASELINE_SHA" -- tests/stories
git add src/ports/module-tools.ts src/tools/module-tool-set.ts src/modules/coding/acp tests/tools/module-tool-set.test.ts tests/modules/coding/acp/contributions.test.ts
git commit -m "feat(coding): preserve behavioral capability ids"
```

### Task 5: Prove module migrations and complete compatibility evidence

**Files:**

- Modify: `tests/utils/test-helpers.ts` only if the rebase did not retain the branch's trusted-module migration passes
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/architecture/commands.md`
- Modify: `tests/CLAUDE.md`
- Test: `tests/db/module-migrations.test.ts`

- [ ] **Step 1: Verify the fresh DB includes module migrations**

Run the existing branch tests that assert `setupTestDb()` applies core migrations followed by each trusted module's migration pass. If the rebase lost that behavior, restore the branch implementation using `TRUSTED_MODULES.map((module) => module.migrations)` in the snapshot cache key and migration passes.

- [ ] **Step 2: Run the entire unchanged compatibility suite**

```bash
BASE_REF="$BASELINE_SHA" bun test:stories:compat
BASE_REF="$BASELINE_SHA" bun test:stories:compat --seed 41021
BASE_REF="$BASELINE_SHA" bun test:stories:compat --rerun-each 10
```

Expected: all commands exit 0 and report the same `tests/stories/**` manifest hash as the baseline.

- [ ] **Step 3: Run full branch verification**

```bash
bun build:client
bun run test
bun test:client
bun check:full
```

Expected: exit 0.

- [ ] **Step 4: Add the refactor compatibility CI invocation**

For the refactor PR job, pass the actual base SHA as `BASE_REF`, run `bun test:stories:compat`, and upload baseline/candidate SHAs, manifest, JUnit results, and sanitized failure traces on `always()`. Do not retry.

- [ ] **Step 5: Document the proof**

Record in architecture/test docs:

- baseline SHA;
- candidate SHA;
- identical manifest hash;
- deterministic seed;
- commands used;
- ACP plugin → coding module is an internal implementation change while scenario checkpoints are unchanged.

- [ ] **Step 6: Final frozen-tree check and commit**

```bash
BASE_REF="$BASELINE_SHA" bun test:stories:compat --manifest-only
git diff --exit-code "$BASELINE_SHA" -- tests/stories
git add tests/utils/test-helpers.ts .github/workflows/ci.yml docs/architecture/commands.md tests/CLAUDE.md tests/db/module-migrations.test.ts
git commit -m "ci(stories): prove core-separation compatibility"
```

## Proof completion gate

The refactor is behaviorally qualified only when:

- the compatibility manifest matches the explicit master baseline;
- no file under `tests/stories/**` differs;
- all unchanged walking-skeleton stories pass without retries;
- module/plugin startup and teardown are symmetric;
- the coding-session story reaches the real coding module and fake magi;
- module-owned migrations are present in every fresh scenario DB;
- full branch checks pass;
- CI artifacts record both SHAs, the common manifest hash, seed, and named checkpoints.
