<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0008: Layered Architecture Current State and Violations

## Status

Draft / Needs Decision

## Date

2026-03-26

## Context

Following the implementation of ADR-0007 (Layered Architecture Enforcement), the codebase has evolved significantly with new features including:

- Multi-platform support (Telegram, Mattermost)
- Group management (`groups.ts`)
- Recurring tasks (`recurring.ts`, `scheduler.ts`)
- Deferred prompts/scheduling system (`deferred-prompts/`)
- Proactive alerts and monitoring

A fresh architectural audit has revealed **new violations** that emerged as the project grew, alongside existing patterns that need refinement.

## Architectural Layers Definition

The project follows a **four-layer architecture**:

```
Presentation Layer (src/chat/, src/commands/)
        ↓
Orchestration Layer (src/llm-orchestrator.ts)
        ↓
Application/Domain Layer (src/memory.ts, src/conversation.ts, src/config.ts, src/groups.ts, src/recurring.ts)
        ↓
Infrastructure Layer (src/providers/, src/cache.ts, src/db/, src/logger.ts, src/scheduler.ts, src/deferred-prompts/poller.ts)
```

### Layer Responsibilities

| Layer              | Responsibilities                                         | Can Import                                   | Must NOT Import                      |
| ------------------ | -------------------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| **Presentation**   | UI adapters, command routing, auth checks                | Domain types, orchestration entry points     | Infrastructure, AI SDK, providers    |
| **Orchestration**  | Coordinate between layers, LLM calls, provider selection | Application layer, infrastructure interfaces | Platform-specific code               |
| **Application**    | Business logic, state management, data access            | Pure types, utilities                        | AI SDK, HTTP clients, infrastructure |
| **Infrastructure** | External APIs, databases, scheduling, file I/O           | Everything (implements interfaces)           | —                                    |

## Violations Identified

### 🔴 HIGH: Duplicate LLM Orchestration

**Issue**: `src/deferred-prompts/proactive-llm.ts` duplicates orchestration logic from `src/llm-orchestrator.ts`

**Evidence**:

- Directly imports `@ai-sdk/openai-compatible` (line 1)
- Calls `createOpenAICompatible` 3 times (lines 93, 121, 161)
- Reimplements:
  - Config validation (`getLlmConfig` vs `checkRequiredConfig`)
  - Three execution modes (lightweight/context/full vs single `callLlm`)
  - Fact persistence (`persistProactiveResults` vs `persistFactsFromResults`)
  - Model building

**Impact**: Code drift, maintenance burden, inconsistent behavior

**Files**: `proactive-llm.ts` (206 lines)

### 🔴 HIGH: Application Layer Bypassing Cache (Direct DB Access)

**Issue**: 11 application layer files directly access database instead of using cache abstraction

**Files Violating**:

| File                                | Lines | Violation                                             |
| ----------------------------------- | ----- | ----------------------------------------------------- |
| `src/announcements.ts`              | 6-7   | `getDrizzleDb`, `userConfig`, `versionAnnouncements`  |
| `src/groups.ts`                     | 3-4   | `getDrizzleDb`, `groupMembers`                        |
| `src/history.ts`                    | 5-6   | `getDrizzleDb`, `conversationHistory` (direct delete) |
| `src/memory.ts`                     | 6-7   | `getDrizzleDb`, `memorySummary`, `memoryFacts`        |
| `src/users.ts`                      | 4-5   | `getDrizzleDb`, `users`                               |
| `src/recurring.ts`                  | 4-5   | `getDrizzleDb`, `recurringTasks` + `drizzle-orm`      |
| `src/recurring-occurrences.ts`      | 3-4   | `getDrizzleDb`, `recurringTaskOccurrences`            |
| `src/deferred-prompts/alerts.ts`    | 3-4   | `getDrizzleDb`, `alertPrompts`                        |
| `src/deferred-prompts/scheduled.ts` | 3-5   | `getDrizzleDb`, `scheduledPrompts`                    |
| `src/deferred-prompts/snapshots.ts` | 3-4   | `getDrizzleDb`, `taskSnapshots`                       |
| `src/instructions.ts`               | Check | Likely direct DB access                               |

**Root Cause**: Application layer should use `cache.ts` abstraction, not direct DB access. Only `config.ts` follows this correctly.

