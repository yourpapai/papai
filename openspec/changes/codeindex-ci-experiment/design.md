# Design — codeindex-ci-experiment

## Context

See `proposal.md — Why`. The load-bearing facts this design rests on, all
verified during exploration (2026-09-10, sibling at `d6eb4e8`, later commits
`54161ce`/`a497785` do not touch these surfaces):

- The pipeline side is complete and live-verified: `AGENT_MCP_SERVERS`
  (`opencode-agent/src/mcp-servers.ts`) takes local stdio entries
  (`command` array + optional `environment`), generates
  `"<name>_*": "allow"` grants for the `plan` and `build` profiles and the
  global default, keeps the `propose` profile confined, and degrades a dead
  server to absent tools bounded by OpenCode's 30 s client timeout. An unset
  knob is byte-identical to a pre-knob run.
- The codeindex server (sibling repo, clone-based distribution) is
  stdio-only, resolves config from its cwd, and its query log is on by
  default: every MCP query lands in `.codeindex/queries.db` with tool,
  query text, hit/miss, latency, top qualified names, and errors
  (`src/mcp/query-logging.ts`, `logQueries: true`,
  `queriesPath: .codeindex/queries.db`).
- A cold database serves **empty** queries immediately while the watcher's
  boot catch-up builds in the background — a silent wrong-answer trap.
- Cold full index build measured at 13.1 s locally (1 297 files, 18 937
  symbols, 51 MB DB); expect roughly 30–60 s on a stock runner.
- `scripts/codeindex-cli.ts` resolves the sibling from its own location
  (worktree-aware) defaulting to `<workspace>/../codeindex`, with
  `CODEINDEX_DIR` as the override; in CI (`.git` is a directory) the
  default is exactly where an `actions/checkout` with `path: ../codeindex`
  puts it. The shim spawns the real CLI with `cwd` = papai workspace, so
  `.codeindex.json` and `.codeindex/` resolve to the workspace.

## Goals / Non-Goals

Goals: turn the CI wiring into a reversible, instrumented experiment whose
keep-or-revert decision can be made from run-page evidence; every added
behavior inert when the knob is unset.

Non-Goals:

- No pipeline (`opencode-agent/src/`) code changes — the knob already
  exists; this change is YAML, one script, docs, and a repository variable.
- No claude-route support — that route pins an empty MCP document by
  design; codeindex is opencode-route-only.
- No package publication of codeindex (bunx-style), no remote/shared server
  (stdio-only today), no `actions/cache` for the index (13–60 s builds do
  not justify it; revisit if builds ever cross minutes).
- No automated keep/revert decision — the rubric is read by a human; the
  workflow produces evidence, not verdicts.
- No change to local workflows: local `--event-path` runs keep whatever
  sibling checkout the developer already has.

## Decisions

1. **Gate every added step on the knob declaring `codeindex`, read through
   the job-level env.** The repository carries `AGENT_MCP_SERVERS` as a
   secret, and a step `if:` may read `env` but not `secrets` — so the knob is
   declared once at job level (`secrets.AGENT_MCP_SERVERS ||
   vars.AGENT_MCP_SERVERS`, the exact spelling the pipeline step forwards:
   one value, every reader) and the five steps gate on
   `contains(env.AGENT_MCP_SERVERS, 'codeindex')`. Keying on the server name
   rather than bare non-emptiness keeps a secret declaring only other
   servers from buying ~1 min of codeindex setup, and removing the
   `codeindex` entry ⇒ the job is byte-identical to today — one revert
   action, no commit, in-flight issues unaffected (each job reads the knob
   fresh). Alternative — always-on setup — was rejected: it would make the
   experiment's abort cost a revert commit on a protected path.
