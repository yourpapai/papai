<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0043: TDD Hooks Integration for Multi-Platform AI Enforcement

## Status

Accepted

## Context

The papai project uses multiple AI coding assistants (Claude Code, OpenCode, GitHub Copilot) to accelerate development. Without enforcement mechanisms, these assistants can:

1. Write implementation code without corresponding tests (violating TDD principles)
2. Regress existing tests during refactoring
3. Add new functionality without adequate test coverage
4. Proceed with failing tests, breaking the Red→Green→Refactor cycle

Previous attempts at TDD compliance relied on documentation and manual review, which proved insufficient. We needed a mechanical enforcement system that operates at the tool level, blocking violations before code is written.

### Decision Drivers

- **Must prevent test-free implementation** — AI assistants must write tests first
- **Must support multiple platforms** — Claude Code, OpenCode, GitHub Copilot
- **Must not block legitimate work** — docs, config, and test files should pass through
- **Must fail open** — hook crashes should not prevent development
- **Must be fast** — <200ms per hook execution to maintain velocity
- **Should provide clear feedback** — developers must understand why they were blocked

## Considered Options

### Option 1: Documentation-Only Enforcement

**Approach**: Rely on CLAUDE.md and instruction files to guide AI behavior.

- **Pros**: Simple to implement, no infrastructure needed
- **Cons**: Proven ineffective — assistants still skip tests, no mechanical enforcement
- **Verdict**: Rejected — insufficient for ensuring compliance

### Option 2: CI-Based Enforcement (Post-Hoc)

**Approach**: Block PRs that lack tests or have failing tests in CI.

- **Pros**: Catches violations before merge, uses existing CI infrastructure
- **Cons**: Feedback loop too late — code already written, requires rework
- **Verdict**: Rejected — violates "fail fast" principle

### Option 3: Editor/IDE Extensions

**Approach**: Build VS Code extensions that enforce TDD at the editor level.

- **Pros**: Real-time feedback, familiar developer experience
- **Cons**: Platform-specific (VS Code only), doesn't intercept AI tool calls
- **Verdict**: Rejected — doesn't solve the AI assistant use case

### Option 4: Platform-Specific Hooks (Chosen)

**Approach**: Use each AI platform's native hook/plugin system to intercept file writes.

- **Claude Code**: PreToolUse/PostToolUse hooks via `settings.json`
- **OpenCode**: Plugin API with `tool.execute.before/after` callbacks
- **GitHub Copilot**: Instructions-only (no confirmed hook support)

- **Pros**: Native integration, mechanical enforcement, immediate feedback
- **Cons**: Platform-specific implementations required, OpenCode has blocking limitations
- **Verdict**: Accepted — best balance of enforcement power and practicality

## Decision

We will implement platform-specific TDD enforcement hooks that mechanically prevent writing implementation code without tests across Claude Code and OpenCode, with advisory enforcement for GitHub Copilot via instructions.

## Architecture

### Shared Core (`.hooks/tdd/`)

Platform-agnostic ES modules shared by all adapters:

- **`test-resolver.mjs`** — Maps implementation files to test files
- **`session-state.mjs`** — File-based session persistence (Claude) + memory-based (OpenCode)
- **`test-runner.mjs`** — Executes `bun test` with timeout handling
- **`coverage.mjs`** — LCOV parsing for line coverage tracking
- **`surface-extractor.mjs`** — Regex-based API surface extraction
- **`checks/*.mjs`** — Individual check implementations:
  - `enforce-tdd.mjs` — Pre-write TDD gate
  - `track-test-write.mjs` — Post-write test tracking
  - `verify-tests-pass.mjs` — Post-write test execution
  - `snapshot-surface.mjs` — Pre-write API surface capture
  - `verify-no-new-surface.mjs` — Post-write surface diff

### Claude Code Adapter (`.claude/hooks/`)

Orchestrator pattern with thin wrappers:

- **`pre-tool-use.mjs`** — Sequential pre-write checks (TDD gate, surface snapshot)
- **`post-tool-use.mjs`** — Sequential post-write checks (tracker, test runner, surface diff)
- **Registration**: `.claude/settings.json` with PreToolUse/PostToolUse matchers

### OpenCode Adapter (`.opencode/plugins/`)

Single plugin implementing deferred blocking:

- **`tdd-enforcement.ts`** — Plugin with `tool.execute.before` and `tool.execute.after` handlers
- **Deferred blocking**: Since OpenCode cannot block from `tool.execute.after`, failures are stored in session state and block the _next_ tool execution

### Documentation

