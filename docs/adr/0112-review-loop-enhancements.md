# ADR-0112: Review Loop Enhancements — Severity Expansion, Plan-Then-Fix Flow, Commit Discipline, and Open Permission Policy

## Status

Accepted

## Date

2026-04-21

## Context

The review-loop (an autonomous code-review → fix → re-review loop runner) had several architectural limitations that constrained its effectiveness:

1. **Narrow severity scope** — only `critical` and `high` issues were reported, suppressing medium and low findings that could still be worth fixing.
2. **No planning for complex fixes** — the fixer received issues directly without a planning step, leading to scattered multi-file changes.
3. **Dirty worktrees** — fixes were applied without committing, leaving uncommitted changes between rounds and making it hard to track what was fixed.
4. **No validation after fixing** — there was no instruction for the fixer to verify its own changes.
5. **Overly restrictive permission policy** — the policy blocked `context7`, websearch, and other tools the agents legitimately need to review and fix code.
6. **Suboptimal agent assignments** — both reviewer and fixer used the same agent, despite each task favoring different strengths (broad code review vs targeted fixes).

## Decision Drivers

- **Maximize review coverage** — all actionable findings should be reported, not just critical/high.
- **Quality of multi-file fixes** — complex refactors need a planning step before implementation.
- **Reproducibility** — each fix must be committed and validated so the loop can resume or continue safely.
- **Unrestricted tool access** — agents must be able to use context7, websearch, and MCP tools as needed.
- **Agent-tool affinity** — reviewer and fixer should use the agent best suited to their respective tasks.

## Considered Options

### Option 1: Severity filter in verify step (Rejected)

Keep severity at two levels but let the verifier decide which are worth fixing.

- **Pros**: Minimal schema change.
- **Cons**: Loses information during review; reviewer still suppresses findings.

### Option 2: Expand severity, plan-then-fix, commit discipline, open permission, agent swap (Selected)

Make all the changes together — they are interdependent (e.g., unrestrained tool access is needed for agents to run `bun check:full`, planning is needed for multi-file fixes).

- **Pros**: Addresses all limitations holistically; agents can self-validate; reviewer reports everything.
- **Cons**: Larger change surface across multiple files; requires test updates across the review-loop workspace.

## Decision

Apply all enhancements together:

1. **Agent role swap** — reviewer uses `opencode acp` with Kimi K2.6 (built-in `/review-code` command); fixer uses `opencode acp` with `opencode/claude-sonnet-4-6` (strong at targeted fixes, planning, and checks).
2. **`maxRounds` default increase** — from `5` to `10` to allow more rounds for medium/low fixes.
3. **Severity expansion** — `ReviewerIssueSchema.severity` becomes `z.enum(['critical', 'high', 'medium', 'low'])`; review prompt requests all severities.
4. **`needsPlanning` replaces `fixPlan`** — `VerifierDecisionSchema` gains a `needsPlanning: z.boolean()` field. The verifier signals whether a fix needs a planning step.
5. **Plan-then-fix flow** — when `needsPlanning === true`, the fixer first receives a `buildPlanningPrompt`, produces a step-by-step plan, then receives the fix prompt with the plan attached.
6. **Commit discipline in fix prompt** — the fixer is instructed to run `bun check:full`, fix failures, commit with `fix(review-loop): <issue title>`, and leave a clean worktree.
7. **Permission policy simplification** — `decidePermissionOptionId` always selects the first `allow_*` option, removing all path, command, and tool restrictions.

## Rationale

Each enhancement addresses a distinct limitation but together they form a coherent architecture: the reviewer reports more findings (severity expansion), the verifier decides which are worth fixing and whether they need planning (needsPlanning), the fixer plans complex changes (planning prompt), and the fixer commits and validates before moving on (commit discipline). The open permission policy removes friction that would otherwise block agents from using the tools they need to perform these tasks.

The agent swap is the least critical piece — both agents are capable of both roles — but it optimizes for the strengths of each model (Kimi's review command vs Claude's targeted fix capability).

## Consequences

### Positive

- Reviewer reports all actionable issues, not just critical/high.
- Complex fixes get a planning step, reducing scattered changes.
- Each fix is committed and validated, enabling safe resumption and clear history.
- Agents can freely use context7, websearch, and MCP tools.
- Review-loop workspace test suite validates all new behaviors (54 tests passing).

### Negative

- **Deviation from original fixer agent spec**: The plan specified a standalone `/usr/local/bin/claude-acp-adapter` binary for the fixer. In practice, the fixer routes through the `opencode acp` adapter with `opencode/claude-sonnet-4-6` as the model. The structural intent (Kimi for review, Claude for fix) is preserved.
- **More fixer prompts per complex issue**: Issues with `needsPlanning: true` require 3 fixer prompts (verify → plan → fix) instead of 2.
- **Wider surface for test maintenance**: Tests must cover severity parsing, planning flow, and prompt content.

### Risks

- **Risk**: Fixer may produce invalid plans or fail to follow them.
  - **Mitigation**: The fix prompt includes both the plan and the original issue/decision; the fixer can still proceed even if the plan is partially ignored.

- **Risk**: Open permission policy could allow unintended tool usage.
  - **Mitigation**: The policy only auto-allows; the underlying ACP server still requires authentication. This can be tightened once actual tool usage patterns are observed.

## Implementation Status

**Implemented**

### `review-loop/src/config.ts`

- `maxRounds` default is `z.number().int().positive().default(10)`

### `review-loop/config.example.json`

- Reviewer: `opencode` / `acp` / `ollama-cloud/kimi-k2.6:cloud` with `/review-code` invocation prefix
- Fixer: `opencode` / `acp` / `opencode/claude-sonnet-4-6`
- `maxRounds: 10`

### `review-loop/src/issue-schema.ts`

- `severity: z.enum(['critical', 'high', 'medium', 'low'])`
- `needsPlanning: z.boolean()` in `VerifierDecisionSchema`

### `review-loop/src/prompt-templates.ts`

- `buildReviewPrompt` requests all severities and includes expanded schema
- `buildPlanningPrompt(issue, decision)` added — produces step-by-step planning request
- `buildFixPrompt(issue, decision, plan?)` gains optional `plan` parameter and commit/check instructions
- `buildRereviewPrompt` references `critical/high/medium/low`

### `review-loop/src/loop-controller.ts`

- Imports `buildPlanningPrompt`
- `processIssueVerifyFix` checks `verifyDecision.needsPlanning`: when `true`, sends planning prompt, receives plan, then passes it to `buildFixPrompt`

### `review-loop/src/permission-policy.ts`

- `decidePermissionOptionId` simplified to always select first `allow_once`/`allow_always` option, or first available option as fallback
- All path/command validation helpers removed

### Test coverage

- `tests/review-loop/issue-schema.test.ts` — medium, low severity; needsPlanning parsing
- `tests/review-loop/prompt-templates.test.ts` — expanded severity, planning prompt, fix prompt with/without plan, commit instructions
- `tests/review-loop/permission-policy.test.ts` — always-allow behavior
- `tests/review-loop/loop-controller.test.ts` — plan-then-fix flow with 3 fixer prompts
- All 54 review-loop tests pass.

## Related Decisions

- [ADR-0081](0081-review-loop-config-and-progress-logging.md) — previous review-loop config and logging improvements
- [ADR-0064](0064-acp-review-automation.md) — original ACP review automation background

## References

- Archived spec: `docs/archive/2026-04-21-review-loop-enhancements-design.md`
- Archived plan: `docs/archive/2026-04-21-review-loop-enhancements.md`
