<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: using Claude Code in review loop

## Context

See `proposal.md` for the motivation (the `/review` residual on the claude
route) and `specs/review-loop-agent-backend/spec.md` for the requirements. This
document covers how.

**Where review-loop is opencode-shaped today.** The coupling is concentrated in
three seams; everything else is already backend-agnostic:

- `src/agent-runner.ts:166` (`attemptRun`) hardcodes the subprocess:
  `opencode run --auto --format json --model <model> --dir <cwd> …extraArgs
  <prompt>` — the prompt as the final argv entry.
- `src/event-stream.ts` parses opencode's event lines (`part`-carrying
  `{step_start, tool_use, text, step_finish}` shapes, session id from a
  top-level `sessionID`).
- `src/line-handler.ts` calls `parseEventLine` / `sessionIdOfLine` directly and
  maps them into `LiveCtx` (usage counters, live tool line, session-ledger
  capture).

The watchdogs (wall-clock timeout, inactivity stall, group kill — the
functions `src/spawn.ts` hosts, untouched; that file's `realSpawn` alone
gains D3's stdin/env seams), the file-based output exchange (`agentWritePath` + misplaced-scratch
diagnosis), the retry-once-on-stall policy in `runAgent`, the ledger, rounds,
worktrees and the stop controller know nothing about opencode and change not at
all.

**One constraint from a second consumer.** `mutation-improve` imports
`runAgent` / `agentWritePath` directly across the workspace boundary
(`mutation-improve/src/{cli,pipeline,build-gate}.ts`). Every extension of
`RunAgentOptions` and `SpawnFn` must be additive-optional so that workspace
compiles and behaves unchanged (it stays opencode-only).

**What opencode-agent already built and this change mirrors, not imports.**
`opencode-agent/src/claude-{contract,argv,connect,config-dir,adapter}.ts`
implement the CLI route for the pipeline's own turns: recorded NDJSON line
schemas (fixtures under `tests/opencode-agent/fixtures/claude-cli/`, pinned CLI
`@anthropic-ai/claude-code@2.1.239`), the argv builder with invocation profiles
(`--bare` vs the native neutralization pair `--setting-sources ''` +
`--strict-mcp-config --mcp-config <empty>`), `--permission-mode default` with
closed per-profile `--allowedTools` lists, prompt-on-stdin, the
`MAX_ARG_STRLEN` refusal, spelling-selected credentials
(`ANTHROPIC_API_KEY` → bare, `CLAUDE_CODE_OAUTH_TOKEN` → native) under an
exclusivity guard, and a job-scoped `CLAUDE_CONFIG_DIR`. The two workspaces are
separated by a documented subprocess boundary (the same reason
`MINIMALITY_LADDER` is duplicated and pinned equal by
`tests/opencode-agent/minimality-rule.test.ts`), so review-loop duplicates the
contract rather than importing it, with the duplicated doctrine pinned equal by
a test (D10).

**The hand-off point.** `opencode-agent/src/deps.ts:93` (`makeReviewRunner`)
hands the loop its env — `opencodeConfigEnv(config.openai)`, i.e.
`OPENCODE_CONFIG_CONTENT` — and `review-runner.ts`'s
`buildReviewLoopConfig` generates the per-role agent blocks (`model` via
`modelRef(settings.openai)`). `PipelineConfig` already carries `backend` and
`claudeCredential`, so the branch has its inputs. The workflow's route-gated
install already puts the `claude` binary on PATH for the whole job, which
includes the loop's children.

## Goals / Non-Goals

**Goals:**

- A claude-route `/review` completes: the loop's four roles run as `claude -p`
  subprocesses with per-role allowlists, credentials, usage accounting and
  run-scoped CLI state, satisfying every scenario in
  `specs/review-loop-agent-backend/spec.md`.
- The default opencode route stays **byte-identical**: same argv, same prompt
  strings, same event handling, no Anthropic credential read, no `claude`
  process spawned. Existing configs (including mutation-improve's use of
  `runAgent`) parse and run exactly as before.
- The loop stays runnable standalone (laptop or CI) on either backend from its
  own config + environment, with no opencode-agent or papai component.
- The duplicated claude doctrine between the workspaces is asserted equal by
  tests, not shared at runtime.

**Non-Goals** (design-level; scope exclusions live in the proposal):

- No session continuity (`--resume`) for loop roles — review-loop never resumes
  an agent session today (each turn is a fresh spawn; the session ledger
  records ids for post-mortem, and stays exactly that), so the adapter-level
  machinery opencode-agent needs is deliberately not mirrored.
