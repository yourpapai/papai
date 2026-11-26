# Proposal: ci-fix-red-run-analysis

## Why

The CI-fix phase never reads the run it was asked to repair. It reproduces CI
against a static local check list (`AGENT_CHECKS`, defaulting to
lint/typecheck/test), so a red run failing on a check outside that list looks
green locally: the phase runs no repair turn at all, reports "nothing changed",
and burns a CI-fix attempt. Runs 32641725211 and 32652877782 (PR #337) both did
this against the mutation-ratchet gate — two of three attempts spent on a
failure the fixer structurally could not see, ending in "no — nothing changed"
comments a maintainer cannot act on.

## What Changes

- The fixer fetches the red run's failed jobs (with per-step conclusions) and
  their logs through the GitHub Actions API, and bases diagnosis and repair on
  what actually failed.
- A diagnosis turn produces a structured verdict per failure:
  - **reproducible** — the failing step's command is derived from the
    repository's own workflow file and run locally in a repair loop until green;
  - **fixable from logs** — not reproducible on the runner, but the log
    justifies a code fix, which is made and pushed;
  - **needs human** — the failure is outside the agent's reach (permissions,
    secrets, infrastructure, a policy decision); the report names the failure,
    why the agent cannot fix it, and the human's remedy.
- A needs-human verdict reports instead of repairing, and does not silently
  consume further rounds: the report says what happened and what a human should
  do.
- **BREAKING**: the `AGENT_CHECKS` configuration knob and `DEFAULT_CHECKS` are
  removed. Check scope is derived from the red run; no repository configuration
  is required for CI fixing to work.
- The `ci` trigger carries the red run's id alongside its URL, so jobs and logs
  can be addressed without scraping.
- The agent workflow's token gains `actions: read` so jobs and logs are
  fetchable.

## Capabilities

### New Capabilities

- `agent-ci-repair`: how the opencode-agent pipeline turns a red CI run on its
  own pull request into either a pushed fix or a maintainer-ready explanation —
  failure discovery from the Actions API, local reproduction from the repo's own
  workflow, the fix/human verdict, and what each outcome reports.

### Modified Capabilities

(none — no existing capability covers CI fixing; `openspec/specs/` has no
ci-fix capability to modify.)

## Impact

- `opencode-agent/src/phases/ci-fix.ts` — restructured around failure discovery
  and the verdict; the report renderer's honesty rules re-scoped.
- `opencode-agent/src/check-loop.ts` — the loop's scope comes from derived
  commands rather than config; the "first round runs everything" doctrine
  adapts.
- `opencode-agent/src/check-spec.ts` — deleted (`AGENT_CHECKS`, `DEFAULT_CHECKS`,
  `parseChecks`).
- `opencode-agent/src/config.ts` / `config-values.ts` — `checks` removed.
- `opencode-agent/src/github.ts` — new Actions surface (list run jobs, download
  job logs), behind the existing boundary rules: redaction at the boundary,
  logs treated as untrusted text.
- `opencode-agent/src/trigger-events.ts` — `workflow_run` parse carries `runId`.
- `opencode-agent/src/prompts.ts` — CI-fix prompt carries job/step facts and
  enveloped log excerpts; verdict asked through `promptForJson`.
- `.github/workflows/agent-pipeline.yml` — `actions: read` added to the token
  permissions (a human edit; the agent's own protected-paths rule is about what
  the *agent* may push, not what this repository may change).
- Tests under `tests/opencode-agent/` — verdict parsing, needs-human path,
  derived-command execution, log clipping, envelope carry, instruction pins.
