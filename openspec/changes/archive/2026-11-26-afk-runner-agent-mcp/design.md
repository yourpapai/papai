<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: afk-runner-agent-mcp

## Context

See `proposal.md` for motivation and `specs/afk-runner-agent-mcp/spec.md` for the
requirements; this design covers only how. Every behavioural fact restated here
carries the research doc's label
(`docs/architecture/afk-runner-mcp-research.md`, "afk-runner MCP research"
below); the **verified** labels are load-bearing and are not re-derived.

The current state that shapes the approach:

- One seam owns every stage-agent spawn: `runStageAgent`
  (`afk-runner/src/agent-layer.ts`) resolves the model at
  `prepareSpawnContext` via `modelFor` (`afk-runner/src/agent-layer.ts:150`,
  the existing role-insensitive per-role hook) and calls review-loop's
  `runAgent`, whose `buildAgentCommand` opencode branch composes
  `opencode run --auto --format json --model <model> --dir <cwd> …` and sets
  **no child environment** (`review-loop/src/agent-command.ts:133-150`) — so
  `realSpawn` inherits `process.env` unchanged (`review-loop/src/spawn.ts`,
  `startChild`: absent `env` inherits, a passed map is the child's **entire**
  replacement environment).
- The delivery channel is proven: config serialized into
  `OPENCODE_CONFIG_CONTENT` reaches the children, its servers connect under
  `<server>_<tool>` naming, it overlays discovered config (unique entries
  merge; every same-key conflict — provider, mcp entry, permission leaf —
  resolves to the content; a content deny cannot be granted back by any
  discovered file) — all **verified** (research §1.1–§1.2).
- Grant and degradation behaviour on this exact route are **verified**
  (§4.1): `--auto` waves `ask` through, so grants are allow-or-absent; a
  failing server degrades to bounded status data; a hung child is bounded at
  30 s and reaped by the binary itself.
- The scoping shape is settled (§2.1): a global base set with per-role
  narrowing, composed at the seam that already holds the role.
- The runner reads only `AFK_RUNNER_MODEL` from the environment today and
  holds no LLM credential of its own; its config surface is the strict
  five-key ladder (`afk-runner/src/config.ts:63`, `resolveRunnerConfig`),
  where a present `.afk-runner/config.json` is wholesale-authoritative.

Constraints inherited as decided (not re-litigated): untrusted input never
defines a server; grants are allow-or-absent; the §1.2 precedence facts; the
spec's inertness contract (no declared servers ⇒ byte-identical behaviour).

## Goals / Non-Goals

**Goals:**

- Deliver the (a)+(c) two-layer design as one implementation: an operator
  env-knob surface, parsed and refused before run work on the verbs that can
  spawn, feeding a per-spawn config-content builder at the afk-runner spawn
  seam.
- Keep the review-loop command builder pure: the composed content reaches it
  as an explicit option; the builder never reads ambient `process.env`.
- Preserve byte-identical behaviour whenever the surface is inactive.
- Stay inside the verified behavioural envelope: no runner-side timeout or
  status-polling machinery, no new permission vocabulary beyond the generated
  `<name>_*` keys.

