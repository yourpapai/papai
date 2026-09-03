<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# afk-runner MCP integration research

What it would take to connect MCP servers to the AI agents afk-runner
spawns **on different levels of task work**: which injection surface can
carry an `mcp` block through afk-runner's one spawn seam, how a server set
could be scoped per role/stage/depth, which servers the repo's own
precedents put forward, and what each option costs in credential exposure
and degradation behaviour. Issue #403; docs-only deliverable (OpenSpec
change `afk-runner-mcp-integration-research`) — the implementation it
informs is a separate follow-up proposal, not delivered here.

Direct precedent: the sibling research
`opencode-agent/docs/mcp-integration-research.md` verified the
binary-level MCP mechanics for the opencode-agent pipeline. Those findings
are inputs to re-verify against afk-runner's spawn path, not portable
conclusions: afk-runner builds no opencode config today — it never sets
`OPENCODE_CONFIG_CONTENT` and runs no config builder — so the proven
single-seam injection point of the sibling workspace does not exist here,
and the claude route's MCP seam is unreachable from afk-runner today.

## Conventions

The document is built evidence-first, in the order the change's tasks
record it: the rig experiments run first (§1 and §4 absorb their live
evidence), the catalogue and comparisons are written design-grounded from
the repo's own docs and code, and §5 ranks only from the scored tables.
Every behavioural claim carries exactly one label:

- **verified** — a live run of the real pinned binary, driven through the
  same spawn shape afk-runner's agents use (`opencode run --dir <cwd>`, or
  the claude native-profile block), demonstrated it. The run's
  reproduction commands are recorded with the claim.
- **by inspection** — read off a pinned package's or this repo's own
  files, anchored `file:line`.

A live label supersedes an inspection label wherever both exist. Anchors
move with any pin bump — on a bump, re-verify the anchored claims and
every **verified** claim against the new binary. Any option whose
behaviour could not be verified live carries that unverified label into
§5's ranking and is scored as an explicit unknown, never a guess.
Credentials appear only as placeholder values, and experiments are
pid-disciplined: children are killed by recorded pid only, never by name.

Status: skeleton with §1.1 (ambient-only) and §1.2 (content-set) evidence
recorded (tasks 2.1–2.2); the claude-route and degradation experiments and
all analysis sections are still to land.

---

## 1. Injection surface for afk-runner's spawn path

> Filled from the merge-vs-override experiments (ambient-only and
> content-set) and the claude-route experiment (tasks 2.1–2.3), then
> scored per option in task 3.1's comparison table.

One seam owns every stage-agent spawn: `runStageAgent`
(`afk-runner/src/agent-layer.ts:253`) → review-loop `runAgent` →
`buildAgentCommand` (`review-loop/src/agent-command.ts:286`) — by
inspection. The options compared here are the four ways an `mcp` block
could reach that seam's children:

- **(a)** afk-runner builds and serialises its own config into
  `OPENCODE_CONFIG_CONTENT` for its `opencode run` children — including
  what that clobbers of the ambient config the binary would otherwise
  discover.
- **(b)** a repo-local `opencode.json` under the spawn cwd — whether the
  binary loads it at all, and whether it merges with, overrides, or loses
  to pipeline-provided config (the merge-vs-override experiment the
  sibling research left pending).
- **(c)** an `AGENT_MCP_SERVERS`-style env knob consumed by afk-runner and
  merged into whichever config path wins.
- **(d)** the claude route's `--mcp-config` doc written non-empty per
  spawn — behind the prerequisite of threading the claude backend through
  afk-runner's seam, recorded as a prerequisite finding, not designed
  here.

*(stub — task 3.1 scores these options from the experiment evidence.)*

### 1.1 Ambient-only: what afk-runner's spawn delivers today (task 2.1)

The spawn shape being studied, by inspection: the opencode branch of
`buildAgentCommand` composes `opencode run --auto --format json --model
<model> --dir <cwd> … <prompt>` and sets **no child environment** —
`AgentCommand.env` is claude-branch-only
(`review-loop/src/agent-command.ts:34-35`, `:133-150`), so `realSpawn`
inherits `process.env` unchanged
(`review-loop/src/spawn.ts:113-116`), and afk-runner threads no config of
its own anywhere in `runSpawn`/`runStageAgent`
(`afk-runner/src/agent-layer.ts:226-251`, `:253`). Spawn cwd equals the
`--dir` value (`review-loop/src/agent-runner.ts:154-158`). The binary is
the workflow's pin `opencode-ai@1.18.7`
(`.github/workflows/agent-pipeline.yml:450`).

