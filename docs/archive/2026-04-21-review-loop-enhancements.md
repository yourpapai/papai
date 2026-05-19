# Review Loop Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the review-loop with expanded severities, plan-then-fix flow, commit discipline, and open permission policy.

**Architecture:** Swap reviewer to opencode (Kimi K2.6) and fixer to claude (Sonnet 4.6). Extend the issue schema with `medium`/`low` severity, replace `fixPlan` with `needsPlanning`, add a planning step before fixing, instruct the fixer to commit and validate, and simplify the permission policy to always-allow.

**Tech Stack:** TypeScript, Bun, Zod v4, ACP SDK, p-limit

---

### Task 1: Config — maxRounds default + agent swap

**Files:**

- Modify: `scripts/review-loop/config.ts:28`
- Modify: `scripts/review-loop/config.example.json`
- Test: `tests/review-loop/run-state.test.ts` (verify existing tests pass)

- [ ] **Step 1: Update maxRounds default in config schema**

In `scripts/review-loop/config.ts`, change line 28:

```typescript
maxRounds: z.number().int().positive().default(10),
```

- [ ] **Step 2: Update config.example.json — swap agents, set models**

Replace entire file `scripts/review-loop/config.example.json`:

```json
{
  "repoRoot": ".",
  "workDir": ".review-loop",
  "maxRounds": 10,
  "maxNoProgressRounds": 2,
  "reviewer": {
    "command": "opencode",
    "args": ["acp"],
    "env": {},
    "sessionConfig": {
      "model": "kimi-k2-0711-ollama-cloud"
    },
    "invocationPrefix": "/review-code",
    "requireInvocationPrefix": false
  },
  "fixer": {
    "command": "/usr/local/bin/claude-acp-adapter",
    "args": [],
    "env": {},
    "sessionConfig": {
      "model": "claude-sonnet-4-20250514",
      "thinking_effort": "high"
    },
    "verifyInvocationPrefix": null,
    "fixInvocationPrefix": null,
    "requireVerifyInvocation": false
  }
}
```

- [ ] **Step 3: Run tests to verify nothing breaks**

Run: `bun test tests/review-loop/run-state.test.ts`
Expected: All tests pass (config default change is backward-compatible).

- [ ] **Step 4: Commit**

```bash
git add scripts/review-loop/config.ts scripts/review-loop/config.example.json
git commit -m "feat(review-loop): swap agents, raise maxRounds default to 10"
```

---

### Task 2: Issue Schema — expand severity, replace fixPlan with needsPlanning

**Files:**

- Modify: `scripts/review-loop/issue-schema.ts`
- Test: `tests/review-loop/issue-schema.test.ts`
- Test: `tests/review-loop/issue-ledger.test.ts` (uses VerifierDecision — must update `fixPlan` references)

- [ ] **Step 1: Write failing tests for expanded severity and needsPlanning**

In `tests/review-loop/issue-schema.test.ts`, add after the last test inside the `describe` block:

```typescript
test('parseReviewerIssues accepts medium severity', () => {
  const parsed = parseReviewerIssues(
    JSON.stringify({
      round: 1,
      issues: [
        {
          title: 'Minor naming inconsistency',
          severity: 'medium',
          summary: 'Variable names do not follow convention.',
          whyItMatters: 'Reduces readability for new contributors.',
          evidence: 'src/utils.ts line 42',
          file: 'src/utils.ts',
          lineStart: 42,
          lineEnd: 44,
          suggestedFix: 'Rename to camelCase.',
          confidence: 0.7,
        },
      ],
    }),
  )

  expect(parsed.issues).toHaveLength(1)
  expect(parsed.issues[0]?.severity).toBe('medium')
})

test('parseReviewerIssues accepts low severity', () => {
  const parsed = parseReviewerIssues(
    JSON.stringify({
      round: 1,
      issues: [
        {
          title: 'Extra blank line',
          severity: 'low',
          summary: 'Double blank line between functions.',
          whyItMatters: 'Minor style issue.',
          evidence: 'src/utils.ts line 50',
          file: 'src/utils.ts',
          lineStart: 50,
          lineEnd: 51,
          suggestedFix: 'Remove extra blank line.',
          confidence: 0.6,
        },
      ],
    }),
  )

  expect(parsed.issues).toHaveLength(1)
  expect(parsed.issues[0]?.severity).toBe('low')
})

test('parseVerifierDecision accepts needsPlanning boolean', () => {
  const parsed = parseVerifierDecision(
    JSON.stringify({
      verdict: 'valid',
      fixability: 'auto',
      reasoning: 'Complex multi-file change needed.',
      targetFiles: ['src/a.ts', 'src/b.ts'],
      needsPlanning: true,
    }),
  )

  expect(parsed.needsPlanning).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/issue-schema.test.ts`
