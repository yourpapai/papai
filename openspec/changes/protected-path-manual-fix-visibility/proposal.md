# Proposal: protected-path-manual-fix-visibility

## Why

A protected-path finding is reported to a maintainer as a title line (`#35d7c517 [low] .github/workflows/ci.yml:113 — Stale rationale …`) with none of the content needed to act on it. PR #362 paid for this twice: the fixer wrote the exact correct ci.yml comment fix (`df1025cb5`) and the push guard reverted it four seconds later (`e2b213562`), leaving the verified diff recoverable only by `git log -S` archaeology; the re-review flagged the still-stale comment and the fixer's `needs_human` reasoning with the exact change died with the ephemeral `ledger.json` when the runner was deleted. The human must reconstruct by hand what the pipeline already produced.

## What Changes

- The review loop's run summary (which folds into the pull-request report) renders the manual-application content under each `needs human` issue line: the reviewer's suggested fix and the fixer's not-auto-fixable reasoning, truncated to a bound; issues with no such content fall back to naming the run's `ledger.json`.
- The review push guard captures the diff it is about to revert for protected paths and the review phase's report on the pull request carries it as an apply-by-hand patch, bounded; if the diff cannot be read, the report degrades to naming the paths (current behavior) and never fails the push.
- Docs updated: `review-loop/AGENTS.md` (fix instruction contract) and `opencode-agent/CLAUDE.md` (push-guard doctrine).

This revisits the declared non-goal of `review-loop-protected-paths` ("surfacing the unmergeable protected edit content beyond the `needs_human` reasoning and the run summary") — PR #362 is the incident showing that carrier is not enough.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `agent-protected-paths`: extends the two reporting requirements ("Protected-path fixes are reported, not applied", "Reverted protected paths are reported to the maintainer") so the report carries the manual-change content — suggested fix, not-auto-fixable reasoning, and the guard's reverted diff — not just the fact that a manual change exists. Declared as `ADDED` requirements with distinct names because the base spec (in the still-open `review-loop-protected-paths` change) is not yet under `openspec/specs/`; archive order of the two changes is independent, no requirement names collide.

## Impact

- `review-loop/src/summary.ts` (issues block), `opencode-agent/src/phases/review-push.ts` + `Git` seam (diff capture at revert), `opencode-agent/src/phases/review.ts` (report rendering); tests under `tests/review-loop/` and `tests/opencode-agent/`.
- All posted content passes the existing outbound redaction in `github.ts`; diffs are size-bounded so the one PR comment stays within limits.
- No papai runtime surface moves: developer tooling only; no platform/task instance, config-context, or scope-model impact.

## Non-goals

- Granting the App `workflows: write`, widening or shrinking `PROTECTED_PREFIXES`, or any path-scoped change to what may be pushed — the guard stays drop-not-refuse; only its reporting grows.
- Generating patches for CI-fix rounds (`ci-report.ts` `blockedNote`) — that path already names the file and the `/retry`-futility remedy; revisit separately if it shows the same gap.
- Uploading run artifacts (`ledger.json`, `summary.txt`) as workflow artifacts — visibility must come from the PR comment itself, which needs no workflow-file change to enable (a workflow edit is itself protected).
