<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Behavior Audit: Test-Driven UX Evaluation via AI Agent

**Date:** 2026-04-16
**Status:** Proposed
**Scope:** Standalone Bun script that extracts behavioral descriptions from unit tests and evaluates them as user stories through non-technical personas

## Summary

Build a standalone Bun/TypeScript script at `scripts/behavior-audit.ts` that processes every unit test in the papai repository through a two-phase AI agent pipeline:

1. **Phase 1 — Extract:** For each individual test case, an AI agent with codebase tools reads the test source, explores the implementation via tool calls, and writes a plain-language behavior description.
2. **Phase 2 — Evaluate:** For each extracted behavior, an AI agent evaluates it from the perspective of three non-technical personas, scoring discoverability, ease of use, and retention.

Output is a set of markdown reports under `reports/behaviors/` and `reports/stories/` that document what the bot actually does, what user stories those behaviors map to, and where the UX has gaps.

## Motivation

The test suite (~3,400 tests across 311 files) is the most complete specification of bot behavior, but it is written in code. This script bridges the gap between "what the code does" and "how a real user would experience it," surfacing UX flaws that are invisible from a purely technical perspective.

## Architecture

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

Uses `@ai-sdk/openai-compatible` (already in project dependencies) with Vercel AI SDK's `generateText` in agent mode (`maxSteps`).

### Agent Tools

Both phases have access to these tools for RAG-style codebase exploration:

| Tool        | Description                                                                | Implementation                                                           |
| ----------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `readFile`  | Read a file by absolute or project-relative path                           | `Bun.file(path).text()` with path resolution                             |
| `grep`      | Search codebase for a regex pattern, returns matching lines with file:line | `Bun.spawn(['grep', '-rn', pattern, '.'])` scoped to `src/` and `tests/` |
| `findFiles` | Find files matching a glob pattern                                         | `Bun.spawn(['find', '.', '-name', pattern])` scoped to project           |
| `listDir`   | List contents of a directory                                               | `readdir` with file/dir indicators                                       |

Tools are read-only. No write tools are exposed to the agent.

### Domain Mapping

Test file paths map to domains based on their directory structure:

| Test path prefix            | Domain               |
| --------------------------- | -------------------- |
| `tests/tools/`              | `tools`              |
| `tests/commands/`           | `commands`           |
| `tests/chat/telegram/`      | `chat-telegram`      |
| `tests/chat/mattermost/`    | `chat-mattermost`    |
| `tests/chat/discord/`       | `chat-discord`       |
| `tests/chat/` (other)       | `chat`               |
| `tests/providers/kaneo/`    | `providers-kaneo`    |
| `tests/providers/youtrack/` | `providers-youtrack` |
| `tests/providers/` (other)  | `providers`          |
| `tests/config-editor/`      | `config-editor`      |
| `tests/group-settings/`     | `group-settings`     |
| `tests/message-queue/`      | `message-queue`      |
| `tests/deferred-prompts/`   | `deferred-prompts`   |
| `tests/identity/`           | `identity`           |
| `tests/web/`                | `web`                |
| `tests/wizard/`             | `wizard`             |
| `tests/debug/`              | `debug`              |
| `tests/db/`                 | `db`                 |
| `tests/e2e/`                | `e2e`                |
| `tests/` (root-level files) | `core`               |

### Console Output

Real-time progress during execution:

```
[Phase 1] 1/311 files — tests/tools/create-task.test.ts
  [1/8] "creates a task with required fields" ✓ (42.1s, 3 tool calls)
  [2/8] "rejects creation without auth" ✓ (38.5s, 1 tool call)
  [3/8] "validates required title field" ✗ retry 1/3 (timeout)
  [3/8] "validates required title field" ✓ (64.2s, 2 tool calls)
  ...
  → wrote reports/behaviors/tools/create-task.test.behaviors.md (8 behaviors)

[Phase 1] 2/311 files — tests/tools/update-task.test.ts
  ...

[Phase 1 complete] 311 files, 3410 behaviors extracted, 12 failed

[Phase 2] Evaluating behaviors...
  [1/3410] tools :: "creates a task with required fields" ✓ (25.3s)
  [2/3410] tools :: "rejects creation without auth" ✓ (22.1s)
  ...

[Phase 2 complete] 3410 behaviors evaluated, 5 failed
→ reports/stories/index.md written
```

