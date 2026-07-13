<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Trusted-Module Hermetic Qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a frozen, production-composition story contract for the trusted-module seams that `plugin-core-separation` must satisfy after rebasing onto the hermetic baseline.

**Architecture:** First add a feature-neutral runtime-extension test seam to the hermetic baseline; it has no product behavior when unused. Baseline stories use that seam through `ScenarioWorld`, not internal registries. The refactor later binds its trusted-module loader, registries, ACP module, and settings sections to the same runtime contract and proves compatibility without changing the frozen story tree.

**Tech Stack:** Bun, TypeScript, `bun:test`, existing `PapaiRuntime`, `ScenarioWorld`, scripted LLM, strict HTTP dispatcher, fake Magi, trusted-module ports on `plugin-core-separation`.

**Design:** `docs/superpowers/specs/2026-07-13-trusted-module-hermetic-qualification-design.md`

---

## Scope boundary

This plan does not migrate production features or mark the full scenario catalog executable. It creates the qualification contract and then integrates the refactor with it. New stories must remain frozen baseline inputs; all refactor-side behavior is implemented under `src/` and `plugins/` only after rebase.

## File structure

- Create `tests/stories/harness/runtime-extension.ts` — feature-neutral extension lifecycle contract used only by the scenario runtime.
- Modify `tests/stories/harness/world.ts` — accepts declared test extensions and starts/stops them through the production runtime lifecycle boundary.
- Modify `tests/stories/harness/scenario.ts` — exposes a narrow `given.runtimeExtension()` setup operation.
- Create `tests/stories/integrations/runtime-extensions/{tool-eligibility,command-prompt,lifecycle}.story.test.ts` — frozen baseline behavior for contribution visibility, execution, and isolation.
- Create `tests/stories/settings/runtime-extension-settings.story.test.ts` — authorization, persistence, and next-turn effect contract.
- Modify `tests/stories/harness/fake-magi.ts` only if an exact missing ACP protocol endpoint is needed.
- Modify `tests/stories/catalog/coverage.ts` only after each literal scenario is committed and manifest-resolvable.
- On `plugin-core-separation`, modify production composition/ports/modules named by `docs/superpowers/plans/2026-07-12-hermetic-e2e-core-separation-proof.md`; do not modify frozen inputs.

## Tasks

### Task 1: Define the neutral scenario runtime-extension seam on the baseline

**Files:**

- Create: `tests/stories/harness/runtime-extension.ts`
- Modify: `tests/stories/harness/world.ts`
- Modify: `tests/stories/harness/world.test.ts`

- [ ] **Step 1: Write failing lifecycle contract tests**

Add tests that construct a world with two extensions and assert start order, reverse stop order, partial-start rollback, and no invocation when no extension is declared.

```typescript
expect(events).toEqual(['first:start', 'second:start', 'second:stop', 'first:stop'])
```

- [ ] **Step 2: Verify RED**

Run:

```bash
bun scripts/test-stories.ts --contracts --fixture tests/stories/harness/world.test.ts
```

Expected: FAIL because `ScenarioWorldOptions` has no runtime-extension contract.

- [ ] **Step 3: Implement the minimal contract**

Create the extension type:

```typescript
export type ScenarioRuntimeExtension = Readonly<{
  start(): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>
}>
```