**Impact**: Bypasses caching layer, inconsistent data access patterns, harder to test

### 🔴 HIGH: Tools Importing Application Layer with DB Access

**Issue**: 9 tool files in `src/tools/` import application modules that access database directly

**Violating Tools**:

| File                             | Line(s) | Violating Import                                                 | Infrastructure Dependency         |
| -------------------------------- | ------- | ---------------------------------------------------------------- | --------------------------------- |
| `tools/instructions.ts`          | 5       | `from '../instructions.js'`                                      | Cache layer                       |
| `tools/completion-hook.ts`       | 3-5     | `from '../recurring-occurrences.js'`<br>`from '../recurring.js'` | Database layer                    |
| `tools/create-recurring-task.ts` | 8       | `from '../recurring.js'`                                         | Database layer                    |
| `tools/list-recurring-tasks.ts`  | 7       | `from '../recurring.js'`                                         | Database layer                    |
| `tools/update-recurring-task.ts` | 6       | `from '../recurring.js'`                                         | Database layer                    |
| `tools/pause-recurring-task.ts`  | 6       | `from '../recurring.js'`                                         | Database layer                    |
| `tools/resume-recurring-task.ts` | 7-8     | `from '../recurring.js'`<br>`from '../scheduler.js'`             | Database + **Presentation layer** |
| `tools/skip-recurring-task.ts`   | 6       | `from '../recurring.js'`                                         | Database layer                    |
| `tools/delete-recurring-task.ts` | 6       | `from '../recurring.js'`                                         | Database layer                    |

**Critical Issue**: `resume-recurring-task.ts` imports from `../scheduler.js` which imports `ChatProvider` from presentation layer!

**Impact**: Tools should only depend on `providers/types.ts` and application services, not infrastructure

### 🟡 MEDIUM: Provider Building Duplication

**Issue**: Provider construction scattered across multiple files

**Locations**:
| File | Function | Status |
|------|----------|--------|
| `providers/factory.ts` | `buildProviderForUser()` | ✅ Correct location |
| `scheduler.ts:33` | Own `buildProviderForUser()` | ❌ Duplication |
| `llm-orchestrator.ts` | Uses factory ✅ | ✅ Correct |
| `deferred-prompts/poller.ts` | Receives via parameter | ⚠️ Inconsistent |

**Impact**: Inconsistent provider construction, config handling

### 🟡 MEDIUM: Tools Scattered Across Project

**Issue**: Tool definitions in multiple locations

**Current State**:

```
src/tools/           # 31 files - task management tools
src/deferred-prompts/tools.ts  # 5 tools for deferred prompts
```

**Problem**: No unified tools directory; deferred tools buried in feature folder

### 🟡 MEDIUM: Infrastructure Misplaced

**Issue**: Infrastructure concerns living in wrong layers

**Violations**:
| File | Lines | Issue | Should Be |
|------|-------|-------|-----------|
| `scheduler.ts` (root) | 243 | setInterval, scheduling logic | `src/infrastructure/scheduler.ts` |
| `deferred-prompts/poller.ts` | 277 | Interval management, concurrency limits | `src/infrastructure/poller.ts` |
| `cron.ts` (root) | 288 | Parser + calculator utility | `src/utils/cron.ts` |
| `changelog-reader.ts` (root) | ~10 | File I/O utility | `src/utils/changelog-reader.ts` |

### 🟡 MEDIUM: Provider Layer Cross-Layer Dependencies

**Issue**: Provider infrastructure importing from application layer

**Violations**:

| File                           | Line(s)  | Import                                               | Issue                                        |
| ------------------------------ | -------- | ---------------------------------------------------- | -------------------------------------------- |
| `providers/kaneo/provision.ts` | Multiple | `clearCachedTools`, `setConfig`, `setKaneoWorkspace` | Infrastructure depends on application config |
| `providers/factory.ts`         | Multiple | `getConfig`, `getKaneoWorkspace`                     | Factory bridges config with providers        |

**Impact**: Circular dependency risk, provider layer should be pure infrastructure

### 🟡 MEDIUM: Orchestration Layer Platform-Specific Dependencies

**Issue**: Orchestrator importing provider-specific implementations instead of using abstractions