## Phase 1: Extract

### Test Case Parsing

Regex-based extraction of `describe`/`it`/`test` blocks with their full nested body. Not an AST parser — regex is sufficient since the agent receives the full file and can request more context via tools.

Each test case is identified by its full path: `"describe block > nested describe > it name"`.

### Agent Prompt (Phase 1)

System message:

```
You are a senior software analyst examining a unit test from a Telegram/Discord/Mattermost
chat bot called "papai" that manages tasks via LLM tool-calling. Your job is to understand
what real-world behavior this test verifies and describe it in plain language that a
non-programmer could understand.

You have tools to read source files, search the codebase, find files, and list directories.
Use them to understand the implementation behind the test — follow imports, read the
functions being tested, understand the full chain from user input to bot response.

Respond with ONLY a JSON object:
{
  "behavior": "Plain-language description of what the bot does in this scenario, written
    as if explaining to someone who has never seen code. Start with 'When...' to describe
    the trigger, then describe what happens.",
  "context": "Technical context about HOW this works internally — what functions are
    called, what the data flow looks like. This is for developers reviewing the audit."
}
```

User message includes: the test case source code, the test file path, and a hint about the likely implementation file path (derived from `tests/X.test.ts` → `src/X.ts`).

### Behavior Output Format

Per test file: `reports/behaviors/<domain>/<test-filename>.behaviors.md`

Example: `reports/behaviors/tools/create-task.test.behaviors.md`

```markdown
# tests/tools/create-task.test.ts

## Test: "creates a task with required fields"

**Behavior:** When the user asks the bot to create a task providing only
a title, the bot creates it in the default project with status "Open"
and confirms back with the task ID.
**Context:** The bot calls `provider.createTask()` which requires
`projectId` and `title`. The `projectId` defaults to the first project
if not specified by the user.

## Test: "rejects creation without auth"

**Behavior:** When an unauthorized user tries to create a task, the bot
refuses and tells them to run /setup first.
**Context:** Auth check happens in `bot.ts` before the orchestrator
is invoked. The tool itself never executes.
```

### Progress Granularity

Progress tracks completed test **files** (not individual tests within a file). If interrupted mid-file, the whole file reruns on resume — acceptable since a file typically has 5–20 tests.

## Phase 2: Evaluate

### Personas

Three non-technical evaluation personas, each representing a different context of use:

#### Maria — Operations Manager (Work)

> You are Maria, 35, an operations manager at a mid-size logistics company. You coordinate 12 people across two warehouses. You use Telegram for personal chats and WhatsApp groups with your team. You've never used a bot for work — your tasks live in spreadsheets and sticky notes. You heard about this bot from a colleague who said "just text it what you need done." You have no idea what a "project" or "status" means in software terms — to you a project is "the holiday sale prep" and a status is "done or not done." You are practical, impatient with anything that feels like extra work, and will abandon a feature if it takes more than two tries to understand. You value: things just working, clear confirmations, not losing track of what you asked for. You get frustrated by: jargon, having to remember exact commands, anything that feels like filling out a form.

#### Dani — Freelance Photographer (Daily Routine)

> You are Dani, 28, a freelance event photographer. You juggle 15-20 clients at any time — weddings, corporate events, portraits. You track everything in your head and Apple Notes. You downloaded Telegram because a client uses it, and someone told you this bot can help you keep track of deadlines. You're creative, scattered, and hate rigid systems. You'd message the bot the same way you'd text a friend: "remind me to send the Garcia wedding proofs by Friday" or "what do I have due this week?" You have zero tolerance for anything that feels like software — if the bot asks you to "specify a project identifier" you'll close the chat and never come back. You value: natural conversation, the bot understanding messy input, gentle reminders. You get frustrated by: required fields, technical error messages, having to set things up before you can use them.

#### Viktor — Retired Teacher (Personal Life)

