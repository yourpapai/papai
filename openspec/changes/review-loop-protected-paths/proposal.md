# Proposal: review-loop-protected-paths

## Why

Run 32992114904 (issue #360, `CODE_REVIEW`) failed because the review loop's fixer edited
`.github/workflows/ci.yml`: the pipeline-side revert guard then fought the loop (two merge
conflicts, a failed final merge) and finally — due to a bookkeeping defect in the same guard —
re-applied the protected content and pushed it, so GitHub refused the whole push (`refusing to
allow a GitHub App to create or update workflow … without workflows permission`). The
opencode-agent's own instruction blocks have carried `PROTECTED_PATHS_RULE` since issue #240,
but the review loop's reviewer/fixer prompts — the only actors that actually touched a
workflow file here — have never been told the rule.

## What Changes

- The review loop's fix and retry prompts carry the protected-paths rule, duplicated from
  `PROTECTED_PATHS_RULE` (`opencode-agent/src/protected-paths.ts`) and pinned equal to it by a
  test, following the `MINIMALITY_LADDER` / `MINIMALITY_RULE` precedent.
- The rule's "say what a maintainer should apply by hand" half is mapped onto the fixer's
  result schema: a fix that genuinely requires a protected-path edit returns `needs_human`
  with the exact change described in `reasoning`, instead of editing the file.
- The reviewer prompt instructs that findings whose fix requires editing a protected path are
  reported with the change described in `suggestedFix` for manual application.
- `phases/review-push.ts` records as the push point the head the remote actually accepted —
  read after the protected-path revert — so a later guard pass can never treat its own revert
  commit as a protected change and restore the protected content.

## Capabilities

### New Capabilities

- `agent-protected-paths`: how the autonomous agent and its review loop handle paths a push
  from the pipeline's token cannot carry — the single rule definition and its carriers, the
  manual-application behavior that replaces the forbidden edit, and the push guard that
  contains a protected edit and must never re-apply one.

### Modified Capabilities

None. `review-loop-fix-quality` covers fix quality (minimality, checks, prose), not delivery
constraints; the minimality precedent chose a dedicated capability over extending it.

## Impact

- `review-loop/src/prompt-templates.ts` (new rule constant, three fix prompts + reviewer
  prompt), `opencode-agent/src/phases/review-push.ts` (push-point recording), tests under
  `tests/review-loop/` and `tests/opencode-agent/`.
- No papai runtime effect: both workspaces are developer tooling; no platform/task instance,
  config-context, or scope-model surface moves.
- Affected docs: `review-loop/AGENTS.md` and `opencode-agent/CLAUDE.md` (fix instruction
  contract; review push guard).

## Non-goals

- Granting the App `workflows: write` or shrinking `PROTECTED_PREFIXES` — a privilege
  decision (`protected-paths.ts` states it) and out of scope.
- Teaching `mutation-improve/` agents the rule — that workspace commits locally and pushes
  nothing, so the failure class cannot occur there. Recorded as declined for that reason.
- Surfacing the loop's unmergeable protected edit content (the exact diff a human should
  apply) beyond what the `needs_human` reasoning and the run summary already carry.
