<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ACP Lifecycle Hermetic Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `SCN-coding-acp-*` catalog record executable through frozen hermetic stories and qualify the trusted-module refactor against them.

**Architecture:** Extend the frozen baseline's strict fake-Magi boundary only for observed ACP HTTP routes, then add literal lifecycle stories using `ScenarioWorld` and the scripted LLM. Rebase the qualified trusted-module branch onto those frozen inputs; use compatibility failures to repair production composition, never the stories or harness.

**Tech Stack:** Bun, TypeScript, `bun:test`, ScenarioWorld, scripted LLM, strict HTTP dispatcher, fake Magi, coding trusted module.

**Design:** `docs/superpowers/specs/2026-07-13-acp-lifecycle-hermetic-coverage-design.md`

---

## Branch and freeze boundary

- The frozen-input baseline is `codex/scenario-catalog-hermetic-stories`, which already contains Phase 1 scenario seams and stories but not `plugin-core-separation` production changes.
- The qualified implementation branch is `codex/plugin-core-qualification` at `48ab45a48` or its successor.
- Tasks 1–5 change only baseline frozen inputs. Task 6 rebases the implementation branch onto the final baseline commit and changes production paths only.
- Frozen paths for Task 6 are `tests/stories/**`, `scripts/test-stories.ts`, `scripts/story-manifest*.ts`, `scripts/story-reports.ts`, `bunfig.toml`, `tests/setup.ts`, `tests/mock-reset.ts`, `tests/utils/test-helpers.ts`, and `tests/utils/logger-mock.ts`.

## File structure

- `tests/stories/harness/fake-magi.ts` — strict declarations and sanitized events for ACP lifecycle HTTP routes.
- `tests/stories/harness/fake-magi.test.ts` — fake protocol contract tests; no application behavior assertions.
- `tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts` — start-on-PR, project/agent discovery, list/status, forge preflight.
- `tests/stories/integrations/coding-sessions/acp-controls.story.test.ts` — cautious permission, finish, cancel, and continued sessions.
- `tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts` — MCP session success and fail-closed configuration safety.
- `tests/stories/catalog/coverage.ts` — literal manifest mappings for every ACP catalog record.
- `src/modules/coding/acp/**`, `src/modules/coding/credentials/**`, and composition ports — implementation-only repair targets after the rebase if a frozen story finds a real mismatch.

### Task 1: Add strict fake-Magi lifecycle protocol declarations on the baseline

**Files:**

- Modify: `tests/stories/harness/fake-magi.ts`
- Create: `tests/stories/harness/fake-magi.test.ts`

- [ ] **Step 1: Write failing fake protocol contract tests**

Add tests that declare each lifecycle request and assert the strict dispatcher accepts exactly the method, URL, bearer token, JSON body, and encoded session id. Include one rejection test for an undeclared request and one redaction test.

```ts
const magi = createFakeMagi({ http, events, baseUrl: 'https://magi.invalid', token: 'secret' })
magi.expectFinish(
  'session/a',
  { action: 'pr', forgeToken: 'forge-secret' },
  { prUrl: 'https://github.com/acme/papai/pull/42' },
)
await http.fetch('https://magi.invalid/sessions/session%2Fa/finish', {
  method: 'POST',
  headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'pr', forgeToken: 'forge-secret' }),
})
expect(events.all()).toContainEqual(expect.objectContaining({ kind: 'magi.session.finish' }))
expect(JSON.stringify(events.all())).not.toContain('forge-secret')
```

- [ ] **Step 2: Verify RED**

Run: `bun test tests/stories/harness/fake-magi.test.ts`

Expected: FAIL because lifecycle expectation methods do not exist.

- [ ] **Step 3: Implement the minimal strict protocol**

Add typed declaration methods for:

```ts
expectAgents(agents)
expectSessions(filter, sessions)
expectSession(sessionId, session)
expectPermissions(sessionId, pending)
expectPermissionDecision(sessionId, { toolCallId, decision })
expectFinish(sessionId, body, result)
expectCancel(sessionId, result)
expectFollowUp(sessionId, body, result)
```

