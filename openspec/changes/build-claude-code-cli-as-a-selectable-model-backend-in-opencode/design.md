<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

The pipeline holds its model backend behind one injected seam: `OpenCodeAgent`
(`opencode-agent/src/opencode-adapter.ts`) — `prompt({prompt, system, agent,
tools}) → {text, sessionId}`, `tokensUsed()`, `abort() → boolean`, `close()` —
memoized once per job by `agent-handle.ts` and assembled into a run by
`contain.ts`. Below the seam the OpenCode route is three files split by what
changes them: `sdk-contract.ts` (shapes recorded from a live server, plus the
request body), `opencode-connect.ts` (how the server is started and addressed),
`opencode-adapter.ts` (the session the pipeline holds). Around the seam:
`turn-run.ts` bounds one turn — deadline, heartbeat, stall watcher, failure
classification — through the narrow `TurnConnection` slice, and `secrets.ts`
scrubs every loaded credential from `process.env` before anything spawns and
redacts them outbound; the provider key reaches OpenCode only through
`provider-proxy.ts` + `contain()`. Motivation (Anthropic-credentialed repos;
OAuth sanctioned only via the official CLI since Feb 19 2026) is in
`proposal.md - Why`; requirements are the delta spec
(`specs/opencode-agent-claude-cli-backend/spec.md`) and are not restated here.
The CLI hard constraints — first-party binary only, credential exclusivity,
`--bare` determinism, exit-code discipline, stream-json output, group-kill stop
semantics — are spec requirements this design takes as given.

## Goals / Non-Goals

**Goals:**

- A second backend behind the existing seam such that phases, budgets,
  guardrails, the state machine and feedback change **nothing** — the interface
  is implemented, the pipeline is not forked.
- A decomposition a reader can predict from the OpenCode side: contract /
  connect / session, changing for the same kinds of reasons.
- A pre-spend, loudly-failing credential guard with a distinguishable code, and
  credential containment that keeps the one chosen Anthropic credential off
  every path except the spawned CLI's environment.
- Stop semantics that fix, on this route, the orphan leak `close()` has on the
  OpenCode side: `abort()` kills the process group and reports.

**Non-Goals:**

- No stall-detector parity beyond what the existing machinery gives for free
  (Decision 6 explains why the stall watcher no-ops here and why that is
  accepted); the whole-turn deadline remains the bound.
- No retry layer for CLI failures — the pipeline cannot see the HTTP status
  behind an exit code, so it must treat every exit as a verdict (contrast
  `provider-proxy.ts`, the one layer that may retry because it still sees an
  HTTP status). Time-transient waves therefore land as turn failures here;
  the accepted availability cost is recorded in Risks.
- No mapping of the per-call `tools` field of `AgentPromptRequest`: no caller
  in `src/` passes it today (verified by grep; only `agent:` is used). The
  field stays on the interface, ignored on this route until a caller exists.
- No MCP on this route (`--bare` skips MCP servers; `AGENT_MCP_SERVERS` is
  read for secret-scrubbing only — Decision 5), no review-loop change, no
  papai runtime or scope-model effect of any kind (see Risks, last bullet).

## Decisions

### 1. One `claude -p` process per turn, `--resume` for continuity

Each `prompt()` spawns `claude -p` with `--output-format stream-json`
(paired with `--verbose`, as the headless docs' stream-json examples do — some
CLI versions gate the full NDJSON stream on the companion flag; the recorder
verifies the pairing), text prompt on stdin, and — from the second turn on — `--resume
<session-id>` carrying the memoized init id **whenever one is memoized** —
usually even when the previous turn was killed, because the init line is the
stream's first line and normally lands long before a deadline can fire. The
edge is a kill during CLI startup, before any line arrived: nothing is
memoized, and the next turn spawns **without** `--resume` into a fresh
session (there is no context to fork — the killed turn produced none); a
wrap-up asked in that state lands in that fresh session and reports what it
can. The
killed-turn wrap-up is the load-bearing case — `askForHandoff`
(`turn-stop.ts`) asks its handoff question in the same session, and under a
success-gated resume it would land in a context-free fresh session with
nothing to report. Alternatives
considered: a **persistent `--input-format stream-json` process** (rejected —
it reintroduces exactly the long-lived server lifecycle the spec disclaims on
this route, collapses `abort()` and `close()` into "signal the one process"
where this design needs them to be different things, and makes a wedged process
poison every later turn; per-turn spawn failure-isolates instead), and
**re-using `shell.ts`'s `runCommand`** (rejected as the spawn mechanism — it
buffers both streams, has no stdin write and no group kill; it remains the
runner for everything else). Cost: one process startup per turn, negligible
against minutes-long turns; the recorder (Decision 7) measures it once.