- **`CLAUDE.md`** — TDD Enforcement section (Claude + OpenCode native)
- **`.github/instructions/tdd.instructions.md`** — Path-scoped instructions (Copilot + OpenCode)
- **`.github/copilot-instructions.md`** — Updated table with TDD entry

## Implementation Details

### Test File Resolution Strategy

```
src/config.ts              → tests/config.test.ts
src/providers/kaneo/client.ts → tests/providers/kaneo/client.test.ts
src/utils/format.ts        → tests/utils/format.test.ts
```

1. Strip `src/` prefix from implementation path
2. Prepend `tests/` prefix
3. Replace extension with `.test.{ext}`
4. Fallback to colocated test file (same directory)

### Hook Execution Pipeline

**PreToolUse (before file write):**

1. **Test-first gate** — Block if no test file exists (disk + session state)
2. **Surface snapshot** — Capture API surface + coverage for refactor guards

**PostToolUse (after file write):** 3. **Test tracker** — Record test files written this session 4. **Test runner** — Execute corresponding test file, block if RED 5. **Coverage check** — Compare against session baseline, block if dropped 6. **Surface diff** — Block if new exports/params/uncovered lines added

### Platform Differences

| Aspect            | Claude Code                                     | OpenCode                                      |
| ----------------- | ----------------------------------------------- | --------------------------------------------- |
| Execution         | Subprocess (shell)                              | In-process (function)                         |
| Input             | JSON on stdin                                   | Function parameters                           |
| PreToolUse block  | `hookSpecificOutput.permissionDecision: "deny"` | `throw new Error(...)`                        |
| PostToolUse block | `decision: "block"` response                    | **Deferred** — store failure, block next call |
| Session state     | File-based (`/tmp`)                             | Memory-based (Map)                            |
| Tool names        | PascalCase (`Write`, `Edit`)                    | lowercase (`write`, `edit`)                   |

## Consequences

### Positive

- **Mechanical TDD enforcement** — AI assistants cannot write implementation without tests
- **Immediate feedback** — Violations blocked at tool execution time, not in CI
- **Cross-platform support** — Works with Claude Code, OpenCode, and (via instructions) Copilot
- **Fail-open design** — Hook crashes don't prevent development
- **Shared core logic** — Single source of truth for test resolution, session state, test running
- **Fast execution** — ~96ms for all hook tests, <200ms per hook invocation
- **Comprehensive test coverage** — 123 unit tests for hook infrastructure

### Negative

- **Platform-specific code required** — Each AI tool needs its own adapter
- **OpenCode deferred blocking** — One tool call delay before blocking (functionally equivalent)
- **Session storage** — File-based state in `.hooks/sessions/` requires cleanup
- **Coverage overhead** — Running `bun test --coverage` adds latency to post-write hooks
- **Limited to src/** — Only gates files under `src/` (by design, but docs/config aren't protected)

### Risks and Mitigations

| Risk                            | Mitigation                                            |
| ------------------------------- | ----------------------------------------------------- |
| Hook blocks legitimate edits    | Only gates `src/*.ts`; docs/config pass through       |
| Test runner timeout slows agent | 30s timeout; Bun is fast; test only related file      |
| Hook crashes break development  | Try/catch with fail-open in all hooks                 |
| Session state file races        | Hooks don't share state files; no actual race         |
| ESM resolution fails            | `.mjs` extension forces ESM; tested with dotfile dirs |
| OpenCode subagent bypass        | Known issue; instructions provide fallback            |
| OpenCode first-message bypass   | Known issue; instructions provide fallback            |

## Phase 2: Future Enhancements

The current implementation includes Phase 2 features not originally planned:

- **API surface diffing** — Blocks new exports/parameters without tests
- **Coverage enforcement** — Blocks if line coverage drops below session baseline
- **Mutation testing infrastructure** — Session state support for StrykerJS integration

These features exceed the original Phase 1 scope and provide stronger refactoring guards.

## Related Decisions

- [ADR-0017](0017-mutation-testing-strykerjs.md) — Mutation testing with StrykerJS (infrastructure reused)
- [ADR-0029](0029-custom-instructions-system.md) — Custom instructions system (patterns reused for TDD instructions)

## References

- Implementation: `.hooks/tdd/`, `.claude/hooks/`, `.opencode/plugins/`
- Tests: `.hooks/tests/tdd/` (123 unit tests)
- Documentation: `CLAUDE.md` (lines 51-139), `.github/instructions/tdd.instructions.md`
- Plan: `docs/plans/done/2026-03-23-tdd-hooks-integration.md`
