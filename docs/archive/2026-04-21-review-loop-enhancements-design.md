# Review Loop Enhancements

Date: 2026-04-21

## Problem

The review-loop script has several limitations:

- Only reports critical/high severity issues, missing medium and low findings
- Fixer has no planning step for complex fixes
- No commit discipline — fixes leave dirty worktrees
- Fixer does not validate that checks pass after fixing
- Permission policy is too restrictive for agents that need context7 or websearch
- Reviewer and fixer agent assignments are suboptimal

## Design

### Agent Role Swap

Swap the reviewer and fixer agents so each uses the tool best suited to its task:

| Role     | Agent                | Model                    | Rationale                                                  |
| -------- | -------------------- | ------------------------ | ---------------------------------------------------------- |
| Reviewer | `opencode acp`       | Kimi K2.6 (Ollama Cloud) | Has built-in `/review-code` command; strong at code review |
| Fixer    | `claude-acp-adapter` | Sonnet 4.6 (high effort) | Strong at targeted fixes, planning, and running checks     |

The fixer has no built-in `/verify-issue` command. Instead, the verify and fix prompts are sent as plain text — the verifier decision schema and fix instructions are embedded directly in the prompt templates.

### Config Changes

`maxRounds` default changes from 5 to 10.

Updated `config.example.json`:

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

Exact `sessionConfig` keys depend on what each ACP adapter exposes. The keys above are illustrative; implementation will verify the actual config IDs.

`.gitignore` already contains `.review-loop/` — no change needed.

### Severity Expansion

The reviewer now returns all severity levels: `critical`, `high`, `medium`, `low`.

The `ReviewerIssueSchema.severity` enum extends to include all four levels. The review prompt no longer filters to critical/high only — it requests all actionable findings.

Fix worthiness is determined by the fixer's verify step, not by severity. A low-severity issue that verifies as `valid` + `auto` fixability still gets fixed.

### Verifier Decision Schema Changes

Replace `fixPlan: string` with `needsPlanning: boolean`.

Updated `VerifierDecisionSchema`:

```typescript
{
  verdict: 'valid' | 'invalid' | 'already_fixed' | 'needs_human',
  fixability: 'auto' | 'manual',
  reasoning: string,
  targetFiles: string[],
  needsPlanning: boolean
}
```

When `needsPlanning` is `true`, the fixer first receives a planning prompt, produces a plan, then receives the fix prompt with the plan attached. When `false`, the fixer proceeds directly to implementation.

### Plan-then-Fix Flow

In `loop-controller.ts:processIssueVerifyFix`, after the verify step:

```
verify issue
  → if needsPlanning === true:
      send planning prompt → receive plan
      send fix prompt with plan attached
  → if needsPlanning === false:
      send fix prompt directly
```

New prompt template `buildPlanningPrompt(issue, decision)` produces a planning request. The fix prompt `buildFixPrompt` gains an optional `plan` parameter. When present, the plan is included in the fix instructions.

### Commit + Clean Branch Discipline

The fix prompt instructs the fixer to:

1. Apply the minimal fix
2. Run `bun check:full` to validate (lint, typecheck, format, tests)
3. Fix any check failures introduced by the fix
4. Commit with message: `fix(review-loop): <issue title>`
5. Leave a clean worktree (no uncommitted changes)

Each issue fix produces its own commit. The fixer must not leave a dirty state between fixes.

### Permission Policy — Allow All

Remove all permission restrictions. The `decidePermissionOptionId` function always selects the first `allow` option. If no allow option exists, it selects the first available option.

This lets both agents freely use context7, websearch, and any other MCP tools they need. The policy can be tightened later once we understand what tools are actually needed.

## Files Changed

| File                   | Change                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `config.ts`            | `maxRounds` default 5 → 10                                                                                      |
| `config.example.json`  | Swap agents, update sessionConfig, update maxRounds                                                             |
| `issue-schema.ts`      | Add `medium`, `low` to severity; replace `fixPlan` with `needsPlanning`                                         |
| `issue-ledger.ts`      | Update `VerifierDecisionSchema` import                                                                          |
| `prompt-templates.ts`  | Update review prompt for all severities; add planning prompt; update fix prompt with plan + commit instructions |
| `loop-controller.ts`   | Add planning step; pass plan to fix prompt                                                                      |
| `permission-policy.ts` | Simplify to always-allow                                                                                        |

## Out of Scope

- Sprint/activity/saved-query provider features
- Changes to the ACP client or session bootstrap
- Resume-run logic changes
- Summary format changes
