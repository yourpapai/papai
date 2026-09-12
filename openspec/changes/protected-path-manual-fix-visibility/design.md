# Design: protected-path-manual-fix-visibility

## Context

Two actors hold manual-change content today and both drop it. In `review-loop/`, the run
summary's issues block (`src/summary.ts` `issuesBlock`) renders one `formatIssueRef` line per
record; the reviewer's `suggestedFix` (`src/issue-schema.ts` `ReviewerIssueSchema`) and the
fixer's `needs_human` reasoning (stored via `recordNeedsHuman` in `src/issue-ledger.ts`) never
reach it — and the ledger truncates that reasoning to 200 chars at storage time
(`issue-ledger.ts` `truncate(reasoning, 200)`), which can cut the "exact change" mid-diff. The
summary is the only carrier that survives: on CI, `ledger.json` lives under the gitignored
`.opencode-agent/review-loop/` and dies with the runner. In `opencode-agent/`, the push guard
(`src/phases/review-push.ts` `dropUnpushable` → `git-revert.ts`) reverts protected paths and
reports only path *names* through `blocked()`; the diff it took back out — the one artifact that
is build-verified — is recoverable only from git history (PR #362: `df1025cb5` reverted by
`e2b213562`). The two actors are separate processes: the loop never learns of a revert, so the
diff can only ride the agent phase's report, while the suggested-fix content can only ride the
loop's summary (which `renderReport` in `src/phases/review.ts` folds into the PR comment).

## Goals / Non-Goals

**Goals:**

- The PR comment is self-sufficient for manual application: exact change text and/or patch
  visible where the finding is listed.
- The guard's reverted diff is captured before the revert destroys it.
- Every added path degrades silently-onward: capture failure changes reporting, never outcomes.

**Non-Goals:**

- Changing what may be committed or pushed (`PROTECTED_PREFIXES`, drop-not-refuse, revert
  mechanics) — see proposal Non-goals.
- A second feedback channel (new comment, artifact upload, issue edit).
- CI-fix path reporting (`ci-report.ts` `blockedNote`) — unchanged.

## Decisions

**D1 — Render needs-human content from existing ledger fields, at the summary layer.**
`issuesBlock` appends, for each displayed needs-human record, the record's
`issue.suggestedFix` and `verifierDecision.reasoning` as indented lines under the issue line.
No schema change; both fields already exist and are non-empty by schema. Alternatives: a new
summary section (splits a finding from its content), or posting from `opencode-agent` by
re-reading the ledger (the agent would need the ledger path and a parse; the loop already owns
summary rendering). The bound: reuse the loop's existing truncation helper — one per-content
bound with an explicit `… (truncated; full text in ledger.json)` marker, applied to the
combined block, not per field.

**D2 — Needs-human reasoning survives at full fidelity in the ledger; the trace event keeps its
bound.** Verified during apply: `recordNeedsHuman` already stores the fixer's reasoning
**untruncated** in the ledger (`recordVerification` at `src/issue-ledger.ts`); the
`truncate(reasoning, 200)` beside it applies only to the `verify_complete` **trace event** in
`loop-trace.ts`, which is an internal log no maintainer-facing surface reads. The original
draft of this design misread the trace truncation as storage truncation. The invariant that
matters — the manual-change description must survive at full fidelity into the ledger, which
the summary reads — is already true and gets pinned by a ledger test rather than built; the
trace-event bound stays at 200 deliberately.

**D3 — Guard captures the diff through the `Git` seam before reverting.** `Git` gains one
method, `diffSince(since, paths)`, reading `git diff <since> -- <paths>`; `dropUnpushable`
calls it before `revertPaths`. `blocked()` grows from `readonly string[]` to path-keyed records
carrying an optional diff; `renderReport` in `src/phases/review.ts` renders the existing
"Reverted before pushing" note plus, per path, a fenced patch block with the by-hand
instruction. Same-path re-reverts overwrite the stored diff, so the report carries the most
recent revert (spec). Capture failure logs a `warn` and leaves the diff absent — the note
degrades to today's wording. Alternatives: `git stash`/object-preservation tricks (stateful,
breaks the guard's drop-and-move-on contract), or reconstructing the diff from the loop's
worker branch after revert (the branch is gone post-merge; the working tree is the last copy).

**D4 — Bounds and redaction.** Diff content is capped per path and in total (constants beside
the render code; per-path ≈4000 chars is enough for a comment fix or a small workflow edit —
a bigger diff gets its head plus a truncation marker and the commit refs to `git show`).
All posted text already passes the outbound redaction in `src/github.ts` and keeps doing so;
workflow-file diffs name secrets by reference, never by value, and summary content comes from
the loop's own schema-validated JSON.

**D5 — Reviewer prompt: suggested fixes for protected paths must be self-contained.** One
clause in `prompt-templates.ts`'s reviewer-prompt protected-path paragraph: the description
must be copy-pasteable (exact replacement text or patch), referencing nothing from the run.
The fixer's mapping line already demands "the exact change" in `reasoning`. Not pinned by
`protected-paths-rule.test.ts` (only the shared constant is), so wording can evolve.

## Risks / Trade-offs

- [PR comment grows unboundedly with needs-human count] → per-content and total bounds;
  `GROUP_CAP` already caps how many records render content at all, and overflow records already
  point at `ledger.json`.
- [Diff capture reads a tree mid-write (loop still merging)] → the guard runs after the loop
  exits and reconcile completes; a dirty read surfaces as a `diff` git error, which is exactly
  the degraded path (D3).
- [Truncated patch misleads a maintainer into applying half a change] → truncation marker plus
  the head/commit reference so `git show` recovers the whole; the spec's ledger-pointer
  fallback covers the summary side.

## Migration Plan

Additive; no state, schema, or persisted-shape change (blocked-paths structure is per-run
memory). Rollback is reverting the commit. Archive-order independence from
`review-loop-protected-paths` is by distinct requirement names (see proposal Capabilities).

## Open Questions

None — bound sizes are constants picked in tasks and tunable without touching the spec.