2. **Sibling checkout at `path: ../codeindex`, pinned to a commit SHA, with
   `AGENT_GITHUB_TOKEN`.** Matches the shim's default resolution (no
   `CODEINDEX_DIR` needed), keeps the clone outside the workspace so the
   implement phase's `git add --all` can never see it (the same reason
   `.superpowers/` is handled), and a private sibling cannot be cloned by
   the repo-scoped `GITHUB_TOKEN`. Pinning follows the workflow's existing
   superpowers convention (pinned checkout, deliberate ref bumps).
3. **Prebuild via `bun run codeindex:index` before the pipeline step.**
   Prevents the cold-DB empty-answers trap; the later per-boot watcher
   catch-ups then compare tree hashes against a warm index and normally
   write nothing (branch switches touch `openspec/` markdown, which is
   outside the indexed roots `src`/`client`/`plugins`). The prebuild runs
   on the base-branch checkout the job starts on; drift after
   `ensureBranch` is caught by the next server boot's incremental.
4. **A canary `code_symbol` query in the setup, and its exclusion from the
   usage counts.** The canary proves index + server + resolution health
   before any model tokens are spent (the repo's zero-spend verification
   doctrine), and is identifiable in `queries.db` by its fixed query text —
   the report subtracts it so the experiment never counts its own
   instrument.
5. **Telemetry source is the server's own query log, surfaced by a
   read-only post-run step.** No pipeline coupling, no new logging code in
   the sibling; the report step runs `if: always()` after the pipeline step
   (servers dead by then — no SQLite contention) and reads
   `.codeindex/queries.db` directly. Alternative — counting tool calls from
   the encrypted transcripts — rejected: decryption tooling in the loop for
   a per-job summary is heavier than a SQLite read, and the transcript stays
   the deep-dive instrument, not the primary one.
6. **The report links the ledger document by absolute URL to the default
   branch** (`docs/operations/codeindex-ci-experiment.md` blob). A relative
   path would not resolve from a run page; the doc ships in the same change
   as the wiring, so the link is live from the first instrumented run.
7. **The report script lives in `scripts/`** (outside mutation-gate roots,
   inside lint scope), tested under `tests/scripts/` per the existing
   pattern (e.g. `codeindex-portability.test.ts`). Alternative — inline YAML
   script — rejected: untestable and unwieldy at the needed size.

## Risks / Trade-offs

- [Private sibling clone fails (token absent/expired)] → the gated setup
  step fails the job before the pipeline step, visibly, before any model
  spend; remedy documented in the ledger. Not silent by construction.
- [Concurrent servers contend on SQLite] → session server + pool-1 review
  worker is at most a couple of WAL readers; queries open/close per call;
  writes only on real drift. Watch for `database is locked` in the job log
  (grep procedure in the ledger); recurring contention is an explicit
  revert criterion.
- [MCP command's relative path resolves against the opencode server's cwd]
  → assumed to be the workspace; the canary plus one live run verify this
  end to end before the experiment is trusted.
- [4 tool schemas on every prompt incl. review workers] → small, cached
  after first use; tokens/turn is part of the decision rubric precisely so
  this cost is watched rather than assumed away.
- [Sibling pin drift] → the pin is deliberate; the ledger's keep procedure
  includes bumping the pinned SHA as routine maintenance.

## Migration Plan

1. Land the change (workflow steps inert — the variable is unset).
2. Set the repository **variable** `AGENT_MCP_SERVERS` to the token-free
   declaration from the ledger; the next agent job is the first
   instrumented run.
3. Run the experiment across a handful of real issues; read each job's
   step summary and the issue comments' spend lines.
4. Decide per the ledger rubric: keep (delete the report step + script if
   the telemetry is no longer wanted) or revert (unset the variable;
   optionally clean up the inert YAML later).

Rollback is step 2 reversed: unset one variable. No `STATE_VERSION`-class
concerns — the agent pipeline's persisted state never observes codeindex.

## Open Questions

None blocking. The one live unknown — the opencode server's cwd assumption
for the relative MCP command — is answered by the change's own
verification task rather than by design.