The experiment (rig: throwaway stub MCP server `echo`/`env_probe` +
stub OpenAI-compatible provider in a temp dir; reproduction = place an
`opencode.json` with the provider and `mcp` blocks as described, run the
command shape above with `--print-logs --log-level DEBUG`, and read the
`loading path=` log lines, the provider's request bodies, and the MCP
trace; placeholder tokens only, pid-recorded teardown, `ps -p` census
clean): `OPENCODE_CONFIG_CONTENT` explicitly unset for every child
(afk-runner never sets it; the invoking environment's own value is an
environment artifact, neutralised for isolation), then one
`opencode run --dir <dir>` spawn per arm with a repo-local
`opencode.json` carrying the stub provider and an `mcp` server named
`localfile`.

- **verified** — a repo-local `opencode.json` at the `--dir` cwd loads.
  The DEBUG log's config-discovery lines list exactly four probes: the
  three global user paths (`~/.config/opencode/config.json`,
  `opencode.json`, `opencode.jsonc` — none exist on this runner), then
  `<dir>/opencode.json`. The file's server connected (full
  initialize/`tools/list` handshake from `clientInfo.name: "opencode"` in
  the stub trace), and the model-visible tool table carried
  `localfile_echo` and `localfile_env_probe`; a forced tool call round
  tripped (`tools/call` with the unprefixed wire name `echo`, result
  returned, turn completed exit 0).
- **verified** — a repo-local `opencode.json` **above** the `--dir`
  directory does not load: only the three global paths were probed, zero
  provider requests, and the turn failed
  (`ProviderModelNotFoundError: Model not found: stub/stub-model`, exit
  1). No parent walk-up: the instance directory is the `--dir` value.
- **verified** — afk-runner's bare-ambient state fails fast, never a
  hang: with no config anywhere (the control arm), the argv `--model
  stub/stub-model` reference cannot resolve
  (`ProviderModelNotFoundError`, stdout `{"type":"error",…}`, exit 1
  after ~2 s). The `--model` reference afk-runner passes names a
  provider the ambient config must define; today afk-runner delivers
  nothing that defines one.

Reading for the merge-vs-override question: the project file is probed
**after** the global user config and is the last discovered layer before
`OPENCODE_CONFIG_CONTENT` — so option (b) reaches the children today, and
whether it survives option (a) is exactly the content-set arm (task 2.2).
The probe list itself is live log evidence; the binary ships compiled
(`node_modules/opencode-ai/bin/opencode.exe`, an ELF), so no loader
source exists to inspect — the discovery list is recorded from the
pinned binary's own DEBUG output only.

### 1.2 Content-set: the discovered file vs `OPENCODE_CONFIG_CONTENT` (task 2.2)

Both sources present at once — the shape option (a) plus option (b) would
create (content carrying provider + deny-by-default permission blocks, as
the proposal's option (a) sketches; the file carrying its own provider,
`mcp`, and permission keys). Same rig and spawn shape as §1.1, two stub
providers on distinct ports so each side's provider is distinguishable by
where the requests land; permission shapes validated against the pinned
SDK's `PermissionConfig` (a tool-name → `"allow"|"deny"|"ask"` object,
`@opencode-ai/sdk` `types.gen.d.ts:1328-1350`). Three arms: disjoint keys
(content: provider + `mcp.research` + `permission: {"*": "deny"}`; file:
`mcp.localfile` + `permission: {"bash": "allow"}`), same-key conflicts
(both sides define provider `stub` on different ports and an mcp server
`shared` with distinguishable trace files), and a permission leaf
conflict (content `bash: deny`, file `bash: allow`).

- **verified** — the file is still discovered and loaded while content is
  set: the DEBUG log carries both the `loaded custom config from
  OPENCODE_CONFIG_CONTENT` marker and the `<dir>/opencode.json` probe
  line, in every arm.
- **verified** — top-level maps **merge**: with both sources present, the
  content's `research` server and the file's `localfile` server both
  spawned and completed their handshakes (both trace files hold the full
  initialize/`tools/list` exchange; both pid-recording wrappers fired).
  The file's unique keys are not clobbered by the content.