- No new retry/stall behaviour: the existing spawn-level watchdogs and the
  retry-once-on-stall policy serve both backends unchanged (spec: "Output
  exchange and spawn guards stay backend-agnostic").
- No papai runtime, DB, settings-UI or `tool_prefs` surface (see
  _Project-rule impacts_).

## Decisions

### D1 — Backend knob: optional per-role field, equality-refined, default `opencode`

`AgentConfigSchema` (`src/config.ts`) gains `backend:
z.enum(['opencode', 'claude']).optional()`; a `superRefine` on
`ReviewLoopConfigSchema` refuses a config where two roles name different
backends, naming "one backend per run" as the rule. The resolved config
carries one effective backend (the single non-`undefined` value, else
`'opencode'`).

*Why per-role fields rather than one top-level key:* the spec's
mixed-per-role scenario demands a **named validation failure** for a config
that spells different backends per role. With only a top-level key such a
config is unexpressible, and a stray per-role `backend` key would be silently
stripped by zod's default object behavior — the run would proceed on the wrong
backend with no refusal. The per-role-optional-plus-refinement shape makes the
misconfiguration representable and refused, while still resolving to exactly
one backend per run. *Alternative rejected:* a top-level-only knob plus
`.strict()` object parsing — `strict` would also reject every future unknown
key, a much wider contract change than this spec asks for.

### D2 — One composition seam: `attemptRun` delegates to a backend command builder

A new `src/agent-command.ts` exports
`buildAgentCommand(options): { command, args, stdin?, env? }` — `env` is
present only on the claude branch (D5); the opencode branch returns none and
`realSpawn` inherits `process.env`, today's behavior. The opencode branch
returns **exactly today's argv** (`opencode run --auto --format json --model …
--dir … …extraArgs <prompt>`, no stdin) so the default route is byte-identical
by construction, pinned by the Migration step 1 composition test — the
existing `agent-runner` tests assert argv **membership** only (`toContain`),
not order or completeness, so they cannot catch a reordered or extra entry.
The claude
branch is D3/D4/D7's composition plus two closing decisions of its own:

- **Model:** it emits `--model <id>` with any `provider/` prefix stripped from
  the configured model — the `modelIdForCli` doctrine mirrored from
  `claude-argv.ts` (a slash-bearing value keeps its model id; a bare one
  passes through untouched). One model knob thus serves either backend, and a
  standalone config spelled in the opencode `provider/model` form
  (`config.example.json`'s live shape) keeps its model id on the claude
  route; D9's generation-side strip in `buildReviewLoopConfig` becomes the
  redundant-but-harmless half, this loop-side strip the one every route
  relies on. The strip is pinned by a composition test (Migration step 1),
  not left to doctrine.
- **`extraArgs`:** a non-empty `extraArgs` is refused with a named
  composition error before anything spawns. The knob is opencode-argv-shaped:
  a silent pass-through could append argv **after** the composed allowlist
  block (a second `--allowedTools`, a bypass flag — the closed-list doctrine's
  back door through the one knob the spec leaves unmentioned), and a silent
  ignore would turn a standing config knob into a no-op on the claude route.
  The pipeline-generated config sets `extraArgs: []` (`review-runner.ts`), so
  the CI route never hits the refusal; a standalone operator combining
  `backend: "claude"` with `extraArgs` gets a loud failure naming the knob.

`attemptRun` stops naming a binary.
`RunAgentOptions` gains `backend?: 'opencode' | 'claude'` (default
`'opencode'`) and, additively-optional beside it,
`claude?: { profile: 'bare' | 'native'; credentialName: 'ANTHROPIC_API_KEY' |
'CLAUDE_CODE_OAUTH_TOKEN'; credentialValue: string; configDirRoot: string;
envSource: Record<string, string | undefined> }`
— the context assembled once in `runCli` from D4's resolver result joined
with D8's run-scoped config-dir root and the parent env (`process.env`, read
at this one assembly point and never again), threaded through the loop's
spawn options (the per-spawn child dir D8 derives from the root never appears
here). `envSource` is the input D5's strip list composes over: the builder
never reads ambient `process.env` — the same purity D4 gives the resolver —
so the strip list is assertable by injecting a map rather than mutating
global state. `backend === 'claude'` with no `claude` context is a
named composition error; both absent (mutation-improve's bare `runAgent`
calls, which pass no config object) is the opencode default, so that
workspace compiles and behaves unchanged.

*Existing-module check:* no review-loop module composes subprocess argv today
(`agent-runner.ts` hardcodes it inline); `agent-runner.ts` is 257 lines and the
repo's `max-lines`/one-thing-per-file convention says the second backend's
composition is a new module, not a second inline branch.

### D3 — Prompt on stdin; `SpawnFn` gains `stdin` and `env` seams; the system-prompt guard ships in the builder

`SpawnFn`'s options gain `stdin?: string` and `env?: Record<string, string>`;
`realSpawn` (`src/spawn.ts`) writes `stdin` to the child, then **ends the
stream (half-closes)** — the CLI reads the prompt until EOF (the parent's
shape is write-then-`end`, `claude-connect.ts`), and a write without the
`end` hangs every claude turn until `agentTimeoutMs`, which `runAgent`
never retries (a non-stall timeout is fatal) — and passes `env` to `spawn`
when present, inheriting `process.env` otherwise (today's behavior). The
passed map is the child's **entire** environment — Node's `env` option
replaces, never overlays — and `realSpawn` must not merge over
`process.env`: the sibling workspace's `shell.ts` composes
`{ ...process.env, ...options.env }`, a shape that would resurrect every
name D5 strips back into every role child env, and a spawn-seam test leg
asserts a stripped name is absent from the captured child env so the merge
shape cannot pass.
The claude command builder returns the whole composed role prompt as `stdin` —
the same string the opencode route passes as argv — because a single Linux
argument is capped at 128 KiB (inspector prompts embed whole diffs) and `ps`
would otherwise carry the prompt. `realSpawn` writes `stdin` through a pipe
with an **error-swallowing handler attached before the first write**: a write
beyond the OS pipe buffer queues in Node's stream, and a child that exits
early or is group-killed by the stall/wall-clock watchdog mid-flush turns the
queued write into an `EPIPE` — a stream `error` with no listener is an
uncaught exception that would kill the whole loop process. The handler
records the failure and lets the attempt fail through the existing exit /
`AttemptError` path: one failed attempt, never a dead loop. (The parent's
`claude-connect.ts` writes stdin with no such handler; review-loop cannot
copy that shape, because its watchdogs kill children mid-write by design.)

The builder also accepts an optional system-prompt string and emits it via
`--append-system-prompt` as a single argv entry, refusing — loudly, before
anything spawns — a value over `MAX_ARG_STRLEN` (131,072 bytes), mirroring
`claude-argv.ts`'s recorded doctrine. **No current loop role passes a system
prompt**: the role briefs (`prompt-templates.ts`) are one composed string, and
keeping that one string the payload on both backends is what makes the two
routes comparable and keeps the opencode route byte-identical without
re-joining carved-up prompts. The guard and its refusal are still implemented
and unit-tested at the builder seam, because the seam is where the next caller
(a steering note, an AGENTS.md-context append — see Open Questions) would land,
and an oversized append must die as a named composition error, never as an
`E2BIG` the failure classifier misreads as a dead backend.

*Alternative rejected:* splitting each role prompt into standing instructions
(`--append-system-prompt`) + per-turn payload (stdin), mirroring
opencode-agent's turn shape. The rules (`MINIMALITY_LADDER`,
`CHECK_BEHIND_RULE`, …) are interleaved with payload lines inside
`join('\n\n')` blocks, so an opencode-side re-join that reproduces today's
bytes exactly would be brittle, and a claude-only split forks every role brief
into two compositions that can drift.

### D4 — Credential guard and profile: one pure resolver, run once before any role subprocess

A new `src/backend-select.ts` exports
`resolveAgentBackend(backend, env): { profile: 'bare' | 'native';
credentialName: 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN';
credentialValue: string } | throws`:
when `backend === 'claude'`, it requires exactly one of `ANTHROPIC_API_KEY` /
`CLAUDE_CODE_OAUTH_TOKEN` (both set → refuse naming both; neither → refuse
naming both), refuses a set `LLM_API_KEY` outright, and maps the surviving
spelling to the profile (API key → `bare`; OAuth token → `native`). Every
refusal throws a named `BackendSelectionError` carrying a machine-readable
`code` — `CLAUDE_CREDENTIALS` for both-set and neither-set,
`LLM_CREDENTIALS` for a set `LLM_API_KEY` — mirroring the parent route's
`ConfigError` doctrine (`opencode-agent/src/config-values.ts`: the guard's
failures must be distinguishable from other startup failures **by code**,
because the remedy differs — unset one variable versus fix a workflow
forwarding gate; the codes themselves are `config-backend-values.ts`'s).
Distinguishability is a spec SHALL beside the message content, and `runCli`'s
top-level catch prints only `error.message` (cli.ts), so the code is
prefixed into that message — `[CLAUDE_CREDENTIALS] both ANTHROPIC_API_KEY
and CLAUDE_CODE_OAUTH_TOKEN are set …` cannot be misread as a config-parse
or plan-path startup failure — and a guard-test leg pins it (Migration
step 1). **"Set"
means a value that is non-empty after trim** — a present-but-empty or
whitespace-only name reads as absence, exactly the parent guard's reading
(`optionalOrNull`, `opencode-agent/src/config-values.ts`: `''`/whitespace →
`null`). This is load-bearing, not hygiene: the workflow forwards unset
secrets as the empty string (`agent-pipeline.yml` — `LLM_API_KEY: ''` on the
claude route, both Anthropic spellings `''` when unset, and its own comment
records "unset secrets forward as the empty string, which the guard reads as
absence"), so a name-present⇒set reading would refuse **every** CI
claude-route run at loop startup, twice over (the `''`-valued `LLM_API_KEY`
alone fires the refusal). The reading is pinned by a guard test whose
injected env carries the CI forwarding shape verbatim. The resolver is pure
over an injected `env` (testable without `process.env` games) and is called
once in `runCli` **after config load, before `applyCommitIdentity` and
`openRun`** — ahead of `createWorktree`'s `bun install`, which is already a
subprocess and already spend. The opencode route never calls it.

The result — profile, the surviving credential's spelling and its value, both
read from the injected `env` so the resolver stays pure — is joined in
`runCli` with D8's run-scoped config-dir root into the `claude` context D2
defines; that join in `runCli` is the context's assembly point — and it is
**there**, not at the resolver's earlier pre-identity call site, that
`process.env` is read for `envSource`: the join sits at D8's try-side parent
creation, which runs after `applyCommitIdentity` has stamped
`GIT_AUTHOR_*`/`GIT_COMMITTER_*` onto `process.env`, so the commit identity
rides `envSource` into every claude role child env (hoisting the read to
the resolver's site would drop it — the one free choice this pin removes) —
and the joined context rides the resolved config to every spawn. `profile` selects
the argv block per D7's
quotation of `claude-argv.ts`'s `profileBlock`: `--bare`, or
`--setting-sources '' --strict-mcp-config --mcp-config <empty-doc>` mandatory
on every invocation (either flag alone leaves a discovery surface open —
recorded census).

### D5 — Child env: inherit, strip the other route's carriers, add the run's two values

The claude branch of `buildAgentCommand` builds the child env from the
injected `envSource` (D2's claude context — `process.env` read once at
`runCli`'s assembly point, never ambient) with a name-strip of `LLM_API_KEY`, `LLM_BASE_URL`,
`OPENCODE_CONFIG_CONTENT` (it embeds a gateway key), `AGENT_MCP_SERVERS` (a
JSON document with credentials embedded *inside* it — the exact reason the
parent's strip list exists: value-matching cannot see them, and via the
pipeline's claude route the loop inherits the name in `process.env` where the
fixer's `Bash` children could read it), the CLI's other credential/endpoint
names `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` (an ambient endpoint
override would redirect the guard-approved credential's traffic; the spec's
claude route talks to Anthropic directly, so an inherited override has no
sanctioned use — the loop closes its list beyond the parent's because the
standalone-laptop scenario has no CI env discipline to lean on), the CLI's
remaining traffic-redirection switches `ANTHROPIC_CUSTOM_HEADERS`,
`CLAUDE_CODE_USE_BEDROCK`, `ANTHROPIC_BEDROCK_BASE_URL`,
`CLAUDE_CODE_USE_VERTEX` and `ANTHROPIC_VERTEX_BASE_URL` (the same class — an
ambient value that redirects or attaches to the credential's traffic, with a
Bedrock/Vertex backend unreachable by an Anthropic-credential route and so no
sanctioned use either), and the **non-selected** Anthropic spelling, then adds
exactly the selected credential, `CLAUDE_CONFIG_DIR` (D8) and
`DISABLE_AUTOUPDATER=1` — the `claude-connect.ts` `childEnv` doctrine,
extended as stated. The **standard proxy variables**
(`HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`/`NO_PROXY`) are the one redirection
class deliberately left inherited: a laptop that legitimately needs its
corporate egress proxy must still reach Anthropic, and stripping them would
break that run to close a residual — recorded as such in Risks, not claimed as
covered.
A credential whose spelling does not match the profile injects nothing, so a
mismatched pair can never smuggle the other spelling through. Credential
values never appear in anything **the loop itself writes** — logs, events,
run artifacts, the config file — **including indirectly**: the loop's log
seam (`enqueueLog`, `line-handler.ts`) is a single sink with exactly two
callers — every raw NDJSON line (`onLine`) and the attempt's raw stderr
line (`agent-runner.ts`) — both appending to
`<workDir>/runs/<runId>/agent-output.log`, and a `user` `tool_result` block
carries its tool output verbatim in `content`, so an allowed fixer `Bash`
call (`printenv`, say) would return the selected credential inside a logged
line and falsify the spec's no-credential-in-artifacts scenario. The claude
branch therefore scrubs the selected credential's value **inside
`enqueueLog` itself** — the sink both callers write through, so the raw
NDJSON lines and the stderr line are covered by construction, not by
auditing call sites — with the value threaded from the `claude` context's
`credentialValue` (D2) onto the handler's `LiveCtx`; and the same
value-substring scrub is applied once where `runAttempt` captures the
child's `stderr`, before that string is embedded anywhere — the enqueued
stderr line and the `` `${label} exited with code …: ${stderr}` ``
`AttemptError` message both flow from the one scrubbed copy, and that
message later persists into needs-human reasoning and the loop's stdout.
The same scrub covers the loop's one other loop-authored capture of child
output: the build check (`createShellExec`, `build-checker.ts`) spawns
`sh -c <checkCommand>` with no `env` option, so it inherits the loop's
`process.env` — which holds the selected credential on both routes
(standalone: D4 reads it from there; pipeline: D9's hand-off merges it in) —
and it executes the fixer's model-authored edits, so check-run code can echo
the value into output the loop persists verbatim: `build-check.log`
(`cli.ts` writes stdout+stderr unscrubbed), the needs-human reasoning and
the retry `buildError` prompt (`issue-processor-attempts.ts` embeds
`buildResult.stderr` in both), and the thrown build error's output tail
(`cli-errors.ts`), which prints to loop stdout. The scrub is applied once
inside `runBuildCheck` (`build-checker.ts`) — the single producer of
`BuildCheckResult`, the point where the build-check result is accepted
before any consumer embeds it, so `finalizeRun` (cli.ts) and
`runBuildWithLogging`'s `issue-processor-attempts.ts` caller read the same
copy — all four
flow from it, with the value threaded from the
claude context as for `enqueueLog` (an optional `BuildCheckDeps` field,
absent on the opencode route); the check child holding the credential
at all is the accepted fixer-residual class (encoded carriage past a
substring scrub stays the residual's, not a claim this closes).
This is the value-substring scrub the parent route performs at its own
process boundary (`secrets.ts` scrubs `claudeCredential.value` under its
`MIN_SECRET_LENGTH = 12` floor — a value that short could plausibly collide
with an unrelated setting, and the floor is mirrored verbatim so a
pathologically short value cannot mangle enqueued lines or captures),
applied at
the loop's three loop-authored text seams. The env seam on `SpawnFn` (D3) is
what makes the child-env half assertable in tests without touching global
state, and Migration step 1 pins the scrub with a fixture line embedding the
value through the sink. What the scrub deliberately does **not** reach is
role-authored content, and the spec claim is scoped to match (see Risks):
the fixer's own result JSON is copied verbatim into `<runDir>` artifacts
(`runAttempt`'s `copyFile` + parse), its `reasoning` persists into the
ledger and trace, its decision notes print to loop stdout, the live
renderer's committed slot line (`commitSlotOnDispose` → `liveLine`) prints
the spawn's last tool call's formatted argument — a fixer `Bash` command,
40-char truncated, role-chosen tool input — to that same stdout surface
(`LiveRenderer.commit` writes it unconditionally, non-dynamic/non-TTY runs
included, which the pipeline repeats into the public Actions log), and any
file it writes in its worktree is staged by the loop's `git add -A` commit
step —
the fixer holds both `Bash` and the credential in its child env, can quote
or encode the value past any substring scrub, and that model-mediated path
is a consequence of the accepted fixer residual, recorded like the
read-scope residual rather than claimed as covered.

### D6 — Event decode: map claude NDJSON into the existing `OpencodeEvent` union via an injected decoder

A new `src/claude-stream.ts` exports a decoder factory with the opencode pair's
shape, one arity change: `parseLine(line): OpencodeEvent[]` — a **list**, not
`OpencodeEvent | null`, because a claude `assistant` line is one message whose
`content` array can carry several `tool_use` blocks (parallel tool calls) and
a `user` line several `tool_result` blocks, and the mapping below is per
block; a single-event signature would leave a second tool call in one line
unexpressible — never counted in `seenCalls`, never rendered as a live tool
line, its `tool_result` later skipped as unpaired. The opencode-side default
is an adapter wrapping `parseEventLine`'s `OpencodeEvent | null` in a
zero-or-one-element array; `sessionIdOf(line)` and
`resultOutcome(): { seen: boolean; isError: boolean }` keep the pair's shape.
`createLineHandler`
(`src/line-handler.ts`) takes the decoder as an option **defaulting to the
opencode adapter** (the list-wrapped `parseEventLine` / `sessionIdOfLine`) — with D5's scrub
riding the same module's `enqueueLog` sink and `LiveCtx`, so the raw-line
and stderr callers are covered by construction — and `runAgent` picks the
claude decoder when
`backend === 'claude'`. The decoder is **created per attempt**, re-armed in
`runAttempt` beside `handler.ctx.sessionId`: `resultOutcome()` and the
tool-pairing map below are attempt state, and a retry after a stalled first
attempt must not read the stalled attempt's result line as its own. Line
shapes are decoded against schemas recorded from the pinned CLI (fixtures,
D10); an unrecognized line returns an empty list and skips,
never failing the role.

Mapping (all into the union `event-stream.ts` already defines, so
`LiveCtx`, `run-stats`, the live renderer and `metrics.json` are untouched):

- `system/init` → `step_start` (starts the clock/live slot) and is the
  session-id source (`session_id`), recorded through the existing
  `SessionLedgerSeam` synchronously on first arrival. The union's required
  `timestamp: number` is filled with `Date.now()` at decode time — the init
  line carries no timestamp, and no consumer reads the field
  (`line-handler.ts`'s `step_start` case stamps its own `firstStepAt` /
  `startedAt` clocks), so the filler is stated only to leave the implementer
  no free choice, not because anything depends on it.
- `assistant` content blocks → `tool_use` per tool_use block (`callId` = block
  id, `input` passthrough for the live arg line, status `running`) — the
  live arg line's formatter (`formatToolArg`, `live-format.ts`) switches on
  opencode's lowercase tool names, so claude's capitalized `Read`/`Bash`/…
  render through its generic 40-char truncation branch: a cosmetic-only
  divergence accepted here, the switch is not re-keyed, and decode tests
  assert the carried `tool`/`input`, never the formatted line; the same
  line's `text` blocks are deliberately dropped — nothing consumes the
  union's `text` member (`line-handler.ts`'s `text` case is a no-op), and
  the corpus's assistant lines mix both block kinds in one content array,
  so the drop is exercised by the decode tests, not left to the implementer.
- `user` tool_result blocks → `tool_use` status `completed` / `error`, paired
  to the earlier assistant `tool_use` block by `tool_use_id` (= `callId`): the
  block itself carries neither a tool name nor an input, so `tool` and
  `input` are carried over from the paired assistant block — `seenCalls`
  counts each call once and the live arg line renders the true tool. A
  `tool_result` with no paired assistant block is skipped.
- `result` → **one** synthetic `step_finish`: `reason: stop_reason ?? ''`
  (the union's `reason: string` has no consumer — grep-verified — and the
  result line carries the natural carrier: `stop_reason`, `end_turn` /
  `stop_sequence` in the corpus), tokens
  `{input: input_tokens, output: output_tokens, reasoning:
  output_tokens_details.thinking_tokens ?? 0, cacheRead:
  cache_read_input_tokens, cacheWrite: cache_creation_input_tokens}` and
  `cost: total_cost_usd`. Usage is counted **once per turn, from the result
  line only** — assistant-line usage blocks are ignored — so cached counters
  stay separate from uncached input exactly as on opencode and the summary's
  `in X · cached Y / out Z` reads identically across backends.

After the spawn exits 0, `runAttempt` (claude branch) consults
`resultOutcome()`: a missing or error-signalling result line fails the attempt
through the existing `AttemptError` path — same shape as a non-zero exit —
**before** the output file is accepted, so an `is_error` turn that still wrote
its scratch can never resolve as an empty success. The missing-file ENOENT
diagnosis and misplaced-scratch hint are unchanged and backend-agnostic.

### D7 — Per-role allowlists: closed lists, scoped `Write` for analysis roles, weakest default

Pinned mapping (mirroring `claude-argv.ts`'s `ALLOWLISTS`, opened for the loop's
file-based exchange). The mapping keys on the spawn's `RunAgentOptions.label`
by **documented prefix**: the loop's only per-spawn identity is the label, and
its forms are `reviewer` (`review-round.ts`), `matcher` (`issue-matcher.ts`),
`inspector` / `inspector-w<n>` / `inspector-aggregated` (`issue-inspector.ts`
— the bare `inspector` when the pool hands a worker with no id), and `fixer` /
`fixer-w<n>[-retry]` (`issue-processor-attempts.ts` — bare `fixer` the same
way) / `fixer-batch-<cluster.id>` (`issue-processor-batch.ts`) — so `fixer*`
maps to
the fixer set and `reviewer*` / `matcher*` / `inspector*` to the analysis set,
with every pooled and batched label covered. Prefix matching rather than a new
role field: it needs no call-site changes, and an unrecognized label falls to
the same weakest-default guard as an unnamed role.

- **fixer** → `Read,Edit,Write,Bash,Glob,Grep` — identical to opencode-agent's
  `build` set; the fixer edits the tree and runs the check command.
- **reviewer / matcher / inspector** → `Read,Glob,Grep` plus `Write` scoped to
  the scratch directory: `Write(<cwd>/.review-loop/**)` in the CLI's absolute
  permission-rule form. These roles must deposit their JSON scratch output but
  may edit nothing and execute nothing (`--permission-mode default`;
  `--allowedTools` auto-approves its members and enables nothing, so an
  unlisted tool has no grantor under headless `-p` and is refused rather than
  run — the composition semantics the fixture corpus's adversarial case
  recorded).
- Any role the mapping does not name inherits the analysis (weakest) set and
  the condition is logged — the weaker-profile-is-the-default doctrine.

The `Write` rule is composed from the spawn's actual cwd because the prompts
name the **absolute** scratch path (`agentWritePath`); a bare relative pattern
could fail to match an absolute-path write and turn every analysis turn into a
refused write. The absolute-rule form is pinned by a zero-spend adversarial
fixture leg (D10) before any credentialed run relies on it.

*Trade-off accepted (spec-mandated):* analysis roles get no `Bash`, so on the
claude route the reviewer cannot run `git diff` / `rg` as the opencode
reviewer may — and the standing prompt **directs** exactly those mechanisms:
its verification-budget line instructs "inspecting `git diff`/`git log`/
`git show`, and cheap targeted searches (rg/grep)"
(`prompt-templates.ts`), so a claude-route reviewer turn eats refused calls
rather than merely losing an optional capability. That churn is the accepted
cost: the prompts are deliberately unchanged (proposal non-goal), the
refusal is the fixture corpus's recorded adversarial shape (refused, no tool
effect), and the evidence rule's core discipline — cite "files/lines you
have actually opened and read" — is `Read`/`Grep`-covered. The matcher and
inspector receive their diffs in-prompt. Reads are likewise unscoped — the
analysis set mirrors the parent's `plan` string verbatim, so
`--allowedTools` confines which tools run, not which paths they touch; see
Risks for the read-scope residual.

### D8 — Run-scoped `CLAUDE_CONFIG_DIR`: a run parent under the OS tmp root, one child per spawn, removed at teardown

The claude route creates a run-scoped **parent**
`mkdtemp(path.join(os.tmpdir(), 'review-loop-claude-'))` — **inside the
finally-protected region**: the `try` in `runCli` today opens only after
`openRun` returns, so the creation happens as the first statement of that
existing `try` (its first consumer is the first role spawn, which sits inside
`executeReviewLoop`), never between `mkdtemp` and coverage where an
`openRun` failure would leak it outside every teardown path. **Each spawn
gets its own child config dir** — `mkdtemp` under the parent, created by
the attempt layer through an injectable dir-creation seam (defaulting to
`mkdtemp`) and passed into `buildAgentCommand` as a ready path, **not
created inside the builder**: the builder is pure composition (D2) and the
native argv embeds the child dir's empty-MCP document path
(`claude-argv.ts`'s `profileBlock`), so compose-time filesystem I/O would
put a nondeterministic tmp path inside every native invocation and break
the composition/pin tests' determinism — they inject a fixed path instead —
and stamped as that spawn's `CLAUDE_CONFIG_DIR` value, into
which the native profile's empty-MCP JSON document is written by the same
creation seam when the profile is `native`: the loop's default pooled shape
runs up to `poolSize`
(default 3) fixers and pooled inspectors **concurrently**
(`processPendingIssues`'s `Promise.all`), while the parent route's
one-dir-per-adapter doctrine (`claude-connect.ts`: "one per adapter, not per
spawn") was recorded for turns that never overlap within one adapter —
concurrent read-modify-write of the CLI's shared state files is unrecorded,
and per-spawn children make that question moot instead of guessed at.
Nothing is lost to the split: the loop never resumes a session (Non-Goals),
so no turn needs another turn's CLI state. The parent rides the resolved
config to every spawn (D5); `runCli`'s existing `finally` (beside
`stop.dispose()` / `pool.close()`) removes the parent best-effort
(`rmSync recursive force`), taking every child with it. Never inside a
worktree or `workDir` — session files and CLI state must never cross runs
and no commit the loop's fixer makes can stage them (the worktree lives
under the checkout, where a stray `.claude/` would be one `git add` away from
a deliverable). A teardown that never runs — SIGKILL, or the repeated-SIGINT
`process.exit(130)` — leaks one tmp parent the OS cleaner owns — the same
residual every tmp scratch has.

### D9 — The pipeline hand-off: branch on `config.backend` in `makeReviewRunner`, backend-aware agent blocks in the generated config

`opencode-agent/src/deps.ts` (`makeReviewRunner`): on the claude route the
loop's env is built from `config.claudeCredential` (the one spelling, name and
value) with **no** `OPENCODE_CONFIG_CONTENT` and no gateway settings; on the
opencode route `opencodeConfigEnv(config.openai)` is byte-identical to today.
`buildReviewLoopConfig` (`review-runner.ts`) gains the backend on
`ReviewLoopSettings` and stamps `backend: 'claude'` into every per-role agent
block on that route, with the model crossed as the **plain model id**
(provider prefix stripped) — never the `OpenAiSettings` object, whose gateway
half must not reach a claude path. `contain()` already starts no proxy on the
claude route, and the route-gated install already puts `claude` on the job's
PATH, which the loop's children inherit.

### D10 — Fixtures and pin-equal tests: reuse the corpus, pin the duplication

- `tests/review-loop/claude-*.test.ts` decode the **existing** fixture corpus
  at `tests/opencode-agent/fixtures/claude-cli/*.ndjson` by relative path — a
  test-time file read, not a runtime import; the subprocess boundary holds.
- A pin test (sibling of `minimality-rule.test.ts`, which already imports
  across the workspace boundary at test time) asserts the duplicated
  doctrine equal across workspaces: `MAX_ARG_STRLEN`; the fixer allowlist
  string equal to `claude-argv.ts`'s `ALLOWLISTS.build` (analysis set ⊇ its
  `plan` set plus the scoped `Write`) — `ALLOWLISTS` is module-private today,
  so it becomes an **export** of `claude-argv.ts` (an additive export;
  `claude-argv.ts` joins D11's opencode-agent edit inventory), because
  without it the test can only pin against a literal copy and would catch
  review-loop drift, not opencode-agent drift; and the **streaming argv
  tail** — `-p`, `--output-format stream-json`, `--verbose`,
  `--permission-mode default` — asserted equal to `buildClaudeArgv`'s
  composition (already exported), because D6's decoder inputs (`system/init`,
  assistant/user blocks) exist only under the full-event stream `--verbose`
  yields in print mode, and a review-loop composition that drops it would
  still pass an allowlist-only pin while silently degrading the route to
  result-only lines — no session id for the ledger, no live tool lines.
- The child-env doctrine is deliberately **not** in the pin: D5's strip list
  is a recorded superset of the parent's `STRIPPED_NAMES` (`claude-connect.ts`
  strips four names; the standalone-laptop scenario closes more), so env
  composition between the workspaces diverges by design and the pin-equal
  guarantee is scoped to the enumerated constants above — a parent-route env
  change surfaces here by re-reviewing D5's list against it, not by a failing
  test.
- The two behaviors this design newly relies on that the corpus does not yet
  prove are added as zero-spend adversarial legs of the existing recorder
  (`tests/opencode-agent/claude-live.integration.ts`), re-run at every CLI
  pin move before any credentialed turn, per the parent change's route rule:
  the **absolute-form scoped `Write` rule** under `--allowedTools` (D7), and
  the **bare `Read` allowlist entry approving an absolute-path read outside
  the process cwd** — the reviewer's mandatory first directed step ("Read the
  plan first", `prompt-templates.ts`) targets `runState.planPath`, absolutized
  outside the worktree cwd on both routes (standalone: the plan resolves
  under `repoRoot` while the worktree sits under
  `<repoRoot>/.review-loop/worktrees/<runId>`; pipeline: the plan lives in
  gitignored `.opencode-agent/plan.md`), and the corpus's only recorded
  `Read` is the relative, in-cwd `README.md` (`success-turn.ndjson`, cwd
  `/runner/workspace`) — so the residual premise D7 and the spec state as
  fact (an analysis turn can read outside the worktree) rests on an approval
  no recording proves, and a CLI that refuses it fails or blinds every
  claude-route reviewer turn at its first directed step. If the read-scope
  leg refuses, the remedy ladder is a scoped `Read` rule, an `--add-dir`
  composition, or the loop copying the plan into the role's working tree
  before the spawn — the last requires no unrecorded CLI behavior at all,
  matching how the file-based output exchange already keeps every other
  file interaction inside cwd.

### D11 — No new modules beyond the four named, no new dependencies

Module inventory with the existing-module check the repo rule asks for:

| New module                | Need                                  | Existing coverage |
| ------------------------- | ------------------------------------- | ----------------- |
| `agent-command.ts`        | per-backend argv/stdin/env composition | none — hardcoded inline in `agent-runner.ts` |
| `backend-select.ts`       | credential guard + profile resolution  | none — `config.ts` validates shape only and reads no env |
| `claude-argv.ts`          | claude argv/profile/allowlist/cap doctrine | none in this workspace (opencode-agent's is behind the subprocess boundary) |
| `claude-stream.ts`        | NDJSON → `OpencodeEvent` decode + result outcome | `event-stream.ts` covers opencode lines only |

No new dependencies: `node:child_process`, `node:fs`, `node:os`, `node:path`
and `zod` (already the workspace's only dependency) cover everything. The
claude CLI itself is an installed binary the workflow already pins, not a
package. Edits to existing modules are confined to `config.ts`,
`agent-runner.ts`, `spawn.ts`, `line-handler.ts`, `cli.ts`,
`build-checker.ts` (D5's build-check scrub, inside `runBuildCheck`),
`config.example.json`, and the five role modules that construct
`RunAgentOptions` at their `runAgent` call sites — `review-round.ts`,
`issue-matcher.ts`, `issue-inspector.ts`, `issue-processor-attempts.ts`,
`issue-processor-batch.ts`: D2's context has no central construction point
(the six call sites build the options field-by-field, and the matcher and
inspector deps thread `model`/`extraArgs` as individual fields, not config
objects), so each site — or the deps plumbing that feeds it — gains the
resolved backend/`claude` context beside those fields and passes it into
every spawn. On the opencode-agent side: `deps.ts`, `review-runner.ts` and
the additive `ALLOWLISTS` export in `claude-argv.ts` (D10).

### Project-rule impacts

- **Capability / tool-prefs gating:** no papai tool surface is added, so no
  `tool_prefs` or capability-catalog change. The tool gating this change
  introduces is the CLI-side allowlists of D7 — deny-by-default under
  `--permission-mode default` with closed per-role lists — which is the
  review-loop-local analogue of the same doctrine.
- **Scope model:** no platform-instance, task-instance, user or config-context
  id keys anything new. Persisted state stays exactly where it was —
  `<workDir>/runs/<runId>/` keyed by runId — and the one new piece of
  per-run state, the `CLAUDE_CONFIG_DIR` tree, is an ephemeral OS-tmp
  directory tree keyed by the run and deleted at teardown (D8).
- **DB changes:** none. No drizzle migration, no backfill — the workspace has
  no database and adds none.
- **New dependencies:** none (D11).

## Risks / Trade-offs

- [CLI pin moves and decoders drift silently] → every decoded shape comes from
  the recorded fixture corpus; the pin test plus the recorder's re-run doctrine
  (re-record, never adjust by inspection) surface a pin move, and D10's
  adversarial legs re-answer the scoped-`Write` composition and the
  bare-`Read` outside-cwd approval at zero spend before any credentialed
  turn.
- [The selected credential is readable by the fixer's `Bash` children] →
  unavoidable under first-party-CLI exclusivity and carried over verbatim from
  the parent route's documented residual; mitigation is operational — prefer
  the bare profile with a revocable, spend-capped Console key, and the OAuth
  spelling only with that acceptance. The loop never widens exposure beyond
  the child env (D5). That env reaches the loop's other inherited-env
  children too — `createWorktree`'s `bun install` (postinstall scripts of
  the reviewed repo's dependency tree run under the loop's `process.env`)
  and the loop's git children (including any pre-commit hook the reviewed
  repo installs, which the commit step executes) hold the credential on the
  claude route exactly as they hold the gateway key inside
  `OPENCODE_CONFIG_CONTENT` on today's opencode route — the same dominated
  residual class, enumerated for completeness; D5's check child is one
  member, not the stand-in. The same residual reaches persistence: once the model
  can read the value it can quote or encode it into its own authored text —
  the fixer's result JSON (copied verbatim into `<runDir>` artifacts), the
  `reasoning` fields persisted from it into the ledger and trace, decision
  notes on loop stdout, the committed live tool line on the same stdout (its
  last call's 40-char-truncated argument, non-TTY runs included), and any
  worktree file the loop's `git add -A` commit
  step then stages — so D5's scrub closes the loop-authored seams only, the
  spec's no-credential claim is scoped to those seams, and no loop-side
  substring scrub is pretended to close this path.
- [OAuth five-hour window exhausted mid-run] → turns fail through the existing
  error path (result-line `is_error` / non-zero exit); the loop records the
  fix as failed/needs_human. No queueing or retry around the window, matching
  the parent route's deliberate trade-off.
- [Killed turns are invisible to usage totals] → a turn killed before its
  `result` line has no usage carrier (D6 counts from the result line only) —
  the same under-count the parent route documents; accepted rather than
  synthesizing numbers from assistant-line usage that may be partial.
- [Analysis roles lose `Bash` on the claude route (no `git diff`/`rg`)] →
  spec-mandated (D7); the reviewer's verification-budget instruction names
  git inspection and rg/grep searches, so those directed calls are refused
  each claude-route turn (recorded refusal shape, no tool effect) — accepted
  refused-call churn with prompts deliberately unchanged per the proposal
  non-goal, not a silent capability loss. If field runs show real reviewer
  blindness here, widening is a spec change first — the closed list is the
  guard, not an oversight.
- [Analysis-role reads are host-wide, not tree-confined] → the analysis set
  mirrors the parent's `plan` string verbatim (`Read,Glob,Grep`, unscoped —
  only the `Write` entry is path-scoped), so an injected analysis turn can
  read outside the worktree and quote host files into its findings JSON,
  which persists in run artifacts. Deliberate, for three reasons: the
  corpus records only the unscoped form, and a `Read(<cwd>/**)` rule is an
  unrecorded composition that, if the pinned CLI does not honor it, leaves
  `Read` unapproved and fails every analysis turn at its first read; the
  D10 pin-equal test pins the analysis set against the parent's recorded
  `plan` string, which a scoped `Read` breaks; and the residual is strictly
  dominated by the accepted fixer residual (`Bash` plus the credential in
  the child env — the loop's containment is permeable by design already).
  The spec sentence states the delivered containment (no edit, no execute,
  scratch-scoped writes) and records the unscoped-read residual; closing it
  is a spec change first — scoped read rules plus a zero-spend adversarial
  leg recording their form on the pinned CLI. The premise this residual
  rests on — that the bare `Read` entry approves the absolute, outside-cwd
  plan read the reviewer prompt directs first — is itself corpus-unproven,
  gated by D10's read-scope adversarial leg before any credentialed turn
  (remedy ladder recorded there).
- [Scoped `Write` rule fails to match the absolute scratch path on a future
  CLI] → the composition is pinned by the adversarial fixture leg at every pin
  move (D10); a mismatch fails the analysis turn loudly at the scratch-path
  diagnosis (existing ENOENT path), never silently.
- [mutation-improve breakage from seam changes] → every `SpawnFn` /
  `RunAgentOptions` extension is additive-optional with opencode-preserving
  defaults; its suites run in the same `bun run test` lane and gate the change.
- [Standalone laptop run over an ambient `~/.claude` login] → `CLAUDE_CONFIG_DIR`
  points the CLI at an empty run-scoped dir, so no operator keychain state is
  read or written, and the env-token-is-authoritative behavior (recorded on
  the parent route) means authentication comes from the guard-approved
  spelling only — and the endpoint with it: `ANTHROPIC_BASE_URL` /
  `ANTHROPIC_AUTH_TOKEN` and the CLI's other traffic-redirection switches
  (`ANTHROPIC_CUSTOM_HEADERS`, the Bedrock/Vertex toggles) are name-stripped
  (D5) rather than inherited, so an ambient endpoint override cannot redirect
  the credential's traffic. Residual, deliberately inherited: the standard
  proxy variables (`HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`/`NO_PROXY`) stay in
  the child env because a laptop that legitimately needs its egress proxy must
  still reach Anthropic — the parent route carries the same hole — so an
  operator whose proxy environment is untrusted (a proxy with an installed
  MITM CA, readable by the fixer's `Bash` children like every inherited name)
  clears it around the run rather than the loop guessing which proxies are
  sanctioned.

## Migration Plan

1. **Test-first, per the TDD hook mapping** (`review-loop/src/**` →
   `tests/review-loop/**`, `opencode-agent/src/**` → `tests/opencode-agent/**`;
   the Write/Edit hook pipeline gates every file below and demands its test
   land first): `config` refinement tests → `backend-select` guard tests
   (including the empty-string-as-absence pin: an injected env carrying the CI
   forwarding shape — `''`-valued `LLM_API_KEY` and non-selected Anthropic
   spelling — resolves rather than refusing, per D4; and the
   distinguishable-failure pin: each refusal's surfaced message carries its
   `BackendSelectionError` code, `CLAUDE_CREDENTIALS` / `LLM_CREDENTIALS`,
   so it cannot read as a config-parse or plan-path failure, per D4) →
   `agent-command` composition tests (including the byte-identical opencode
   argv pin, the claude `--model` prefix-strip pin, the non-empty-`extraArgs`
   refusal, the `MAX_ARG_STRLEN` refusal, the child-env strip-list legs over
   an injected `envSource` carrying the CI forwarding shape (every D5-stripped
   name absent from the composed env; exactly the selected credential,
   `CLAUDE_CONFIG_DIR` and `DISABLE_AUTOUPDATER` added; an inherited
   non-stripped name — a `GIT_AUTHOR_*` identity name — present, pinning
   D4's try-side `process.env` read), and the D7
   label→allowlist mapping
   legs: per-label set selection across the documented label forms, the
   unrecognized-label weakest-set fallback **with its spec-mandated logged
   condition**, and the cwd-composed absolute scoped-`Write` rule) →
   `claude-stream` decode tests
   over the fixture corpus plus a synthetic multi-block leg — one assistant
   line carrying two `tool_use` blocks and one `user` line carrying two
   `tool_result` blocks, asserting both calls counted/rendered and both
   results paired — because the recorded corpus carries at most one
   `tool_use` per assistant line and one `tool_result` per user line
   (census-verified; the second "tool_use" string in each fixture assistant
   line is a `stop_reason` value, not a content block), so the per-block
   mapping is pinned by the synthetic leg, not left to the corpus →
   `spawn` stdin/env tests (asserting the stdin
   half-close after the write, the error-swallowing handler on the stdin
   pipe — a mid-flush `EPIPE` from a watchdog group-kill fails the attempt,
   never the loop process — and replacement env semantics with a D5-stripped
   name absent from the captured child env, D3) → `line-handler` decoder-injection tests
   plus the credential-value scrub through the `enqueueLog` sink (a fixture
   line embedding the value on both callers' paths — raw NDJSON line and
   stderr line — plus the scrubbed `stderr` capture before it reaches the
    `AttemptError` message, plus a sub-floor (<12-char) fixture value
    surviving the scrub unscrubbed — pinning the mirrored `MIN_SECRET_LENGTH`
    floor (D5) — and the same scrub at the build-check capture
   seam — the persisted `build-check.log`, the needs-human reasoning, the
   retry `buildError` prompt and the thrown build error all flow from one
   scrubbed copy — D5) →
   `agent-runner` result-outcome tests →
   role-module backend-threading tests (the five `runAgent` call sites pass
   the resolved context through) → `cli` config-dir lifecycle tests →
   `deps`/`review-runner` hand-off tests → the pin-equal test.
2. Land review-loop backend support (default route byte-identical; standalone
   configs unaffected), then the opencode-agent hand-off, then docs:
   `review-loop/config.example.json` gains a `backend` field **inside the
   agent blocks** — the per-role placement D1 defines; there is no top-level
   key, and a top-level spelling would be silently stripped by the plain
   `z.object` (the exact silent-strip D1's rationale names), so the docs
   update states the placement and the semantics (a role may omit it; every
   role that names it must agree) — showing the
   default value (the file is strict JSON loaded by `JSON.parse`, so it
   carries no comments — the field's explanation lives in the
   `CLAUDE.md`/`AGENTS.md` update, not in the file);
   `review-loop/CLAUDE.md`/`AGENTS.md` and `opencode-agent/README.md`'s
   _Backend selection_ section updated — the `/review` residual bullet is
   retired, and the loop's route trade-offs (Bash-less analysis roles,
   killed-turn under-count, no retry layer) are documented operator-facing —
    as is the pinned-CLI requirement: a standalone operator installs the
    pinned `@anthropic-ai/claude-code@2.1.239` (the version the workflow's
    route-gated install pins and the fixture corpus was recorded against),
    and a drifted CLI presents as D6's missing-`result`-line attempt failure
    (every line unrecognized), not as a dead backend. An **absent** binary
    presents differently and takes the same remedy, so the doc names both
    shapes: `spawn.ts`'s error handler resolves a missing `claude` as exit 1
    with `spawn claude ENOENT` on stderr, `runAgent` retries it once per its
    standing policy, and the turn then fails as `AgentRunError` naming the
    label — self-diagnosing, but the operator doc says "install the pinned
    CLI" beside it rather than leaving ENOENT to be read as a PATH problem it
    never mentions.
3. Zero-spend recorder legs, each run once on the pinned CLI before the
   credentialed path merges: the absolute `Write` rule (D10), the
   bare-`Read` outside-cwd approval — the analysis allowlist under `-p` with
   `--permission-mode default`, reading an absolute path outside the spawn
   cwd: the reviewer's plan read (D10) — and the AGENTS.md-in-context leg
   the Open Question defers (both profiles — the reviewer brief's "already
   in your context" premise is verified, or the D3 system-prompt remedy is
   applied, before any credentialed reviewer turn).
4. **Rollback:** revert the commits. No persisted-state migration exists in
   either direction — run state, ledger, `metrics.json` and the trace log
   (`trace.jsonl`) carry the same fields with the same meanings on both
   backends (D6 maps into the existing union; the one per-backend file,
   `agent-output.log`, is raw backend NDJSON and diagnostic-only — nothing
   reads it back), so an in-flight run's artifacts survive either
   direction. The claude route itself does not drop out gracefully under a
   revert: pre-change `ReviewLoopConfigSchema` is a plain `z.object` that
   silently strips the then-unknown per-role `backend` key (the exact
   silent-strip D1's rationale names), so a resumed claude-backend config
   proceeds on opencode spawns that fail per-spawn — `AgentRunError`s on a
   claude-only setup with no opencode config or credentials — rather than a
   named backend refusal; deleting the `backend` keys before resuming under
   pre-change code avoids the noise. The default route never changes
   behavior, so rollback cannot strand an opencode run.

## Open Questions

- Whether the pinned CLI auto-loads `AGENTS.md`/`CLAUDE.md` project memory in
  headless `-p` mode under each profile (the review prompt asserts the repo
  conventions are "already in your context", which opencode guarantees and the
  native profile's neutralization flags may affect). Answerable by one
  zero-spend fixture leg during implementation; if the answer is "not loaded",
  the remedy — appending the conventions via the system-prompt seam D3 already
  ships — changes no spec, no approach and no task ordering, so it is
  deliberately deferred rather than guessed here.