Add `runtimeExtensions?: readonly ScenarioRuntimeExtension[]` to `ScenarioWorldOptions`. Start extensions after database setup and before production extension startup; retain cleanup callbacks and execute them in reverse order during `world.stop()`. If a later start fails, run retained callbacks before propagating the failure. With no extensions, preserve the existing lifecycle exactly.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
bun scripts/test-stories.ts --contracts --fixture tests/stories/harness/world.test.ts
bun test:stories:contracts
bun typecheck
git add tests/stories/harness/runtime-extension.ts tests/stories/harness/world.ts tests/stories/harness/world.test.ts
git commit -m "test(stories): add runtime extension fixture seam"
```

Expected: all commands exit 0.

### Task 2: Expose stable contribution fixtures through ScenarioWorld

**Files:**

- Create: `tests/stories/harness/runtime-extension.test.ts`
- Modify: `tests/stories/harness/scenario.ts`
- Modify: `tests/stories/harness/scenario.test.ts`

- [ ] **Step 1: Write failing public-API tests**

Add a fixture extension that registers one tool, one command, and one prompt marker through the neutral seam. Assert `given.runtimeExtension()` is permitted only before startup and the same setup after `when.message()` fails through `assertPrerequisitesOpen`.

```typescript
expect(() => given.runtimeExtension(extension)).not.toThrow()
await when.message(alice, dm, 'hello')
expect(() => given.runtimeExtension(extension)).toThrow('Scenario prerequisites are closed')
```

- [ ] **Step 2: Verify RED**

Run:

```bash
bun scripts/test-stories.ts --contracts --fixture tests/stories/harness/scenario.test.ts
```

Expected: FAIL because the public setup operation does not exist.

- [ ] **Step 3: Implement the narrow API**

Add `runtimeExtension(extension: ScenarioRuntimeExtension): void` to `ScenarioGiven`. It must call the existing prerequisite guard and append to the world-owned extension list. Do not expose registries, execute callbacks directly, or expose a generic production dependency override.

- [ ] **Step 4: Verify GREEN and commit**

```bash
bun scripts/test-stories.ts --contracts --fixture tests/stories/harness/runtime-extension.test.ts
bun scripts/test-stories.ts --contracts --fixture tests/stories/harness/scenario.test.ts
bun test:stories:contracts
git add tests/stories/harness/runtime-extension.test.ts tests/stories/harness/scenario.ts tests/stories/harness/scenario.test.ts
git commit -m "test(stories): expose runtime extension setup"
```

Expected: all commands exit 0.

### Task 3: Freeze tool eligibility and command/prompt contribution stories

**Files:**

- Create: `tests/stories/integrations/runtime-extensions/tool-eligibility.story.test.ts`
- Create: `tests/stories/integrations/runtime-extensions/command-prompt.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

- [ ] **Step 1: Write failing literal stories**

Create a synthetic extension that contributes a capability with an eligibility predicate, a command, and a prompt marker. The eligible tool story must script the capability call and assert a reply plus an extension event. The ineligible branch must assert all model inspections exclude the wire tool and the event is absent.

```typescript
scenario(
  'SCN-module-tool-eligibility executes eligible extension tool and hides it when ineligible',
  async ({ given, when, then, world }) => {
    // configure an eligible context, script capability call + answer, then assert reply/event
    // send the same request in an ineligible context and assert no offered tool/event
  },
)
```

The command/prompt story asserts the command reply and `promptTextFingerprint('trusted-extension-marker')`; the ineligible context receives neither contribution.

- [ ] **Step 2: Verify RED**

```bash
bun test:stories -- tests/stories/integrations/runtime-extensions/tool-eligibility.story.test.ts tests/stories/integrations/runtime-extensions/command-prompt.story.test.ts
```

Expected: FAIL until the neutral extension seam participates in real tool, command, and prompt assembly.

- [ ] **Step 3: Bind the neutral baseline extension through production assembly**

Implement only the adapter required for test extensions to enter the same tool/command/prompt assembly path as production contributions. The adapter must preserve existing plugin ordering, tool wrapping, gate behavior, context scope, and error formatting. It must be inert when no extension is declared.

- [ ] **Step 4: Mark only literal stories executable and commit**

```bash
bun test:stories -- tests/stories/integrations/runtime-extensions
bun test:stories:contracts
bun test:stories:manifest
git add tests/stories/integrations/runtime-extensions tests/stories/catalog/coverage.ts
git commit -m "test(stories): freeze contribution qualification stories"
```

Expected: the manifest contains both literal `SCN-module-*` entries; ledger entries point to their exact manifest IDs.

### Task 4: Freeze coding-session and module-settings qualification stories

**Files:**

- Create: `tests/stories/integrations/coding-sessions/module-qualification.story.test.ts`
- Create: `tests/stories/settings/module-settings-qualification.story.test.ts`
- Modify: `tests/stories/harness/fake-magi.ts` only for an observed missing endpoint
- Modify: `tests/stories/catalog/coverage.ts`

- [ ] **Step 1: Write failing ACP safety stories**

Use existing `given.codingSession`, `given.llm`, and fake Magi. Add success, missing-config, denied actor, guest actor, and declared upstream failure cases. Success asserts a session record and exactly one expected fake request; every failure asserts no session record and no undesired request.

