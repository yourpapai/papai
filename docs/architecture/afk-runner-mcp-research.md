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

Status: complete — evidence (§1.1–§1.3, §4.1), comparisons (§1.4, §2.1),
catalogue (§3.1), doctrine (§4.2), recommendation (§5), and boundaries
(§6) all landed (tasks 1.1–3.6); referenced from `docs/architecture/afk-runner.md`
and the `CLAUDE.md` docs table (task 4.1).

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

### 1.3 The claude route: `--mcp-config` written non-empty (task 2.3)

The seam being studied, by inspection: review-loop's native claude
profile composes `--setting-sources '' --strict-mcp-config --mcp-config
<doc>` (`review-loop/src/claude-argv.ts:54-63`), the doc written per
spawn by `defaultCreateClaudeSpawnDir`
(`review-loop/src/agent-command.ts:71-79`) — an intentionally **empty**
`{ "mcpServers": {} }` document. The binary is the workflow's pin
`@anthropic-ai/claude-code@2.1.251`
(`.github/workflows/agent-pipeline.yml:474`). The threading
**prerequisite** (by inspection, nothing designed): afk-runner's
`runSpawn` threads no `backend`/`claude` options at all
(`afk-runner/src/agent-layer.ts:226-251`), and review-loop's spawn
options read `backend` — "absent is `opencode`" — with the claude
context "assembled once in `runCli`"
(`review-loop/src/agent-runner.ts:94-97`); reaching this seam from
afk-runner is a threading change this research records but does not
design.

The experiment (rig: the recorded zero-spend method — the real pinned
CLI driven against a loopback stub Anthropic endpoint over
`ANTHROPIC_BASE_URL` with an invalid stub token and an env built from
nothing, the `claude-stub.integration.ts` pattern; reproduction = the
argv below with the doc swapped; pid-recorded teardown, census clean):

- **verified** — control, the doc exactly as review-loop writes it today
  (empty): the CLI's `system/init` line reports `"mcp_servers":[]`, the
  model-visible tool table carries the 23 built-in tools and no `mcp__*`
  entries, and no MCP connection is made.
- **verified** — the same doc made non-empty with a `research` stdio
  server (placeholder token via `env`): the server connects under
  `--strict-mcp-config` and is the only one — the CLI's own init line
  reports `"mcp_servers":[{"name":"research","status":"connected"}]`,
  the stub trace holds the full initialize/`tools/list` handshake from
  `clientInfo.name: "claude-code"` (version 2.1.251), and the main
  turn's tool table carries `mcp__research__echo` and
  `mcp__research__env_probe` beside the 23 built-ins — claude's
  `<server>__<tool>` naming (double underscore, distinct from opencode's
  single). A forced tool call round-tripped: the CLI executed the MCP
  tool (`tools/call` in the stub trace) and the `tool_result` reached
  the model, turn completed exit 0.

Reading for option (d): the claude seam already exists in review-loop
end to end — the doc is the whole MCP surface under
`--strict-mcp-config`, non-empty works, the connected status is in the
CLI's own stdout, and the naming contract is the model-visible table.
What afk-runner lacks is only the threading of `backend`/`claude` (and a
per-spawn doc writer) through `runSpawn` — recorded as the prerequisite
finding option (d) carries into §5's ranking.

### 1.4 The comparison: options (a)–(d) scored

Scored from §1.1–§1.3 and §4.1's live evidence plus the sibling
workspace's on-record mechanics (cited, never imported — design D1).
Every claim carries its label. The ranking itself is §5's; this table
only scores.

