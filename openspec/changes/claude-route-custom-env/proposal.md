# Custom Claude environment variables for the opencode agent

## Goal

`AGENT_BACKEND=claude` spawns `claude -p` per turn with a child environment the pipeline fully controls (`childEnv` in `opencode-agent/src/claude-connect.ts`: post-scrub `process.env` + the profile-spelled credential + `DISABLE_AUTOUPDATER=1` + `CLAUDE_CONFIG_DIR`). Today an operator has no way to pass Claude Code's own tuning variables — `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING`, `CLAUDE_CODE_DISABLE_1M_CONTEXT`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_NO_FLICKER`, `CLAUDE_AFK_TIMEOUT_MS`, … — to that child.

Add one operator knob, `AGENT_CLAUDE_ENV`: a JSON object (repository variable) mapping env-var name → string value, merged into every claude CLI child environment on the claude route. Unset or blank keeps every spawn byte-identical to today. This is the mechanism the issue's `env` block asks for; the pinned invocation composition (profiles, allowlists, neutralization flags, census pins) is unchanged.

**Assumption (veto at the DESIGN_SPEC park):** scope is environment variables only. The settings-document keys in the issue's example (`attribution`, `alwaysThinkingEnabled`, `modelSettings`) are not deliverable this way — settings files are deliberately neutralized on the native profile (`--setting-sources ''`), and a `--settings`-file composition would need a zero-spend recording against the pinned CLI (`claude-stub` lane) on both profiles before any credentialed turn; that is its own proposal. `effortLevel` is already served by `AGENT_EFFORT_PLAN`/`AGENT_EFFORT_BUILD` → `--effort`.

## Capabilities

New capability `agent-claude-custom-environment` (the claude route's operator-controlled child environment; `openspec/specs/` holds no archived corpus, so new capabilities only).

## Files to touch

- `opencode-agent/src/claude-env-knob.ts` (new) — parse + refusal rules, the `mcp-servers.ts` arrangement for this knob (its own module; `config-values.ts` stays scalar-only).
- `opencode-agent/src/config.ts` / `config-shape.ts` / `config-backend-values.ts` — read at job start alongside the other backend reads, carried on `PipelineConfig`; parsed whenever set (JSON errors fail loudly on either route, like `AGENT_MCP_SERVERS`), applied only on the claude route.
- `opencode-agent/src/claude-connect.ts` — extend `ClaudeSpawnRequest`; merge in `childEnv` after the name strip and **before** the profile credential re-add.
- `opencode-agent/src/claude-adapter.ts` + `opencode-agent/src/contain.ts` — plumb config → spawn request.
- `opencode-agent/src/secrets.ts` — knob values join the pipeline credential list (value-based scrub + transcript redaction), same doctrine as `AGENT_MCP_SERVERS` `headers`/`environment`.
- `.github/workflows/agent-pipeline.yml` — forward `AGENT_CLAUDE_ENV: ${{ vars.AGENT_CLAUDE_ENV }}` in the pipeline step's env (the install step's `env.AGENT_BACKEND` gate pattern).
- `opencode-agent/README.md` — document the knob in the claude-route section: route-scoped, JSON shape, refused names, values are readable by the CLI's `Bash` children (the documented residual), and that secrets do not belong in a repository variable.

## Intended behaviour change

- **Claude route, knob set:** every `claude -p` spawn's environment additionally carries the operator's variables. Precedence is fixed: the route's own injections always win — refused names fail at job start (`AGENT_CLAUDE_ENV` may not set `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`, `DISABLE_AUTOUPDATER`, `LLM_BASE_URL`, `AGENT_MCP_SERVERS` — everything the route strips (`STRIPPED_NAMES`) or injects itself; the refusal names the rule, not a schema path). The profile credential re-add runs after the merge, so a custom entry can never shadow the credential that selects the profile.
- **Claude route, knob unset/blank:** byte-identical child env to today.
- **OpenCode route:** the knob is parsed if set (so malformed JSON fails the job, not a spawn) and otherwise inert — route-scoped like `LLM_PROVIDER`.
- Nothing above the seam changes: argv, profiles, allowlists, scrub, group kill, teardown, budgets.

## Verification

- Unit tests for the knob: unset/blank → `undefined`; invalid JSON and non-`string` values refused with named errors; each refused name rejected.
- Unit tests for `childEnv`: custom variable present on the merged env; custom values cannot override the credential spellings, `CLAUDE_CONFIG_DIR` or `DISABLE_AUTOUPDATER`; unset knob produces an env byte-identical to the current build; merge order proven (credential re-add wins).
- Adapter spawn-seam test: recorded spawn receives the merged env through `ClaudeSpawnRequest`.
- Full suite green; `bun workflows:lint` for the workflow edit; mutation ratchet passes on the touched files.

## Non-goals

- A full Claude Code **settings-document** passthrough (`attribution`, `alwaysThinkingEnabled`, `modelSettings`) — needs the zero-spend `--settings` composition recording described above; revisit as its own proposal.
- The review loop's claude subprocesses (`/review` on the claude route) do not receive the knob in this change — their env carries only the job's credential today; extending them is a follow-up decision.
- Secret delivery through this knob — values live in a repository variable and reach a child environment the CLI's `Bash` children inherit; credentials stay on their dedicated secret spellings.
