# Execution Order Recommendation: Provider Abstraction Leaks, Architecture Violations, and Plugin System

> Analysis of three interdependent plans targeting the same infrastructure surface, written after verifying implementation completeness against the current codebase. Captures dependency chains, partial implementations, and the correct sequencing for remediation.

---

## The Three Plans

| Plan                                    | File                                                                       | Status             | When Written                    | Implementation State                                    |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------ | ------------------------------- | ------------------------------------------------------- |
| **Layered Architecture Violations Fix** | `docs/superpowers/plans/2026-03-26-layered-architecture-violations-fix.md` | ❌ Not implemented | 2026-03-26                      | 0/12 tasks completed                                    |
| **Fix Provider Abstraction Leaks**      | `docs/superpowers/plans/2026-03-30-fix-provider-abstraction-leaks.md`      | ❌ Not implemented | 2026-03-30                      | 0/9 tasks completed                                     |
| **Plugin System Implementation**        | `docs/superpowers/plans/2026-03-30-plugin-system-implementation.md`        | ✅ Implemented     | 2026-03-30 (revised 2026-04-25) | All 13 phases completed (commit `225f8347`, 2026-04-25) |

---

## Execution Order (What Should Have Happened)

```
Phase A ──► Fix Provider Abstraction Leaks (2026-03-30)
   │          ├── Task 4: Generic workspace functions (getWorkspaceId/setWorkspaceId) ← FOUNDATION
   │          ├── Task 1: Add provisionUser?() and ProvisioningResult to TaskProvider
   │          ├── Task 2: Implement provisionUser in KaneoProvider
   │          ├── Task 3: Remove provider-specific imports from llm-orchestrator.ts
   │          ├── Tasks 5–8: Update factory, scheduler, wizard, admin commands
   │          └── Task 9: Verification
   │
   └──► Phase B ──► Layered Architecture Violations Fix (2026-03-26, updated)
              ├── Phase 2–3: Remove direct DB access from history.ts / memory.ts
              ├── Phase 4: Extract createMissedTasks to break tools→scheduler→ChatProvider leak
              ├── Phase 5–7: Consolidate LLM orchestration (proactive-llm.ts → llm-orchestrator.ts)
              ├── Phase 8: Remove provider-specific errors from orchestrator
              └── Phase 9–12: Verification, deferred-prompt tool move, docs

Phase C ──► Plugin System Implementation (2026-03-30, revised)
              └── Build on clean abstractions: generic workspace, provider-agnostic provisioning,
                  consolidated LLM building, no cross-layer tool imports.
```

**What actually happened:** The plugin system was implemented **out of order** — it landed on top of the existing leaks and violations. That commit is `225f8347` (dated 2026-04-25); neither of the prerequisite plans had been touched. The plugin system works today but inherits all of the underlying technical debt catalogued below.

---

## Why Provider Abstraction Must Come First

### The provider plan creates interfaces the other two consume

| Plan                              | Depends On      | Specific Dependency                                                                                                                                                                                                                  |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture Violations (Phase 4) | Provider Task 4 | `getWorkspaceId()` / `setWorkspaceId()` — the scheduler's duplicate `buildProviderForUser` currently calls `getKaneoWorkspace`, which the architecture plan wants to delete                                                          |
| Architecture Violations (Phase 8) | Provider Task 3 | `KaneoClassifiedError` / `YouTrackClassifiedError` removal — the architecture plan's Task 8 explicitly tries to remove these from `llm-orchestrator.ts`; the provider plan provides the replacement (`ProviderClassifiedError` only) |
| Plugin System                     | Provider Task 1 | `TaskCapability` union — the plugin system uses `requiredTaskCapabilities: TaskCapability[]` for compatibility checks. Adding `'provisioning'` to this union is the provider plan's Task 1                                           |
| Plugin System                     | Provider Task 7 | `ProviderMetadata` — plugin system display code (`/config`, diagnostics) would benefit from provider display names and token labels on the `TaskProvider` interface itself                                                           |

### Consequences of doing it out of order

The plugin system commit (`225f8347`) **worked around** the leaks instead of fixing them:

- `src/tools/index.ts` still imports `buildProviderForUser` from `src/providers/factory.ts`, which still imports `getKaneoWorkspace`. Plugin tools are merged into the same tool pipeline that depends on this leak.
- `src/llm-orchestrator.ts` still imports `maybeProvisionKaneo` from `./providers/kaneo/provision.js` and `getKaneoWorkspace` from `./users.js`. Plugin tool resolution runs **after** this leak, meaning a broken provider build here also crashes plugin tool availability.
- `buildSystemPrompt(provider, contextId)` is called by both the proactive-LLM path (architecture plan Phase 5) and the plugin prompt-fragment path (plugin plan Phase 8). The provider plan's `ProviderMetadata` addition would give both a cleaner way to inject provider names/labels.

---

## Why Architecture Violations Should Come Second

### The architecture plan establishes boundaries the plugin system now extends

| Architecture Phase                                           | What It Fixes                                                                                   | How Plugin System Re-uses It                                                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Phase 2–3 (`history.ts`, `memory.ts`)                        | Removes `getDrizzleDb` + `drizzle-orm` from application layer                                   | Plugin system added `src/plugins/store.ts` (KV storage) which also touches DB — the same pattern should apply                  |
| Phase 4 (`recurring-missed.ts`)                              | Breaks `tools/resume-recurring-task.ts` → `scheduler.ts` → `ChatProvider` transitive dependency | Plugin system adds `src/plugins/loader.ts` which constructs provider facades — a similar bridge-module concern                 |
| Phase 5–7 (LLM consolidation)                                | Centralises `createOpenAICompatible`, `persistFactsFromResults`, history trim                   | Plugin tool execution goes through the same `makeTools`/`invokeModelWithTyping` pipeline; consolidation benefits plugins       |
| Phase 8 (error class cleanup)                                | Removes `KaneoClassifiedError` / `YouTrackClassifiedError` from orchestrator                    | Plugin tools throw errors that bubble through the same orchestrator error-handling path                                        |
| Phase 9–10 (tool definition location, `commands/context.ts`) | Moves deferred-prompt tools to `src/tools/`, removes `ai` SDK from commands                     | Plugin system added `src/commands/plugin.ts` and `src/chat/plugin-interaction-handler.ts` — these should follow the same rules |

### New violations introduced by the plugin system

The original architecture plan was written for a **pre-plugin** codebase. The plugin commit (`225f8347`) added files that create violations the original plan never catalogued:

| New File                                 | Violation                                                                             | Severity                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------- |
| `src/plugins/loader.ts`                  | Dynamic imports in application layer; builds provider facades (bridge-module pattern) | LOW (same accepted pattern as `factory.ts`) |
| `src/plugins/registry.ts`                | State machine mixing DB persistence + runtime state                                   | LOW                                         |
| `src/plugins/store.ts`                   | Direct DB access in application layer (like `history.ts`, `memory.ts`)                | MEDIUM                                      |
| `src/chat/plugin-interaction-handler.ts` | Presentation layer callback handling for plugins                                      | LOW                                         |

These should be addressed in an **updated** architecture plan after the original violations are fixed.

---

## Recommended Execution Order (Going Forward)

### Step 1: Fix Provider Abstraction Leaks — in dependency order, not plan order

The provider plan's tasks were written in a TDD sequence (test-first). For remediation, priority should be by **dependency graph**, not by plan task number:

1. **Task 4** — Add `getWorkspaceId()` / `setWorkspaceId()` to `src/users.ts`. This is the leaf dependency; everything else calls it.
2. **Task 1** — Add `ProvisioningResult`, `provisionUser?()`, `ProviderMetadata`, and `'provisioning'` capability to `src/providers/types.ts`.
3. **Task 2** — Implement `provisionUser()` in `KaneoProvider` and add `metadata`.
4. **Tasks 5 + 6** — Update `factory.ts` and `scheduler.ts` to use generic workspace functions.
5. **Task 3** — Refactor `llm-orchestrator.ts` to use `buildProviderForUser()` + `provider.provisionUser` instead of direct `maybeProvisionKaneo` import.
6. **Task 7** — Update `wizard/steps.ts` to read from `ProviderMetadata`.
7. **Task 8** — Update `commands/admin.ts` and `commands/setup.ts` to use generic provisioning.
8. **Task 9** — Final verification.

### Step 2: Update Architecture Violations Fix for post-plugin state

