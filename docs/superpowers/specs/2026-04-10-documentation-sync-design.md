<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Documentation Sync Design

**Date:** 2026-04-10  
**Scope:** Sync CLAUDE.md and README.md with actual codebase changes  
**Type:** Documentation Maintenance

## Overview

Comprehensive sync of main documentation files (CLAUDE.md and README.md) to reflect the actual state of the codebase after recent feature implementations including identity resolution, thread-aware group chat, recurring tasks, deferred prompts, memos, and work items/time tracking.

## Discrepancies Identified

### 1. CLAUDE.md Testing Section (lines 292-302)

**Current Issues:**

- References outdated path `tests/tools/mock-provider.ts` (should be `tests/utils/`)
- Doesn't mention Dependency Injection pattern (now used in 18+ modules)
- Missing newer helpers: `expectAppError()`, `mockMessageCache()`, `clearMessageCache()`
- Incorrectly mentions `afterAll(() => { mock.restore() })` which is NOT needed (handled by global mock-reset.ts)
- Missing DI pattern documentation from tests/CLAUDE.md

**Required Changes:**

- Sync with tests/CLAUDE.md content
- Add DI pattern as preferred mocking approach
- Update helper references to correct paths
- Remove outdated `afterAll` restore instruction

### 2. CLAUDE.md Available Tools Table (lines 242-276)

**Current State:** Lists 28 tools

**Actual State:** 73+ tools in codebase

**Missing Categories:**

- Task Collaboration: watchers, votes, visibility (7 tools)
- Work Items/Time Tracking (4 tools)
- Memos (5 tools)
- Recurring Tasks (6 tools)
- Deferred Prompts (5 tools)
- Instructions (3 tools)
- Identity Resolution (2 tools)
- Count Tasks (1 tool)
- Attachments (3 tools)
- Lookup Group History (1 tool)
- Comment Reactions (2 tools)
- Project Team Management (2 tools)

**Required Changes:**

- Expand table to include all 73 tools
- Organize by functional category
- Include new capabilities: `tasks.watchers`, `tasks.votes`, `tasks.visibility`, `workItems.*`, `attachments.*`

### 3. CLAUDE.md Architecture Section (lines 198-240)

**Missing Components:**

- Identity resolution system (`src/identity/`)
- Deferred prompts system (`src/deferred-prompts/`)
- Recurring tasks scheduler (`src/scheduler.ts`)
- Proactive delivery (`src/proactive-delivery/`)
- Embeddings service (`src/embeddings.ts`)
- Thread-aware group chat handling
- Memos system (`src/memos/`)
- Work items/time tracking
- Instructions system

**Required Changes:**

- Add identity resolver to architecture diagram description
- Add deferred prompts and recurring tasks components
- Document thread-aware context handling
- Add new storage systems (memos, instructions)

### 4. CLAUDE.md Key Conventions (lines 304-316)

**Missing Pattern:**

- Dependency Injection with `export interface Deps`
- Default deps with production implementations
- Test override via deps parameter

**Required Changes:**

- Add DI pattern to conventions list
- Show example of `Deps` interface pattern

### 5. README.md Features Section (lines 47-71)

**Missing Features:**

- Work Items/Time Tracking
- Memos (quick notes system)
- Recurring Tasks
- Deferred Prompts
- Custom Instructions
- Identity Resolution
- Thread-aware Group Chat
- Voting on tasks
- Attachments

**Required Changes:**

- Expand feature table with new categories
- Update Task Provider Support table with new capabilities

## Implementation Plan

### Phase 1: CLAUDE.md Core Updates

1. **Testing Section Rewrite**
   - Import content from tests/CLAUDE.md
   - Add DI pattern as primary approach
   - Update helper paths
   - Remove outdated afterAll instruction

2. **Tools Table Expansion**
   - Create comprehensive table with all 73 tools
   - Group by functional category
   - Add missing capabilities to Capability type documentation

3. **Architecture Updates**
   - Add identity resolution to component list
   - Document deferred prompts and recurring tasks
   - Add thread-aware group chat components
   - Update storage layer description

4. **Key Conventions Addition**
   - Add DI pattern documentation
   - Include example code

### Phase 2: README.md Updates

1. **Features Section Expansion**
   - Add new feature categories
   - Update capability tables
   - Update component overview

### Phase 3: Verification

1. Cross-reference all tool names with actual implementations
2. Verify all paths exist in codebase
3. Ensure consistency between CLAUDE.md and subdirectory docs

## Files to Modify

- `/Users/ki/Projects/experiments/papai/CLAUDE.md`
- `/Users/ki/Projects/experiments/papai/README.md`

## Success Criteria

- All documented tools exist in codebase
- All documented patterns are used in codebase
- No references to non-existent files
- Testing section accurately reflects tests/CLAUDE.md
- README features match actual capabilities

## Risk Assessment

**Low Risk:** Documentation-only changes, no code modifications
**Mitigation:** Verification step to ensure all referenced paths exist
