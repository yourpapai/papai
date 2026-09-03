# afk-runner agent MCP integration research

## Goal

Research (docs-only, no runtime changes) how afk-runner could connect additional MCP servers to the AI agents it spawns **on different levels of task work**, so stage agents get as many checking/work tools as possible. Deliverable: a verified findings + comparison document with a ranked recommendation that a follow-up implementation change can build on. Direct precedent: the sibling research change `opencode-agent-mcp-integration-research` (archived 2026-08-20; findings in `opencode-agent/docs/mcp-integration-research.md`) verified the binary-level MCP mechanics for the opencode-agent pipeline. This change re-grounds those mechanics for afk-runner's own spawn path — which differs materially, because afk-runner builds no opencode config at all today — and adds the per-level scoping question the prior research deliberately deferred.

Assumption (stated, veto-able at the park): the issue's verb governs — this change delivers research, not wiring. The implementation (config schema, per-level injection) is a separate follow-up proposal informed by this document.

## Current state (verified anchors)

- Every afk-runner stage agent spawns through one seam: `runStageAgent` (`afk-runner/src/agent-layer.ts:253`) → review-loop `runAgent` → `buildAgentCommand` (`review-loop/src/agent-command.ts:286`). The opencode branch (`opencodeCommand`, agent-command.ts:133-150) inherits `process.env` unchanged; afk-runner never sets `OPENCODE_CONFIG_CONTENT`, so its agents run under whatever ambient/default opencode config the invoking environment provides — no runner-owned MCP surface exists.
- afk-runner is opencode-only: `runSpawn` (`afk-runner/src/agent-layer.ts:226-251`) threads no `backend`/`claude` options. The claude route already has an MCP seam in review-loop — `defaultCreateClaudeSpawnDir` (`review-loop/src/agent-command.ts:71-79`) writes an intentionally empty `{ mcpServers: {} }` doc behind `--strict-mcp-config --mcp-config` (`review-loop/src/claude-argv.ts:54-63`) — but it is unreachable from afk-runner today.
- "Levels of task work" have three concrete axes in the code: per-role (`AgentRoleSchema`: drafter/reviewer/skeptic/resolver/estimator/decomposer/atomicity/planner — `afk-runner/src/config.ts:11-20`), per-stage (spawn sites: intake.ts:126 estimator, draft.ts:80 drafter, review-agents.ts:37/:67 reviewer/resolver, veto-updater.ts:228 resolver, decompose.ts:60 decomposer, atomicity.ts:44 atomicity), and per-depth (S/M/L round caps/tail shape). `modelFor` (`afk-runner/src/config.ts:127`) is the existing per-role hook and is currently role-insensitive. `RunnerConfigSchema` is a strict five-key object (`afk-runner/src/config.ts:49-69`).
- Verified MCP mechanics already on record (`opencode-agent/docs/mcp-integration-research.md`): opencode `mcp` block shapes (local stdio / remote with static headers + `oauth: false` only, unattended), `<server>_<tool>` tool naming, `<server>_*` allow grants living in each profile's own permission map (global-only grants are a silent no-op), `ask` grants deadlock unattended turns, OAuth is a dead end, startup failures degrade to `failed` status data bounded at 30s (never hang), and `AGENT_MCP_SERVERS` + `buildOpencodeConfig` is the proven single-seam injection for the opencode-agent workspace (`opencode-agent/src/mcp-servers.ts`, `openai-config.ts:265-278`) — a builder afk-runner does not run.
- papai-core precedents to cite, not import: `src/mcp/` (papai-as-MCP-client: pooled streamable-http connections, allow/deny tool filters, three-state `tool_prefs`, HTTPS-only user endpoints) and `src/mcp-server/` (papai hosts plugin tools at `/mcp/plugin/<pluginId>` — a candidate remote server runner agents could consume).
- Security doctrine carried forward from the prior research: an MCP config is executable configuration — local entries are arbitrary command execution, remote entries are exfiltration endpoints over unrestricted egress; credentials reaching config content are model-readable (S3-9 class); untrusted text (task files, chat messages, issue bodies) must never define servers.

## Files to touch

- Create `docs/architecture/afk-runner-mcp-research.md` — the only deliverable (SPDX header; **verified** / **by inspection** confidence labels, following the prior research doc's conventions).
- Optionally: one pointer line in `docs/architecture/afk-runner.md` and a row in the CLAUDE.md docs table.
- No changes to `afk-runner/src/**`, `review-loop/src/**`, tests, workflows, or any runtime config.

## Required content

1. **Injection surface for afk-runner's spawn path.** Enumerate and score how an `mcp` block could reach the stage agents: (a) afk-runner builds and serialises its own config into `OPENCODE_CONFIG_CONTENT` for its `opencode run` children — and what that clobbers of the ambient config the binary would otherwise discover; (b) a repo-local `opencode.json` under the spawn cwd — whether the binary loads it at all and whether it merges with or overrides pipeline-provided config (the merge-vs-override experiment the prior research left pending); (c) an `AGENT_MCP_SERVERS`-style env knob consumed by afk-runner and merged into whichever config path wins; (d) the claude route's `--mcp-config` doc written non-empty per spawn (prerequisite: threading the claude backend through afk-runner's seam — recorded as a prerequisite finding, not designed here). Verify merge semantics live against the real binary through the review-loop spawn shape; options whose behaviour cannot be verified carry that label into the ranking.
2. **Scoping model for "levels of task work".** Compare per-role vs per-stage vs per-depth vs global server sets; recommend a shape and its config surface (extension of `RunnerConfigSchema`, env knob, or separate config file), including how grants differ per level (read-only checking servers for reviewer/skeptic vs work servers for drafter/decomposer) and how the shape composes with the `modelFor`-style per-role hook.
3. **Server catalogue and transports.** Candidate servers for checking and work (structural code index, papai-hosted context-vault/plugin MCP at `/mcp/plugin/<pluginId>`, task-tracker access, web search); transport constraints (papai's pool is streamable-http only; local stdio for spawned-agent routes); install/pinning story for stdio servers on ephemeral runners; startup/timeout behaviour.
4. **Credentials, security, degradation.** Where tokens live; S3-9 model-readability on the afk-runner route; rejection of untrusted-input-defined servers (task files and chat text never configure MCP); degrade-never-hang guarantees; what the runner should emit/log when a server fails (L0/L1 agent events) so a dead server is visible without failing the run.
5. **Ranked recommendation + named follow-ups**, and an outline of the follow-up implementation change (capability name at feature-domain granularity, sketch of the config surface and injection point) — proposal only, not delivered here.

## Intended behaviour change

None — research/docs-only. No runtime contract, config, or spawn behaviour changes.

## Verification

- Behavioural claims verified live against the pinned real binaries driven through the same spawn shape review-loop uses (config/env delivery identical to `opencodeCommand` / the claude profile block); experiments killed by recorded pid only, never by name; placeholder credentials only; anything not run is explicitly marked "by inspection".
- Config-shape claims anchored to pinned SDK/CLI types with file:line.
- `bun run lint`, `bun run typecheck`, `bun run format:check` pass (docs-only; the licence-header gate applies to the new file).

## Non-goals

- No production code: no `RunnerConfig` extension, no `OPENCODE_CONFIG_CONTENT` builder in afk-runner, no claude-backend threading, no MCP block in any runtime config.
- No credential-containment implementation (documented as a follow-up, like the prior research).
- No per-server opt-out knob design (follow-up).

## Capabilities

None — skip_specs proposed because the deliverable is a docs-only research document; no runtime contract changes, and the implementation change it informs proposes its own capabilities.
