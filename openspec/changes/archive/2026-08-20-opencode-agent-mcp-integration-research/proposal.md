# Research: connecting custom MCP servers into the opencode-agent pipeline

## Goal

Produce a research/findings document — **no production code changes** — that compares the different ways an end user could define MCP server configuration for the opencode-agent, and recommends the one with the best UX given the possibilities and limitations of the GitHub Actions CI environment the agent runs in.

Maintainer decisions already taken (do not re-open):
- MCP tools are granted to **all** agent profiles (read-only `plan` and write-capable `build` alike).
- A per-server opt-out configuration surface is **deferred** and out of scope (listed as a named follow-up only).

Safety rule for any live verification this job performs: **this job's control plane is an `opencode serve` on loopback — never `pkill`/`killall` it; kill experiment processes by recorded pid only.** Do not kill yourself.

## Files to touch

- **Create** `opencode-agent/docs/mcp-integration-research.md` — the only deliverable.
- **Optionally modify** `opencode-agent/ROADMAP.md` — one line linking the new finding document, if it surfaces a follow-up worth tracking.
- **No changes** to `src/`, tests, or the workflow.

The document follows the conventions of the existing docs in `opencode-agent/docs/` (`remaining-findings-evaluation.md`, `review-command-plan.md`): confidence-labelled findings (**verified** against a live run / **by inspection**), recorded-not-guessed claims about SDK/server behaviour, and the SPDX licence header matching the existing docs (the license-header gate applies to the new file).

## Required content

### 1. OpenCode's MCP config surface, recorded from the pinned SDK

