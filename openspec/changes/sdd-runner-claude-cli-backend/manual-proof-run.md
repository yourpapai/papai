# Manual proof run — NOT YET PERFORMED

**Status: outstanding.** This change's one piece of end-to-end evidence is a
credentialed manual run on the claude route. It has not been done, and this
file is the placeholder for it, not the record of it. Nothing below is an
observation; the tables are empty on purpose.

The task that produced this branch ran inside GitHub Actions (`CI=true`), where
the proof run is explicitly forbidden by the proposal ("never in CI") and was
impossible anyway: the job carries neither `ANTHROPIC_API_KEY` nor
`CLAUDE_CODE_OAUTH_TOKEN`, and a real run would spend real money against a
subscription or API key that CI has no business holding. Everything the route
does *is* covered by unit tests over injected seams — argv and child-env
composition per role, the credential guard's refusals by code, the allowlist
mapping, the continuation skip, the config-dir parent's location and teardown,
and the decoded `result` line's cost chain. What no unit test can show is that
the pinned CLI, invoked exactly as composed here, actually drives the pipeline
to a gate. That is what this run is for.

## How to perform it

On a workstation, not CI:

1. Install the pinned CLI: `@anthropic-ai/claude-code@2.1.251` (the version the
   fixture corpus and allowlist doctrine were recorded against).
2. Export exactly one of `ANTHROPIC_API_KEY` (bare profile) or
   `CLAUDE_CODE_OAUTH_TOKEN` (native profile). Unset `LLM_API_KEY`.
3. Set `"backend": "claude"` in the runner `config.json`, keeping the `model`
   value's `provider/model` prefix.
4. Pick a genuinely small task (depth S is enough — the point is reaching a
   gate, not exercising decomposition) and run:
   `bun run sdd-runner:start -- <task-file> --depth S`
5. Let it reach its gate. Do not settle the gate before capturing the notes.

## What to record here

Replace this section with the observed values:

- **Route and profile** — the credential spelling used and the profile it
  resolved to.
- **Argv** — one composed `claude` invocation verbatim from a transcript,
  with the credential value redacted. Confirm the profile block, the streaming
  tail, `--permission-mode default`, the role's allowlist and the
  prefix-stripped model id all appear as composed.
- **Per-role allowlists** — that the drafter/resolver spawns carried the
  authoring set and the reviewer/skeptic spawns the analysis set, and that no
  spawn carried `Bash`.
- **Spend** — the gate digest's `### Cost / duration` line, including its
  metered/estimated/unknown marker, and whether the figure came from the CLI's
  own `total_cost_usd` or from repricing.
- **Gate digest** — the run id and the `gate-<n>.md` path, plus confirmation
  that the digest rendered with the same shape as an opencode-route run.
- **Anything that diverged** from what the tests assert. A divergence here is
  a finding against the change, not a note to smooth over.

## Until then

The claude route should be treated as unproven end to end. The `opencode`
default is untouched and is pinned byte-identical by
`tests/sdd-runner/agent-layer.test.ts`, so shipping this change does not put
existing runs at risk — but the first operator to set `"backend": "claude"` is
performing this run whether or not it has been written down here.
