<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0077: Behavior Audit — Test-Driven UX Evaluation via AI Agent

## Status

Accepted

## Date

2026-04-16

## Context

The papai test suite contains ~3,400 tests across 311 files, representing the most complete specification of bot behavior. However, this specification is written in code and not accessible to non-technical stakeholders. This creates a significant gap between "what the code does" and "how a real user would experience it."

We needed a systematic approach to:

1. Extract behavioral descriptions from unit tests in plain language
2. Evaluate these behaviors from the perspective of non-technical users
3. Surface UX flaws that are invisible from a purely technical perspective
4. Generate actionable reports documenting user stories and improvement opportunities

This decision captures the base behavior audit pipeline, which provides the foundation for subsequent incremental runs optimization (ADR-0073).

## Decision Drivers

- **Must bridge code-to-UX gap** — translate test specifications into user-facing language
- **Must support persona-based evaluation** — assess UX through diverse user perspectives
- **Must be resumable** — long-running analysis should survive interruptions
- **Must use local LLM infrastructure** — avoid external API dependencies and costs
- **Should produce actionable artifacts** — reports that inform product decisions
- **Should integrate with existing test suite** — no modifications to tests required

## Considered Options

### Option 1: Manual UX Audit by Human Reviewers

- **Pros**: Human judgment, nuanced understanding of context
- **Cons**: Expensive, time-consuming, cannot scale to 3,400+ tests, inconsistent between reviewers
- **Verdict**: Rejected — not scalable for our test volume

### Option 2: Static Analysis of Test Files

- **Pros**: Fast, deterministic, no LLM costs
- **Cons**: Cannot understand semantic meaning of tests, produces low-quality output
- **Verdict**: Rejected — insufficient understanding of test intent

### Option 3: AI Agent Pipeline with Codebase Tools (chosen)

- **Pros**: Can explore implementation dynamically, generates rich plain-language descriptions, evaluates against personas with context from actual code
- **Cons**: Requires local LLM infrastructure, longer runtime than static analysis
- **Verdict**: Accepted — best balance of quality and practicality

### Option 4: Integration with Existing Test Runner

- **Pros**: Unified tooling, could capture runtime behavior
- **Cons**: Would require test modifications, couples audit to test execution
- **Verdict**: Rejected — prefer standalone tool that doesn't affect test suite

## Decision

Implement a standalone Bun/TypeScript script at `scripts/behavior-audit.ts` that executes a two-phase AI agent pipeline:

1. **Phase 1 — Extract**: For each test case, an AI agent with codebase tools reads the test source, explores the implementation, and writes a plain-language behavior description
2. **Phase 2 — Evaluate**: For each extracted behavior, an AI agent evaluates it from the perspective of three non-technical personas

### Architecture

```
scripts/behavior-audit.ts (entry point)
  ├── config: hardcoded model, base URL, API key from env
  ├── progress: reports/progress.json (resumable)
  ├── Phase 1: extract loop
  │     for each test file:
  │       parse test cases (describe/it/test blocks)
  │       for each test case:
  │         agent call with tools → behavior + context
  │       write reports/behaviors/<domain>/<name>.behaviors.md
  │       mark file complete in progress.json
  └── Phase 2: evaluate loop
        for each behavior in reports/behaviors/**/*.behaviors.md:
          agent call with tools → 3-persona evaluation
          accumulate into domain story file
        write reports/stories/<domain>.md
        write reports/stories/index.md (summary table)
```

### LLM Configuration

Hardcoded in the script — no CLI arguments:

```typescript
const MODEL = 'qwen3-30b-a3b'
const BASE_URL = 'http://localhost:1234/v1'
// API key from OPENAI_API_KEY env var
```

Uses `@ai-sdk/openai-compatible` with Vercel AI SDK's `generateText` in agent mode (`maxSteps`).

### Agent Tools

Both phases have access to these read-only tools for RAG-style codebase exploration:

| Tool        | Description                                                                |
| ----------- | -------------------------------------------------------------------------- |
| `readFile`  | Read a file by project-relative path                                       |
| `grep`      | Search codebase for a regex pattern, returns matching lines with file:line |
| `findFiles` | Find files matching a glob pattern                                         |
| `listDir`   | List contents of a directory                                               |

### Personas

Three non-technical evaluation personas, each representing a different context of use:

1. **Maria** — Operations Manager (Work context): Practical, impatient with extra work, abandons features that take more than two tries
2. **Dani** — Freelance Photographer (Daily Routine context): Creative, scattered, zero tolerance for anything that feels like software
3. **Viktor** — Retired Teacher (Personal Life context): Patient but easily confused, types slowly, needs step-by-step guidance

### Progress Tracking

Uses `reports/progress.json` with schema:

```typescript
interface Progress {
  version: 1
  startedAt: string
  phase1: {
    status: 'not-started' | 'in-progress' | 'done'
    completedTests: Record<string, Record<string, 'done'>>
    failedTests: Record<string, FailedEntry>
    completedFiles: string[]
    stats: { filesTotal: number; filesDone: number; testsExtracted: number; testsFailed: number }
  }
  phase2: {
    status: 'not-started' | 'in-progress' | 'done'
    completedBehaviors: Record<string, 'done'>
    failedBehaviors: Record<string, FailedEntry>
    stats: { behaviorsTotal: number; behaviorsDone: number; behaviorsFailed: number }
  }
}
```

### Timeouts and Retries