**Violations**:

| File                  | Line(s) | Import                                                                | Issue                                        |
| --------------------- | ------- | --------------------------------------------------------------------- | -------------------------------------------- |
| `llm-orchestrator.ts` | ~15     | `KaneoClassifiedError` from `providers/kaneo/classify-error.js`       | Should use `provider.classifyError()` method |
| `llm-orchestrator.ts` | ~16     | `provisionAndConfigure` from `providers/kaneo/provision.js`           | Provider-specific logic                      |
| `llm-orchestrator.ts` | ~18     | `YouTrackClassifiedError` from `providers/youtrack/classify-error.js` | Should use abstraction                       |

### 🟡 MEDIUM: Commands Importing AI SDK

**Issue**: Presentation layer importing from AI SDK

**Violation**:

- `src/commands/context.ts` line 1: `import type { ModelMessage } from 'ai'`

**Impact**: Commands should not depend on AI SDK types

### 🟢 LOW: Module Organization

**Issue**: `deferred-prompts/` mixes concerns

**Current** (10 files):

- `types.ts` - Domain types ✅
- `tools.ts` - Tool definitions (should be in `src/tools/`)
- `tool-handlers.ts` - Business logic ✅
- `proactive-llm.ts` - Orchestration (should be consolidated)
- `poller.ts` - Infrastructure (should move)
- `alerts.ts`, `scheduled.ts`, `snapshots.ts`, `fetch-tasks.ts` - Domain ✅
- `proactive-trigger.ts` - Utility ✅

### 🟢 LOW: Business Logic in Commands

**Issue**: Commands contain formatting/parsing logic that should be in application layer

**Files**:

- `src/commands/context.ts` lines 12-108: Heavy formatting logic for context reports
- `src/commands/group.ts` lines 101-108: User ID extraction logic
- `src/commands/admin.ts` lines 8-18: User identifier parsing logic

### 🟢 LOW: File Size Concerns

**Issue**: Several files exceed recommended line counts

| File               | Lines | Limit | Concern                                    |
| ------------------ | ----- | ----- | ------------------------------------------ |
| `src/scheduler.ts` | 243   | 200   | Does scheduling + execution + notification |
| `src/recurring.ts` | 299   | 200   | Complex domain logic                       |
| `src/cron.ts`      | 288   | 200   | Parser + calculator mixed                  |
| `src/cache.ts`     | 291   | 200   | Many cache types mixed                     |

## Refined Architectural Key Points

### 1. Single LLM Orchestration Entry Point

**Rule**: All LLM calls MUST go through a unified orchestration service

**Acceptable**:

- `llm-orchestrator.ts` calls `generateText()`
- `deferred-prompts/` uses orchestration service, doesn't build models directly

**Violation**:

- Building models with `createOpenAICompatible` outside orchestration layer

### 2. Provider Construction Centralized

**Rule**: Only `providers/factory.ts` and `providers/registry.ts` may construct providers

**Acceptable**:

- `buildProviderForUser(userId)` from factory
- Pass provider instances as parameters

**Violation**:

- Direct provider construction in schedulers/pollers

### 3. Tool Definitions Co-located

**Rule**: All tool definitions live in `src/tools/` or `src/tools/<feature>/`

**Structure**:

```
src/tools/
  index.ts              # Main tool exports
  task/                 # Task management tools (move existing)
  deferred/             # Deferred prompt tools (move from deferred-prompts/)
  recurring/            # Recurring task tools (for local state)
  confirmation-gate.ts
```

### 4. Infrastructure Layer Isolation

**Rule**: Infrastructure (intervals, file system, external APIs) lives in `src/infrastructure/`

**Structure**:

```
src/infrastructure/
  scheduler.ts          # Move from root
  poller.ts             # Move from deferred-prompts/
  cache.ts              # Already correct ✅
  db/                   # Already correct ✅
  logger.ts             # Already correct ✅
```

### 5. Feature Modules Are Domain-Only

**Rule**: Feature folders (`deferred-prompts/`, `recurring/`) contain only business logic

**Acceptable in feature folders**:

- Types and schemas
- Business logic (tool-handlers)
- State management

**NOT acceptable**:

- Tool definitions (move to `tools/`)
- Infrastructure (polling, intervals)
- LLM orchestration

