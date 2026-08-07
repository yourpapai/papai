# opencode-agent Workspace

## Purpose

`opencode-agent/` is a standalone Bun workspace holding a **spike**: an
event-driven GitHub Actions coding agent built on the OpenCode SDK and
obra/superpowers skills. It is not a papai runtime dependency and nothing under
`src/` imports it. Full behaviour, configuration and setup: `README.md`. Open
findings: `ROADMAP.md`.

## Shape

- One CI job = one call to `runCli`. State lives in hidden blocks on the issue,
  not on disk: `AGENT_STATE` for the machine, `AGENT_SPEC` / `AGENT_PLAN` /
  `AGENT_REPORT` for the artefacts.
- `src/triggers.ts` decides _whether and where_ an event moves the state;
  `src/orchestrator.ts` drives the phase cascade once that decision is made.
  Phase handlers in `src/phases/` return a `TransitionSignal`, a comment body and
  optional artefact blocks, and never write state or decide the next phase
  themselves.
- Every external boundary is an injected interface (`GitHubApi`, `Git`,
  `CheckRunner`, `RunReview`, `OpenCodeAgent`, `ReadSkillFile`).

## Local rules

- **Never scrape prose to recover an artefact.** Spec, plan and report travel in
  hidden blocks via `blocks.ts` / `artifacts.ts`. Heading-and-trailer scraping
  silently truncated specs at their first `---` rule; do not reintroduce it.
- **The review loop is `review-loop/`, not a local reimplementation.** Phase 3
  drives that workspace through `review-runner.ts`. `check-loop.ts` exists only
  for CI fixing, which the workspace does not cover.
- **One model endpoint.** Everything goes through `openai-config.ts`; there are
  no provider-specific keys and no second place a model is named. OpenCode is
  never handed the real key: `provider-proxy.ts` holds it and `contain()` in
  `index.ts` configures everything downstream with the placeholder, because the
  SDK puts the config into the spawned server's environment where `bash` can
  read it. Never pass `config.openai` to an OpenCode path — pass the contained
  settings. That proxy is also where **transient failures are retried**, because
  it is the one layer that sees a real HTTP status and the only one the review
  loop's subprocesses also pass through; do not add a second retry in the
  adapter, where the status is already gone.
- **Bounds go on the finished prompt, and on waiting.** `prompt-budget.ts` caps
  what reaches the model — per prompt, not per input, since a per-input cap
  bounds one log and nothing else. `deadline.ts` bounds waiting for a model turn;
  it cannot cancel the request and does not claim to. What both buy is a failure
  the pipeline can report, instead of a runner killed by `timeout-minutes`, which
  posts nothing at all.
- **Ask for JSON through `promptForJson`, not `agent.prompt` + `parseModelJson`.**
  It re-asks once with the validation complaint attached. Once, not until it
  works.
- **Capabilities are deny-by-default.** `openai-config.ts` grants tools by name
  on top of `"*": "deny"`, per agent profile: `plan` (the read-only phases)
  cannot edit or run commands, `build` can. Add a capability by naming it, never
  by widening the wildcard. Credentials are scrubbed from `process.env`
  (`secrets.ts`) before anything spawns, because the OpenCode server inherits it
  wholesale — so never reintroduce a code path that reads a secret from `env`
  after `runCli` has loaded config. Outbound text is redacted in `github.ts`, at
  the boundary: never move that into a renderer, and never add a `GitHubApi`
  method that sends free text without passing it through `clean`. `diff-guard.ts`
  inspects the index between `git add --all` and the commit; its `parseNumstat`
  fixtures are recorded from real git output, so re-record rather than adjust
  them by inspection.
- Untrusted text (issue bodies, comments, **check output**) must go through the
  envelope from `prompts.ts` before reaching a prompt, and commands must be
  spawned as argv vectors with `shell: false`. The envelope is only as good as
  its three legs: a random per-prompt id, neutralising _every_ delimiter-shaped
  run rather than the one that would have matched, and `composeSystemPrompt`
  stating the rule for that same id. `mintEnvelope()` is called once per handler
  and its `nonce` passed to both the system prompt and the user prompt — the
  `SystemPromptInput.nonce` field exists to make forgetting that a type error.
- No `await` inside a loop body (repo lint). Sequential iteration goes through
  `src/sequence.ts` (`mapSeries`, `firstMatch`) or tail recursion.
- One class per file: pipeline failures are constructed through the factories in
  `src/errors.ts` rather than new error subclasses.
- Tests live in `tests/opencode-agent/`, follow `tests/CLAUDE.md`, and must not
  touch the network. The one exception is `live-sdk.integration.ts`, which is
  deliberately not a `*.test.ts` so default discovery skips it; it needs the
  `opencode` CLI and is run via `bun run opencode-agent:test:live`.
- When a command test asserts an outcome, assert the **persisted state**, not
  just the returned status — a state that is never posted never happened.
- **The SDK response shapes are recorded, not guessed.** `decodeSessionId` and
  `decodeReply` decode `{ data, error }` through a schema; the fixtures in
  `adapters.test.ts` come from a live run. When the `@opencode-ai/sdk` pin moves,
  re-run the live check and re-record rather than adjusting the decoders by
  inspection.

## Dependencies

- `@octokit/rest` — GitHub REST access, behind `src/github.ts`.
- `@opencode-ai/sdk` — headless OpenCode server + session, behind
  `src/opencode-adapter.ts`.
- `zod` — payload, config and model-reply validation (shared with root).

The first two sit in `devDependencies` even though the pipeline needs them at
run time: this workspace is developer tooling that never runs inside the papai
container, and the Dockerfile's `prod-deps` stage installs with `--production`.
The Actions workflow runs a plain `bun install --frozen-lockfile`, so both are
present there.

The workflow additionally installs the `opencode` CLI (the review-loop workspace
shells out to `opencode run`) and checks out `obra/superpowers` to `.superpowers/`.
Both of those paths, plus the generated `.opencode-agent/` run inputs, are
gitignored — `git add --all` in the implement phase would otherwise commit them.