Validate request JSON with Zod schemas, record only IDs/action/count/status/PR presence in events, reject undeclared routes through the existing strict dispatcher, and keep `verifyConsumed()` authoritative.

- [ ] **Step 4: Verify GREEN**

Run: `bun test tests/stories/harness/fake-magi.test.ts`

Expected: PASS with declarations consumed and no secret-bearing event payload.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/fake-magi.ts tests/stories/harness/fake-magi.test.ts
git commit -m "test(stories): extend strict ACP fake Magi lifecycle protocol"
```

### Task 2: Freeze start-on-PR, preflight, and discovery stories on the baseline

**Files:**

- Create: `tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts`

- [ ] **Step 1: Write failing literal stories**

Write these exact named stories using real `given.codingSession`, repository/credential setup, `given.llm`, and fake-Magi expectations:

```ts
scenario(
  'SCN-coding-acp-start-on-pr: starts a configured session with PR and forge token',
  async ({ given, when, then, world }) => {
    // Configure SaaS repo, agent provider, forge token, and fake POST /sessions expected with prNumber: 42.
    // Script coding-session.start; assert reply, persisted record, sanitized magi.session.start event with prNumber, and consumed fake.
  },
)

scenario(
  'SCN-coding-acp-self-hosted-forge-preflight: refuses a self-hosted repository without forge settings',
  async ({ given, when, then, world }) => {
    // Configure a non-github/gitlab URL and agent provider only.
    // Script coding-session.start; assert no HTTP, no session record, and redacted events.
  },
)
```

Add literal records for `SCN-coding-acp-list-projects`, `SCN-coding-acp-list-agents`, `SCN-coding-acp-list-sessions`, and `SCN-coding-acp-session-status`. List-projects asserts no HTTP; list-sessions uses fake `/sessions?filter=active` and returns only a locally started record; status asserts a declared 404 produces the scripted user reply without local mutation.

- [ ] **Step 2: Verify RED**

Run: `bun test:stories -- tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts`

Expected: FAIL until the fake-Magi lifecycle declarations and any missing public setup support exist.

- [ ] **Step 3: Add only observed fixture support**

If a story cannot configure coding repositories or credentials through existing public scenario setup, add one narrow prerequisite-only `given` operation with a harness contract test. Do not invoke ACP tools or stores directly from a story.

- [ ] **Step 4: Verify GREEN**

Run: `bun test:stories -- tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts`

Expected: all six literal stories pass; fake Magi has no unconsumed request and every denial has zero HTTP/session side effect.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts tests/stories/harness
git commit -m "test(stories): freeze ACP start and discovery coverage"
```

### Task 3: Freeze cautious-permission and session-control stories on the baseline

**Files:**

- Create: `tests/stories/integrations/coding-sessions/acp-controls.story.test.ts`

- [ ] **Step 1: Write failing literal stories**

Cover these records with separate stories and distinct happy/unhappy assertions:

```ts
scenario(
  'SCN-coding-acp-cautious-permission-roundtrip: resolves every pending cautious permission decision',
  async ({ given, when, then, world }) => {
    // Declare GET /permissions with two toolCallIds and two matching POST decisions.
    // Script answer_permission allow; assert resolved: 2 reply, both sanitized decision events, and no pending request remains.
  },
)

scenario(
  'SCN-coding-acp-finish-push: finishes a session by pushing its branch',
  async ({ given, when, then, world }) => {
    // Declare POST /finish action push; assert user reply/event and no secret in trace.
  },
)
```

Add `SCN-coding-acp-finish-pr`, `SCN-coding-acp-cancel`, `SCN-coding-acp-continue-followup`, and `SCN-coding-acp-continue-by-pr`. The PR continuation story must declare `GET /sessions?filter=done`, use only a locally-known matching parent, then declare exactly one follow-up request. A foreign or missing parent is an unhappy assertion: no follow-up request or child record.