> You are Viktor, 62, a retired high school history teacher. You volunteer at a community center organizing events, tutoring schedules, and supply drives. Your daughter set up Telegram for you and showed you this bot, saying it's "like a smart to-do list you can talk to." You type slowly, use full sentences with punctuation, and sometimes make typos. You don't know what an API is, what "sync" means, or why anything needs a "token." You are patient but easily confused by unexpected responses. If the bot says something you don't understand, you'll politely ask it to explain — but if it keeps being confusing, you'll assume you're doing something wrong and stop trying. You value: polite responses, clear step-by-step guidance, being told what to do next. You get frustrated by: cryptic abbreviations, being expected to know things nobody taught you, responses that assume familiarity with technology.

### Agent Prompt (Phase 2)

System message includes all three persona descriptions, then:

```
You are evaluating a single behavior of a Telegram chat bot from the perspective of
all three personas above. You have tools to read source files, search the codebase,
find files, and list directories. Use them to look at actual bot responses, error
messages, system prompts, and command help text to judge the real UX — don't guess.

For each persona, evaluate:
- discover (1-5): Would they find and trigger this feature naturally?
- use (1-5): Could they use it successfully without help?
- retain (1-5): Would they keep using it after the first time?

Also identify the user story this behavior fulfills.

Respond with ONLY a JSON object:
{
  "userStory": "As a [user type], I want to [action] so that [benefit].",
  "maria": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "dani": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "viktor": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "flaws": ["flaw 1", "flaw 2"],
  "improvements": ["improvement 1", "improvement 2"]
}
```

User message includes: the behavior description, its context, the domain name, and the test file path.

### Story Output Format

Per domain: `reports/stories/<domain>.md`

```markdown
# Tools — User Stories & UX Evaluation

## "Create a task with just a title"

**User Story:** As a user, I want to tell the bot "create a task called
Fix the login page" and have it just work, without needing to know
which project or status to use.

| Persona | Discover | Use | Retain | Notes                                            |
| ------- | -------- | --- | ------ | ------------------------------------------------ |
| Maria   | 4        | 4   | 5      | "Just works, love it"                            |
| Dani    | 5        | 3   | 4      | "What project did it pick?"                      |
| Viktor  | 2        | 2   | 3      | "How do I start? Nobody told me to say 'create'" |

**Flaws:**

- No confirmation of which project was selected
- No way to undo if it picked the wrong project

**Improvements:**

- Always include project name in the confirmation message
- Offer "wrong project? say 'move to X'" in the response
```

### Summary Index

Auto-generated: `reports/stories/index.md`

```markdown
# Behavior Audit Summary

**Generated:** 2026-04-16T18:00:00Z
**Tests processed:** 3410 / 3410
**Behaviors failed:** 12

| Domain   | Behaviors | Avg Discover | Avg Use | Avg Retain | Worst Persona |
| -------- | --------- | ------------ | ------- | ---------- | ------------- |
| tools    | 245       | 3.8          | 3.2     | 3.5        | Viktor (2.1)  |
| commands | 48        | 2.5          | 2.8     | 3.0        | Dani (1.9)    |
| ...      |           |              |         |            |               |

## Top 10 Flaws (by frequency)

1. "Technical error messages shown to user" (seen in 34 behaviors)
2. ...

## Top 10 Improvements (by frequency)

1. "Include project name in confirmation" (suggested for 28 behaviors)
2. ...

## Failed Extractions

| Test File | Test Name | Error | Attempts |
| --------- | --------- | ----- | -------- |
| ...       | ...       | ...   | 3        |
```

### Progress Granularity

Phase 2 tracks individual behaviors by `testFile::testName` key. If interrupted mid-domain, resumes from the exact behavior.

## Error Handling & Retries

### Retry Policy

| Error type                          | Action                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| Timeout                             | Retry once with doubled timeout, then skip                                    |
| Malformed LLM output (invalid JSON) | Retry once with stricter prompt suffix, then skip                             |
| File not found (readFile tool)      | No retry — agent asked for wrong path, behavior recorded with partial context |
| Network error                       | Retry 3x with 100s delay                                                      |

**Max retries per test/behavior:** 3. After 3 failures, mark as failed in progress and move on. Failed items get a dedicated section in the final report.

### Timeouts

