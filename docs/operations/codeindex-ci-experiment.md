<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# codeindex CI experiment — operating ledger

The agent pipeline can run with the `codeindex` MCP server provisioned as a
reversible, instrumented experiment. Every step the experiment adds to the
`agent` job in `.github/workflows/agent-pipeline.yml` — sibling checkout,
dependency install, index prebuild, canary query, usage report — is gated on
the `AGENT_MCP_SERVERS` knob declaring a `codeindex` server. The gate reads
the job-level env spelling `secrets.AGENT_MCP_SERVERS || vars.AGENT_MCP_SERVERS`
(the secret wins, exactly as the pipeline step forwards it), so a declaration
in either spelling provisions, and while neither declares `codeindex` the
job's steps, timing, and pipeline behavior are indistinguishable from a job
before the experiment existed: one revert action, no commit.

This document is the ledger the per-job usage report links to. It carries the
four procedures — enable, revert, read the statistics, decide keep-vs-revert —
plus the cleanup after a keep decision, the exact declaration to set, and the
recorded runs.

## Enable the experiment

This repository carries `AGENT_MCP_SERVERS` as a **secret**, and the secret
wins over the variable — so while the secret exists, the codeindex entry must
live **in the secret**: setting the variable alone would be silently ignored.
The codeindex server entry, token-free, is:

```json
"codeindex": {"type": "local", "command": ["bun", "run", "scripts/codeindex-cli.ts", "mcp"]}
```

Update the existing secret by merging that key into the JSON it already holds
(GitHub never shows a secret's value back, so compose the merged document from
what you know the secret contains — typically the previous declaration with
the codeindex key added):

```bash
gh secret set AGENT_MCP_SERVERS --body '{"codeindex": {"type": "local", "command": ["bun", "run", "scripts/codeindex-cli.ts", "mcp"]}, ...existing keys...}'
```

On a repository where **no** secret is set, the token-free declaration may
instead live in the `AGENT_MCP_SERVERS` **variable** (Settings → Secrets and
variables → Actions → Variables), visible to non-admin maintainers and
diffable in settings — the knob's documented split: token-bearing declarations
belong in the secret, token-free ones may live in the variable. Either way no
commit is needed — the next agent job reads the knob fresh and is the first
instrumented run.

What the gated steps then do, in order, before the pipeline step:

1. `actions/checkout` of `yourpapai/codeindex` at the pinned SHA into
   `.codeindex-sibling`, with `AGENT_GITHUB_TOKEN` (a private sibling cannot
   be cloned by the repo-scoped `GITHUB_TOKEN`), immediately followed by a
   `mv` to `../codeindex` — outside the workspace, so the implement phase's
   `git add --all` can never see it. Two steps rather than one because
   `actions/checkout` validates `path` against `GITHUB_WORKSPACE` and refuses
   anything above it; a `path: ../codeindex` fails the job outright.
2. `bun install --frozen-lockfile` in the sibling.
3. `bun run codeindex:index` — the prebuild, so the first MCP query answers
   from a populated index instead of an empty database while a background
   build catches up. A failure here fails the job before any model tokens
   are spent.
4. The canary `bun run scripts/codeindex-cli.ts symbol kaneoAutoProvision`
   — a fixed query against a known-indexed symbol. An empty result fails
   the step naming the canary and the likely causes.

After the pipeline step — `if: always()` — the usage-report step reads
`.codeindex/queries.db` (the query log the codeindex server writes by default)
read-only and emits the per-job markdown summary to the step summary and the
job log.

Sibling-pin maintenance: the checkout's `ref:` is the commit SHA pinned in
`agent-pipeline.yml`. Bumping it is deliberate, like the superpowers pin —
the sibling is third-party code the job executes. Re-run the canary mentally
when bumping: the pin should move only to a commit whose MCP surface and
query-log schema still match what the shim and this report expect.

Note on the canary line in the report: the CI canary itself runs through the
CLI's `symbol` command, which does not go through MCP query logging — so the
report's `Canary:` line usually reads 0. It exists to exclude any *server-issued*
queries carrying the canary's fixed text (`kaneoAutoProvision`) from the
model-usage counts, so the experiment never counts its own instrument.

## Procedure: revert

Remove the `codeindex` entry from wherever the knob declares it — no commit,
in-flight issues unaffected (each job reads the knob fresh). With the secret
spelling this repository uses, that means rewriting the secret without the
`codeindex` key:

```bash
gh secret set AGENT_MCP_SERVERS --body '{...remaining keys...}'
```