### 6. Application Layer Uses Cache Abstraction

**Rule**: Application layer MUST NOT import from `db/drizzle.ts` or use `drizzle-orm`

**Correct**:

- `config.ts` → uses `cache.ts` ✅
- `memory.ts` → should use cache (violates on clear operations)

**Violation**:

- Direct `getDrizzleDb` imports
- Direct `drizzle-orm` usage

### 7. Tools Depend Only on Interfaces and Services

**Rule**: Tools should only import:

- `ai` (tool types)
- `../providers/types.ts` (provider interface)
- Application services (not infrastructure)
- `zod` (validation)

**Violation**:

- Tools importing modules that access database directly

## Updated Verification Commands

### Essential Checks

```bash
# 1. LLM orchestration centralized
# Should only appear in llm-orchestrator.ts and infrastructure
echo "=== AI SDK Infrastructure Usage ==="
grep -r "createOpenAICompatible" src/ --include="*.ts" | grep -v "node_modules"
# Expected: src/llm-orchestrator.ts, src/conversation.ts, src/infrastructure/*.ts

# 2. Provider construction centralized
echo "=== Provider Building Outside Factory ==="
grep -rn "buildProviderForUser\|createProvider" src/*.ts src/**/*.ts 2>/dev/null | grep -v "factory.ts\|registry.ts\|providers/"
# Expected: Only calls to imported functions, no inline construction

# 3. No infrastructure in domain layer
echo "=== Infrastructure Leaks (setInterval/setTimeout) ==="
grep -l "setInterval\|setTimeout" src/*.ts src/*/*.ts 2>/dev/null | grep -v "infrastructure/"
# Expected: Only infrastructure/ and index.ts (startup)

# 4. Tools location
echo "=== Tool Definitions Outside tools/ ==="
grep -l "^export.*tool(" src/deferred-prompts/*.ts src/*/*.ts 2>/dev/null | grep -v "src/tools/"
# Expected: None (all tool() calls should be in tools/)

# 5. Commands don't import providers directly
echo "=== Commands Provider Imports ==="
grep -r "from.*providers/(kaneo|youtrack)" src/commands/ --include="*.ts"
# Expected: Only provisionAndConfigure import (acceptable)

# 6. Application layer isolation - NO direct DB access
echo "=== Direct DB Access in Application Layer ==="
grep -l "from.*db/drizzle" src/*.ts src/*/*.ts src/deferred-prompts/*.ts 2>/dev/null | grep -v "cache"
# Expected: Only cache.ts, cache-db.ts, infrastructure/

# 7. Application layer - NO drizzle-orm
echo "=== drizzle-orm in Application Layer ==="
grep -l "from 'drizzle-orm'" src/*.ts src/*/*.ts 2>/dev/null | grep -v "infrastructure/\|db/"
# Expected: None

# 8. Tools importing application layer with DB access
echo "=== Tools with DB Dependencies ==="
grep -l "from '../recurring\|from '../instructions" src/tools/*.ts 2>/dev/null
# Expected: Should be refactored
```

### Cross-Layer Dependency Checks

```bash
# Check presentation layer doesn't import infrastructure
echo "=== Presentation Layer Violations ==="
grep -r "from.*db/drizzle\|from.*@ai-sdk\|from.*providers/(kaneo|youtrack)" src/chat/ src/commands/ --include="*.ts"

# Check application layer doesn't import AI SDK
echo "=== Application AI SDK Imports ==="
grep "@ai-sdk/openai-compatible" src/memory.ts src/config.ts src/users.ts src/groups.ts src/recurring.ts src/history.ts 2>/dev/null

# Check orchestration doesn't import platform-specific
echo "=== Orchestration Platform Imports ==="
grep -r "KaneoClassifiedError\|YouTrackClassifiedError" src/llm-orchestrator.ts
```

### File Size Boundaries

```bash
# Bot.ts should be thin (presentation only)
wc -l src/bot.ts
# Expected: <150 lines (current: 129 ✅)

# Commands should be thin
echo "=== Command File Sizes ==="
wc -l src/commands/*.ts
# Expected: Each <200 lines

# LLM orchestrator should be primary
echo "=== Orchestration File Sizes ==="
wc -l src/llm-orchestrator.ts src/deferred-prompts/proactive-llm.ts
# Current: 175 + 206 = 381 (should consolidate to ~250)

# Large application files
echo "=== Large Application Files ==="
wc -l src/recurring.ts src/cache.ts src/cron.ts
# Flag if >200 lines
```