- **verified** — **same-key conflicts resolve to the content**. Provider
  `stub` defined by both sides: every request went to the content's
  endpoint (3 requests; the file's port received 0 across all arms). mcp
  server `shared` defined by both sides: the content's definition is the
  one that spawned — its trace holds the handshake and a `tools/call`,
  its tools (`shared_echo`, `shared_env_probe`) reached the model-visible
  table, and the file-side trace file was never created (its server never
  spawned).
- **verified** — **the content's permission is final; the file cannot
  grant back**. With content `permission: {"*": "deny"}`, the main
  turn's prompt-time tool table was completely empty — built-ins
  included — and the file's `bash: allow` did not rescue bash. With the
  leaf conflict (content `bash: deny`, file `bash: allow`), the main
  turn's table carried nine tools and `bash` was not among them. What
  the content denies, no discovered file can re-enable.

Reading for option (a): `OPENCODE_CONFIG_CONTENT` **overlays** the
discovered config — it merges with the file's unique entries and wins
every same-key conflict, including permission denies. An afk-runner-built
content block therefore needs no knowledge of ambient files to be
authoritative, and a deny-by-default block inside it cannot be loosened
by anything the spawn cwd carries. No configuration in this arm was
unrunnable, so no unverified label carries forward from task 2.2.

## 2. Scoping the server set to levels of task work

> Filled by task 3.2's comparison: one table, the five dimensions below
> identical across the four axes.

"Levels of task work" are code, not concepts — three concrete axes exist
in afk-runner today, plus the global fallback (by inspection):

- **per-role** — `AgentRoleSchema` (drafter/reviewer/skeptic/resolver/
  estimator/decomposer/atomicity/planner,
  `afk-runner/src/config.ts:11-20`); `modelFor` (`config.ts:127`) is the
  existing per-role hook, currently role-insensitive.
- **per-stage** — the six spawn sites (estimator, drafter,
  reviewer/resolver ×2, decomposer, atomicity).
- **per-depth** — S/M/L round caps and tail shape.
- **global** — one set for every agent.

The comparison scores the four axes on dimensions fixed before anything
is ranked (design D4): **trust edge** — who can influence the server set;
**blast radius** — checking servers for reviewer/skeptic vs work servers
for drafter/decomposer, and how grants differ per level; **config
surface** — extension of the strict five-key `RunnerConfigSchema`
(`afk-runner/src/config.ts:49-69`) vs an env knob vs a separate file;
**grant composition** — how the shape emits per-profile grants and
composes with the `modelFor` precedent; **cost profile** — which axes pay
server startups for stages that never use the tools.

*(stub — task 3.2 fills the table and names the recommended shape.)*

## 3. Server catalogue and transports

> Filled by task 3.3; bounded by repo precedents (design D5), not a
> marketplace survey. Every entry carries a repo `file:line` anchor.

Candidates the repo already names:

- a structural code index server (the `codeindex` pattern);
- papai-hosted remotes — plugin tools at `/mcp/plugin/<pluginId>` and the
  context vault — reachable only over streamable-http per papai's pooled
  client, which local stdio-spawned routes must be measured against;
- task-tracker access (Kaneo/YouTrack-shaped);
- web search.

Each entry records transport constraints, the install/pinning story for
stdio servers on ephemeral runners, and startup/timeout behaviour.

*(stub — task 3.3.)*

## 4. Credentials, security, and degradation

> Filled by task 2.4 (live re-grounding through the rig) and task 3.4
> (doctrine restated per injection surface, with labels and anchors).

Carried-forward doctrine (design D6), to be restated per surface: an
`mcp` entry is executable configuration — a `local` entry is arbitrary
command execution, a `remote` entry is an exfiltration endpoint over
unrestricted egress; anything a credential reaches in config content is
model-readable on the `OPENCODE_CONFIG_CONTENT` route (S3-9 class) and
readable by children on the claude route; untrusted text — task files,
chat messages, issue bodies — never defines a server, on any option, as a
design decision needing no binary evidence; unattended grants are `allow`
or absent, never `ask`; degradation is never a hang (the 30s bound on
record), with the caveat that a status poller must bound its own calls.
The section also records what the runner should emit/log when a server
fails (L0/L1 agent events) so a dead server is visible without failing
the run.

*(stub — tasks 2.4 and 3.4.)*

## 5. Recommendation and follow-ups

> Filled by task 3.5: the ranking derives from the §1 and §2 tables,
> states which conclusions any unverified label changes, and names the
> follow-ups (credential containment, per-server opt-out) plus an outline
> of the follow-up implementation change — capability named at
> feature-domain granularity, config-surface and injection-point sketch,
> proposal-shaped, nothing implemented.

*(stub — task 3.5.)*

## 6. System boundaries (design D8)

Four statements the follow-up cannot conflate; stubs below, filled in
full by task 3.6.

- **Gating / tool-prefs.** *(stub)* afk-runner's stage agents are
  opencode/claude subprocesses gated by opencode permission maps and the
  claude CLI's own `--mcp-config`/allowlist surface — papai-core's
  capability gating and per-context `tool_prefs` do not apply to them;
  and a papai-hosted server consumed from a runner agent bypasses papai's
  `tool_prefs` allow/deny resolution entirely.
- **Scope model.** *(stub)* this change adds no persisted state — the
  deliverable is repo content keyed to nothing; the follow-up's config
  keys at the runner level, outside papai's per-user/group scope model.
- **Dependency surface.** *(stub)* none — no DB change, no drizzle
  migration, no new packages; the doc sits in the existing
  `docs/architecture/` home and the sibling research is cited, never
  imported.
- **Hook surface.** *(stub)* the write-hook pipeline gates the file
  writes for headers/format; docs are not gateable implementation code,
  so no TDD test pair and no mutation floor applies to this deliverable.