Delete the secret outright (`gh variable delete AGENT_MCP_SERVERS` for the
variable spelling) only when it carried nothing but codeindex:

```bash
gh secret delete AGENT_MCP_SERVERS
```

What remains is **inert YAML**: the five gated steps stay in
`agent-pipeline.yml` with `if:` conditions that evaluate false on every job,
plus `scripts/codeindex-ci-report.ts` and its test, plus this document. None
of it executes or costs anything while the variable is unset.

The optional cleanup commit — only if you want the YAML gone — deletes the
gated steps from `agent-pipeline.yml`, the report step, the script and its
test, and (once no instrumented run will happen again) this document. It
touches a protected path, so it is a maintainer commit; the local
`.codeindex/` directory is gitignored and needs no cleanup.

## Procedure: read the statistics

Each instrumented job renders the usage report into its own step summary
(the run page's *Summary* tab) and its job log — the report step's line
`bun scripts/codeindex-ci-report.ts | tee -a "$GITHUB_STEP_SUMMARY"` puts the
same markdown in both places. Per MCP tool it shows calls, hit rate, median
and max latency, and error count; then the most frequent query texts, the
canary exclusion line, and the count of explicit `code_index` reindex
requests.

Which jobs to read: the **planning** and **implement** phases are where
exploration happens — those runs' summaries are the experiment's primary
evidence. Review-worker queries land in the **same** `queries.db` (each
`opencode run` worker boots the server with the same workspace cwd), so one
job's log mixes session and review-worker calls; the report cannot and does
not need to separate them — the aggregate is what the rubric reads.

Deeper layers, when the summary is not enough:

- **Token spend** — the run's issue comment carries the spend lines; compare
  against comparable pre-experiment issues (similar phase, similar repo
  area). Four MCP tool schemas ride every prompt including review workers,
  so tokens-per-run is part of the rubric precisely so this cost is watched
  rather than assumed away.
- **Call interleaving** — the encrypted debug transcript (when the run had
  an `AGENT_LOG_KEY`) shows where in a turn the codeindex calls sat beside
  the `read`/`grep` calls they were meant to replace.
- **Log greps** — on the job's log page:

  ```bash
  rg -n 'database is locked'          # SQLite contention between servers
  rg -n 'query-log record failed'     # the server could not write its own log
  rg -n 'codeindex'                   # the boot banner and canary output
  ```

  Recurring hits on the first two are an explicit revert criterion below.

## Procedure: decide — the rubric

Read across at least a handful of genuine runs (a scratch issue exercising
one real planning/implement cycle counts; a run that never reached a model
turn does not).

**Keep** when all of:

- meaningful usage: ≈10+ codeindex queries with a >50% hit rate on at least
  one exploration-heavy issue;
- no recurring errors — no repeated `database is locked`, no repeated
  canary or boot failures across the run set;
- no token regression: spend lines comparable to pre-experiment issues of
  the same shape.

**Revert** when any of:

- ~0 usage across ≥3 genuine planning/implement issues — the tools are on
  the prompt and the model is not reaching for them;
- recurring lock/boot failures — `database is locked`, canary failures, or
  dead-server timeouts that eat the 30 s MCP budget per boot;
- tokens up while usage ≈ 0 — paying the schema cost and getting nothing.

**Ambiguous** (some usage, marginal hit rates, one-off errors): extend the
experiment — more runs, same procedure — rather than deciding on noise.

After a **keep**, the statistics output can be removed (next procedure) while
the provisioning stays; after a **revert**, unset the variable (see the
revert procedure).

## Procedure: remove the statistics after keeping

Once the keep decision is made and per-job telemetry is no longer wanted:

1. Delete the usage-report step from `agent-pipeline.yml` (the
   `if: always() && contains(env.AGENT_MCP_SERVERS, 'codeindex')` step
   running `bun scripts/codeindex-ci-report.ts | tee -a "$GITHUB_STEP_SUMMARY"`).
2. Delete `scripts/codeindex-ci-report.ts` and
   `tests/scripts/codeindex-ci-report.test.ts`.
3. To stop query logging entirely, set `"logQueries": false` in
   `.codeindex.json` — the server then never opens `.codeindex/queries.db`,
   and the (gitignored) database stops growing. Leaving `logQueries` on is
   also fine: the log is local-only, read by nobody once the report step is
   gone.

The provisioning steps (checkout, install, prebuild, canary) stay: they are
what the keep decision kept.

## Recorded runs

_None yet._ After each verified instrumented run, append the run URL and a
one-line verdict (canary present, usage counts, any lock/boot failures) here.
