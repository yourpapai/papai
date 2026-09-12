<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Custom Claude environment variables for the opencode agent

## Context

See `proposal.md` — Goal and Intended behaviour change; the behavioural contract is
`specs/agent-claude-custom-environment/spec.md`. The proposal's assumption section
already vetoes the settings-document passthrough (the pinned `--setting-sources ''`
neutralization and the zero-spend recording a `--settings` composition would owe); this
design does not revisit it. `effortLevel` is already served by the effort tiers.

Three code facts shape the seams:

- `childEnv` in `claude-connect.ts` is the one place the CLI child's environment is
  assembled: post-scrub `process.env` → name strip (`STRIPPED_NAMES`) → the profile
  credential re-add → `DISABLE_AUTOUPDATER=1` → `CLAUDE_CONFIG_DIR`. Precedence is an
  **ordering** fact inside one pure function, which is why the merge point below is a
  design decision and not an implementation detail.
- `pipelineSecrets` in `secrets.ts` is the one credential list the environment scrub and
  the outbound redaction read — but the claude session redacts its transcript lines and
  stderr through its own `credentialValues` list (today exactly the credential's value).
  Knob values have to reach both sites or the redaction story forks.
- The claude adapter takes **plain values** across its seam, never the `OpenAiSettings`
  object (design D5 of the native-OAuth change) — so the knob cannot ride the settings
  object the way `mcpServers` does.

`config-values.ts` stays scalar-only by its own stated seam; `mcp-servers.ts` is the
existing arrangement for a non-scalar, document-shaped knob and none of the existing
modules covers this one.

## Goals / Non-Goals

**Goals:**

- One operator knob, validated at job start, whose entries reach every `claude -p`
  child environment on the claude route with route-owned precedence fixed by
  construction — and an unset knob producing a byte-identical child env (asserted).
- Knob values wired into the one credential machinery that already exists: value-based
  scrub, outbound redaction, transcript redaction — no second secret mechanism.
- Route scoping that cannot leak: the knob never reaches the OpenCode config builder,
  the review-loop subprocess environments, or any other route surface.

**Non-Goals:**

- Everything in `proposal.md` — Non-goals (settings-document passthrough, review-loop
  delivery, secret delivery through the knob).
- Extending `STRIPPED_NAMES` or changing the value-based scrub: the proposal pins
  "nothing above the seam changes". The knob is delivered by explicit merge, not by
  loosening what the route strips. (The hygiene follow-up this leaves open is in
  Risks.)
- Validating the CLI's variable surface — the pipeline refuses only what **it** owns
  (D6); which `CLAUDE_CODE_*` variables the pinned CLI honours is the CLI's business.

## Decisions

### D1 — Own module `claude-env-knob.ts`, the `mcp-servers.ts` arrangement; parse always, apply on the claude route only

`AGENT_CLAUDE_ENV` is the third non-scalar knob. The parser gets its own module —
`safeJson` naming the syntax error, a rule-first refusal pass, then a Zod
`z.record(z.string(), z.string())` shape — re-exported through `config-values.ts` the
way `parseMcpServers` is, so callers keep naming one module. Refusals are
**route-independent**: malformed JSON, a non-object and non-string values fail job
startup on both backends (an operator flipping `AGENT_BACKEND` later must not inherit a
document that was never validated), while the parsed entries are *applied* only on the
claude route. Empty-string values are accepted — `VAR=` is a legitimate spelling for
"explicitly empty", unlike the MCP `command` rule where a blank word is a command that
can never run — and the `MIN_SECRET_LENGTH` filter keeps them off the credential list
regardless.

### D2 — The parsed knob rides `PipelineConfig` as a top-level field, not `OpenAiSettings`

`mcpServers` rides `OpenAiSettings` because both execution paths read the one config
builder. This knob is claude-route-only and must stay **out** of that builder: a field
on the settings object is one spread away from `OPENCODE_CONFIG_CONTENT` and the
review-loop subprocesses, which the spec forbids. `PipelineConfig.claudeEnv:
Record<string, string> | null` (`null` = unset/blank, the house absence shape) is read
in `loadConfig`'s backend block ahead of every spawn and every model spend, beside the
reads it is scoped like. `config-backend-values.ts` is expected to need no edit — the
read sits in the backend block `config.ts` already owns; the proposal lists the file
for adjacency, not necessity.
*Alternative — ride `OpenAiSettings` beside `mcpServers` for symmetry:* rejected;
symmetry with the one object this knob must never contaminate is the bug shape here.

### D3 — Merge inside `childEnv`, after the name strip and before the credential re-add; refused set explicit and behavior-pinned

`ClaudeSpawnRequest` gains an optional `customEnv: Record<string, string>`; `childEnv`
folds it in between the strip and the credential re-add. That ordering **is** the
precedence contract: the credential re-add, `DISABLE_AUTOUPDATER` and
`CLAUDE_CONFIG_DIR` are written after the fold, so the route's values win by
construction even before the refusal list is consulted — the refused set is the
operator-facing rule, the order is the defence in depth behind it. The refused set is
an exported constant in the knob module (the union of `STRIPPED_NAMES` and the names
the route injects), and it is pinned by **behaviour** tests, not just a constant
comparison: a test asserts every `STRIPPED_NAMES` member is refused, and the
`childEnv` merge-order test proves the route's own values win for the injected names —
so drift in either list fails a test the day it happens.
*Alternative — single-source the list from `claude-connect.ts`:* rejected; config
loading would then import the spawn layer (`node:child_process` graph) and invert the
layering for one array. *Alternative — merge after the credential re-add:* rejected;
it makes the credential losable to a custom entry, which is exactly the shadowing the
spec refuses.

### D4 — Knob values join the one credential list, at both redaction sites

`secrets.ts` gains a `claudeEnvSecrets` collector beside `mcpSecrets`, appended in
`pipelineSecrets` — that covers the value-based scrub and every outbound redaction
that reads the pipeline list. The claude session's own redaction list
(`credentialValues`, used for transcript lines and stderr) gains the knob values too;
without that second site the claude route's transcript would be the one place a knob
value survived. The `MIN_SECRET_LENGTH` doctrine is unchanged: a short value is not
made dangerous by being listed, and the filter governs. The raw knob variable itself is
neither logged nor emitted anywhere.
*Alternative — hand the claude session the whole `pipelineSecrets` list:* rejected for
this change; it would widen the session's redaction beyond the credential + knob values
the proposal scopes (an improvement worth its own decision, not a side effect).

### D5 — Workflow spelling: `vars.AGENT_CLAUDE_ENV` only, and the line cannot ride this pipeline's commits

The forwarding line — `AGENT_CLAUDE_ENV: ${{ vars.AGENT_CLAUDE_ENV }}` in the pipeline
step's `env:` block, beside the other `vars.*` forwardings — is deliberately
**variable-only**: values reach a child environment the CLI's `Bash` children inherit,
so secret delivery through this knob is refused by policy and credentials stay on
their dedicated secret spellings. A same-named Actions secret reaches no job. The
proposed edit sits under `.github/workflows/`, a protected path this pipeline's own
token can never push — and this change is being drafted by that pipeline, so the line
is applied by a maintainer by hand (exact line in Migration Plan); until then the knob
is simply never set, which is the unset case. `tests/opencode-agent/workflow.test.ts`
pins parts of the workflow and must stay green across the hand edit.

### D6 — The pipeline validates shape and route ownership, never the CLI's variable surface

The refusal list is exactly the names **this route** strips or injects. No allowlist of
"variables the pinned Claude CLI knows" exists: that list rots with every CLI release,
a stale one refuses working tuning variables, and the CLI itself already ignores
unknown names silently. The README carries the motivating examples
(`CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING`, `CLAUDE_CODE_SUBAGENT_MODEL`, …) as guidance,
not validation.
*Alternative — enumerate known `CLAUDE_CODE_*` names and refuse unknowns:* rejected;
strictness here buys a failure mode worse than the typo it catches.

## Capability gating, scope model, dependencies, hooks

- **Gating:** no tool surface and no `tool_prefs` involvement — this workspace has no
  chat-platform scope model, and the claude route's permissions are the CLI's own
  allowlists, which the spec pins unchanged. Papai's tool gating, plugins and `src/mcp/`
  are untouched; nothing under papai's `src/` imports this workspace.
- **Scope model:** no persisted state of any kind — no storage/config context ids, no
  platform instance, no user keying, no DB rows, no `STATE_VERSION` interest. The knob
  lives in repository Actions settings; the run's relationship to it is read-at-load.
- **DB / dependencies:** no migration, no new dependency. Zod is already the
  workspace's config-boundary validator; `JSON.parse` plus the existing
  `ConfigError`/`ConfigValueError` family covers the refusals, and nothing else is
  needed.
- **New module:** `claude-env-knob.ts` — `mcp-servers.ts` covers MCP declarations
  specifically and `config-values.ts` is scalar-only by its own seam; no existing
  module covers this knob, and the arrangement copies the one that does this job.
- **Hooks / TDD:** the Write/Edit TDD hook pipeline gates the new
  `opencode-agent/src/claude-env-knob.ts` and every edited file (`claude-connect.ts`,
  `claude-adapter.ts`, `contain.ts`, `config.ts`, `config-shape.ts`, `secrets.ts`,
  `README.md`). Test-first order: (1) `tests/opencode-agent/claude-env-knob.test.ts` —
  unset/blank → `undefined`, invalid JSON / non-object / non-string refusals, every
  refused name, every-`STRIPPED_NAMES`-member pin; (2) `childEnv` merge assertions in
  the existing claude-connect suite — entries present, route values win, unset knob
  byte-identical, merge order proven; (3) the adapter spawn-seam case — the recorded
  spawn receives the merged env through `ClaudeSpawnRequest`; (4) a `pipelineSecrets`
  collection case; (5) loadConfig / config-shape assertions. The new source file
  enters the Stryker per-file ratchet when the PR measures it.

## Risks / Trade-offs

- [A knob value is readable by the CLI's `Bash` children — the model can `env` it.]
  → Documented residual; secret delivery through the knob is refused by policy
  (variable-only spelling, D5), the values join the credential list so every pipeline
  output stays clean, and credentials keep their dedicated spellings.
- [The raw `AGENT_CLAUDE_ENV` document rides the post-scrub environment wholesale, so a
  value embedded in the document — as opposed to a standalone spelling — is invisible
  to the value-based scrub on routes where the knob is inert.] → Same exposure class
  `AGENT_MCP_SERVERS`'s name-strip closes; this change pins the strip list unchanged
  (Non-Goals), so it is mitigated by the README's secrets-don't-belong-here guidance
  and left as a one-line hygiene follow-up (add the knob's own name to
  `STRIPPED_NAMES`) with its own proposal if wanted.
- [A future route injection is forgotten in the refused set.] → Behaviour pins, not
  constant comparisons (D3): the refusal test walks `STRIPPED_NAMES`, and the
  merge-order test proves route values win regardless — a new injection must update a
  test, not a comment.
- [Malformed knob fails jobs on the opencode route, where the knob does nothing.] →
  Deliberate (D1, parse-always): a broken document fails loudly at start instead of
  lurking until someone flips `AGENT_BACKEND`; mirrors `AGENT_MCP_SERVERS`.
- [The CLI silently ignores a mistyped variable name.] → Accepted (D6): no
  CLI-surface allowlist; the README lists the motivating variables, and the refusal
  list stays limited to what the pipeline owns.
- [The hand-applied workflow line is missed, leaving the knob silently inert.] →
  README states the variable takes effect only with the forwarding line; inert-until-
  applied is exactly the tested unset case, so nothing degrades — it merely does
  nothing.

## Migration Plan

Additive. An unset knob is byte-identical to today at every seam (asserted by test);
no persisted state, no state-block shape change, no `STATE_VERSION` interest. Rollback
is revert plus deleting the repository variable. The one piece this pipeline cannot
deliver is the workflow forwarding line — a maintainer applies it by hand:

```yaml
          AGENT_CLAUDE_ENV: ${{ vars.AGENT_CLAUDE_ENV }}
```

in the pipeline step's `env:` block (beside `AGENT_EFFORT_PLAN` and the other `vars.*`
forwardings), keeping `workflow.test.ts` green. Until that line lands the knob is
unset-and-inert, which is the tested baseline. The README entry lands with the code.

## Open Questions

None — the deferrable items (settings-document passthrough, review-loop delivery,
`STRIPPED_NAMES` hygiene) are proposal Non-goals or named follow-ups, and reopening
any of them would change scope, not approach.