### Import Path Verification

```bash
# No fragile relative paths
echo "=== Fragile Import Paths ==="
grep -r "\.\./\.\./\.\./" src/ --include="*.ts"
# Expected: None

# Schema imports are local to providers
echo "=== Schema Import Paths ==="
grep -r "from.*schemas" src/providers/ --include="*.ts" | grep -v "\.\/schemas"
# Expected: All use ./schemas/ relative paths

# Check for root-level infrastructure files
echo "=== Root-Level Infrastructure ==="
ls src/*.ts | xargs -I {} sh -c 'grep -l "setInterval\|setTimeout\|createOpenAICompatible" {}' 2>/dev/null
# Expected: Only scheduler.ts, cron.ts (to be moved)
```

## Migration Path

### Phase 1: Fix Application Layer DB Access (Critical)

1. Extend `src/cache.ts` with methods for:
   - User CRUD operations
   - Group member operations
   - Recurring task operations
   - Deferred prompts operations
   - History clear operation (currently direct DB delete)
   - Facts/summary clear operations
2. Update all violating files to use cache instead of direct DB
3. Move DB operations to `cache-db.ts`

### Phase 2: Consolidate LLM Orchestration

1. Extract common execution modes from `proactive-llm.ts`
2. Extend `llm-orchestrator.ts` with execution mode support
3. Update `proactive-llm.ts` to delegate to orchestrator
4. Remove duplicate model building

### Phase 3: Create Infrastructure Directory

1. Create `src/infrastructure/` directory
2. Move `src/scheduler.ts` → `src/infrastructure/scheduler.ts`
3. Move `src/cron.ts` → `src/utils/cron.ts` (it's a utility)
4. Move `src/changelog-reader.ts` → `src/utils/changelog-reader.ts`
5. Move `src/deferred-prompts/poller.ts` → `src/infrastructure/poller.ts`
6. Update all imports

### Phase 4: Centralize Tools

1. Create `src/tools/deferred/` directory
2. Move tool definitions from `deferred-prompts/tools.ts`
3. Create `src/tools/recurring/` directory
4. Refactor recurring task tools to not depend on DB-accessing modules
5. Update imports in `src/tools/index.ts`

### Phase 5: Fix Provider Layer Dependencies

1. Move `src/providers/factory.ts` to `src/` (bridges config with providers)
2. Evaluate `src/providers/kaneo/provision.ts` - consider moving to application layer
3. Update orchestrator to use provider abstraction instead of specific error classes

### Phase 6: Cleanup Commands

1. Remove `ModelMessage` import from `src/commands/context.ts`
2. Extract formatting logic from `context.ts` to application service
3. Extract parsing logic to shared utilities

### Phase 7: Consolidate Recurring Tasks Architecture

**Problem**: Recurring tasks stored locally in SQLite while other tasks in provider

Options:

- **Option A**: Keep local storage but properly abstract behind service layer
- **Option B**: Move recurring tasks to task provider (requires provider capability)
- **Option C**: Create separate `src/services/` layer for local state management

## Consequences

### Positive

- Single source of truth for LLM interactions
- Consistent data access patterns (all through cache)
- Clear separation between domain and infrastructure
- Easier testing (mock cache layer)
- Better discoverability (tools in one place)
- No cross-layer dependencies

### Negative

- Breaking changes to internal APIs
- Need to update tests
- Temporary duplication during migration
- More import path updates
- Cache layer becomes larger responsibility

## Related Documents

- ADR-0007: Layered Architecture Enforcement
- `/docs/plans/done/2026-03-13-layered-architecture-refactoring.md`

## Decision Needed

1. **Approach for Phase 1**: Extend cache layer vs create service layer?
2. **Recurring tasks**: Keep local SQLite or migrate to provider?
3. **Tools depending on local state**: How to properly abstract?
4. **Timeline**: Phased approach or single large refactoring?

Pending approval to proceed with migration phases.