- [ ] **Step 2: Verify RED**

Run: `bun test:stories -- tests/stories/integrations/coding-sessions/acp-controls.story.test.ts`

Expected: FAIL because permission/control fake routes and/or production contribution behavior is incomplete.

- [ ] **Step 3: Implement only harness behavior observed in the RED run**

Keep permission, finish, cancel, and follow-up state in fake Magi declarations. Fake state must never auto-create a session or imitate LLM behavior; all observed writes come from production ACP calls.

- [ ] **Step 4: Verify GREEN**

Run: `bun test:stories -- tests/stories/integrations/coding-sessions/acp-controls.story.test.ts`

Expected: each literal record passes, empty pending permission produces no POST, and missing forge/parent branches create no side effects.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/integrations/coding-sessions/acp-controls.story.test.ts tests/stories/harness/fake-magi.ts
git commit -m "test(stories): freeze ACP permission and session controls"
```

### Task 4: Freeze MCP session coverage on the baseline

**Files:**

- Create: `tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts`
- Modify: `tests/stories/harness/fake-magi.ts` only if RED proves an exact request field is unobservable

- [ ] **Step 1: Write failing MCP success and failure stories**

```ts
scenario(
  'SCN-coding-acp-mcp-session: starts a session with configured MCP details without leaking token',
  async ({ given, when, then, world }) => {
    // Configure a valid coding MCP selection through production-facing prerequisite setup.
    // Declare POST /sessions expected with sanitized MCP server identity; script coding-session.start.
    // Assert reply/record/start event and that serialized events omit MCP token/header secret.
  },
)
```

Add the paired unhappy branch in the same story file: unresolved or malformed MCP configuration refuses session start before fake Magi, leaves no session record, and reports no secret in events. The literal catalog mapping remains only `SCN-coding-acp-mcp-session`; the unhappy branch is its safety oracle.

- [ ] **Step 2: Verify RED**

Run: `bun test:stories -- tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts`

Expected: FAIL until the scenario can configure the observed MCP boundary or the fake validates the actual request shape.

- [ ] **Step 3: Add the narrowest observed setup/fixture seam**

Add a public prerequisite setup method only for durable coding MCP configuration if none exists. Ensure it calls the existing production store/route-level setup boundary and receives a harness contract test. Do not add a generic dependency override.

- [ ] **Step 4: Verify GREEN**

Run: `bun test:stories -- tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts`

Expected: success declares and consumes exactly one session request; failure has no HTTP or record side effect.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts tests/stories/harness
git commit -m "test(stories): freeze ACP MCP session coverage"
```

### Task 5: Move every ACP catalog record to executable on the baseline

**Files:**

- Modify: `tests/stories/catalog/coverage.ts`
- Test: `tests/stories/catalog/coverage.test.ts`

- [ ] **Step 1: Write failing ledger assertions**

Add an explicit expected map for all ACP IDs. Existing Phase 1 mappings remain intact; each new ID must point to exactly one literal story name created in Tasks 2–4.

```ts
expect(executableStoryIdsFor('SCN-coding-acp-finish-pr')).toEqual([
  'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-finish-pr: finishes a session by opening a PR',
])
```

- [ ] **Step 2: Verify RED**

Run: `bun test tests/stories/catalog/coverage.test.ts && bun test:stories:manifest`

Expected: FAIL because the new literal story IDs have not yet been entered in the coverage ledger.

- [ ] **Step 3: Map every ACP ID**

Extend `QUALIFICATION_STORY_IDS` so all eighteen ACP catalog IDs resolve to literal manifest entries, including existing Phase 1 stories. Do not change catalog status classification; forward-only records stay forward-only while becoming executable.

- [ ] **Step 4: Verify GREEN and freeze baseline**

Run:

```bash
bun test tests/stories/catalog/coverage.test.ts
bun test:stories:manifest
bun test:stories:contracts
bun test:stories -- tests/stories/integrations/coding-sessions
bun test:stories:stress
```

Expected: ledger is complete for ACP, all new stories manifest-resolve, and randomized stories pass.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/catalog/coverage.test.ts
git commit -m "test(stories): mark ACP catalog coverage executable"
```

### Task 6: Rebase and qualify the trusted-module implementation without changing frozen inputs

**Files:**

- Modify only if compatibility fails: `src/modules/coding/acp/**`, `src/modules/coding/credentials/**`, `src/composition/**`, `src/runtime/**`, `src/ports/**`
- Verify unchanged: all frozen paths named above

- [ ] **Step 1: Rebase implementation branch onto the final Phase 2 baseline commit**

```bash
OLD_BASE=$(git merge-base codex/plugin-core-qualification <phase2-baseline-sha>)
git switch codex/plugin-core-qualification
git rebase --onto <phase2-baseline-sha> "$OLD_BASE"
```

Resolve only production conflicts. Do not stage frozen inputs while resolving.

- [ ] **Step 2: Prove frozen-input identity before execution**

```bash
BASE_REF=<phase2-baseline-sha> bun test:stories:compat --manifest-only
git diff --exit-code <phase2-baseline-sha> -- tests/stories scripts/test-stories.ts scripts/story-manifest.ts scripts/story-manifest-candidate.ts scripts/story-manifest-scenarios.ts scripts/story-reports.ts bunfig.toml tests/setup.ts tests/mock-reset.ts tests/utils/test-helpers.ts tests/utils/logger-mock.ts
```

Expected: both commands exit 0.

- [ ] **Step 3: Run compatibility RED and repair production only**

Run: `BASE_REF=<phase2-baseline-sha> bun test:stories:compat`

Expected: initially exposes any trusted-module regression in lifecycle, MCP, credential, capability, or guarded HTTP composition. For each failure, first add a non-frozen production regression test, then make the smallest production repair.

- [ ] **Step 4: Run the full qualification gate**

Run:

```bash
BASE_REF=<phase2-baseline-sha> bun test:stories:compat
bun test:stories:contracts
bun test:stories
bun test:stories:stress
bun test tests/stories/catalog/coverage.test.ts
bun test tests/modules/coding/acp
bun test tests/modules/coding/credentials
bun test tests/composition/load-trusted-modules.test.ts
bun test tests/architecture-guard.test.ts
bun run typecheck
```

Expected: no failure, frozen diff remains zero, all eighteen ACP catalog entries are executable.

- [ ] **Step 5: Commit production-only compatibility repairs**

```bash
git add src tests/modules tests/composition tests/runtime
git commit -m "fix(coding): qualify ACP lifecycle stories through modules"
```

### Task 7: Final review and handoff

- [ ] **Step 1: Run independent specification review**

Confirm every remaining ACP catalog ID has a literal story, all Phase 1 inputs remained unchanged, and no non-ACP scope was introduced.

- [ ] **Step 2: Run independent code-quality review**

Inspect strict fake boundaries, lifecycle cleanup, provider/MCP secret redaction, cross-context filtering, and production-only repairs.

- [ ] **Step 3: Re-run final evidence**

Run:

```bash
BASE_REF=<phase2-baseline-sha> bun test:stories:compat
bun test:stories:contracts
bun test:stories:stress
bun test tests/stories/catalog/coverage.test.ts
bun run typecheck
git status --short
```

Expected: all tests pass and the working tree is clean.

## Plan self-review

- Every Phase 2 design scope item maps to Tasks 1–6.
- Tasks define literal ACP catalog records, strict protocol methods, their safety assertions, and exact verification commands.
- The baseline/refactor freeze boundary is explicit, so implementation cannot silently rewrite qualification inputs.
- The plan has no placeholders; angle-bracket SHAs in rebase commands are values obtained from the completed baseline commit, not deferred design decisions.