| Phase                | Per-call timeout | Retry policy                                  |
| -------------------- | ---------------- | --------------------------------------------- |
| Phase 1 (extraction) | 1200s (20 min)   | Max 3 retries with backoff 100s → 300s → 900s |
| Phase 2 (evaluation) | 600s (10 min)    | Same retry policy                             |

### Domain Mapping

Test file paths map to domains for organized output:

| Test path prefix            | Domain               |
| --------------------------- | -------------------- |
| `tests/tools/`              | `tools`              |
| `tests/commands/`           | `commands`           |
| `tests/chat/telegram/`      | `chat-telegram`      |
| `tests/chat/mattermost/`    | `chat-mattermost`    |
| `tests/chat/discord/`       | `chat-discord`       |
| `tests/providers/kaneo/`    | `providers-kaneo`    |
| `tests/providers/youtrack/` | `providers-youtrack` |
| `tests/` (root-level files) | `core`               |

### Exclusions

These test directories are excluded from audit:

- `tests/e2e/` — requires Docker infrastructure context
- `tests/client/` — dashboard UI tests out of scope
- `tests/helpers/` — test utilities, not user-facing
- `tests/scripts/` — build/CI script tests
- `tests/review-loop/` — internal tooling
- `tests/types/` — type-level tests

## Rationale

The AI agent approach was selected because it provides the best balance of output quality and implementation practicality. Static analysis cannot understand the semantic intent behind test code, while manual audits cannot scale to our test volume.

Key design decisions:

1. **Two-phase pipeline**: Separates extraction (understanding test intent) from evaluation (judging UX), allowing each phase to be optimized independently
2. **Read-only tools**: Prevents the agent from modifying code while allowing deep codebase exploration
3. **Three distinct personas**: Captures diverse user perspectives — from tech-savvy but impatient (Dani) to patient but inexperienced (Viktor)
4. **Resumable progress**: Critical for long-running analysis (20+ minutes per test file with local LLM)
5. **Domain-based organization**: Makes large output navigable by grouping related behaviors

The local LLM requirement (`qwen3-30b-a3b` via LM Studio) avoids external API costs and enables offline operation, though it requires significant local compute.

## Consequences

### Positive

- Bridge between technical implementation and user experience
- Systematic identification of UX gaps invisible to developers
- Actionable reports with specific improvement suggestions
- No modifications required to existing test suite
- Resumable long-running analysis
- Non-technical stakeholders can understand bot capabilities

### Negative

- Requires local LLM infrastructure (significant RAM/GPU requirements)
- Full run takes hours (20+ min per test file × 311 files)
- Narrow dependency tracking in base implementation (addressed in ADR-0073)
- Git dependency for incremental features (non-git workflows fall back to full runs)
- JSON output parsing can fail on malformed LLM responses

### Risks

- **LLM hallucination**: May misinterpret test intent. Mitigation: Agent has tools to verify by reading implementation.
- **Stale results**: Base implementation re-runs everything. Mitigation: ADR-0073 adds incremental selection.
- **Local LLM availability**: Script fails if LM Studio not running. Mitigation: Clear error messages, documented setup.
- **Storage growth**: Behavior files accumulate. Mitigation: `reports/` directory in `.gitignore`.

## Implementation Notes

### Files Created

- `scripts/behavior-audit.ts` — Entry point orchestrating both phases
- `scripts/behavior-audit/config.ts` — Hardcoded LLM config, timeouts, paths
- `scripts/behavior-audit/domain-map.ts` — Test path → domain mapping
- `scripts/behavior-audit/test-parser.ts` — Parse test files into individual test cases
- `scripts/behavior-audit/tools.ts` — Agent tool definitions
- `scripts/behavior-audit/progress.ts` — Read/write/update progress.json
- `scripts/behavior-audit/personas.ts` — Three persona prompt constants
- `scripts/behavior-audit/extract.ts` — Phase 1 extraction agent loop
- `scripts/behavior-audit/evaluate.ts` — Phase 2 evaluation agent loop
- `scripts/behavior-audit/report-writer.ts` — Write behavior files, story files, index

### NPM Script

Added to `package.json`:

```json
"audit:behavior": "bun scripts/behavior-audit.ts"
```

### Output File Tree

```
reports/
  progress.json
  behaviors/
    core/
      auth.test.behaviors.md
      bot.test.behaviors.md
      ...
    tools/
      create-task.test.behaviors.md
      update-task.test.behaviors.md
      ...
    commands/
    chat-telegram/
    chat-mattermost/
    chat-discord/
    providers-kaneo/
    providers-youtrack/
    ...
  stories/
    index.md
    core.md
    tools.md
    commands.md
    ...
```

### Report Format

Per-domain story files include:

- User story mapping for each behavior
- Three-persona scores (discover, use, retain) 1-5 scale
- Specific flaws identified
- Improvement suggestions
- Aggregated statistics

Summary index includes:

- Domain-level statistics table
- Top 10 flaws by frequency
- Top 10 improvements by frequency
- Failed extraction log

## Related Decisions

- **ADR-0073** (Behavior Audit Incremental Runs) — builds on this base implementation to add selective reprocessing based on file changes
- **ADR-0054** (Mock Isolation Guardrails) — test isolation patterns that this audit system verifies

## References

- Plan: `docs/archive/2026-04-16-behavior-audit-implementation.md`
- Design: `docs/archive/2026-04-16-behavior-audit-design.md`

## References

- Plan: `docs/archive/2026-04-16-behavior-audit-implementation.md`
- Design: `docs/archive/2026-04-16-behavior-audit-design.md`