Expected: The three new tests fail (severity enum doesn't include `medium`/`low`, `VerifierDecisionSchema` still requires `fixPlan`).

- [ ] **Step 3: Update issue-schema.ts**

In `scripts/review-loop/issue-schema.ts`:

Change line 5 — expand severity enum:

```typescript
severity: z.enum(['critical', 'high', 'medium', 'low']),
```

Change `VerifierDecisionSchema` (lines 21–27) — replace `fixPlan` with `needsPlanning`:

```typescript
export const VerifierDecisionSchema = z.object({
  verdict: z.enum(['valid', 'invalid', 'already_fixed', 'needs_human']),
  fixability: z.enum(['auto', 'manual']),
  reasoning: z.string().min(1),
  targetFiles: z.array(z.string().min(1)),
  needsPlanning: z.boolean(),
})
```

- [ ] **Step 4: Update test fixtures that reference fixPlan**

In `tests/review-loop/issue-schema.test.ts`, update the existing `parseVerifierDecision` test at line 48. Replace the JSON in the `parseVerifierDecision` call:

```typescript
test('parseVerifierDecision accepts lightly wrapped JSON', () => {
  const parsed = parseVerifierDecision(
    `Verifier result follows.

{"verdict":"valid","fixability":"auto","reasoning":"Looks good.","targetFiles":["src/app.ts"],"needsPlanning":false}

End result.`,
  )

  expect(parsed.verdict).toBe('valid')
  expect(parsed.targetFiles).toEqual(['src/app.ts'])
  expect(parsed.needsPlanning).toBe(false)
})
```

In `tests/review-loop/issue-ledger.test.ts`, replace all `fixPlan` properties in `VerifierDecision` objects with `needsPlanning: false` (there are three occurrences at approximately lines 77, 84, and 110).

In `tests/review-loop/prompt-templates.test.ts`, update the `verifierDecision` fixture at line 26. Replace:

```typescript
const verifierDecision: VerifierDecision = {
  verdict: 'valid',
  fixability: 'auto',
  reasoning: 'The policy is too permissive and can be tightened safely.',
  targetFiles: ['scripts/review-loop/permission-policy.ts'],
  needsPlanning: false,
}
```

In `tests/review-loop/loop-controller.test.ts`, replace all `fixPlan` properties in fixer reply JSON objects with `needsPlanning: false` (there are multiple occurrences throughout the file — search for `fixPlan` and replace each with `needsPlanning: false`).

- [ ] **Step 5: Run all review-loop tests**

Run: `bun test tests/review-loop/`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/review-loop/issue-schema.ts tests/review-loop/issue-schema.test.ts tests/review-loop/issue-ledger.test.ts tests/review-loop/prompt-templates.test.ts tests/review-loop/loop-controller.test.ts
git commit -m "feat(review-loop): expand severity to medium/low, replace fixPlan with needsPlanning"
```

---

### Task 3: Permission Policy — simplify to always-allow

**Files:**

- Modify: `scripts/review-loop/permission-policy.ts`
- Test: `tests/review-loop/permission-policy.test.ts`

- [ ] **Step 1: Write failing test for always-allow behavior**

In `tests/review-loop/permission-policy.test.ts`, add a new test inside the `describe` block:

```typescript
test('always allows any request kind regardless of paths or commands', () => {
  const allowOptions = [
    { optionId: 'allow-once', kind: 'allow_once' as const },
    { optionId: 'reject-once', kind: 'reject_once' as const },
  ]

  expect(
    decidePermissionOptionId(
      {
        title: 'MCP tool call',
        kind: 'execute',
        locations: [],
        rawInput: { tool: 'context7', query: 'some query' },
        options: allowOptions,
      },
      '/repo',
    ),
  ).toBe('allow-once')

  expect(
    decidePermissionOptionId(
      {
        title: 'Web search',
        kind: 'execute',
        locations: [],
        rawInput: { command: 'curl https://example.com' },
        options: allowOptions,
      },
      '/repo',
    ),
  ).toBe('allow-once')

  expect(
    decidePermissionOptionId(
      {
        title: 'Unknown tool',
        kind: 'other',
        locations: [],
        rawInput: {},
        options: allowOptions,
      },
      '/repo',
    ),
  ).toBe('allow-once')
})
```

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `bun test tests/review-loop/permission-policy.test.ts`
Expected: The new test fails because `other` kind and unrestricted execute currently get rejected.

- [ ] **Step 3: Simplify permission-policy.ts**

Replace the body of `scripts/review-loop/permission-policy.ts` with a minimal always-allow implementation. Keep the `PermissionOption` and `PermissionRequestLike` types exported (they are imported by other modules). Remove all the safe-execute patterns, path checks, and command validation. The new `decidePermissionOptionId`:

```typescript
export function decidePermissionOptionId(request: PermissionRequestLike, _repoRoot: string): string {
  const allowOption = request.options.find((option) => option.kind === 'allow_once' || option.kind === 'allow_always')
  if (allowOption !== undefined) {
    return allowOption.optionId
  }

  const firstOption = request.options[0]
  if (firstOption !== undefined) {
    return firstOption.optionId
  }

  throw new Error('No permission options provided by the ACP agent')
}
```

Delete all unused helper functions: `isRepoPath`, `isPathLikeToken`, `stripMatchingQuotes`, `normalizeCommand`, `chooseOption`, `isSafeExecuteCommand`, `areBunTestFlagsSafe`, `getPathCandidate`, `areExecutePathsSafe`. Delete the `SAFE_EXECUTE_PATTERNS`, `BUN_TEST_SAFE_FLAGS`, and `UNSAFE_COMMAND_TOKENS` constants.

- [ ] **Step 4: Update existing permission-policy tests**

The existing tests assert specific allow/reject behavior for path-safe edits, safe commands, and out-of-repo paths. Under always-allow, everything returns `allow-once`. Replace the entire test file content:

```typescript
import { describe, expect, test } from 'bun:test'

import { decidePermissionOptionId } from '../../scripts/review-loop/permission-policy.js'

describe('decidePermissionOptionId', () => {
  test('allows all request kinds when an allow option exists', () => {
    const options = [
      { optionId: 'allow-once', kind: 'allow_once' as const },
      { optionId: 'reject-once', kind: 'reject_once' as const },
    ]

    expect(
      decidePermissionOptionId(
        {
          title: 'Edit any file',
          kind: 'edit',
          locations: [{ path: '/etc/passwd' }],
          rawInput: {},
          options,
        },
        '/repo',
      ),
    ).toBe('allow-once')

    expect(
      decidePermissionOptionId(
        {
          title: 'Execute anything',
          kind: 'execute',
          locations: [],
          rawInput: { command: 'rm -rf /' },
          options,
        },
        '/repo',
      ),
    ).toBe('allow-once')

    expect(
      decidePermissionOptionId(
        {
          title: 'Other tool',
          kind: 'other',
          locations: [],
          rawInput: {},
          options,
        },
        '/repo',
      ),
    ).toBe('allow-once')
  })

  test('falls back to first available option when no allow option exists', () => {
    const options = [{ optionId: 'reject-once', kind: 'reject_once' as const }]

    expect(
      decidePermissionOptionId(
        {
          title: 'Edit file',
          kind: 'edit',
          locations: [{ path: 'src/foo.ts' }],
          rawInput: {},
          options,
        },
        '/repo',
      ),
    ).toBe('reject-once')
  })

  test('prefers allow_once over allow_always', () => {
    const options = [
      { optionId: 'allow-always', kind: 'allow_always' as const },
      { optionId: 'allow-once', kind: 'allow_once' as const },
    ]

    expect(
      decidePermissionOptionId(
        {
          title: 'Edit',
          kind: 'edit',
          locations: [{ path: 'src/foo.ts' }],
          rawInput: {},
          options,
        },
        '/repo',
      ),
    ).toBe('allow-once')
  })

  test('throws when no options are provided', () => {
    expect(() =>
      decidePermissionOptionId(
        {
          title: 'Edit',
          kind: 'edit',
          locations: [],
          rawInput: {},
          options: [],
        },
        '/repo',
      ),
    ).toThrow('No permission options provided by the ACP agent')
  })
})
```

- [ ] **Step 5: Run permission-policy tests**

Run: `bun test tests/review-loop/permission-policy.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/review-loop/permission-policy.ts tests/review-loop/permission-policy.test.ts
git commit -m "feat(review-loop): simplify permission policy to always-allow"
```

---

### Task 4: Prompt Templates — expanded severity, planning prompt, commit instructions

**Files:**

- Modify: `scripts/review-loop/prompt-templates.ts`
- Test: `tests/review-loop/prompt-templates.test.ts`

- [ ] **Step 1: Write failing tests for new prompt behavior**

In `tests/review-loop/prompt-templates.test.ts`, add tests inside the `describe` block:

```typescript
test('buildReviewPrompt includes all severity levels in schema', () => {
  const prompt = buildReviewPrompt('/repo/plan.md', [])

  expect(prompt).toContain('"severity": "critical" | "high" | "medium" | "low"')
  expect(prompt).not.toContain('Only include severity critical or high findings.')
})

test('buildPlanningPrompt includes issue and decision', () => {
  const prompt = buildPlanningPrompt(reviewerIssue, verifierDecision)

  expect(prompt).toContain('Produce a step-by-step plan to fix')
  expect(prompt).toContain('"title": "Missing validation"')
  expect(prompt).toContain('"verdict": "valid"')
})

test('buildFixPrompt with plan includes the plan text', () => {
  const prompt = buildFixPrompt(reviewerIssue, verifierDecision, 'Step 1: Update queue.ts')

  expect(prompt).toContain('Fix Plan:')
  expect(prompt).toContain('Step 1: Update queue.ts')
  expect(prompt).toContain('Commit the fix')
})

test('buildFixPrompt without plan omits plan section', () => {
  const prompt = buildFixPrompt(reviewerIssue, verifierDecision)

  expect(prompt).not.toContain('Fix Plan:')
  expect(prompt).toContain('Commit the fix')
})

test('buildFixPrompt includes commit and check instructions', () => {
  const prompt = buildFixPrompt(reviewerIssue, verifierDecision)

  expect(prompt).toContain('Run `bun check:full`')
  expect(prompt).toContain('fix(review-loop):')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/prompt-templates.test.ts`
Expected: New tests fail — `buildPlanningPrompt` doesn't exist, `buildFixPrompt` doesn't accept a plan parameter, review prompt still says "critical or high only".

- [ ] **Step 3: Update prompt-templates.ts**

Replace `scripts/review-loop/prompt-templates.ts`:

```typescript
import type { LedgerIssueRecord } from './issue-ledger.js'
import type { ReviewerIssue, VerifierDecision } from './issue-schema.js'

function summarizeLedger(records: readonly LedgerIssueRecord[]): string {
  if (records.length === 0) {
    return 'No prior issues recorded.'
  }

  return records.map((record) => `- ${record.fingerprint} [${record.status}] ${record.issue.title}`).join('\n')
}

export function buildReviewPrompt(planPath: string, ledgerRecords: readonly LedgerIssueRecord[]): string {
  return [
    `Review the current implementation against the implementation plan at: ${planPath}.`,
    'Return JSON only.',
    'Include all severity levels: critical, high, medium, low.',
    'Use this exact schema:',
    '{"round": number, "issues": [{"title": string, "severity": "critical" | "high" | "medium" | "low", "summary": string, "whyItMatters": string, "evidence": string, "file": string, "lineStart": number, "lineEnd": number, "suggestedFix": string, "confidence": number}]}',
    'Prior issue ledger:',
    summarizeLedger(ledgerRecords),
  ].join('\n\n')
}

export function buildVerifyPrompt(planPath: string, issue: ReviewerIssue): string {
  return [
    `Verify this issue against the implementation plan at: ${planPath}.`,
    'Return JSON only.',
    'Use this exact schema:',
    '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "needsPlanning": boolean}',
    'Set needsPlanning to true if the fix touches multiple files, changes public APIs, or requires non-trivial refactoring.',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}

export function buildPlanningPrompt(issue: ReviewerIssue, decision: VerifierDecision): string {
  return [
    'Produce a step-by-step plan to fix the verified issue below.',
    'The plan should be specific enough that a developer can follow it without re-reading the original issue.',
    'Return the plan as plain text.',
    'Issue:',
    JSON.stringify(issue, null, 2),
    'Verifier decision:',
    JSON.stringify(decision, null, 2),
  ].join('\n\n')
}

export function buildFixPrompt(issue: ReviewerIssue, decision: VerifierDecision, plan?: string): string {
  const sections = [
    'Fix exactly the verified issue below.',
    'Keep the fix minimal and do not broaden scope unless required for correctness.',
  ]

  if (plan !== undefined) {
    sections.push('Fix Plan:', plan)
  }

  sections.push(
    'After applying the fix:',
    '1. Run `bun check:full` to validate (lint, typecheck, format, tests).',
    '2. If any check fails, fix the failure.',
    '3. Commit with message: fix(review-loop): <issue title>',
    '4. Leave a clean worktree with no uncommitted changes.',
    'Issue:',
    JSON.stringify(issue, null, 2),
    'Verifier decision:',
    JSON.stringify(decision, null, 2),
  )

  return sections.join('\n\n')
}

export function buildRereviewPrompt(planPath: string, ledgerRecords: readonly LedgerIssueRecord[]): string {
  return [
    `Re-review the current implementation against the implementation plan at: ${planPath}.`,
    'Return JSON only with remaining critical/high/medium/low issues.',
    'Confirm whether previously fixed issues are resolved and report only unresolved or newly introduced issues.',
    'Use the same schema as the original review prompt.',
    'Current issue ledger:',
    summarizeLedger(ledgerRecords),
  ].join('\n\n')
}
```

- [ ] **Step 4: Update prompt-templates test imports**

The test file imports `buildFixPrompt`, `buildRereviewPrompt`, `buildReviewPrompt`, `buildVerifyPrompt`. Add `buildPlanningPrompt` to the import.

- [ ] **Step 5: Run prompt-templates tests**

Run: `bun test tests/review-loop/prompt-templates.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/review-loop/prompt-templates.ts tests/review-loop/prompt-templates.test.ts
git commit -m "feat(review-loop): expand severities, add planning prompt, commit discipline in fix prompt"
```

---

### Task 5: Loop Controller — plan-then-fix flow

**Files:**

- Modify: `scripts/review-loop/loop-controller.ts`
- Test: `tests/review-loop/loop-controller.test.ts`

- [ ] **Step 1: Write failing test for needsPlanning flow**

In `tests/review-loop/loop-controller.test.ts`, add a new test inside the `describe('runReviewLoop')` block:

```typescript
test('plans before fixing when verifier sets needsPlanning to true', async () => {
  const repoRoot = makeTempDir()
  const config: ReviewLoopConfig = {
    repoRoot,
    workDir: path.join(repoRoot, '.review-loop'),
    maxRounds: 5,
    maxNoProgressRounds: 2,
    reviewer: {
      command: 'opencode',
      args: ['acp'],
      env: {},
      sessionConfig: {},
      invocationPrefix: null,
      requireInvocationPrefix: false,
    },
    fixer: {
      command: '/usr/local/bin/claude-acp-adapter',
      args: [],
      env: {},
      sessionConfig: {},
      verifyInvocationPrefix: null,
      fixInvocationPrefix: null,
      requireVerifyInvocation: false,
    },
  }

  const planPath = path.join(repoRoot, 'plan.md')
  const runState = await createRunState(config, planPath)
  const ledger = await createIssueLedger(runState.runDir)
  const fixerPrompts: string[] = []

  const result = await runReviewLoop({
    config,
    runState,
    ledger,
    reviewer: {
      availableCommands: [],
      promptText: () =>
        Promise.resolve({
          text: JSON.stringify({
            round: 1,
            issues: [
              {
                title: 'Complex refactoring needed',
                severity: 'high',
                summary: 'Module boundary is wrong.',
                whyItMatters: 'Causes import cycles.',
                evidence: 'src/a.ts line 10',
                file: 'src/a.ts',
                lineStart: 10,
                lineEnd: 20,
                suggestedFix: 'Move interface to shared module.',
                confidence: 0.85,
              },
            ],
          }),
          stopReason: 'end_turn',
        }),
    },
    fixer: {
      availableCommands: [],
      promptText: (text) => {
        fixerPrompts.push(text)
        const promptIndex = fixerPrompts.length
        if (promptIndex === 1) {
          return Promise.resolve({
            text: JSON.stringify({
              verdict: 'valid',
              fixability: 'auto',
              reasoning: 'Needs multi-file change.',
              targetFiles: ['src/a.ts', 'src/b.ts'],
              needsPlanning: true,
            }),
            stopReason: 'end_turn',
          })
        }
        if (promptIndex === 2) {
          return Promise.resolve({
            text: 'Step 1: Move interface. Step 2: Update imports.',
            stopReason: 'end_turn',
          })
        }
        return Promise.resolve({
          text: 'Applied the fix and committed.',
          stopReason: 'end_turn',
        })
      },
    },
  })

  expect(result.doneReason).toBe('clean')
  expect(fixerPrompts).toHaveLength(3)
  expect(fixerPrompts[1]).toContain('step-by-step plan')
  expect(fixerPrompts[2]).toContain('Fix Plan:')
  expect(fixerPrompts[2]).toContain('Step 1: Move interface')
})
```

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `bun test tests/review-loop/loop-controller.test.ts`
Expected: The new test fails because `processIssueVerifyFix` does not yet handle `needsPlanning`.

- [ ] **Step 3: Update loop-controller.ts**

In `scripts/review-loop/loop-controller.ts`, update the import from `prompt-templates.js` to include `buildPlanningPrompt`:

```typescript
import {
  buildFixPrompt,
  buildPlanningPrompt,
  buildReviewPrompt,
  buildRereviewPrompt,
  buildVerifyPrompt,
} from './prompt-templates.js'
```

Update the `processIssueVerifyFix` function. Replace the existing function (lines 50–75):

```typescript
async function processIssueVerifyFix(
  record: LedgerIssueRecord,
  deps: ReviewLoopDeps,
): Promise<{ fixedThisIssue: boolean }> {
  const verifyPrompt = resolveInvocationText(
    deps.config.fixer.verifyInvocationPrefix,
    deps.fixer.availableCommands,
    buildVerifyPrompt(deps.runState.planPath, record.issue),
    deps.config.fixer.requireVerifyInvocation,
  )
  const verifyDecision = parseVerifierDecision((await deps.fixer.promptText(verifyPrompt)).text)
  recordVerification(deps.ledger, record.fingerprint, verifyDecision)

  if (verifyDecision.verdict === 'valid' && verifyDecision.fixability === 'auto') {
    let plan: string | undefined

    if (verifyDecision.needsPlanning) {
      const planningPrompt = resolveInvocationText(
        deps.config.fixer.fixInvocationPrefix,
        deps.fixer.availableCommands,
        buildPlanningPrompt(record.issue, verifyDecision),
        false,
      )
      plan = (await deps.fixer.promptText(planningPrompt)).text
    }

    const fixPrompt = resolveInvocationText(
      deps.config.fixer.fixInvocationPrefix,
      deps.fixer.availableCommands,
      buildFixPrompt(record.issue, verifyDecision, plan),
      false,
    )
    await deps.fixer.promptText(fixPrompt)
    recordFixAttempt(deps.ledger, record.fingerprint)
    return { fixedThisIssue: true }
  }
  return { fixedThisIssue: false }
}
```

- [ ] **Step 4: Update existing loop-controller tests**

In `tests/review-loop/loop-controller.test.ts`, all existing fixer reply JSON objects that have `fixPlan` were updated to use `needsPlanning: false` in Task 2. Verify the test at "uses configured invocation prefixes" still passes — the fixer prompts still match because `needsPlanning: false` skips the planning step, so fixer gets exactly 2 calls (verify + fix) as before.

Also update the `no_progress` test's fixer to return `needsPlanning: false` in the JSON (already done in Task 2 if `fixPlan` was replaced). The test for "does not re-verify issues already in a terminal status" should also have `needsPlanning: false` (already done in Task 2).

- [ ] **Step 5: Run all review-loop tests**

Run: `bun test tests/review-loop/`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/review-loop/loop-controller.ts tests/review-loop/loop-controller.test.ts
git commit -m "feat(review-loop): add plan-then-fix flow when needsPlanning is true"
```

---

### Task 6: Full test suite validation

**Files:** None (validation only)

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 2: Run lint and typecheck**

Run: `bun run typecheck && bun run lint`
Expected: No errors.

- [ ] **Step 3: Run format check**

Run: `bun run format:check`
Expected: No issues.
