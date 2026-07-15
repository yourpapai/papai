<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Review-loop simplification — replace ACP orchestration with shell-invoked agents

**Status:** approved (brainstorm), ready for implementation planning
**Date:** 2026-07-15
**Spans:** `review-loop/` workspace + `tests/review-loop/`
**Builds on:** ADR-0112 (review-loop enhancements), the existing review-loop workspace.

## Problem

The current `review-loop/` workspace orchestrates an autonomous code-review → verify → fix → re-review loop using ACP (Agent Client Protocol) subprocess management. A comprehensive analysis revealed eight issues:

1. **Command name mismatch** — config references `/review-code` but the opencode command file registers as `/code-review`. With `requireInvocationPrefix: false`, the reviewer never gets the specialized review persona.
2. **Circular framing of verification** — the fixer verifies issues before fixing them. (Clarified during brainstorm: this is a legitimate broad→narrow funnel, not a conflict of interest. Kept.)
3. **No build validation** — the loop never checks that `bun check:full` passed after a fix. Broken fixes pile on top of each other.
4. **No git isolation** — runs in the current working directory with no worktree or branch management.
5. **Fragile fingerprinting** — SHA-256 over 5 fields (file + title + summary + whyItMatters + evidence). Any rephrasing breaks dedup across rounds.
6. **Open permission policy** — auto-approves everything unconditionally.
7. **Sequential processing** — `pLimit(1)` with many process spawns per round.
8. **Never used** — `.review-loop/runs/` is empty. ~1,700 lines of code (source + tests) for a tool that has never been run against this repo.

The root cause: ~600 lines of ACP subprocess plumbing (`acp-process-client.ts`, `acp-connection-methods.ts`, `process-lifecycle.ts`, `agent-session.ts`, `permission-policy.ts`, `available-commands.ts`) exist to manage JSON-RPC sessions over stdio, when `opencode run` can achieve the same agent invocation in a single shell call.

## Key decisions (settled during brainstorm)

1. **Simplify radically.** Replace ACP subprocess orchestration with `opencode run` shell calls. Delete all ACP plumbing. Keep Bun/TypeScript runtime.
2. **Two agents, shell-invoked.** Reviewer and fixer remain separate roles with separate models. Each invoked via `opencode run --model <model> --dangerously-skip-permissions "<prompt>"`. No session persistence.
3. **File-based data exchange.** Agents write structured results to gitignored JSON files (`issues.json`, `result.json`, `matches.json`). Orchestrator reads + validates with Zod. If JSON is invalid, retry once with a "fix your JSON" prompt.
4. **Full ledger with LLM-based matching.** Keep the 8-state issue lifecycle. Replace SHA-256 fingerprinting with a small LLM call that matches new issues to existing ledger entries by semantic similarity. Stable IDs assigned on discovery.
5. **Keep verify step in fixer.** The fixer verifies each issue (broad→narrow funnel: reviewer scans broadly, fixer takes focused look at each specific issue to re-evaluate correctness and severity). The fixer may reject false positives or mark issues as `needs_human`.
6. **Orchestrator validates builds.** After each fix, the orchestrator runs `bun check:full` itself and checks the exit code. If it fails, retry the fix once with the error output. If still failing, mark `needs_human` and revert broken changes.
7. **Auto-create worktree.** Orchestrator creates `git worktree` before starting. All agent calls + checks happen in the worktree. At the end, orchestrator auto-merges the worktree branch back to the original branch and cleans up.
8. **Ledger-only resume.** The ledger persists for resume. On `--resume-run`, reload ledger, reuse worktree if it exists, resume from `currentRound + 1`.
9. **Drop planning step.** The fixer plans internally within its `opencode run` session. No separate planning prompt.
10. **Full auto-approve permissions.** Agents get `--dangerously-skip-permissions`. Same risk profile as current design, made explicit.
11. **Per-issue verify+fix calls (Approach C).** Reviewer does one `opencode run` per round. Then per issue: one `opencode run` for the fixer that does verify+fix in one session. Build validation after each fix.

## Approaches considered

- **A — Per-issue verify + per-issue fix (rejected).** Mirrors current ACP flow with 2N+1 `opencode run` spawns per round. Most control but most process spawns (~2-5s startup each).
- **B — Batch fixer per round (rejected).** One reviewer + one fixer `opencode run` per round. Simplest orchestrator but less per-issue control. If the fixer chokes on one issue, the whole batch suffers.
- **C — Per-issue hybrid (chosen).** One reviewer + N fixer `opencode run` per round. Each fixer call does verify+fix in one session. Per-issue build validation catches breakages before moving to the next issue. N+1 spawns per round.

## Architecture

### Module map

**Delete (ACP plumbing):**

- `acp-process-client.ts`
- `acp-connection-methods.ts`
- `process-lifecycle.ts`
- `agent-session.ts`
- `permission-policy.ts`
- `available-commands.ts`
- `issue-fingerprint.ts`

**Keep (modify lightly):**