**Non-Goals** (design-level, beside the proposal's):

- No `agent` profile blocks in the delivered content — afk-runner's spawns
  carry no `--agent`, and profile permission maps would change built-in tool
  behaviour, which the spec forbids. Only top-level `permission` is emitted
  (the level §1.2's arms verified as gating `opencode run` turns).
- No ambient-`OPENCODE_CONFIG_CONTENT` management when inactive: an ambient
  value set by the invoking environment keeps flowing to children exactly as
  today; the runner overwrites it only when it delivers content of its own.
- No new event *kinds* in the fold's driving vocabulary — dead-server
  visibility rides the existing L0/L1 noise altitudes only.

## Decisions

### D1 — Config surface: two environment knobs, parsed and refused before run work (option (i))

The server set enters through **environment knobs**, not keys beside the
strict runner-config schema:

- `AGENT_MCP_SERVERS` — the base map: a JSON object mapping server names to
  declarations, sibling-verbatim in shape (`type: 'local' | 'remote'`
  discriminates the union — the sibling's `z.strictObject` literals,
  `opencode-agent/src/mcp-servers.ts:35-47`, so an entry without `type`
  fails the parse; `local`: non-empty `command` array, optional
  `environment`; `remote`: `url`, optional `headers`; unknown fields
  refused; names restricted to `[A-Za-z0-9_-]+`; any `oauth` key refused in
  every spelling). Blank/unset/`{}` means inactive.
- `AGENT_MCP_ROLE_NARROWING` — the optional narrowing map: a JSON object
  mapping role names to arrays of base-map server names to shed. Keys are
  validated against the closed `AgentRoleSchema` vocabulary
  (`afk-runner/src/config.ts:12-22`); a name absent from the base map refuses
  ("narrowing cannot mint servers").

Beyond the alphabet, a **prototype-pollution refusal** and two **shadowing
refusals** join the same parse, all at the verb before any run work and all
naming the offending name — the shadowing pair because D4 turns every
base-map name into a `<name>_*` permission key, and those keys glob over the
binary's one flat tool-name namespace:

- **Prototype-pollution names**: a base-map name of `__proto__` refuses, and
  `constructor`/`prototype` refuse with it as the same magic-key class.
  `JSON.parse` keeps `__proto__` as an own key and the alphabet admits it,
  but both a zod record rebuild and the sibling-verbatim `{}`-literal
  emission (`block[name] = entry`) silently drop it — verified against this
  repo's zod — so without the refusal the operator's declared server
  vanishes from the delivered `mcp` map without a word, and no shadowing or
  minting check ever sees a name to complain about. The check runs over the
  raw parsed own keys, the one place the name is still visible before a
  rebuild drops it.
- **Intra-map shadowing**: a base map holding names `A` and `B` where
  `A + "_"` is a string prefix of `B` (`foo` beside `foo_bar`) refuses. The
  only ordering semantics on record is the sibling's ordered concatenation
  with the later rule winning (`opencode-agent/src/permissions.ts:70-74`,
  cited by research §1.4), so emitting
  `{foo_bar_*: "deny", …, foo_*: "allow"}` would let the later allow un-shed
  `foo_bar`'s tools for exactly the role that narrowed it — and reversing
  the emission order breaks the mirror case. The research's verified
  wildcard arms (§4.1) are single-server (`ok_*` alone); nothing on record
  makes an overlap of two emitted keys safe. Refusing it keeps D4's emitted
  wildcards pairwise disjoint, so no emission order can flip another key's
  verdict. (The sibling's `mcp-servers.ts` needs no such check — it emits
  MCP grants only, so an overlap there is two allows agreeing; afk-runner's
  per-role narrowing is what makes deny keys live.)
- **Built-in shadowing**: a base-map name whose `name_` prefix is a prefix
  of a built-in tool name on record refuses — today exactly `external`, the
  prefix of the recorded `external_directory` built-in
  (`opencode-agent/src/permissions.ts:34-41`). §1.2 **verified** that
  content permission reaches built-ins (`{"*": "deny"}` blanked the table,
  built-ins included), so a shed server named `external` would emit
  `external_*: "deny"` and deny a built-in tool for that role — breaking
  the spec's non-MCP invariance with a fully legal name. The reserved-prefix
  list is recorded-not-guessed (the on-record underscore-bearing built-in
  tool names), pinned by tests, and re-verified on `opencode-ai` pin bumps
  alongside the other verified anchors; a built-in not yet on the list is
  that stated residual, not a silently assumed absence.

Rationale, from §5's trade-offs: the knob is the operator surface whose trust
edge is "whoever sets the job's environment" (§1.4(c)); the config-file
alternative would put remote `headers` and local `environment` values —
credentials — into a file whose home (`.afk-runner/config.json`) is repo-tree
adjacent, and a committed file is leaked by definition (the research's own
placeholder-only doctrine). The env route also keeps the five-key ladder
untouched: the strict schema, its removed-key pointers, and the
file-over-env-over-defaults precedence all stay exactly as the
`afk-runner-cli` spec pins them. Reusing the sibling's exact knob name and
entry shape lets an operator lift a working `opencode-agent` declaration
verbatim.

The refusal point is verb dispatch, scoped to the verbs that can spawn.
`cliMain` resolves `resolveRunnerConfig(process.cwd())` before dispatch today
(`afk-runner/src/cli.ts:276`); for the two spawning verbs — `start` and
`resume` — it additionally resolves the MCP surface through a new pure
`resolveAgentMcp(env, model)` and refuses on any invalid input, naming the
offending key and the shape problem, before any run work. The non-spawning
verbs — `status`, `report`, `stop`, `runs`, `analyze` (the read-only corpus
report), `serve` (the read-only web board), and the bare run-dir fold summary
— skip the MCP step entirely: env knobs are per-invocation and far more
volatile than the config file (shell profiles and CI env edits sit between
the start and stop invocations), and `stop` — the calm-stop channel for a
live, budget-burning run — must not be lost to an unrelated MCP typo. The
spec requires refusal only before agent spawn or budget spend; the five-key
loader and the one-resolution doctrine around it are not touched. The resolved
surface is threaded as a new optional field on `RunDeps` →
`PipelineWorkDeps` → **every `AgentLayerDeps` construction site** — the two
factories (`agentSeamsOf` `afk-runner/src/graph/pipeline-agent.ts:19`,
`agentOf` `afk-runner/src/graph/pipeline-work.ts:103`) *and* the two
review-stage assembly sites that hand-roll agent deps outside them:
`reviewModule`'s subset literal (`afk-runner/src/graph/pipeline-work.ts:171`,
handed to `runReviewWork`) and `buildReviewScope`'s field-by-field rebuild
(`afk-runner/src/work/review.ts:182-187`), which `review-agents.ts` feeds
into `runStageAgent` for the reviewer/skeptic (and resolver/veto-updater)
spawns. Both review sites enumerate fields rather than spread, so an
optional field omitted there compiles silently and would drop the entire
review half of a run — the checking roles the narrowing exists for — to
contentless spawns. Not inside `RunnerConfig`, which stays the persisted
five-key contract and a secrets-free shape that nothing hesitates to log.

The same verb-time refusal owns one size bound: the serialized content the
builder would emit for the *full* base map (provider block included when
active) is measured against the OS per-string environment ceiling — the same
`MAX_ARG_STRLEN` constant review-loop already refuses an over-limit claude
system prompt with (`review-loop/src/agent-command.ts`, the constant from
`claude-argv.ts`). An over-limit map refuses naming `AGENT_MCP_SERVERS` (the
alternative is an opaque `E2BIG` at the first spawn), and the measurement
bounds every spawn: narrowing only ever removes `mcp` entries and swaps
`"allow"` keys for the shorter `"deny"`, so the full-base composition is the
upper bound of any per-spawn one.

Alternative considered: schema keys (option (ii)) — rejected on the
credentials-in-a-file exposure and ladder-precedence complications above; it
would also force a decision about knob-vs-file precedence the env route simply
does not have.

### D2 — The provider block: an env credential pair, with a refusal matrix

The spec requires delivered content to carry the provider definition for the
model reference the spawn passes, so the model resolves without ambient
configuration. afk-runner holds no credential today, so the same resolution
step reads one OpenAI-compatible pair from the environment:
`LLM_API_KEY` + `LLM_BASE_URL`. These are the repo's established
opencode-route carrier names — the sibling reads exactly them, and
review-loop's claude branch already strips them (`OPENCODE_CONFIG_CONTENT`
and `AGENT_MCP_SERVERS` sit beside them in that list's route carriers) from
claude children
(`review-loop/src/agent-command.ts:165-177`), so the family is coherent
end-to-end. Env-only, never persisted, never logged.

The surface is **active** iff the base map is non-empty. Only an active
surface reads the pair at all — an inactive one never touches credentials,
keeping inertness absolute. For an active surface, two shapes are coherent
and a third is tolerated with a warning; everything else refuses at the verb
naming the offending key:

| Model ref (`config.model`) | Credential pair | Result |
| --- | --- | --- |
| bare (no `/`, e.g. the `opencode` default) | neither set | active; no provider block — the shared model resolves through opencode's own auth/catalogue, which no delivered key names or clobbers |
| `<provider>/<model…>` | both set | active; provider block composed |
| `<provider>/<model…>` | either missing | refuse: the content must carry the provider definition, and half a credential pair is a contradiction (the review-loop claude route's both-or-neither rule) |
| bare | any set | active; no provider block — the pair is inert against a model that names no provider; resolution warns naming the ignored keys (never their values) and proceeds |

Rationale: the spec's "model resolves without ambient configuration" scenario
makes delivered-provider resolution the point of the builder; refusing at the
verb beats discovering `ProviderModelNotFoundError` at the first spawn. The
bare-model row is the documented exception, not a gap: no provider block
*exists* for a shared-auth model, and fabricating a `provider` entry keyed to
a built-in shared provider would same-key-clobber binary-owned configuration.
The scenario's operative claim — the turn proceeds rather than failing on an
unresolvable model — holds on both active rows. The warn-and-ignore row is
deliberate, not an oversight: the pair names are the repo's established
carriers for *other* tooling too (the sibling reads exactly them; review-loop
strips them from claude children), so an ambient pair beside the bare
compiled-default model (`DEFAULT_MODEL = 'opencode'`,
`afk-runner/src/config.ts:68`) is the mainstream activation shape, not a
misconfiguration — refusing there would brick every `start` over credentials
the run would never use, so the resolution warns and proceeds instead.

One invariant the matrix rests on, stated: it validates the resolved
config's `model`, while D3's per-spawn composition reads
`modelFor(config, role)` — the same value today only because the hook is
role-insensitive (`afk-runner/src/config.ts:161-163`, `_role` unused). That
insensitivity is load-bearing; a later role-sensitive `modelFor` must
re-derive the provider decision per spawn, or some role's spawns would carry
model refs naming providers the verb-time matrix never evaluated — the
first-spawn `ProviderModelNotFoundError` the matrix exists to prevent.

The block itself is the sibling's proven shape (by inspection,
`opencode-agent/src/openai-config.ts:202-219`), copied not imported: the
research's D1 copy-never-import discipline bars importing the spike workspace,
and the block is small — `npm: '@ai-sdk/openai-compatible'`,
`name: 'OpenAI-compatible'`, `options` carrying
`apiKey`/`baseURL` (plus `setCacheKey: true`, unconditional for the sibling's
reason: a provider that ignores it is unaffected, and session-continuation
spawns keep prompt-cache hits), and a `models` entry keyed by the model id.
The provider id is the first `/`-segment of the model ref (split at the first
slash; the remainder is the model id and may itself contain slashes — the
sibling's `parseModelRef` rule).

### D3 — Composition point and threading: `mcpFor` beside `modelFor`; a full replacement env through the builder

Per-spawn composition happens at the one place that already holds role and
model: `prepareSpawnContext` resolves `modelFor(...)` and now also
`mcpFor(surface, role)` — the base map minus the role's narrowing entry,
defaulting to the full base (research §2.1's composition seam). The resolved
set, the surface, and the model ref feed a pure builder producing the
serialized content; the child environment is composed at the afk-runner layer
(one place permitted to read the ambient env) as a full replacement map:
`{ ...process.env, OPENCODE_CONFIG_CONTENT: content }` minus the family's
four carrier names — `AGENT_MCP_SERVERS`, `AGENT_MCP_ROLE_NARROWING`,
`LLM_API_KEY`, `LLM_BASE_URL` — deleted from the copy. The deletion is free
exactly here, because a passed map is the child's entire replacement
environment (`realSpawn`'s replace-never-merge semantics) and no opencode
child reads any of those names (their in-repo readers are papai-family code
only — the chat app's env bootstrap, the sibling runner, the strip lists, a
benchmark and smoke-test script — none of it executing inside an
afk-runner-spawned opencode child); it is the same carrier hygiene review-loop's claude
`STRIPPED_ENV_NAMES` list already practices on the other route (D7). Without
it the spread would hand every child the whole base map's credentials —
including the servers this spawn's narrowing shed, strictly more credential
surface than the composed content carries — plus the ambient credential
pair, so per-role narrowing would widen exposure instead of narrowing it.
One grandchild cost the docs must state: a passed map is also what declared
local MCP server commands inherit through the opencode child, so activation
removes the four carrier names from those grandchildren too — a server
command that expected ambient `LLM_API_KEY`/`LLM_BASE_URL` must receive it
through its entry's `environment`, and a server that silently loses one
degrades under the binary's own 30 s bound (task 5 documents this
activation-visible env change).
The overwrite of any ambient `OPENCODE_CONFIG_CONTENT` value stays, which is
exactly the overlay precedence §1.2 verified; when the surface is inactive
nothing is composed and inheritance is untouched (D5).

Threading through review-loop: `AgentCommandOptions` gains
`opencodeEnv?: Record<string, string>` — the child's **entire replacement
environment**, caller-composed. The opencode branch returns it verbatim as
`AgentCommand.env`; absent stays `undefined`, so `realSpawn` inherits
`process.env` exactly as before (byte-identical default). The claude branch
**refuses** a set `opencodeEnv` with a named `AgentCommandError`, mirroring
the existing `extraArgs` refusal — afk-runner threads no claude backend
(the non-goal), and a silent ignore would hide an operator mistake.
`RunAgentOptions` gains the same optional field and `attemptRun` passes it
through. A full-env option (not a content string) is forced by
`realSpawn`'s replace-never-merge semantics: the builder cannot merge into
`process.env` without reading it, which the spec forbids.

The composed content, per spawn: `$schema`, `provider` (per D2, omitted for
the bare-model row), `model` (the ref, same value the argv carries),
`mcp` (the resolved set's entries, every remote forced `oauth: false` — the
sibling's emission-half rule: parse refuses the key, emission pins it, so a
maintainer who omitted it still gets clean `failed`-with-error degradation
instead of a run parked at `needs_auth`), and `permission` (D4). Nothing else:
no `agent` blocks, no `small_model`, no facts the runner does not hold.

### D4 — Permission base: per-name wildcard keys over the base map, no `"*"`

The delivered `permission` map contains exactly one key per base-map server:

- granted to this spawn's role (in the resolved set): `<name>_*: "allow"` —
  the generated wildcard form §4.1 verified admits the server's whole
  toolset, appended after any denies;
- shed by this role's narrowing: `<name>_*: "deny"` — the same wildcard form
  §4.1's deny control verified filters the tools, and the §1.2 permission-leaf
  arm verified a content deny beats a discovered file's same-key allow.

The allows-after-denies ordering is belt-and-braces, not load-bearing: D1's
intra-map shadowing refusal keeps the emitted wildcards pairwise disjoint,
so under the recorded later-rule-wins semantics no key can flip another
key's verdict, and D1's built-in-shadowing refusal keeps every emitted key —
deny or allow — off the built-in tool names the spec's non-MCP invariance
protects (the literal-key rule below says nothing about what a generated
*pattern* matches; the refusals are what close that).

No `"*"` key, no built-in tool names, no operator-supplied permission text
copied (the knob schema refuses unknown fields; there is no permission
passthrough). `ask` is never emitted (§4.1: `--auto` waves it through).

This diverges deliberately from the sibling's deny-by-default
`"*": "deny"` + named allow-list, and the reason is the spec's non-MCP
clause: afk-runner's agents currently run on opencode's *default* tool
surface, and an allow-list would have to enumerate today's built-ins exactly —
the enumeration trap (a later binary's new built-in arrives silently denied,
and "same built-in surface as a content-free spawn" becomes unpinnable). The
spec's requirement that the deny cover MCP-delivered tools is met over the
namespace the runner delivers and names: every server in the base map is keyed
allow-or-deny by construction, so narrowing is robust against a discovered
file re-defining a shed server's name (same-key conflict resolves to the
content).

Residual, stated plainly: a server that exists **only** in discovered config,
self-granted by that same file, is ambient configuration exercising its own
authority over its own tools — the delivered content neither names nor keys
it, so the merge leaves it exactly as a content-free spawn would have it —
with one exception, the same mechanism the refusals above close only
in-family: an emitted `<name>_*` wildcard globs the binary's one flat
tool-name namespace, so a discovered-only server whose name extends a
base-map name (discovered `foo_bar` beside base `foo`) inherits that key's
verdict — deny when the base name is shed, allow when granted — under the
content-is-final precedence. The runner cannot refuse what it cannot see:
discovered names are invisible at verb-time validation, so the two shadowing
refusals close only the *emitted* overlaps (base-map pairs, built-ins), and
this cross-boundary overlap is the documented residual. The runner's
authority guarantee (nothing discovered re-enables what the base denies)
covers the keys the base emits; see Risks.

### D5 — Inertness contract

Inactive surface (unset/blank/empty base map): no content is composed, no
credential is read, no `opencodeEnv` option is threaded, no event field
appears, ambient `OPENCODE_CONFIG_CONTENT` (if any) keeps flowing untouched —
every spawn behaves exactly as before this change. This is the spec's
requirement and the rollback story in one property, and it is why "active" is
defined on the *base map* alone: activation governs what is *delivered*, never
what is *validated* — a present narrowing knob is validated in full on the
spawning verbs whatever the base map's state, so with the base unset, blank,
or `{}` every name a narrowing entry carries is absent from the base map and
refuses as minting, exactly as the validation requirement's scenario reads
(the knob alone neither activates the surface nor, absent, refuses anything).

### D6 — Degradation and dead-server telemetry: names on the spawned event, calls on the existing L0

No runner-side machinery: no per-server timeouts, no status polling, no
`enabled`/`timeout` knobs (the binary's own 30 s bound and reaping are
verified; the spec bars adding waits on top). Visibility rides the existing
noise altitudes under §4.2's payload discipline (names, counts — never
`environment`, `headers`, or token-bearing URLs):

- **L1**: `SpawnedEvent` (`afk-runner/src/agent-noise-schemas.ts:43`) gains an
  optional `mcp?: readonly string[]` — the resolved set's server names,
  emitted where `spawned` is emitted today (`prepareSpawnContext`). Optional
  and additive: old logs parse unchanged, the fold tolerates noise, nothing
  drives on it. On the `opencode run` route the parent's only truthful
  spawn-time status *is* the declaration — connection status lives inside the
  child (the verified status surface, §4.1, exists on `opencode serve`, a
  mode the runner does not run) — so names are the honest bounded payload.
- **L0**: the existing `tool_use` telemetry (the agent reporter's slot-line
  capture) already records every call by tool name, `<server>_`-prefixed; an
  orphaned call is visible there as it happens. No new L0 event type.

The composed content and everything credential-shaped it carries is never
logged, echoed into run artifacts, or carried in any event payload (spec
requirement; S3-9 class) — and beyond the content itself no credential rides
a child: the carrier names are stripped at composition (D3), so the
model-readable residual is the delivered content alone. The documentation
updates state that residual plainly.

### D7 — Module layout, dependencies, and the review-loop strip list

Two new afk-runner modules (no existing afk-runner module covers either need:
`config.ts` is the five-key *file* loader — wrong seam for env knobs holding
credential-bearing values; `agent-layer.ts` is the spawn seam, not a config
builder):

- `afk-runner/src/mcp-servers.ts` — knob schemas, `resolveAgentMcp`
  (parse-and-refuse), `mcpFor` (role narrowing). Own module for the same
  seam-discipline reason as the sibling's same-named file: it is MCP domain
  logic, not config-ladder logic.
- `afk-runner/src/agent-config.ts` — the content composition and
  serialization (provider block, permission keys, mcp block with
  `oauth: false` forcing, model ref). Pure functions over their inputs.

No new packages. `zod` (already a dependency) validates the knobs. The
sibling types its config through `@opencode-ai/sdk`; afk-runner does not take
that dependency — the emitted shape is a locally-typed plain JSON object
pinned by tests, because the SDK here would buy only type-checking of an
externally-owned shape across a workspace boundary the research keeps
import-free. Review-loop gains no dependency either; its change is the
`opencodeEnv` option plus one name (`AGENT_MCP_ROLE_NARROWING`) added to
`STRIPPED_ENV_NAMES` beside `AGENT_MCP_SERVERS` — the list's own contract is
"the other route's carriers", and the family gained a member.

**Gating / tool-prefs boundary** (research §6, restated because a new tool
surface arrives): runner-agent MCP calls are gated solely by the delivered
permission maps — the `<server>_*` keys inside each spawn's content. Papai's
capability gating and per-context three-state `tool_prefs` neither gate nor
are consulted: runner spawns carry no storage context id, no config context
id, no `platformInstanceId`, no user identity, so there is no context for
`tool_prefs` to resolve against. Consequence carried into the docs: a runner
agent consuming a papai-hosted server (`/mcp/plugin/<pluginId>`) authenticates
by binding token and bypasses papai's per-context resolution — subject to the
runner's permission maps alone.

**Scope model**: the configuration keys at the runner level only — the
per-invocation environment — outside papai's scope model entirely; no
storage/config-context/platform-instance/user id keys anything, and a run
persists no server state anywhere (spec's runner-level-keying requirement).

**DB / dependencies**: no drizzle migration, no backfill, nothing under
`src/db/`; no new packages (above).

## Risks / Trade-offs

- [Serialized content is model-readable (S3-9 class): the spawned agent's own
  processes can read `OPENCODE_CONFIG_CONTENT`, so the provider key and any
  server credentials in it are reachable by the model] → Never logged, never
  echoed, never in payloads; the docs state the residual and direct operators
  to prefer servers needing no credential in the content (hosted-remote
  pattern); credential containment is the named follow-up change, not
  silently assumed here.
- [A discovered-file-only server self-granted by that file stays visible —
  the per-name deny keys only names the base map holds, and a wildcard key's
  reach extends past its own name] → The base map keys every server the
  operator declared, so the guarantee holds over the delivered namespace;
  the residual is ambient config acting on its own tools, unchanged from a
  content-free spawn — except under a name-prefix collision, where a
  discovered-only server extending a base-map name (`foo_bar` beside `foo`)
  inherits that key's deny-or-allow verdict and cannot be refused at
  validation (discovered names are invisible there; D4's residual).
  Documented here and in the operator docs; revisit only with a verified
  catch-all deny shape that spares built-ins (none is on record — do not
  guess one).
- [Refusing a slash-shaped model without the credential pair locks out
  operators whose provider resolves from ambient config] → Deliberate: the
  spec makes delivered-provider resolution part of the active surface's
  contract, and a verb-time refusal naming the missing key beats a
  first-spawn `ProviderModelNotFoundError`. The lock-out only exists while
  activating MCP; inactive runs are untouched.
- [Env-knob name shared with the sibling (`AGENT_MCP_SERVERS`) could couple
  the two workspaces' evolution] → The shape is pinned by the spec's
  validation requirement and the sibling's on-record schema; divergence would
  show at the shared parse-and-refuse boundary, and the narrowing knob is
  runner-specific from the start.
- [`agent-layer.ts` and `agent-command.ts` are near `max-lines`] → The
  composition logic lives in the new modules; the layer edits are resolve,
  thread, and emit only. A `max-lines` failure at review is a signal to split
  along the same seams, not to compress.
- [Pin bumps move every verified anchor] → The research's convention applies:
  on an `opencode-ai` pin move, re-verify the §1.2 precedence and §4.1
  grant/degradation claims before trusting this design's permission shape.

## Migration Plan

Nothing to deploy: the runner is repo-internal tooling, the surface is inert
until an operator sets the knobs, and no persisted state exists anywhere (a
`resume` after the change simply composes later spawns from whatever the
current invocation resolves — there is no server-set memory to migrate or
reconcile). That per-invocation keying owns one documented residual: a
`resume` under drifted knobs (or none) continues `--session`-attached agents
whose prior turns used servers the new invocation no longer delivers — the
continued agent inherits context referencing tools that now resolve to
nothing and can burn validation retries on it, with the L1 `mcp` names as
the only trace (nothing correlates them across invocations). Not repaired
here — repairing it would take exactly the server-set memory the surface
refuses to persist — so the task-5 operator docs state it plainly: resume a
run under the same knobs it started with.

Rollback is `git revert`: with the knobs unset the code is byte-identical in
behaviour, and with them set the delivered content leaves no trace the
runner owns.

Order of work (each task one complete red→green cycle, per the walk grammar):

1. `review-loop/src/agent-command.ts` + `agent-runner.ts`: the `opencodeEnv`
   option — refusal on the claude branch, verbatim `env` on the opencode
   branch, absence byte-identical; the `STRIPPED_ENV_NAMES` addition. Tests
   under `tests/review-loop/`.
2. `afk-runner/src/mcp-servers.ts`: knob schemas and `resolveAgentMcp`
   (every refusal scenario in the spec's validation requirement, plus D2's
   credential-pair matrix rows — slash-shaped model with either half of the
   pair missing refuses; bare model with the pair set warns and proceeds)
   plus `mcpFor`. Tests under `tests/afk-runner/`.
3. `afk-runner/src/agent-config.ts`: content composition — provider rows,
   permission keys, `oauth: false` forcing, serialization, never-`ask`, and
   the D1 size bound: the full-base composition measured against
   `MAX_ARG_STRLEN`, refusing with `AGENT_MCP_SERVERS` named. The bound
   lands here rather than in task 2 because the refusal measures this
   task's serializer output; the verb-time call site arrives with task 4's
   wiring. Tests assert the emitted shape (including non-MCP keys' absence)
   and the over-limit refusal row.
4. `afk-runner/src/agent-layer.ts` + threading (`cli.ts`, `run.ts` `RunDeps`,
   every `AgentLayerDeps` construction site — the two factories plus the two
   review-stage assembly sites, D1): per-spawn resolution beside `modelFor`,
   env composition, `spawned`'s `mcp` names, verb-time wiring of
   `resolveAgentMcp`, with a review-stage spawn (reviewer or skeptic)
   explicitly pinned composing content — the silently-dropped-optional-field
   failure D1 names is invisible to the compile step and to the shape tests
   unless a review-stage spawn is pinned. Tests under `tests/afk-runner/`
   (DI'd env source; the hermetic lane's I/O guard means no test spawns a
   real `opencode`).
5. Docs: `docs/architecture/afk-runner.md` (surface, boundary, residual —
   the model-readable exposure, the resume-drift interaction, the wholesale
   replacement of any ambient `OPENCODE_CONFIG_CONTENT` when the surface
   activates, the carrier-name strip reaching declared local server
   commands' inherited environment (a value a server command needs must
   ride its entry's `environment`), and the dead-entry boot tax (a dead
   server costs up to the binary's 30 s bound per spawn, every spawn boots
   its own instance, so the tax multiplies by the run's six-plus spawns —
   research §2.1) included) and the research doc's status note.

The Write/Edit TDD hook pipeline gates every file above as gateable
implementation code (`review-loop/src/**` → `tests/review-loop/**`,
`afk-runner/src/**` → `tests/afk-runner/**`), with the licence-header gate on
all writes including the docs; the mutation ratchet applies per-file to the
changed implementation files, and new modules start with no floor to drop.
Verification is the standard compiled check set (`bun run test`,
`bun check:full`) — necessary and not sufficient: the hermetic lane pins the
composed shape but cannot spawn the consumer (task 4's I/O guard), and the
research verified the precedence and grant arms against its own targeted
emissions, never this builder's combined document. One live smoke therefore
precedes delivery, per the workspace's live-proof convention (C7/C8): one
`opencode run` spawn against the pinned binary with a one-server local base
map and a credentialed provider row — assert the server's tools arrive under
`<name>_*` naming, one call round-trips, and a second, dead-server entry
degrades without failing the turn — run by the operator outside the suite;
its outcome is recorded in the task-5 research-doc status note, and a shape
that fails there re-opens this design rather than being adjusted by
inspection (the sibling's recorded-not-guessed doctrine).

## Open Questions

- Whether the L1 `mcp` field should ever carry connection statuses richer
  than the declaration (e.g. `failed`/`disabled`): only answerable if a
  future route exposes them to the parent (`opencode serve` does; `opencode
  run` does not). Additive optional field — safely deferrable.