The `mcp` key on the OpenCode `Config` takes per-server `McpLocalConfig` (`type: "local"`, `command: string[]`, `cwd`, `environment`, `enabled`, `timeout`) or `McpRemoteConfig` (`type: "remote"`, `url`, `headers`, `oauth: McpOAuthConfig | false`, `enabled`, `timeout`) — anchored in `opencode-agent/node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:1462-1503`. The SDK also exposes runtime endpoints (`POST /mcp` add, `/mcp/{name}/connect|disconnect|auth`, `GET /mcp` status with `McpStatusConnected|Disabled|Failed|NeedsAuth|NeedsClientRegistration`) — the doc records which of these are usable from an unattended pipeline and which are not. Runtime behaviour claims (tool naming as `<server>_<tool>`, startup/connect failure handling, `enabled: false` semantics, whether a repo-committed `opencode.json` merges with or is overridden by `OPENCODE_CONFIG_CONTENT`, OAuth's `McpStatusNeedsAuth` flow being unusable without a browser) are **verified against the real `opencode` binary** via `OPENCODE_CONFIG_CONTENT` and recorded, not inferred — per the workspace rule that SDK/server behaviour is recorded from live runs.

### 2. Comparison of user-facing configuration surfaces — the core of the research

Enumerate and compare **every plausible way an end user could declare MCP servers**, scored on end-user UX: how much the user must know about the pipeline's internals, where the value lives, how it is reviewed and changed, how secrets are supplied, and what failure looks like. Candidates to evaluate (the doc may add more found during research):

1. **Repo-committed OpenCode config file** (e.g. `opencode.json` / `.opencode/` in the target repository, OpenCode's native discovery). UX: version-controlled, PR-reviewable, per-repo, native syntax with `{env:VAR}` interpolation. Open questions to resolve by live run: does it merge with `OPENCODE_CONFIG_CONTENT` (which the pipeline already uses for provider/permissions), and could a committed file silently override the pipeline's deny-by-default permission model or provider pinning — i.e. can a contributor PR smuggle in config the pipeline thought it owned? Also: a file in the checkout is readable by the model (`read` is allowed in both profiles), so it must never carry credentials.
2. **Pipeline env knob in the existing `AGENT_*` style** (e.g. an `AGENT_MCP_SERVERS` JSON value parsed in `src/config.ts` / `config-values.ts` style and merged inside `buildOpencodeConfig` so in-process and `OPENCODE_CONFIG_CONTENT` paths cannot drift). UX: set as a repo/environment Actions variable or secret, no workflow edit, consistent with the existing knob table in the README; but raw JSON in an Actions variable is clunky and its validation errors surface at job start.
3. **Repository Actions variables/secrets referenced from a committed config** — hybrid: server definitions in the repo file, credentials only via `{env:...}` interpolation from masked secrets. UX: secrets never touch git; rotation is an Actions-settings edit, no commit.
4. **Workflow-file edits** (user forks `agent-pipeline.yml` to add env/steps, e.g. installing a stdio server binary). UX: maximal power (can `bunx`/`npx`/install arbitrary servers) but worst drift — every upstream workflow improvement must be manually re-merged; record as the escape hatch, not the recommendation.
5. **Issue/comment-level configuration** (a slash command or issue body block defining servers). Must be **rejected on security grounds and the doc must say so explicitly**: issue authors and commenters are untrusted, and letting them define a local MCP server is arbitrary command execution in a privileged job, or a remote one an exfiltration endpoint. Recorded as evaluated-and-rejected, not omitted.

Each option is scored against the CI constraints in §3 and the security model in §4, and the doc ends with a ranked recommendation and the reasoning an implementer needs.

### 3. GitHub Actions CI possibilities and limitations, applied to each option

Grounded in the environment the agent actually runs in, each verified or marked by-inspection:

- **No interactive user**: OAuth browser flows cannot complete (`oauth: false` mandatory for remote servers; `McpStatusNeedsAuth` is a dead end); `ask` permissions deadlock the job.
- **Secrets only exist as job env**: GitHub masks them in logs, but S3-9 already proved the spawned OpenCode server's environment (incl. `OPENCODE_CONFIG_CONTENT`) is readable by the model via `bash` in the `build` profile — so any MCP credential placed in config content or a local server's `environment` block is model-readable. Evaluate whether the `provider-proxy.ts` loopback-placeholder pattern generalises to MCP `headers`, whether `secrets.ts` value-based scrubbing covers these values, and state a recommendation — deferred like the opt-out, but the risk documented per option, since it changes the UX ranking (remote-with-static-token vs. local-unauthenticated).
- **Ephemeral runner, no writable home assumed**: stdio servers must be installed per-run (workflow step, `bunx`/`npx` on demand) — cold-start cost and supply-chain pinning belong in the comparison; nothing persists between jobs, so per-server OAuth token caches are useless.
- **Network egress is unrestricted by default** on GitHub-hosted runners: remote MCP servers are reachable, but that also means an MCP server is a new exfiltration channel — noted for the security section.
- **Repo file is model-readable and attacker-influenceable via PR** on repos taking contributions: config loaded from the checkout must be treated as untrusted input, unlike env knobs which only a maintainer can set.
- **MCP server boot failure must degrade, not hang**: record what the real binary does when a configured server fails to start (phase blocked vs. tools absent), per the record-don't-guess rule.

### 4. Interaction with the deny-by-default permission model

`openai-config.ts` builds both profiles on `"*": "deny"` plus per-tool allows; MCP tools arrive as `<server>_<tool>` names. Determine and record which permission key form grants them (e.g. a `<server>_*` wildcard entry), confirmed against the resolved rules the real binary reports — the same verification method the existing plan/build table used. Per the maintainer decision, the recommended shape grants the server wildcard in **both** profiles and the global default; the opt-out knob is listed as a deferred follow-up, not designed here.

### 5. How the config would reach both execution paths

`buildOpencodeConfig` feeds `createOpencodeServer({ config })` in-process and `OPENCODE_CONFIG_CONTENT` for the review-loop's `opencode run` subprocesses; describe where an `mcp` block would be injected per option so the two paths cannot drift, and note for the repo-file option whether the review-loop subprocesses (spawned with `OPENCODE_CONFIG_CONTENT` set) would even see a checkout-local file.

### 6. Recommendation and deferred follow-ups

A short verdict: the recommended configuration surface with its UX justification, the grant-all-profiles permission shape, the deferred per-server opt-out, and the deferred credential-containment work, each as a named follow-up.

## Non-goals

- No production code changes: no `src/`, test, or workflow edits; no `mcp` block actually added to `buildOpencodeConfig`.
- No per-server opt-out configuration surface (deferred; named as a follow-up only).
- No credential-containment implementation for MCP headers/environment (deferred; risk documented per option).

## Verification

- Config-shape claims are checked against the pinned `@opencode-ai/sdk` types quoted above; behavioural claims (tool naming, permission resolution, config-file merge semantics, failure handling) are verified by feeding configs with a throwaway stdio MCP server to the real `opencode` binary (spawned and **terminated by recorded pid**, never by name — this job's control plane is an `opencode serve` on loopback that must survive) and recording the result, per the workspace's record-don't-guess rule; anything that cannot be run is explicitly marked 'by inspection'.
- The comparison table's CI-environment claims (env visibility, masking, egress, ephemeral home) are stated from the workflow/README and prior ROADMAP findings (S3-7, S3-9), cited rather than re-derived.
- `bun run lint`, `bun run typecheck`, and `bun run format:check` pass (docs-only change; the license-header gate applies to the new file, matching the existing docs' SPDX header).
- The pipeline delivers the document as a pull request through its normal DELIVER phase; maintainer review of the PR is the acceptance gate.

## Verified anchors (re-checked against the checkout)

- `opencode-agent/node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:1462-1503` — `McpLocalConfig`, `McpOAuthConfig`, `McpRemoteConfig`.
- `opencode-agent/src/openai-config.ts` — `buildOpencodeConfig` (line 273), deny-by-default profiles (`"*": "deny"` + per-tool allows), `OPENCODE_CONFIG_CONTENT` emission in `opencodeConfigEnv` (lines 297-299).
- `opencode-agent/src/provider-proxy.ts`, `opencode-agent/src/secrets.ts`, `opencode-agent/src/config.ts`, `opencode-agent/src/config-values.ts` exist as named.
- `opencode-agent/docs/remaining-findings-evaluation.md`, `opencode-agent/docs/review-command-plan.md` exist as convention templates.
- `opencode-agent/ROADMAP.md` carries the S3-7 (line 857) and S3-9 (line 899) findings.