| Phase                | Per-call timeout | Rationale                                                              |
| -------------------- | ---------------- | ---------------------------------------------------------------------- |
| Phase 1 (extraction) | 1200s (20 min)   | Local LLM, deep code exploration with multiple tool calls              |
| Phase 2 (evaluation) | 600s (10 min)    | Local LLM, simpler task — reading behaviors + some code for UX context |

Retry backoff: 100s → 300s → 900s.

### Resume Logic

1. On start, check if `reports/progress.json` exists
2. If yes, skip all entries in `completedTests` / `completedBehaviors`
3. Retry entries in `failedTests` / `failedBehaviors` (reset attempt counter)
4. If `phase1.status === "done"`, jump straight to Phase 2

### Progress File Schema

```jsonc
{
  "version": 1,
  "startedAt": "2026-04-16T14:00:00Z",
  "phase1": {
    "status": "in-progress", // "not-started" | "in-progress" | "done"
    "completedTests": {
      "tests/tools/create-task.test.ts": {
        "tests/tools/create-task.test.ts::creates a task with required fields": "done",
        "tests/tools/create-task.test.ts::rejects creation without auth": "done",
      },
    },
    "failedTests": {
      "tests/tools/update-task.test.ts::updates status": {
        "error": "Timeout after 1200s",
        "attempts": 3,
        "lastAttempt": "2026-04-16T14:05:12Z",
      },
    },
    "completedFiles": ["tests/tools/create-task.test.ts"],
    "stats": { "filesTotal": 311, "filesDone": 1, "testsExtracted": 2, "testsFailed": 1 },
  },
  "phase2": {
    "status": "not-started",
    "completedBehaviors": {},
    "failedBehaviors": {},
    "stats": { "behaviorsTotal": 0, "behaviorsDone": 0, "behaviorsFailed": 0 },
  },
}
```

## Output File Tree

```
reports/
  progress.json
  behaviors/
    core/
      auth.test.behaviors.md
      bot.test.behaviors.md
      config.test.behaviors.md
      ...
    tools/
      create-task.test.behaviors.md
      update-task.test.behaviors.md
      ...
    commands/
      help.test.behaviors.md
      setup.test.behaviors.md
      ...
    chat-telegram/
      index.test.behaviors.md
      ...
    providers-youtrack/
      index.test.behaviors.md
      ...
    ...
  stories/
    index.md
    core.md
    tools.md
    commands.md
    chat-telegram.md
    chat-mattermost.md
    chat-discord.md
    providers-kaneo.md
    providers-youtrack.md
    ...
```

## Exclusions

- `tests/e2e/` — E2E tests require Docker infrastructure context that the agent can't meaningfully explore
- `tests/client/` — dashboard UI tests are out of scope for bot UX evaluation
- `tests/helpers/` — test utility tests don't represent user-facing behavior
- `tests/scripts/` — build/CI script tests are not user-facing
- `tests/review-loop/` — internal tooling, not user-facing
- `tests/types/` — type-level tests have no runtime behavior

## Implementation Modules

The script should be structured as:

| Module                                    | Responsibility                                              |
| ----------------------------------------- | ----------------------------------------------------------- |
| `scripts/behavior-audit.ts`               | Entry point, orchestrates both phases                       |
| `scripts/behavior-audit/config.ts`        | Hardcoded LLM config, timeouts, paths                       |
| `scripts/behavior-audit/progress.ts`      | Read/write/update progress.json                             |
| `scripts/behavior-audit/test-parser.ts`   | Parse test files into individual test cases                 |
| `scripts/behavior-audit/tools.ts`         | Agent tool definitions (readFile, grep, findFiles, listDir) |
| `scripts/behavior-audit/extract.ts`       | Phase 1 loop — per-test extraction agent calls              |
| `scripts/behavior-audit/evaluate.ts`      | Phase 2 loop — per-behavior evaluation agent calls          |
| `scripts/behavior-audit/personas.ts`      | Persona prompt text constants                               |
| `scripts/behavior-audit/domain-map.ts`    | Test path → domain mapping                                  |
| `scripts/behavior-audit/report-writer.ts` | Write behavior files, story files, index                    |
