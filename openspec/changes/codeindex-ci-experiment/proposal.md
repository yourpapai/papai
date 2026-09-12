## Why

The opencode agent's read-only phases navigate papai with text tools only
(`read`, `grep`, `glob`, `list`), while the repo's own AGENTS.md protocol —
loaded into the agent's context — tells it to prefer `codeindex`
(`code_symbol` / `code_search` / `code_impact`) for structural queries: a
promise that is false in CI today. The pipeline already ships the whole MCP
seam (`AGENT_MCP_SERVERS`, generated grants, dead-server tolerance), so
wiring codeindex in is a config-only experiment whose value is a hypothesis,
not a proven fact. The experiment is worth running because its downside is
bounded (~1 min of setup per job, bounded 30 s failure mode) and its
reversal is a single variable — but only if the runs produce evidence, which
means the wiring must arrive with instrumentation and an explicit
decision procedure, not as a silent settings change.

## What Changes

- The `agent` job in `.github/workflows/agent-pipeline.yml` gains
  **knob-gated** codeindex provisioning steps (gated on `AGENT_MCP_SERVERS`
  declaring a `codeindex` server, secret or variable spelling — this
  repository carries the knob as a secret): a pinned sibling checkout
  at `../codeindex` (via `AGENT_GITHUB_TOKEN`, since the repo-scoped token
  cannot cross repositories), `bun install` there, a pre-pipeline
  `bun run codeindex:index` (the prebuild that prevents the cold-database
  empty-answers trap), and a canary `code_symbol` query that proves index
  health before any model tokens are spent.
- A usage-report step (`if: always()`, same gate) reads
  `.codeindex/queries.db` — the query log the codeindex server already
  writes by default (`logQueries: true`) — and emits a per-job summary
  (calls, hit rate, latency, errors, top queries) to
  `$GITHUB_STEP_SUMMARY` and the job log, excluding the canary's known
  query from usage counts.
- The report carries a link to the experiment ledger document.
- New `docs/operations/codeindex-ci-experiment.md`: the experiment ledger —
  the four procedures (how to revert, how to read the statistics, how to
  decide keep-vs-revert, how to remove the statistics output after keeping)
  plus the decision rubric and the exact `AGENT_MCP_SERVERS` variable
  content to set.
- New `scripts/codeindex-ci-report.ts` (read-only, post-run, servers dead)
  with tests, following the `tests/scripts/` pattern.
- A short pointer in `opencode-agent/README.md`'s MCP-servers section.

Unset the `codeindex` entry from `AGENT_MCP_SERVERS` at any point and every
added step goes inert without a commit — that gating property is itself a
requirement below.

## Capabilities

### New Capabilities

- `codeindex-ci-experiment`: the agent CI job's codeindex wiring — gated
  provisioning (sibling checkout, prebuild, canary), per-job usage telemetry
  linked to the ledger document, and the single-variable reversibility
  contract that makes the whole thing an experiment rather than a
  commitment.

### Modified Capabilities

None. `opencode-agent-mcp-integration-research` records the research
deliverable and is untouched; this change is a consumer of the delivered
`AGENT_MCP_SERVERS` knob, which needs no pipeline code changes. The claude
backend route stays excluded by its pinned empty-MCP document — a non-goal
here, not a modification.

## Impact

- `.github/workflows/agent-pipeline.yml` — a **protected path**: the agent
  can never commit these edits, so the change is maintainer-only by
  construction; `bun workflows:lint` applies.
- `scripts/codeindex-ci-report.ts` + `tests/scripts/` — scripts/ is outside
  the mutation-gate roots; its suite still runs.
- `docs/operations/codeindex-ci-experiment.md`, `opencode-agent/README.md`.
- Repository knob `AGENT_MCP_SERVERS` — this repository's spelling is a
  **secret** (which wins over the variable), so the token-free codeindex
  entry merges into the existing secret; a repo with no secret set may use
  the variable per the knob's documented split.
- Runtime surface: the opencode route only. Cost ceiling ~1 min/job
  (checkout + install + 13–60 s index build) inside a 300-minute budget;
  failure mode bounded by OpenCode's 30 s MCP client timeout.