The original plan needs two categories of change:

**a) Re-evaluate what is still a violation:**

- `history.ts` / `memory.ts` direct DB deletes — **still violations**, unchanged by plugin system
- `proactive-llm.ts` duplicate LLM building — **still a violation**, unchanged
- Duplicate `buildProviderForUser` in `scheduler.ts` — **still a violation**, but now plugin loader also duplicates provider-building concerns
- `commands/context.ts` imports `ai` — **still a violation**
- `resume-recurring-task.ts` → `scheduler.ts` — **still a violation**

**b) Add new plugin-related violations to the plan:**

- `src/plugins/store.ts` should use cache abstraction (like `history.ts`/`memory.ts` will after Phase 2–3)
- `src/plugins/loader.ts` provider-facade building should be documented as accepted bridge-module pattern
- `src/chat/plugin-interaction-handler.ts` callback routing should be checked against commands-layer rules

### Step 3: Verify plugin system compatibility

After the two prerequisite plans are implemented, run a focused regression pass:

```bash
bun test tests/plugins/
bun test tests/tools/
bun test tests/llm-orchestrator-*.test.ts
bun typecheck
bun lint
```

The plugin system's `makeTools` integration, `buildSystemPrompt` integration, and `/plugin` command should all continue to work with the generic abstractions.

---

## Cross-Plan Task Mapping

| Provider Plan Task                              | Architecture Plan Consumer  | Plugin System Consumer                               |
| ----------------------------------------------- | --------------------------- | ---------------------------------------------------- |
| Task 1 (`provisionUser?()`, `ProviderMetadata`) | —                           | Compatibility checks, provider display names         |
| Task 3 (generic `maybeAutoProvision`)           | Phase 8 (error cleanup)     | Plugin tool pipeline depends on clean provider build |
| Task 4 (`getWorkspaceId/setWorkspaceId`)        | Phase 3–4 (scheduler dedup) | Plugin loader provider facades                       |
| Task 7 (`ProviderMetadata`)                     | —                           | `/config` plugin display, diagnostics                |

| Architecture Plan Phase       | Provider Plan Prerequisite | Plugin Plan Dependency         |
| ----------------------------- | -------------------------- | ------------------------------ |
| Phase 3 (scheduler dedup)     | Task 4                     | Plugin loader builds providers |
| Phase 5–7 (LLM consolidation) | —                          | Plugin tools use same pipeline |
| Phase 8 (error cleanup)       | Task 3                     | Plugin errors bubble same path |
| Phase 10 (tool location)      | —                          | Plugin tool contributions      |

---

## Risks of Continuing to Skip These Plans

1. **Every new provider adds more leaks.** If a third task tracker (Linear, Jira, etc.) is added, the current codebase requires touching `llm-orchestrator.ts`, `scheduler.ts`, `wizard/steps.ts`, `commands/admin.ts`, `commands/setup.ts`, `commands/start.ts`, and `llm-orchestrator-config.ts` with provider-specific code. The provider plan reduces this to `src/providers/<provider>/index.ts` only.

2. **Plugin system extensibility is capped.** Plugin tools that need workspace resolution, provider metadata, or provisioning will be forced to use the same leaked APIs (`getKaneoWorkspace`, `maybeProvisionKaneo`) that the core code uses today. This leaks provider-specific concepts into plugin contributions.

3. **Architecture verification is unreliable.** The `scripts/check-architecture.sh` proposed in the architecture plan cannot pass while `history.ts`, `memory.ts`, and the new `plugins/store.ts` all contain direct DB access. Without fixing the original violations first, the verification script will always fail.

---

## Related Documents

- `docs/superpowers/plans/2026-03-30-fix-provider-abstraction-leaks.md` — source of provider plan tasks
- `docs/superpowers/plans/2026-03-26-layered-architecture-violations-fix.md` — source of architecture plan tasks
- `docs/superpowers/plans/2026-03-30-plugin-system-implementation.md` — source of plugin plan phases
- `docs/superpowers/remaining/2026-03-30-fix-provider-abstraction-leaks.md` — auto-generated remaining-work tracker
- `docs/superpowers/remaining/2026-03-30-plugin-system-implementation.md` — auto-generated remaining-work tracker
