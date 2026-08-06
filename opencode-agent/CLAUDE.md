# opencode-agent Workspace

## Purpose

`opencode-agent/` is a standalone Bun workspace holding a **spike**: an
event-driven GitHub Actions coding agent built on the OpenCode SDK and
obra/superpowers skills. It is not a papai runtime dependency and nothing under
`src/` imports it. Full behaviour, configuration and setup: `README.md`.

## Shape

- One CI job = one call to `runCli`. State lives in hidden
  `<!-- AGENT_STATE: {...} -->` blocks on the issue, not on disk.
- `src/orchestrator.ts` owns the state machine; phase handlers in `src/phases/`
  return a `TransitionSignal` and a comment body and never write state or decide
  the next phase themselves.
- Every external boundary is an injected interface (`GitHubApi`, `Git`,
  `CheckRunner`, `OpenCodeAgent`, `ReadSkillFile`), so the whole pipeline runs
  against fakes.

## Scripts

Run from the repo root:

- `bun run opencode-agent:test`
- `bun run opencode-agent:typecheck`
- `bun run opencode-agent:lint`
- `bun run opencode-agent:format:check`
- `bun run opencode-agent:start -- --event-path <file> --event-name <name>`

## Local rules

- No `await` inside a loop body (repo lint). Sequential iteration goes through
  `src/sequence.ts` (`mapSeries`, `firstMatch`) or tail recursion — see the
  round loops in `src/review-loop.ts` and the cascade in `src/orchestrator.ts`.
- One class per file: pipeline failures are constructed through the factories in
  `src/errors.ts` rather than new error subclasses.
- Untrusted text (issue bodies, comments) must be wrapped with `asUntrusted()`
  from `src/prompts.ts` before it reaches a prompt, and commands must be spawned
  as argv vectors with `shell: false`.
- Tests live in `tests/opencode-agent/`, follow `tests/CLAUDE.md`, and must not
  touch the network.

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