- `config.ts` — simplify schema (remove ACP fields, add `opencode run` model config, add worktree + checkCommand config)
- `issue-schema.ts` — keep `ReviewerIssueSchema`, simplify `VerifierDecisionSchema` (drop `needsPlanning`)
- `prompt-templates.ts` — adapt for file-based exchange (instruct agents to write JSON files)
- `summary.ts` — minor updates for new ledger shape
- `run-state.ts` — simplify (drop session IDs, keep round + ledger path + worktree path)

**Modify heavily:**

- `issue-ledger.ts` — replace fingerprint keys with stable IDs + LLM-matched reopening, keep lifecycle states
- `loop-controller.ts` — rewrite for shell-based agent calls + per-issue flow + build validation
- `cli.ts` — simplify (remove ACP bootstrap, add worktree lifecycle)

**Create:**

- `agent-runner.ts` — wraps `opencode run` shell calls: spawns process, passes prompt, reads result file, validates with Zod, retries on invalid JSON
- `issue-matcher.ts` — one small LLM call to match new issues against existing ledger entries
- `worktree.ts` — `git worktree add` lifecycle (create, merge, cleanup)
- `build-checker.ts` — runs `bun check:full` in worktree, captures exit code + output, handles retry escalation

### Per-round flow

```
ROUND N

1. REVIEW
   orchestrator → opencode run (reviewer model)
   prompt: "review against plan, write issues to .review-loop/issues.json"
   agent writes issues.json, exits
   orchestrator reads + validates issues.json
   (retry once if invalid JSON)

2. MATCH
   if ledger has existing non-terminal issues:
     orchestrator → opencode run (matcher model)
     prompt: "match new issues to old ones"
     → writes matches.json
   else: all issues are new
   orchestrator updates ledger (new records / reopen existing)

3. PER-ISSUE VERIFY+FIX
   for each non-terminal issue:
     orchestrator → opencode run (fixer model)
     prompt: "verify this issue. If valid & auto-fixable,
              fix it, run bun check:full, commit.
              Write result to .review-loop/result.json"
     agent writes result.json:
       {verdict, fixability, fixed, commitSha?}
     orchestrator validates result.json
     if fixed:
       orchestrator runs bun check:full itself
       if fails: retry fix once with error output
       if still fails: mark needs_human, revert changes
     update ledger

4. CONVERGENCE
   save ledger
   mark fixed_pending_review issues NOT reported this round as closed
   if no issues found this round → clean, stop
   if 0 issues fixed → noProgress++
   if noProgress >= maxNoProgress → stop
   if round >= maxRounds → stop
   else → ROUND N+1
```

### Worktree lifecycle

```
START:
  1. git worktree add .review-loop/worktree -b review-loop/<runId>
  2. all agent calls get cwd=.review-loop/worktree
  3. all bun check:full runs happen in the worktree

END:
  4. git checkout <original-branch>
  5. git merge review-loop/<runId> --no-edit
  6. git worktree remove .review-loop/worktree
  7. git branch -d review-loop/<runId> (if fully merged)
  8. print summary

RESUME (--resume-run <runId>):
  9. if worktree exists at .review-loop/worktree → reuse
  10. if removed → recreate from current HEAD
  11. reload ledger, resume from currentRound + 1
```

### Build validation & retry

Before each fixer call, the orchestrator records `preFixSha = git rev-parse HEAD` in the worktree. After the fixer call reports `fixed: true`:

1. Orchestrator runs `bun check:full` in the worktree.
2. Exit code 0 → mark issue `fixed_pending_review` in ledger, proceed to next issue.
3. Exit code != 0 → capture stderr, send back to fixer: "Your fix broke the build. Error: `<stderr>`. Fix this." One retry.
4. Retry also fails → mark issue `needs_human`, `git reset --hard <preFixSha>` (undo any commits/changes from this fix attempt), proceed to next issue.

The orchestrator is the source of truth for build status. Agents can run checks internally for self-correction, but the orchestrator verifies independently. The `preFixSha` checkpoint ensures a broken fix is fully reverted whether or not the fixer committed.

### File exchange format (all in `<workDir>/`, gitignored)

- `issues.json` — reviewer output: `{issues: ReviewerIssue[]}`
- `matches.json` — LLM matcher output: `[{newIssueIndex: number, existingId: string | null}]`
- `result.json` — fixer output per issue: `{verdict: VerifierVerdict, fixability: "auto" | "manual", fixed: boolean, commitSha?: string}`
- `ledger.json` — durable issue ledger (persists across rounds for resume)
- `agent-output.log` — captured stdout/stderr from `opencode run`, appended per call (for debugging)

All files are overwritten per round (except `ledger.json` which accumulates, and `agent-output.log` which appends).

### Issue ledger

```typescript
interface LedgerIssueRecord {
  id: string // stable ID assigned on first discovery (UUID)
  issue: ReviewerIssue // latest version of the issue text
  status: LedgerIssueStatus
  firstSeenRound: number
  latestSeenRound: number
  fixAttempts: number
  verifierDecision: VerifierDecision | null
}

type LedgerIssueStatus =
  | 'discovered'
  | 'verified'
  | 'rejected'
  | 'already_fixed'
  | 'needs_human'
  | 'fixed_pending_review'
  | 'closed'
  | 'reopened'
```