**(a) `OPENCODE_CONFIG_CONTENT` built by afk-runner.** The channel is
**verified** end to end through afk-runner's exact spawn shape: config
serialized into the inherited environment reaches the `opencode run
--dir` children, which connect its servers, expose its tools under
`<server>_<tool>` naming, and round-trip calls (§1.1, §1.2). Authority
over ambient config is **verified** (§1.2): the content overlays the
discovered file — its unique entries merge, every same-key conflict
(provider, mcp entry, permission leaf) resolves to the content, and a
deny inside the content is final (no discovered file can grant back).
What it clobbers is therefore exactly the same-key set — afk-runner's
builder would own the provider and profile blocks outright and must
deliberately emit everything it wants, while ambient keys it does not
name survive. Degradation under this channel is **verified** never to
hang (§4.1), and the grant doctrine is **verified** to sharpen: `--auto`
waves `ask` through, so the builder must emit `allow` or absent. The
delivery mechanism is the sibling workspace's proven one — by
inspection, `opencodeConfigEnv` serializes the one config both execution
paths read (`opencode-agent/src/openai-config.ts:160-171`, `:288-296`),
with grants generated as `<server>_*: "allow"` appended after the named
allows where the later rule wins
(`opencode-agent/src/permissions.ts:60-67`, `:76-77`). The cost is
S3-9-shaped: the serialized content contains the provider credentials
(`openai-config.ts:288-296` states it outright — "This value contains
the API key — never log it"), and config content is model-readable —
the follow-up's credential-containment problem, already a named
follow-up. The work is a config builder in afk-runner: new code, no
schema change required if the mcp set rides the existing config surface
as a knob (option (c) composes with this one).

**(b) A repo-local `opencode.json` under the spawn cwd.** Loading is
**verified** (§1.1): the binary probes `<dir>/opencode.json` after the
three global user paths and no parent walk-up occurs — the instance
directory is the `--dir` value. With no content in the environment
(afk-runner's state today), it is the only delivery that exists, and its
servers connect and name exactly as option (a)'s do. Its authority is
**verified** to be the mirror image of (a)'s: against a delivered
content it loses every same-key conflict and cannot rescue a denied tool
(§1.2). Trust edge: the file is repo content — reviewable in the pull
request that carries it, versioned with the tree it configures; but the
same tree is the one afk-runner's own agents hold edit tools over, and
the file scopes to the whole checkout (every opencode consumer of that
cwd, not afk-runner's spawns alone). It cannot carry credentials (a
committed file is leaked by definition — placeholder-only doctrine) and
cannot vary per role, stage, or invocation — it is one static set for
the workspace. Cost: zero code, and zero afk-runner-owned validation —
the binary's own loader is the only gate, and nothing in afk-runner
would know the set exists.

**(c) An `AGENT_MCP_SERVERS`-style env knob consumed by afk-runner.** The
mechanics are on record from the sibling workspace, by inspection: the
knob is parsed and refused at job start (`parseMcpServers`,
`opencode-agent/src/mcp-servers.ts:58-73`), server names are constrained
to the tool-name-prefix-safe alphabet (`mcp-servers.ts:33`, enforced at `:88-92`), the
declarations are strict local/remote schemas (`mcp-servers.ts:48-55`),
and the parsed set rides the one settings object both execution paths
read so they cannot drift (`opencode-agent/src/openai-config.ts:100-123`)
before `mcpGrants`/`mcpBlock` emit it (`:267-268`). Its `headers` and
`environment` values join the pipeline's secret set
(`opencode-agent/src/secrets.ts:106`, consumed by `contain.ts:258` and
`index.ts:226`) — the scrubbing story the sibling built and afk-runner
does not run. Its authority is inherited from the channel that carries
it: **verified** (§1.2) that content overlays ambient, so a knob afk-runner
merges into its built content carries option (a)'s full authority. Config
surface: afk-runner's own `RunnerConfigSchema` is a strict six-key
object (`afk-runner/src/config.ts:58`) — a knob is an env-side surface
that reaches the children only through option (a)'s builder, making (c)
a delivery-and-validation wrapper over (a), not a rival. Trust edge:
whoever sets the job's environment — for afk-runner's CI shape, the
workflow.

**(d) The claude route's `--mcp-config` doc written non-empty.** The
seam is **verified** working end to end in review-loop's native profile
(§1.3): the doc is the entire MCP surface under `--strict-mcp-config`,
the CLI's own init line reports the connected status, the naming is
`mcp__<server>__<tool>`, and forced calls round-trip. The prerequisite
is by inspection and is the option's defining cost: afk-runner threads
no `backend`/`claude` options through its one spawn seam
(`afk-runner/src/agent-layer.ts:226-251`;
`review-loop/src/agent-runner.ts:94-97`) — option (d) is unreachable
until that threading change lands, and it reaches only the claude
backends' agents, which afk-runner does not spawn today. Its gating
surface also differs in kind (claude's doc + allowlist vs opencode's
permission maps — the D8 gating boundary), so a dual-backend delivery
would carry two grant vocabularies for one server set.

| Dimension | (a) content built by afk-runner | (b) repo-local file | (c) env knob (via (a)) | (d) claude `--mcp-config` |
| --- | --- | --- | --- | --- |
| Delivery verified live | **verified** (§1.2) | **verified** (§1.1) | by inspection (sibling) + rides (a) | **verified** (§1.3) |
| Authority over ambient | wins every same-key conflict (verified) | loses to any content (verified) | inherits (a)'s (verified channel) | n/a (different binary) |
| Per-level scoping possible | yes — the builder composes per spawn (by inspection: one builder, `openai-config.ts:160-171`) | no — one static set per checkout | yes — parsed per invocation | yes — per-spawn doc (seam exists, `agent-command.ts:71-79`) |
| Credential exposure | model-readable content (S3-9, by inspection anchor `openai-config.ts:288-296`) | none possible (committed file) | values join the secret set (by inspection, `secrets.ts:106`) | child-env readable (D6; §1.3's env) |
| Unattended grant safety | verified: allow-or-absent; `ask` is auto-approved (§4.1) | verified on the content channel only (§4.1): same rules as (a), same engine (§1.2) — file-channel `ask` not driven | generated `allow` grants (by inspection, `permissions.ts:60-67`) | allowlist vocabulary differs (by inspection) |
| Prerequisite work | config builder in afk-runner | none (zero code) | knob parse + schema surface | claude backend threading first |
| Validation on arrival | afk-runner's zod (repo convention) | the binary's loader only | knob parse refuses at start (by inspection) | the CLI's own errors |

**Scored conclusion.** Options (a) and (c) are one design in two layers —
the knob is the operator surface, the built content the delivery channel
— and together they are the only pair that is simultaneously verified
live on afk-runner's own spawn shape, authoritative over ambient config,
per-level composable, and validated at job start. Option (b) is real
today and free, but static, unvalidated, scope-bloating, and powerless
beside any future content. Option (d) is verified viable but blocked
behind a backend-threading prerequisite that is itself a change. §5
ranks from this table.

## 2. Scoping the server set to levels of task work

> Filled by task 3.2's comparison: one table, the five dimensions below
> identical across the four axes.

"Levels of task work" are code, not concepts — three concrete axes exist
in afk-runner today, plus the global fallback (by inspection):

- **per-role** — `AgentRoleSchema` (drafter/reviewer/skeptic/resolver/
  estimator/decomposer/atomicity/planner,
  `afk-runner/src/config.ts:11-20`); `modelFor` (`config.ts:127`) is the
  existing per-role hook, currently role-insensitive.
- **per-stage** — the seven spawn sites (estimator, drafter,
  reviewer/skeptic, review resolver, escalation resolver, decomposer,
  atomicity).
- **per-depth** — S/M/L round caps and tail shape.
- **global** — one set for every agent.

The comparison scores the four axes on dimensions fixed before anything
is ranked (design D4): **trust edge** — who can influence the server set;
**blast radius** — checking servers for reviewer/skeptic vs work servers
for drafter/decomposer, and how grants differ per level; **config
surface** — extension of the strict six-key `RunnerConfigSchema`
(`afk-runner/src/config.ts:49-69`) vs an env knob vs a separate file;
**grant composition** — how the shape emits per-profile grants and
composes with the `modelFor` precedent; **cost profile** — which axes pay
server startups for stages that never use the tools.

### 2.1 The comparison (task 3.2)

The facts each axis rests on, by inspection. **Per-role**: the role is
already in the builder's hand — `runStageAgent` receives
`options.role` (`afk-runner/src/agent-layer.ts:35`) and resolves the
model at `:174` through `modelFor` (`afk-runner/src/config.ts:127`),
the existing per-role hook, role-insensitive today (it returns
`config.model`, the `_role` parameter unconsumed); the role vocabulary
is a closed 8-member enum (`AgentRoleSchema`,
`afk-runner/src/config.ts:11-20`). **Per-stage**: the seven spawn sites —
estimator (`work/intake.ts:126`), drafter (`work/draft.ts:80`),
reviewer/skeptic (`work/review-agents.ts:37`, `role: lens`), review
resolver (`work/review-agents.ts:67`), escalation resolver
(`work/veto-updater.ts:228`), decomposer (`work/decompose.ts:60`),
atomicity (`work/atomicity.ts:44`) — spawn across six stages: reviewer
and skeptic share one lens-parameterized site, resolver spawns from two
stages (review and escalation), and `planner` (the enum's eighth member)
never spawns through the seam. **Per-depth**:
`DepthProfile` rides the kernel context
(`afk-runner/src/kernel/machine.ts:49`, set by the `depth` event at
`:99`) and gates the tail (`runsAtomicity`, `work/decompose.ts:19`,
consumed at `work/atomicity.ts:68`) — known before any spawn. And each
`opencode run` spawn boots its **own** opencode instance and its own MCP
children — verified across every rig arm — so whatever set an axis
assigns, its boot cost multiplies by the run's six-plus spawns.

| Dimension | per-role | per-stage | per-depth | global |
| --- | --- | --- | --- | --- |
| Trust edge | Runner-level: the mapping keys on code-owned role names (closed enum, `config.ts:11-20`); untrusted text cannot mint a role, so the influencer set is exactly today's operator class. | Identical — stage identity lives in the seven code sites; no new influencer. | Identical — depth arrives from the run's own profile (`machine.ts:99`), never from outside text. | Identical — one set, one owner; the narrowest surface to audit. |
| Blast radius | Sharpest: checking servers for reviewer/skeptic, work servers for drafter/decomposer/atomicity — grants differ per role by construction. | Near-sharp: reviewer and skeptic share one lens site and resolver spawns from review and escalation; the review stage owns checking (reviewer/skeptic) and work (resolver) roles — a stage-level set hands it the union. | Coarse: every agent in a depth tier holds the same set; the checking/work distinction collapses within S/M/L. | Maximal: every agent holds every server; the distinction disappears entirely. |
| Config surface | A per-role map beside the strict six-key schema — a deliberate extension of `z.strictObject` (`config.ts:58`), ~8 keys for the operator to know and the validator to check; or a global list plus narrowing keys. | Same extension cost with 6 keys, one of which (review) carries three roles' worth (reviewer, skeptic, resolver). | Smallest keyed surface (3 keys) — but the keys cut across the wrong grain. | Smallest possible: one server list — one schema key, or an env knob with no schema change at all. |
| Grant composition (incl. `modelFor`) | Composes directly with the existing hook: an `mcpFor` sits beside `modelFor` at the one seam already holding the role (`agent-layer.ts:174`), emitting the sibling's proven per-profile grant shape (`permissions.ts:76-77`). | Needs a stage→roles mapping in code to emit grants; composes with `modelFor` only where stage maps 1:1 to role. | Orthogonal to `modelFor` — role keeps the model, depth takes the servers, no shared seam. | One grant set; nothing to compose. |
| Cost profile | Each spawn boots only its role's servers — a checking role never pays a work server's startup. | Same per-spawn economy; review pays the union once per reviewer/resolver spawn. | Spawns pay for servers their role never uses, bounded by tier. | Every spawn pays every server's boot across the run's six-plus spawns — the widest set multiplies the widest. |

**Scoring conclusion.** No axis wins outright: per-role is the precise
fit for blast radius and grant composition but carries the largest
config surface; global is the cheapest surface with the worst blast
radius and the widest boot bill; per-stage and per-depth sit between
without fixing either end. The table points at the mixed shape — a
**global base set with per-role narrowing** (checking roles shed the
work servers), stated here as the composition it is (design D4): one
global list for the common servers, an optional per-role narrowing map,
both through the (a)+(c) delivery pair §1.4 scored. Its config surface —
where the base list and the narrowing map live, and what the strict
schema gains — is the follow-up implementation change's to design; §5
ranks from both tables.

## 3. Server catalogue and transports

> Filled by task 3.3; bounded by repo precedents (design D5), not a
> marketplace survey. Every entry carries a repo `file:line` anchor.

### 3.1 The catalogue (task 3.3)

Bounded by repo precedents (design D5), not a marketplace survey; every
entry carries a repo anchor. Shared mechanics first, so the entries
don't repeat them: opencode's per-entry `timeout` field exists on both
config shapes (`@opencode-ai/sdk` `types.gen.d.ts:1476` local,
`:1502` remote) and the default bound is the **verified** 30 s of §4.1;
local stdio delivery into afk-runner's route is **verified** working
(§1.1), remote entries' shapes (`url`/`headers`, `:1485-1502`) are by
inspection plus the sibling doc's on-record verification of static-header
remotes with `oauth: false` under unattended runs
(`opencode-agent/docs/mcp-integration-research.md:51-100`); and the
install/pinning story for any local stdio server on an ephemeral runner
is the sibling doc's on-record answer — a build step can `bunx`/`npx`
the server or pin it from a lockfile, with the pinned command embedded in
`McpLocalConfig.command` (`opencode-agent/docs/mcp-integration-research.md:499`,
`:794`).

- **Structural code index server** (the `codeindex` pattern). The repo's
  protocol names it and its four queries — `code_symbol`, `code_search`,
  `code_impact`, `code_index` — with `limit`/`kinds`/`scopeTiers`
  shaping (`CLAUDE.md:138-151`); the server itself lives outside this
  repository (`CLAUDE.md:42`). Transport: not on record in this repo —
  the entry shape (local stdio or remote) is undetermined here, labelled
  as such rather than guessed. Install/pinning: per the shared mechanics
  above if stdio (ephemeral runners must install and pin it per build);
  if remote, a URL + header story. Startup/timeout: the shared 30 s
  bound; its four queries are read-only by contract, the blast-radius
  profile of a checking server (§2.1).
- **papai-hosted remotes** (`/mcp/plugin/<pluginId>`, context-vault).
  The route is live repo code: prefix `/mcp/plugin/`
  (`src/mcp-server/server-route.ts:21`, router doc `:136`), plugin tool
  descriptors bridged (`src/mcp-server/plugin-bridge.ts:53`), gated by
  the manifest flag `mcpServer: true`
  (`src/plugins/types.ts:210`) — and the repo carries its own live
  example, `plugins/synthetic-web-search/plugin.json`. Binding tokens
  authenticate the route: 30-day HMAC-signed binding tokens
  (`src/mcp-server/token.ts:13-16`). context-vault's manifest contributes
  the read-only tools `list_agent_specs`/`get_agent_spec` with
  `storageScope: group`, `defaultEnabled: false`, and a 3000 ms
  activation timeout (`plugins/context-vault/plugin.json`). Transport
  constraint, by inspection: papai's own MCP client pool is
  streamable-http only today — "Stdio transport is a future extension"
  (`src/mcp/client-pool.ts:104-105`, enum at `src/mcp/types.ts:30`) —
  and its user endpoints are HTTPS-enforced
  (`src/mcp/types.ts:17-18`); a runner agent consuming the hosted route
  would therefore drive it as an opencode **remote** entry (or a claude
  remote doc), with the binding token riding `headers` — i.e. a
  credential inside config content or the claude doc, the §4 exposure
  class, and the papai-`tool_prefs` bypass §6 records. Startup/timeout:
  papai-side plugin activation is bounded (3000 ms in both hosted
  manifests); the MCP connection itself follows the shared 30 s bound.
- **Task-tracker access** (Kaneo/YouTrack-shaped). The repo precedents
  are provider plugins, not MCP servers:
  `plugins/task-provider-kaneo/plugin.json` contributes
  `taskProviderTypes: ["kaneo"]` with capability-gated operations
  (`comments.create`…), beside `plugins/task-provider-youtrack/` and
  `plugins/task-provider-github/`, all implementing the normalized
  `TaskProvider` interface (`src/providers/types.ts:81-86`, gated by
  `TaskCapability`, `:33,66`; registration contract in
  `src/providers/CLAUDE.md:12-16`). Transport: no MCP server for task
  tracking exists in-repo — exposing it to runner agents would either
  ride the papai-hosted remote route above (the bridge exists; the
  plugins would need the `mcpServer` flag and their tools bridged) or be
  a new local stdio wrapper; neither is on record, labelled as such.
  Install/pinning: hosted = none; stdio wrapper = the shared mechanics.
  Startup/timeout: the shared mechanics. The security note is §4's
  doctrine: a task-tracker server can mutate work items, so it is a work
  server (§2.1's blast radius), never a checking role's default.
- **Web search**. Two repo-grounded shapes. First, the repo already
  hosts a search MCP server: `plugins/synthetic-web-search/plugin.json`
  sets `mcpServer: true`, contributes the `search` tool, scopes its
  `api_key` as sensitive/admin config, allow-lists its egress host
  (`providerAllowedHosts: ["api.synthetic.new"]`), and bounds activation
  at 3000 ms — the complete hosted-remote shape with credentials living
  papai-side, never in the runner's config. Second, the binaries carry
  built-ins: `webfetch` is **verified** present in the model-visible
  tool tables of both routes (§1.2, §1.3), and `websearch` exists as a
  permission key in the pinned SDK's permission type
  (`types.gen.d.ts:1345`) — gateable by the same maps, though its
  runtime behaviour was not driven in the rig and stays unverified.
  Install/pinning: hosted = none; built-ins = none; an external search
  API as a stdio server would follow the shared mechanics. 
  Startup/timeout: 3000 ms activation papai-side; the shared 30 s bound
  for any MCP shape.

*(catalogue closed by the D5 boundary: external servers beyond these
four families appear only as shape examples above, not endorsements,
and nothing here is an install recommendation.)*

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

### 4.1 Live re-grounding through afk-runner's spawn shape (task 2.4)

The sibling research's degrade-never-hang and unattended-grant claims,
re-driven through the real pinned binary on the CLI spawn shape afk-runner
uses (`opencode run --dir` / `opencode serve`, config delivered in the
inherited environment — the channel option (a) would use; same rig,
placeholder tokens only, pid-recorded teardown, census clean). A
four-server block in one boot — `ok` (works), `bad` (failing command),
`off` (`enabled: false`), `hang` (stdio child that never initializes) —
polled through `GET /mcp` with an 8 s per-call bound:

- **verified** — a failing server command degrades to data, never a
  crash or a hang: `bad` reports `{"status":"failed","error":"MCP error
  -32000: Connection closed"}` while `ok` connects and serves normally
  in the same boot.
- **verified** — a stdio child that never initializes is bounded by
  opencode itself at 30 s: `hang` reports `{"status":"failed","error":
  "Operation timed out after 30000ms"}`, and the child's pid-recording
  wrapper's pid was already gone at teardown — reaped by opencode, no
  leak.
- **verified** — `enabled: false` means the child is never spawned at
  all: status `disabled`, and the entry's pid-recording wrapper never
  wrote its pid file.
- **verified** — a status poller must bound its own calls: while the
  hang client was settling, `GET /mcp` blocked past three consecutive
  8 s poll deadlines; the full map only answered ~34 s after boot, every
  entry final at once. The cheap lesson from the sibling doc re-holds:
  treat the 30 s ceiling as the poll-time floor, or the runner reads its
  own timeout as a missing server.
- **verified — and this is a new finding, not a carried one** — an `ask`
  grant does **not** deadlock an unattended turn under afk-runner's spawn
  shape. With `permission: {"ok_*": "ask"}` in the delivered config, the
  tool stayed in the prompt-time table, the forced call executed
  (`tools/call` reached the server, tool part `state: completed`), the
  DEBUG log records `evaluated permission=ok_echo … action.action=ask`
  with no permission prompt anywhere, and the turn completed exit 0 in
  7 s. `--auto` (review-loop's `opencodeCommand` passes it,
  `review-loop/src/agent-command.ts:138`) auto-approves permissions that
  are not explicitly denied — and an `ask` rule is not a deny — so on
  this route `ask` behaves as `allow`. The wildcard `<server>_*` key
  form itself works at the top level (the deny control with
  `{"ok_*": "deny"}` filtered both tools from the table). Security
  reading for §5: under afk-runner's shape the doctrine "unattended
  grants are `allow` or absent, never `ask"` sharpens — `ask` buys
  nothing and gates nothing, because `--auto` waves it through; the
  follow-up must emit `allow` or absent, and must not rely on `ask` as
  a hold-point.

### 4.2 The doctrine restated per injection surface (task 3.4)

The carried-forward doctrine (D6), restated per surface so no option can
be adopted with a security property left implicit. Labels as everywhere
else; the degrade-never-hang half is **verified** (§4.1) and binds every
surface identically, because it is the binary's own behaviour.

**The content route — options (a) and (c), one channel.**

- *Credentials* — the S3-9 class binds by inspection of the sibling
  workspace's verified finding: the provider key reached the model
  through `OPENCODE_CONFIG_CONTENT` because every process the model
  starts inherits the variable — `echo $OPENCODE_CONFIG_CONTENT` was a
  complete disclosure (`opencode-agent/ROADMAP.md:906-916`) — and the
  afk-runner-built content would carry the same class of payload by
  construction (the sibling's own builder states it: "This value
  contains the API key — never log it", `openai-config.ts:288-296`).
  The sibling's containment — the provider proxy placeholder plus value
  scrubbing (`opencode-agent/src/secrets.ts:106`, consumed by
  `contain.ts:258`) — is not part of afk-runner and stays a named
  follow-up (§5); a papai-hosted remote's binding token would ride
  `headers` inside the content, the same class (§3.1). Until containment
  lands, the recommendation inherits S3-9's lesson: prefer servers that
  need no credential in the content at all.
- *Untrusted input* — never defines a server, as a design decision
  needing no binary evidence: task files, agent prompts, gate answers,
  issue and chat text contribute nothing to the `mcp` block on any
  option. The set arrives only through the operator's knob and config —
  the trust edges §2.1 scored. The sibling's on-record rejection of
  issue/comment-level configuration is the same rule wearing its other
  face (`opencode-agent/docs/mcp-integration-research.md:629-646`).
- *Grants* — **allow or absent**, and §4.1 adds the verified reason
  this route cannot even offer `ask` as a choice: `--auto` waves it
  through. The builder emits the generated `<server>_*: "allow"` keys
  per profile after the deny base (by inspection,
  `permissions.ts:60-77`), or nothing.
- *Degradation* — **verified** (§4.1): a failing command degrades to
  `failed` data, `enabled: false` never spawns, a hung child is bounded
  at 30 s and reaped, and a status poller must bound its own calls.

**The repo-local file — option (b).**

- *Credentials* — none possible: a committed file is leaked by
  definition; placeholder-only doctrine applies to any example that
  ships in the tree.
- *Untrusted input* — the file's trust model is exactly the reviewed
  pull request that carries it (§2.1's trust edge); the same rejection
  holds — no run-time text writes it, and the run's agents hold edit
  tools over the tree it lives in, which is why option (b) alone can
  never be the gate.
- *Grants* — whatever the file says, validated only by the binary's
  loader (§1.4's validation row); the allow-or-absent doctrine is the
  operator's discipline here, unenforced by afk-runner. And **verified**
  (§1.2): a delivered content's same-key deny voids the file's grants —
  precedence the operator must know.
- *Degradation* — identical to the content route (**verified** §4.1:
  the mechanics are the binary's, independent of the channel).

**The claude route — option (d).**

- *Credentials* — readable by the child and its children: the
  credential rides the child environment by design
  (`review-loop/src/backend-select.ts:41-49`, `:98-102`), the loop's
  own record accepts the fixer residual ("the credential is readable by
  the fixer's Bash children"), the MCP doc is a file the child reads,
  and server `env` values ride inside it — the S3-9 family with a
  different carrier. The claude child env at least strips
  `OPENCODE_CONFIG_CONTENT` by name
  (`review-loop/src/agent-command.ts:168`), so the two routes' exposure
  channels do not compose.
- *Untrusted input* — the same rejection: the per-spawn doc is written
  by the runner from operator config only.
- *Grants* — claude's allowlist vocabulary differs in kind (the doc
  plus allowlist surface — the D8 gating boundary); allow-or-absent
  maps to allowlist membership, but the mapping is **by inspection
  only**: the rig verified connection, naming, and round trip (§1.3),
  not the claude-side grant enforcement, and the claude route's failure
  degradation was never driven — both carry forward as explicit
  unknowns into §5.
- *Degradation* — connection **verified** (§1.3); failure behaviour
  unverified on this route (stated above, not guessed).

**What the runner emits when a server dies — the L0/L1 guidance.** The
event surface already exists: the L0/L1 agent-noise schemas
(`afk-runner/src/agent-noise-schemas.ts:19-73` — L0 `tool_use` /
`step_finish`, L1 `spawned` / `retrying` / `killed` / `done`, "telemetry
the fold tolerates, never drives on"), emitted today at the spawn seam
(`afk-runner/src/agent-layer.ts:175`). The guidance, proposal-shaped:
a dead server should surface as telemetry at these altitudes — an
L1-class event at spawn time naming the agent and the server's resolved
status, and an L0-class record when a call targets a tool a dead server
would have owned — so the run report shows the gap without the run
failing. What the research fixes is the class (L0/L1), the payload
discipline (names, statuses, counts — never a server's `environment`,
`headers`, or any URL that embeds a token), and the never-fail rule;
the exact schema addition is the follow-up implementation change's to
design.

## 5. Recommendation and follow-ups (task 3.5)

The ranking derives from §1.4's option table and §2.1's scoping table —
no new claims, only their consequences. This section is a recommendation
and an outline, not an implementation: the change it informs is a
separate follow-up proposal, and nothing here is wired (the design-risk
framing this doc exists under).

**1. Afk-runner builds `OPENCODE_CONFIG_CONTENT` per spawn, fed by an
operator knob — options (a)+(c) as one two-layer design.** It is the
only option pair whose delivery is **verified** live on afk-runner's own
spawn shape (§1.1, §1.2), whose authority over ambient config is
**verified** (content overlays the discovered file, wins every same-key
conflict, and cannot be loosened by the tree), whose grants and
degradation are **verified** on this exact route (§4.1), and which
scores per-level composable with validated-at-start config on both
§1.4 dimensions that the other options fail. The scoping shape it
carries is §2.1's conclusion: a **global base set with per-role
narrowing** — checking roles (reviewer, skeptic) shed the work servers
drafter/decomposer/atomicity carry — composed at the seam that already
holds the role (`afk-runner/src/agent-layer.ts:174`, beside `modelFor`).

**2. A repo-local `opencode.json` as checked-in defaults, not the
mechanism.** **Verified** real today (§1.1) and free, but static,
unvalidated beyond the binary's loader, scoped to the whole checkout,
and — **verified** — powerless beside any delivered content (§1.2). Its
role in the recommendation is a complement: repo-owned defaults an
operator can review in the PR that changes them, never the per-level
surface.

**3. The claude `--mcp-config` route, after its prerequisite.**
Connection, naming, and round trip are **verified** (§1.3), but the
route is blocked behind threading the claude backend through afk-runner's
seam (`afk-runner/src/agent-layer.ts:226-251` — a change of its own) and
carries a second grant vocabulary. Ranked last not on viability but on
sequencing: it is the follow-up that lands after backend threading, not
part of the first change.

**Which conclusions any unverified label changes.** The winner rests on
none: every load-bearing claim for options (a)+(c) — delivery, authority,
grant behaviour, degradation — is **verified** on afk-runner's own shape.
The unverified labels bound the edges. The claude route's two unknowns
(§4.2: grant enforcement, failure degradation) affect only option (d),
which the ranking already places behind a prerequisite — if either
turned adverse, (d) drops further and nothing above it moves. The knob
mechanics are the sibling's by inspection (`mcp-servers.ts:58-73`); a
behavioural surprise in afk-runner's port would revise the config-surface
sketch below, not the ranking, because the knob rides option (a)'s
**verified** channel either way. The catalogue's unknowns (codeindex
transport, `websearch` runtime, task-tracker MCP exposure — §3.1) bind
only their own entries' install stories.

**The follow-up implementation change — outline (nothing implemented).**
Capability named at feature-domain granularity: **`afk-runner-agent-mcp`**
— the afk-runner agent MCP injection surface, one change, not one per
experiment. What it would decide (its proposal's job, sketched only):

- *Config surface:* how the server set enters the run — an operator
  knob read and refused at start (the sibling's parse-and-refuse shape,
  `mcp-servers.ts:58-73`) or keys beside the strict six-key
  `RunnerConfigSchema` (`afk-runner/src/config.ts:58`); either way a
  global base map plus the optional per-role narrowing map, with the
  role vocabulary validated against `AgentRoleSchema`.
- *Injection point:* the per-spawn builder at the seam that already
  holds the role and the model (`agent-layer.ts:174`), composing the
  provider block, the deny-by-default permission base, the generated
  per-profile `<server>_*: "allow"` grants (`permissions.ts:60-77`'s
  shape), and the `mcp` map into the content serialized to the child —
  including how the opencode spawn branch, which today sets no child
  environment (`review-loop/src/agent-command.ts:34-35`), threads it.
- *Emission:* the L0/L1 dead-server events under §4.2's payload
  discipline.
- *What it explicitly inherits as decided:* untrusted input never
  defines a server; grants are allow-or-absent; degrade-never-hang; the
  precedence facts of §1.2.

**Named follow-ups, each its own change (deferred, risks on record):**

- **Credential containment for the afk-runner content route** — the
  proxy-placeholder/scrubbing generalisation the sibling built
  (`secrets.ts:106`, `contain.ts:258`) is not here; until it lands, the
  recommendation is the one S3-9 taught: prefer servers that need no
  credential in the content at all (§4.2).
- **Per-server opt-out** — narrows the base-set shape (an operator can
  turn one server off without editing the whole set); the sibling's
  deferred item, carried for the same reason.
- **The claude-backend threading change** — option (d)'s prerequisite,
  named here so it is not mistaken for part of `afk-runner-agent-mcp`.

## 6. System boundaries (design D8)

Four statements the follow-up cannot conflate; each carried in full with
its anchors.

- **Gating / tool-prefs.** Afk-runner's stage agents are opencode/claude
  subprocesses gated by opencode permission maps — the `<server>_*` keys
  inside each profile's deny-by-default map, **verified** live on this
  route (§1.2's deny arms, §4.1's ask/deny evaluation lines; the
  generated-grant shape at `opencode-agent/src/permissions.ts:60-77`) —
  and, on the claude route, the CLI's own `--mcp-config`/allowlist
  surface (§1.3). Papai-core's capability gating and per-context
  three-state `tool_prefs` (`src/tools/tool-preferences.ts:17`,
  resolved at `src/tools/index.ts:22,52`, scoped by the entity-scope
  registry of `docs/architecture/behaviors.md:24` / `src/chat/context-scope.ts`)
  do **not** apply to them: the runner is an MCP client outside papai's
  context model — its spawns carry no storage context id, no
  `platformInstanceId`, no user identity, so there is no context for
  `tool_prefs` to resolve against. Conversely — a stated consequence,
  not a defect to fix here — consuming a papai-hosted server
  (`/mcp/plugin/<pluginId>`, `src/mcp-server/server-route.ts:21`,
  authenticated by a binding token, `src/mcp-server/token.ts:13`) from a
  runner agent bypasses papai's `tool_prefs` allow/deny resolution
  entirely: the call is subject to the runner's permission maps alone,
  and papai's per-context gate never sees it.
- **Scope model.** This change adds no persisted state: the deliverable
  is repo content keyed to nothing — no storage context id, config
  context id, platform instance id, or user id (the scope model's four
  keying dimensions, `docs/architecture/behaviors.md:24`,
  `src/chat/context-scope.ts`). The follow-up's config, whatever surface
  wins in §5, keys at the **runner level** — the per-invocation
  afk-runner config file or environment
  (`afk-runner/src/config.ts:58`'s strict schema is the existing shape) —
  outside papai's per-user/group scope model entirely; nothing in
  papai's SQLite (context settings, platform instances, tool prefs)
  reads, stores, or validates it.
- **Dependency surface.** None. No DB change — no drizzle migration, no
  backfill, nothing under `src/db/`. No new packages: the experiments
  consumed the already-pinned binaries (`opencode-ai@1.18.7`,
  `.github/workflows/agent-pipeline.yml:450`;
  `@anthropic-ai/claude-code@2.1.251`, `:474`) and the zod-declared
  shapes already on record (`@opencode-ai/sdk` types, cited throughout
  §1–§4). No new module is created: the doc sits in the existing
  `docs/architecture/` home beside `afk-runner.md`, and the sibling
  research doc is cited, never imported — afk-runner's copy-never-import
  discipline applied to its docs layer.
- **Hook surface.** The write-hook pipeline gates the three file writes —
  this doc (SPDX header mandatory: the licence-header gate) and the two
  pointer edits (`docs/architecture/afk-runner.md`, the `CLAUDE.md`
  docs-table row) — for headers and format
  (`docs/architecture/commands.md` documents the pipeline). Docs are not
  gateable implementation code: no TDD test pair exists for this
  deliverable and none is required, and no mutation floor applies — the
  Stryker gate measures product code only (`src/`, `client/`,
  `plugins/`, via `isGateableImplFile`), so a docs-only diff selects
  zero targets. The change's order of work followed its own tasks:
  rig and live experiments first, evidence recorded, doc drafted,
  gates run.