### 2. Module split mirrors the OpenCode boundary; the seam interface moves to a neutral home

Three new files, changing for the same reasons their OpenCode twins do:

- `claude-contract.ts` — what the CLI **says**: Zod decoders for the NDJSON
  line types (`system` init, `assistant`, `user`, `result`, `stream_event`),
  recorded from a live CLI, never guessed; plus the argv builder, the request
  side of the contract (the `buildBody` analogue).
- `claude-connect.ts` — how the CLI is **started and addressed**: the
  `node:child_process` spawn (`detached: true`, own process group, `shell:
  false`, argv vector), the child environment (post-scrub `process.env` plus
  exactly the injected values of Decision 5/9), and the job-scoped config dir
  of Decision 9.
- `claude-adapter.ts` — the **session** the pipeline holds: implements the
  seam interface, memoizes the CLI session id, drives `runTurn`, reads
  usage before teardown.

The seam interface is extracted from `opencode-adapter.ts` into
`agent-session.ts` as `AgentSession`, with `OpenCodeAgent` re-exported as an
alias from `opencode-adapter.ts` so not one existing import changes — the
`phase-names.ts` precedent ("split from `types.ts` and re-exported by it so
callers keep naming one module"). New modules and tests use the neutral name.
Alternatives: keep the name (rejected — a claude session typed as
`OpenCodeAgent` is a lie at every new import site), wholesale rename
(rejected — broad no-op churn on the default route). `agent-handle.ts`,
`runTurn`, `ProgressTracker`, the `errors.ts`/`turn-errors.ts` factories and
the `contain.ts` assembly pattern are all reused; the dependency question one
level in: **no new package.json dependency anywhere** — Zod already covers
decoding, `node:child_process` (already used by `shell.ts`) covers spawning,
and the CLI itself arrives the way `opencode-ai` does today, as a pinned
workflow-global install, not a workspace dependency.

### 3. Request mapping: stdin prompt, appended system prompt, profile allowlists

- **Prompt on stdin**, not argv: Linux caps a single argument at 128 KiB and
  the pipeline's user prompts (issue body + envelope) are capped by
  `prompt-budget.ts`, not by that number; stdin also keeps content
  out of `ps`. `claude -p` with no positional reads stdin.
- **System prompt via `--append-system-prompt`**, carrying
  `composeSystemPrompt`'s output verbatim. `--system-prompt` (replace) was
  rejected: the CLI's built-in prompt defines its tools' contracts, and this
  pipeline's system prompts are additions (envelope rule, protected paths),
  not replacements. The system prompt is, however, the one prompt component
  no budget caps — `prompt-budget.ts` bounds user-prompt inputs (thread
  context, check output), while inlined skill prose lands in the system
  prompt unbounded (`obra-skills.ts` inlines full SKILL.md bodies) — and it
  rides argv, against the very 128 KiB single-argument cap that puts the user
  prompt on stdin. So the argv builder refuses to compose an invocation whose
  appended system prompt exceeds that cap (MAX_ARG_STRLEN, 131,072 bytes),
  failing the turn with its own named error carrying the composed size, the
  cap and the remedy (shrink the inlined skill set) — a distinguishable
  adapter-level failure, not the ENOENT-shaped `serverGoneError` relabel an
  E2BIG spawn failure would misclassify as. Current composed sizes (roughly
  10–50 KB with this repo's inlined skills) leave headroom; the recorder
  (Decision 12, step 7) exercises the composition with real skills.
- **Profile → `--allowedTools`**: the spec pins `plan → Read,Glob,Grep` and
  `build → Read,Edit,Write,Bash,Glob,Grep`. The pipeline prompts a third
  profile (`plan-draft.ts` uses `agent: 'propose'`), which the spec leaves to
  design: `propose → Read,Edit,Write,Glob,Grep` — the spec's pinned read trio
  plus file mutation, **no `Bash`**. Re-derived from the real maps, not a
  paraphrase of them: `PROPOSE_PERMISSION` grants `READ_TOOLS + PROPOSE_TOOLS`
  = `read,grep,glob,list,todowrite,edit` (`permissions.ts` — five read tools,
  not three, and `edit` only). On the CLI side the read trio keeps the spec's
  pinned `plan` shape (deliberately no `LS`/`TodoWrite` analogs — a narrowing),
  and OpenCode's single `edit` tool, which both creates and modifies files,
  maps onto the CLI's `Edit`+`Write` pair (`Edit` cannot create a file), so
  the substance is never broader and stays diff-guard-confined at staging.
  Cost of the narrowing: drafting turns lose the todo tool the OpenCode side
  grants — a degradation of the CLI's own turn hygiene, not of any repository
  capability — accepted and recorded here. An unknown or absent profile gets the `plan`
  allowlist plus a `warn` — the existing default-weak doctrine
  (`openai-config.ts`: "the weaker profile is the default, so an agent this
  pipeline does not name inherits the restricted set"). Every invocation also
  carries `--permission-mode default`; none ever carries
  `--dangerously-skip-permissions`. Composition semantics, stated rather than
  assumed: `--allowedTools` is an auto-approval list, not an enablement list,
  and `--bare`'s minimal tool set (Bash, file read, file edit) is availability,
  not permission — under headless `-p` with `--permission-mode default` a
  permission request for an unlisted tool has no grantor and the call is
  refused, so the effective toolset is the allowlist and a plan/propose prompt
  injection cannot reach `Bash` on this route either. That reading is pinned,
  not trusted: the recorder (Decision 12, step 1) records an adversarial
  plan-profile fixture whose prompt attempts a `Bash` call and asserts the
  call is refused — the one permission-effect assertion in an otherwise
  flag-acceptance pass.
- **Model and effort**: `--model` takes the profile's model —
  `LLM_MODEL_LIGHT` for `plan`-profile turns when set, else `LLM_MODEL` —
  split by the existing `parseModelRef` rule when the value carries a
  `provider/` prefix (only the model id crosses to the CLI; a slash-free
value passes verbatim), so one knob serves either backend and switching
backends needs no re-spelling — of the knob, not the value's validity: the
CLI is this route's model oracle too, and a `LLM_MODEL`/`LLM_MODEL_LIGHT`
value it does not recognize fails the first turn loudly (`CLAUDE_EXIT` with
a redacted stderr tail), named in the README's backend-selection notes.
`--effort` takes the profile's
  `AGENT_EFFORT_PLAN` / `AGENT_EFFORT_BUILD` when set (`propose` gets none,
  matching its empty variant on the OpenCode side) and is omitted when unset;
  values are passed through, never enumerated — the existing
  pass-through-not-enumerated doctrine.

### 4. `AGENT_BACKEND` is read first; gateway requirements are route-scoped

`config-values.ts` gains an enum read (`opencode | claude`, default
`opencode`, any other **non-empty** value a `ConfigError` naming
`AGENT_BACKEND`; unset or empty keeps the default — the job-level `env:` line
of Decision 11 renders an unset repository variable as `''`, and the read
follows the `optional` convention that trim-empty is absence), and
`loadConfig` reads it **before** the gateway block: on the claude route the
`required` reads of `LLM_API_KEY` / `LLM_BASE_URL` become optional-empty —
presence meaning a non-empty value, the `required()` rule, because the
workflow forwards an unset secret as `''` — so `config.openai` keeps its type
with empty `apiKey`/`baseUrl` when the gateway is unconfigured, and
`pipelineSecrets` / `mcpSecrets` skip empty values (the value-based scrub
must not start matching empty strings). The endpoint and its credential are
unused there and must not be load-bearing, while the model/profile knobs of
Decision 3 are read on both routes into the config the adapters consume. One
presence is refused outright: `LLM_API_KEY` set on the claude route fails
`loadConfig` with a `ConfigError` (code `LLM_CREDENTIALS`) — the only thing
a gateway key could still feed on this route is the review runner's
`opencode run` children, and `contain()` starts no proxy here, so
`OPENCODE_CONFIG_CONTENT` would inline the real key into a subprocess whose
children the model controls, the exact exposure `provider-proxy.ts` exists
to prevent. Unset it or stay on the opencode route; `LLM_BASE_URL` and the
model knobs stay optional-empty and harmless. On the claude route `runCli`
also skips `describeModel`
(the models.dev lookup exists to feed `buildOpencodeConfig`, which this route
never builds — and a claude run must not pay a network read the OpenCode
router would refuse to make for a dropped payload), and `contain()` starts
**no provider proxy** (`Contained.proxy` becomes nullable; the one teardown
call site gates on it). The default route emits byte-identical config and
behaviour: no CLI spawn, no Anthropic credential handling, no guard — one
deliberate, named exception: the shared `serverGoneError` failure path's
backend-neutral rewording — thrown message and the adjacent log line
(Decision 6) — a failure-comment wording change the
default route can display, not a behaviour change.

### 5. The credential guard fires in config loading; the chosen credential rides the existing secret machinery

When the backend is `claude`, config loading requires **exactly one** of
`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`: both set fails (the API key
silently wins and switches billing to per-token Console charges — the message
says so), neither set fails (no credential remains); the failure is a
`ConfigError` whose new `code` field reads `CLAUDE_CREDENTIALS`, satisfying the
spec's distinguishable-by-error-code requirement with the existing startup
path (config errors propagate to `main` and redden the job, drawing the
workflow's existing infrastructure-failure fallback comment — the same
"Agent job did not finish / reply `/retry`" comment a missing `LLM_API_KEY`
draws today, because a config error is thrown before the first pipeline
comment and `reported` is unset; the `CLAUDE_CREDENTIALS` code itself
surfaces in the job log, which is where an operator looks for it). The guard fires
in `loadConfig`, ahead of the logger, the scrub, every GitHub call and every
spawn — before any model spend by construction — and never fires on the
opencode route.

Containment reuses the provider-key doctrine minus the proxy: the chosen
credential is captured into config and joins `pipelineSecrets`
(`secrets.ts`), so the value-based `scrubSecrets` removes it from
`process.env` before anything spawns, the outbound `redactSecrets`/`clean`
boundary and the diff guard know it, and `claude-connect.ts` injects **only**
it (plus Decision 9's hygiene variables) into the child environment. Because
the scrub matches by value and the CLI's `Bash` tool can read the child env,
the claude route still parses `AGENT_MCP_SERVERS` for the secrets list even
though it configures no MCP — an MCP header credential must not survive the
scrub just because its knob is inert on this route. What never reaches a
claude code path is `config.openai`'s gateway half — the credential and the
endpoint; the model/profile knobs of Decision 3 are the one part that
crosses, as plain values on the claude adapter's options (the model id and
the per-profile effort tiers), never the `OpenAiSettings` object itself.
The child environment is likewise stripped of two variable **names**:
`LLM_BASE_URL`, the one gateway variable this route does not refuse outright
(the value-based scrub cannot see a non-secret endpoint URL, and the spec
forbids the endpoint riding the CLI's environment on any run, not only a
workflow-gated one), and `AGENT_MCP_SERVERS` itself — its value is a JSON
document with MCP header/environment credentials embedded **inside** it, so
the whole-value equality of `scrubSecrets` removes each individual
credential from any whole-value carrier but can never remove the JSON
carrier, and the knob is inert on this route (`--bare` runs no MCP
servers); without the name-strip the spec's only-one-injected-credential
scenario would be false here, because the CLI's `Bash` children read the
child env. The guard message names
variables, never values.

### 6. Turn lifecycle reuses `runTurn`; two new turn-family codes join the bypass set

The adapter drives `runTurn` through a `TurnConnection` shim:
`sendPrompt` is the spawn-and-collect promise (resolves with the captured
`result` line, rejects with the Decision 7/8 failure codes); `alive` is the
spawn-transport probe — for a subprocess route, "the transport stopped
answering" means the spawn itself failed (ENOENT — the binary the workflow
forgot to install), which is precisely the `serverGoneError` relabeling that
probe exists to perform. The stall watcher is wired but **no-ops by design**:
its second condition (retry evidence accumulated since last progress) is an
OpenCode event-stream fact with no analog in a CLI child, and synthesizing
fake evidence would manufacture false stalls on long generations — so the
whole-turn `AGENT_TIMEOUT_MS` deadline remains this route's bound, recorded as
a trade-off, not hidden. Because every claude turn failure is classified
**after** its process has exited (where `alive()` is trivially `false`),
`CLAUDE_EXIT` and `CLAUDE_RESULT` (Decision 7) are added to `runTurn`'s
bypass list beside `isTurnDeadline`/`isTurnStall` — the established
turn-family arrangement (`turn-errors.ts`, re-exported by `errors.ts`), and
the `serverGoneError` path's wording — thrown message **and** the
`bounds.log.error` line beside it on the same catch path, which otherwise
names an OpenCode server in exactly the ENOENT case this probe exists to
relabel — becomes backend-neutral ("the model
backend process this job spawned" / "the model backend process stopped
answering; the turn died with it") since on this route there is no
`opencode serve` to name — keeping its post-mortem step pointer, still true
on both routes because the step's OOM/cgroup probes are process-name-agnostic
(Decision 11); a test pins the rewording keeping the pointer.

### 7. The output contract is recorded, decoded, and final-anchored on the `result` line

`claude-contract.ts` decodes each NDJSON line through `safeParse`-yielding
schemas, per the `activity.ts` doctrine: an unrecognized line is skipped for
progress purposes and never fails the turn; final text and token usage (plus
`total_cost_usd`, decoded but **never read as a budget** — budget stays on
tokens) come from the `result` line; the session id comes from the init
message, is memoized by the adapter, returned as `sessionId`, and chained into
the next turn's `--resume`. The interface's boot-time `sessionId` property
holds a synthetic job-local id until the first init line lands (its readers
are log/progress context; `AgentPromptResult.sessionId` always returns the
CLI's). Exit discipline: exit 0 **and** a decodable `result` line resolves the
turn; exit 0 with a missing or undecodable `result` fails with
`CLAUDE_RESULT` (an empty success is the issue-#239 shape this pipeline
already refuses); a decodable `result` line that itself signals an error
(`is_error: true` or the recorded equivalent) or carries empty final text
fails `CLAUDE_RESULT` **regardless of exit code** — the CLI's documented
error→non-zero-exit correlation is relied on for nothing, and failing empty
text at the adapter closes the protection `requireAnswer`'s stall-evidence
condition loses when Decision 6 removes its evidence source; likewise exit 0
with a decodable `result` line but no
session id available — no init line this turn and none memoized from an
earlier one — fails with `CLAUDE_RESULT`, because resolving under the
synthetic id would either hand `--resume` an id the CLI refuses or silently
fork the session's context mid-job, the quiet-failure shape this pipeline
refuses; once an id is memoized, a later turn whose stream omits the init
line degrades — continuity rides the id already chained; non-zero exit
fails with `CLAUDE_EXIT` carrying the code and
a redacted stderr tail — never reinterpreted, never retried away. Fixtures
are recorded from the live pinned CLI by a new `claude-live.integration.ts`
(deliberately not `*.test.ts`, so discovery skips it; `bun run
opencode-agent:test:claude-live`), the `live-sdk.integration.ts` doctrine: it
is the recorder, and when the pin moves you re-run it rather than adjusting a
decoder by inspection. The recorder also stamps the recorded CLI's exact
version into the fixture directory, and `workflow.test.ts` asserts that stamp
equals the workflow's pin — fixture↔binary skew fails CI instead of resting
on doctrine.

### 8. `abort()` kills the group and reports; `close()` reaps, terminating anything abandoned; usage is read before teardown

`claude-connect.ts` spawns detached, so the CLI leads its own process group
and the `Bash` tool's children stay in it — a premise verified at recording,
not assumed (Decision 12, step 7): the OpenCode route measured its own tool
children escaping its server's group. `abort()` sends `SIGTERM` to the
group (`-pid`), escalates to `SIGKILL` after a short named grace, and reports
whether the kill landed — a first signal that finds no live group (already
gone, or refused) reports `false`, keeping the salvage fence conservative
exactly as the spec's refused-kill scenario demands. `close()` is never a
stop and never a fallback for a refused kill — no caller fences on it, and
it reports nothing. But "only reaps" does not mean "kills nothing": a turn
abandoned by a deadline outside the implement phase (no `turn-stop` runs
there — it is the pipeline's sole aborter, and `runTurn`'s deadline race
leaves the losing `sendPrompt` promise — and its child — running), or a
crashed run, can reach teardown (`index.ts`: `agent.close()` is all it
calls) with the detached, credentialed CLI group still alive, where the
OpenCode route's `close()` kills its server pid — so `close()` finding a
live group delivers the same SIGTERM→grace→SIGKILL escalation
fire-and-forget (the grace timer never blocks process exit or the teardown
reserve), then reaps what remains and best-effort removes the job-scoped
config dir. A live model process outliving the job is the orphan leak this
route's own goal claims to close, not a residual to record; waiting for the
child instead would hang teardown past `AGENT_TEARDOWN_RESERVE_MS` and lose
the report. Token totals are captured from
each `result` line **as it arrives** — before any teardown can race it — and
`tokensUsed()` answers the accumulated total, degrading to `0` with a `warn`
when no recognizable usage was seen (the `readTokensUsed` doctrine). A turn
stopped **before** its `result` line arrives — on this route, every deadline
kill, since the stall watcher no-ops (Decision 6) — contributes `0` and has
no post-hoc accounting source: a killed CLI child is gone, where the
OpenCode server's session usage survives an abort. That under-count is
recorded as a risk below, a budget-integrity trade-off, not doctrine parity.
Whether
the pinned CLI's per-`result` usage is per-invocation or session-cumulative
is a fixture-recording fact (Open Question 2); the adapter sums or takes last
accordingly, and the budget's meaning does not change either way.

### 9. Determinism is structural: `--bare`, explicit flags, a job-scoped config dir, no auto-update

Every invocation carries `--bare` (no user hooks, MCP servers, skills or
CLAUDE.md discovery — runner A and runner B see the same context; this
pipeline inlines its own skill prose in prompts, so nothing is lost), an
explicit `--model` and `--effort` per Decision 3, and
`--permission-mode default`. No `~/.claude` state crosses jobs because none
survives the job: `claude-connect.ts` points `CLAUDE_CONFIG_DIR` at a fresh
job-scoped temp directory outside the checkout workspace (under `os.tmpdir()`,
where the `--resume` session files live and die — never a path `git add --all`
in the implement phase could stage),
and disables the CLI's self-update via the documented `DISABLE_AUTOUPDATER=1`
so the pinned version is the running version — verified at recording like
`CLAUDE_CONFIG_DIR`: the recorder asserts the running `--version` is
unchanged after a turn (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, which
also silences telemetry, is the broader documented alternative should the
recording show any other background traffic). If the pinned CLI turns out
not to honor
`CLAUDE_CONFIG_DIR` (verified at recording — Open Question 3), the fallback
is a job-scoped `HOME`, same isolation, one line. The determinism knobs are
constants in `claude-connect.ts`, not env-var-tunable: a knob that lets two
runners disagree is the thing `--bare` exists to prevent.

### 10. Progress keeps the names/statuses/counts rule; content only reaches the encrypted transcript

The NDJSON decode feeds the existing `ProgressTracker` through a thin
translation in the adapter: the public Actions log carries line types, tool
names, statuses and counts only — schemas that name just the scalar fields
they want, so assistant text, tool input and tool output have nowhere to land
— while the content-bearing lines go to the encrypted `TranscriptSink`
unabridged, redacted by credential value (`redactSecrets`) before they reach
it, per the spec's redaction scenario. No widening of the public-log schemas
is legal on this route either; the one legal widening remains the
transcript-side seam.

### 11. The workflow gains one gated, pinned install step; `AGENT_BACKEND` lives at job level

`AGENT_BACKEND` is declared once in the job-level `env:` block as
`AGENT_BACKEND: ${{ vars.AGENT_BACKEND }}` — a repository variable, the same
source every existing knob reads — (so the install step's `if:` and the
pipeline step read one value, not two kept in step), and
a new step before the pipeline step installs
`bun add --global @anthropic-ai/claude-code@<exact-version>` plus the
`$HOME/.bun/bin` PATH line, mirroring the `opencode-ai@1.18.7` step — pinned
exact, no floating tag, no `latest` — and gated on
`env.AGENT_BACKEND == 'claude'`, so the default route installs nothing.

Credential forwarding is gated on the same job-level value, and must be
specified because GitHub Actions injects no repository secret implicitly:
today the pipeline step forwards every variable line-by-line
(`LLM_API_KEY: ${{ secrets.LLM_API_KEY }}`, …), and without new lines the
guard would always see neither-set and every claude-route job would fail at
startup. The pipeline step gains `ANTHROPIC_API_KEY` and
`CLAUDE_CODE_OAUTH_TOKEN` lines that forward only when
`AGENT_BACKEND == 'claude'`, and its `LLM_API_KEY` / `LLM_BASE_URL` lines
gain the inverse gate (the model knobs — `LLM_MODEL` and friends — stay
forwarded on both routes; they name the model either backend runs). The
gates are what keep each route clean: a default-route job — including the
rollback path of the knob unset while the Anthropic secret still exists —
never carries an Anthropic credential in `process.env` at all, where
`opencode serve` and its model-readable `bash` children would see it (the
spec forbids the guard rewriting the environment on that route, so the
workflow gate is the only compliant mechanism), and a claude-route job never
carries the gateway key, keeping Decision 4's `LLM_CREDENTIALS` refusal
unreachable from the workflow itself — it backstops manual and misconfigured
local runs. The workflow stays one file both routes execute; only runtime
values differ. `workflow.test.ts` pins the install gate, the version's
exactness, and the forwarding gates. Nothing else in the workflow, the
cascade or the state machine differs between backends; the post-mortem
census is deliberately not extended to count `claude` processes (the
constraint is "nothing else changes"; the spawn-failure diagnosis on this
route is the `serverGoneError` message's job, and the step's OOM/cgroup
probes are process-name-agnostic, so an OOM-killed CLI is still visible
there).

### 12. Build order and test-first discipline

Nothing in the Write/Edit TDD hook pipeline gates these files — the hook's
gateable roots are `src/`, `client/`, `plugins/`, `review-loop/src/` and
`sdd-runner/src/` (`test-resolver.mjs`'s `isGateableImplFile`; documented in
`docs/architecture/commands.md`, where local hooks are advisory and CI is the
hard gate), and `opencode-agent/src/` is not among them — so the test-first
order below and the apply-stage TDD discipline carry it, not the hook. Order
of work: (1) run the recorder
against the live pinned CLI, commit the recorded NDJSON fixtures — including
the adversarial plan-profile fixture of Decision 3 (prompt attempts a `Bash`
call; the call must come back refused), the permission-effect pin; (2)
`claude-contract.ts` decoders and argv builder — tests first, against those
fixtures; (3) the `AGENT_BACKEND` enum, route-scoped config and the
credential guard, tests first in `config-values.test.ts` / `config.test.ts`
(both-set, neither-set, unknown-value, empty-means-default,
opencode-route-untouched, gateway-key-refused,
no-value-in-messages); (4) `claude-adapter.ts` over an injected spawn seam
(`options.spawn`, the `OpenCodeAgentOptions.connect` doctrine — DI, no
`mock.module`): result-line resolution, exit-code and missing-result
failures, resume chaining, group-kill reporting, tokens-before-teardown,
unrecognized-line skipping, names-only progress; (5) `agent-session.ts`
extraction + `contain()` wiring with a `createClaudeAgent` test seam;
(6) `workflow.test.ts` — additions plus one superseded pin: the existing
"passes only the single LLM endpoint credentials" test asserts the pipeline
step's env keys carry no `ANTHROPIC*`, which Decision 11's route-gated
forwarding lines fail, so it is rewritten into the forwarding-gate pins rather
than kept beside them; one knob-harvest interaction is settled in the same
step: the "passes every knob the README documents, or names it as deliberately
absent" test harvests every `AGENT_*` name from the README's environment
table and requires each in the pipeline step's env keys or in
`DELIBERATELY_ABSENT`, and `AGENT_BACKEND` lives only in the job-level `env:`
block (Decision 11) — invisible to `step('agent pipeline').env` — so its
README row resolves through a `DELIBERATELY_ABSENT` entry carrying the
job-level-declaration reason (documenting it as a table row, like every other
knob, rather than hiding it in prose); the additions pin a workflow edit the agent can never
land itself: `agent-pipeline.yml` is a protected path (`stageAllowed`
drops **and reverts** the working-tree copy), so a maintainer commits the
workflow edit to the change branch **before this step**, carrying the exact pin
step (1) recorded — the repo precedent (every prior workflow change, e.g.
`add5c40d2`, is one human commit with its `workflow.test.ts` pins) — so the
install-gate, pin-exactness, forwarding-gate and fixture-stamp assertions read
a file already on the branch and the suite is green through apply; (7) before
merge, re-run the recorder
end-to-end through the finished `claude-adapter.ts` — the
`live-sdk.integration.ts` doctrine exercised fully, the recorder driving the
adapter's own argv composition — so a flag set the pinned CLI no longer
accepts fails at recording cost, not at the first claude-route issue. The
same run measures the stop semantics a fixture cannot: a live turn running a
long `Bash` child is `abort()`ed and the recorder asserts no member of the
group survives (the OpenCode route measured its own tool children escaping its
server's group — whether the CLI's `Bash` children share the CLI's group is a
recording fact, not a POSIX assumption), and a follow-up prompt `--resume`s
the memoized session after a `SIGKILL`ed turn and answers — Decision 8's
escalation and Decision 1's killed-turn wrap-up, the `live-sdk.integration.ts`
claim class, measured rather than assumed. All
tests network-free; the recorder is the
only credentialed artifact and never runs in CI.

## Risks / Trade-offs

- **[Recorded shapes drift when the CLI pin moves]** → the workflow pins one
  exact version and the contract doctrine applies verbatim: re-run the
  recorder, re-record, never adjust a decoder by inspection. The recorder
  stamps the CLI version into the fixture directory and `workflow.test.ts`
  asserts it equals the workflow's pin (Decision 7), so binary and fixtures
  cannot **silently** skew; the README's copy of the pin stays human-readable
  documentation CI does not read.
- **[Killed turns are invisible to the token budget]** → a turn stopped before
  its `result` line has no usage carrier on this route — unlike the OpenCode
  server, whose session usage survives an abort — so deadline-looping issues
  (`INCOMPLETE` → `/continue`, `FAILED` → `/retry`) burn spend
  `AGENT_MAX_TOKENS` never sees. Accepted and recorded as a budget-integrity
  trade-off of the CLI route, not doctrine parity; watch item beside the
  stall no-op — deadline failures on claude-route jobs during dogfooding.
- **[Transient provider waves fail turns instead of being retried]** → the
  opencode route absorbs 429/529-class waves in `provider-proxy.ts`; this
  route has no equivalent, and whatever the CLI absorbs internally is all
  there is. A wave exits non-zero → `CLAUDE_EXIT`, the attempt is spent, the
  phase parks `FAILED` for a human `/retry`. Accepted as the availability
  cost of CLI exclusivity, and recorded in the README's backend-selection
  notes so an operator choosing `AGENT_BACKEND` sees it before choosing.
- **[Stall bound no-ops on this route]** → accepted and recorded (Decision 6):
  the deadline still bounds every turn; do not synthesize retry evidence. The
  dead knob is recorded where the route's other trade-offs are — the README's
  backend-selection notes say any `AGENT_STALL_TIMEOUT_MS` value is inert when
  `AGENT_BACKEND=claude`. Watch
  item: deadline failures on claude-route jobs during dogfooding.
- **[The review loop still needs the gateway on this route]** → recorded
  residual: `review-loop/` shells out to `opencode run`, which a claude-route
  job cannot serve (the forwarding gate of Decision 11 and the
  `LLM_CREDENTIALS` refusal of Decision 4 leave no gateway credential on this
  route) — `/review` then fails loudly at its own boundary (never silently
  degraded); the proposal's Non-goals own it. The delivery comment still
  recommends `/review` at the `reviewHintLines` threshold, and suppressing
  the hint by backend would fork feedback behavior above the seam, which the
  spec's above-the-seam identity requirement forbids — so a follower spends
  one job and one `reviewAttempt` discovering the residual. Accepted, and
  named in the README so an operator of a claude-route repository knows the
  hint is inert there.
- **[The guard checks presence, not validity]** → deliberate: the CLI is the
  validity oracle, and a rejected credential is a non-zero exit → `CLAUDE_EXIT`
  failure with a redacted stderr tail, on the first turn, before which nothing
  else has spent.
- **[The chosen credential is readable by the CLI's own tool children]** →
  the route's defining security asymmetry: on the opencode side the real key
  is structurally invisible to model children (`provider-proxy.ts` + the
  placeholder, `contain()`); here the CLI cannot authenticate without the
  credential in its environment, and every `Bash` tool child inherits that
  environment by POSIX semantics — a prompt-injected build turn can
  exfiltrate it with one `env | curl`. Unavoidable under first-party-CLI
  exclusivity (the Feb 19 2026 constraint leaves no compliant alternative),
  so recorded, not fixed: the README's backend-selection notes name it and
  say the revocable, spend-capped Console API key is the safer spelling on
  threat-model-sensitive repositories (the OAuth token carries a
  subscription's spend and a ~12-month lifetime), and the spec's OAuth
  scenario is scoped to what the pipeline hands over, not what the CLI's own
  children inherit.
- **[A tool child that double-detaches escapes the group]** → the group kill
  covers the CLI and its direct group members, which is strictly better than
  the OpenCode side's leaked `close()`; the boolean report keeps salvage fenced
  on "did the kill land", the same conservative answer.
- **[OAuth token expiry (~12-month lifetime)]** → rotation is regeneration,
  documented in the README, not automated (proposal Non-goal); a dead token is
  a loud first-turn `CLAUDE_EXIT`.
- **[The paused June 2026 credit-pool change]** → still CLI-sanctioned, only
  metered differently; no code consequence, noted so nobody re-derives it.
- **[Per-turn spawn cost]** → negligible against turn length; measured once in
  the recorder and noted in the README.
- **[Capability/tool-prefs, scope model, DB]** → none, by construction: no
  papai tool surface or `tool_prefs` entry changes (this route's tool gating
  is the `--allowedTools` deny-by-default mapping inside the Actions job); no
  persisted state keyed by storage/config context, platform instance or user
  is created — backend selection is per-job environment, nothing crosses a job
  boundary, `AGENT_STATE` carries no backend field; no SQLite/drizzle change,
  so no migration or backfill exists to plan.

## Migration Plan

Rollout is config, not code motion: merge (the workflow edit is a maintainer
change — `agent-pipeline.yml` is a protected path the agent itself can never
commit, landed on the change branch before build-order step (6) so the
workflow pins are green through apply), then a repository sets the `AGENT_BACKEND` repository variable
(`vars.AGENT_BACKEND`) to `claude` and exactly one Anthropic secret — the
merged workflow already forwards it
route-gated (Decision 11), so no per-repository env editing is involved. Default route is byte-identical with the knob
unset, so every in-flight issue continues under the old behaviour; there is no
persisted state, no `STATE_VERSION` question, nothing to backfill. Rollback is
unsetting the knob (or reverting the merge); a claude-route job interrupted
mid-issue loses only its session continuity by design (no `~/.claude` state
survives a job), and the restored OpenCode route picks up from the same issue
blocks it always read.

## Open Questions

- The exact pinned CLI version is chosen when the fixtures are recorded (the
  then-current stable release); it lands in the workflow step and the README
  together. Nothing in the approach depends on which version it is.
- Whether the pinned CLI's `result` usage is per-invocation or
  session-cumulative: the recorder answers it, and the adapter sums or takes
  last accordingly (Decision 8) — the budget's meaning is unchanged either way.
- Whether the pinned CLI honors `CLAUDE_CONFIG_DIR` (verified at recording;
  job-scoped `HOME` is the one-line fallback — Decision 9).