**Lifecycle unchanged from current design.** What changed: the key is `id` (UUID assigned on discovery, stable forever) instead of `fingerprint` (SHA-256 hash that changes when text is rephrased). Matching across rounds is done by the LLM, not by string hashing.

**Convergence transition:** at the end of each round, any `fixed_pending_review` issues that were not reported by the reviewer this round (i.e., not matched to any new issue by the LLM matcher) are marked `closed`. This replaces the explicit re-review step from the current design — the next round's full review IS the re-review.

### LLM issue matching

After the reviewer returns new issues:

1. If ledger is empty → all issues are new, assign UUIDs.
2. If ledger has existing non-terminal issues:
   - Orchestrator invokes `opencode run` (matcher model) with a prompt listing existing issues (id + title + file + summary) and new issues (title + file + summary).
   - Agent writes `matches.json`: for each new issue, the matching existing `id` or `null`.
   - Orchestrator reads + validates `matches.json`.
   - Matched → reopen existing record, update issue text to latest version.
   - Unmatched → new record, assign UUID.

The matcher prompt includes only title + file + summary (not full details) to keep the call cheap. The LLM sees semantic relationships that hashing cannot.

### Config (simplified)

```jsonc
{
  "repoRoot": ".",
  "workDir": ".review-loop",
  "maxRounds": 10,
  "maxNoProgressRounds": 2,
  "checkCommand": "bun check:full",
  "reviewer": {
    "model": "ollama-cloud/kimi-k2.6:cloud",
    "extraArgs": [],
  },
  "fixer": {
    "model": "opencode/claude-sonnet-4-6",
    "extraArgs": [],
  },
  "matcher": {
    "model": "ollama-cloud/kimi-k2.6:cloud",
    "extraArgs": [],
  },
}
```

**Removed from current config:** `command`/`args`/`env` per agent (hardcoded to `opencode run`), `sessionConfig`, `invocationPrefix`/`requireInvocationPrefix`, `verifyInvocationPrefix`/`fixInvocationPrefix`/`requireVerifyInvocation`.

### CLI

```bash
# new run
bun run review-loop:start -- --config <path> --plan <path>

# resume interrupted run
bun run review-loop:start -- --config <path> --plan <path> --resume-run <runId>
```

### VerifierDecision schema (simplified)

```typescript
const VerifierDecisionSchema = z.object({
  verdict: z.enum(['valid', 'invalid', 'already_fixed', 'needs_human']),
  fixability: z.enum(['auto', 'manual']),
  reasoning: z.string().min(1),
  targetFiles: z.array(z.string().min(1)),
})
```

**Removed:** `needsPlanning: z.boolean()` — the fixer plans internally within its `opencode run` session.

### Agent invocation

Each `opencode run` call:

```
opencode run --model <model> --dangerously-skip-permissions --cwd <worktree-path> "<prompt>"
```

- `--model` — from config (reviewer/fixer/matcher)
- `--dangerously-skip-permissions` — full auto-approve (same risk profile as current, made explicit)
- `--cwd` — the worktree path
- Prompt instructs the agent to write its result to a specific file path and exit

The orchestrator captures stdout/stderr to `agent-output.log` for debugging. The structured result is read from the file the agent writes.

If the result file is missing or fails Zod validation, the orchestrator retries once with: "Your output file was missing or invalid. Expected schema: `<schema>`. Write valid JSON to `<path>`."

## Testing

### Existing tests (update or replace)

- `loop-controller.test.ts` — rewrite for new per-round flow with shell-call mocks
- `issue-ledger.test.ts` — update for ID-based keys (no fingerprinting)
- `issue-schema.test.ts` — drop `needsPlanning` tests
- `prompt-templates.test.ts` — update for file-based exchange prompts
- `config.test.ts` — update for simplified config shape
- `run-state.test.ts` — simplify (drop session IDs)
- `summary.test.ts` — minor updates
- `cli.test.ts` — rewrite for new bootstrap flow
- `fake-agent-integration.test.ts` — rewrite to spawn a fake `opencode` script instead of a fake ACP agent

### Delete (ACP-specific tests)

- `acp-process-client.test.ts`
- `acp-connection-methods.test.ts`
- `available-commands.test.ts`
- `permission-policy.test.ts`
- `issue-fingerprint.test.ts`

### New tests

- `agent-runner.test.ts` — shell invocation, file reading, Zod validation, retry-on-invalid
- `issue-matcher.test.ts` — LLM matching prompt building, matches.json parsing, ledger update
- `worktree.test.ts` — worktree creation, merge, cleanup, resume detection
- `build-checker.test.ts` — exit code handling, retry escalation, revert-on-failure

### Test strategy

The fake-agent integration test will use a shell script that mimics `opencode run` — reads the prompt, writes the expected JSON file, exits. This replaces the current fake ACP agent that speaks the JSON-RPC protocol. Simpler and closer to the real invocation path.