```typescript
scenario(
  'SCN-coding-module-start refuses missing configuration without calling Magi',
  async ({ given, when, then, world }) => {
    // do not configure coding credentials; request start; assert error reply and no magi.session.start event
  },
)
```

- [ ] **Step 2: Write failing settings round-trip story**

Use `given.settingsSession()` and `when.settingsRequest()` to make an authorized module-settings mutation, read it back, then send the next chat request and assert changed offered contribution or behavior. Add one unauthenticated, CSRF-less, malformed, or cross-context request per mutation route and assert no persisted change.

- [ ] **Step 3: Verify RED**

```bash
bun test:stories -- tests/stories/integrations/coding-sessions/module-qualification.story.test.ts tests/stories/settings/module-settings-qualification.story.test.ts
```

Expected: FAIL until the production module route/contribution path is available on the baseline adapter.

- [ ] **Step 4: Implement only exact fake/fixture support, verify, and commit**

```bash
bun test:stories:contracts
bun test:stories -- tests/stories/integrations/coding-sessions/module-qualification.story.test.ts tests/stories/settings/module-settings-qualification.story.test.ts
bun test:stories:stress
git add tests/stories/integrations/coding-sessions tests/stories/settings tests/stories/harness/fake-magi.ts tests/stories/catalog/coverage.ts
git commit -m "test(stories): freeze coding module qualification"
```

Expected: all commands exit 0; fake events contain no Magi or provider secrets.

### Task 5: Rebase and qualify plugin-core-separation without changing frozen inputs

**Files:**

- Modify on refactor branch: `src/composition/load-trusted-modules.ts`, `src/runtime/production-deps.ts`, `src/modules/coding/*`, `src/modules/task-tracker/*`, and ports only where the frozen stories expose a production incompatibility.
- Verify unchanged on refactor branch: `tests/stories/**`, `scripts/test-stories.ts`, `scripts/story-manifest*.ts`, `scripts/story-runner*.ts`, `tests/setup.ts`, `tests/mock-reset.ts`, `tests/utils/test-helpers.ts`, `tests/utils/logger-mock.ts`, and `bunfig.toml`.

- [ ] **Step 1: Rebase the refactor onto the baseline commit containing Tasks 1–4**

```bash
OLD_BASE=$(git merge-base plugin-core-separation <baseline-sha>)
git rebase --onto <baseline-sha> "$OLD_BASE" plugin-core-separation
```

Resolve production conflicts without modifying frozen inputs.

- [ ] **Step 2: Demonstrate the frozen tree is byte-identical**

```bash
BASE_REF=<baseline-sha> bun test:stories:compat --manifest-only
git diff --exit-code <baseline-sha> -- tests/stories scripts/test-stories.ts scripts/story-manifest.ts scripts/story-manifest-candidate.ts scripts/story-manifest-scenarios.ts scripts/story-reports.ts bunfig.toml tests/setup.ts tests/mock-reset.ts tests/utils/test-helpers.ts tests/utils/logger-mock.ts
```

Expected: both commands exit 0.

- [ ] **Step 3: Use RED compatibility failures to repair production composition only**

Run:

```bash
BASE_REF=<baseline-sha> bun test:stories:compat
```

Expected before final integration: a sanitized failure identifying the missing production lifecycle, module contribution, settings, or capability bridge. Repair only the affected `src/`/`plugins/` composition path, then rerun until green.

- [ ] **Step 4: Run final qualification and commit refactor-side fixes**

```bash
BASE_REF=<baseline-sha> bun test:stories:compat
bun test:stories:contracts
bun test:stories
bun test:stories:stress
bun test tests/architecture-guard.test.ts tests/composition/load-trusted-modules.test.ts
bun typecheck
git add src plugins tests -- ':!tests/stories/**'
git commit -m "test(modules): qualify trusted module composition"
```

Expected: all commands exit 0; the compatibility report uses the frozen baseline and no frozen file differs.

## Plan self-review

- Tasks 1–2 create only neutral, baseline-compatible test infrastructure.
- Tasks 3–4 establish required user/composition/safety stories and update ledger references only after literal manifest IDs exist.
- Task 5 performs the refactor-side compatibility proof without modifying frozen inputs.
- Provider/proactive/nerv catalog coverage is intentionally absent from this phase and remains pending.
