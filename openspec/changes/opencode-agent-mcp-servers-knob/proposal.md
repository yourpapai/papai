# MCP servers knob for the opencode-agent pipeline

## Why

The MCP integration research (`opencode-agent/docs/mcp-integration-research.md`, change
`opencode-agent-mcp-integration-research`) enumerated every surface a user could declare
MCP servers on and recommended one: an `AGENT_*` env knob merged inside
`buildOpencodeConfig` — least user knowledge, no PR trust edge, best failure shape, both
execution paths by construction. The pipeline has no MCP support today; this change
implements that recommendation.

## What Changes

- New knob **`AGENT_MCP_SERVERS`** (JSON, repository Actions variable or secret): `local`
  (`command`, `environment`) and `remote` (`url`, `headers`) entries, parsed and validated
  at job start in a new `opencode-agent/src/mcp-servers.ts` — the `check-spec.ts` pattern,
  the second non-scalar knob. An `oauth` object is refused at parse; the emitted config
  always forces `oauth: false` on remotes (an OAuth remote parks at `needs_auth` forever —
  verified, research §2.5).
- `buildOpencodeConfig` (`opencode-agent/src/openai-config.ts`) emits the `mcp` block and
  **generated** `"<name>_*": "allow"` grant keys in the `plan` and `build` profile maps
  and the global default, per the maintainer decision (all profiles) — grants are
  generated, never hand-keyed, because a bare server name is a silent no-op (verified,
  §2.4). `propose` gets no MCP grant (design decision D1). Both execution paths (the
  in-process session and the review loop's `OPENCODE_CONFIG_CONTENT`) carry the block by
  construction.
- `pipelineSecrets` (`opencode-agent/src/secrets.ts`) collects every `headers` and
  `environment` value, so the environment scrub and outbound redaction cover MCP
  credentials by value.
- Workflow: one `env:` line forwarding
  `secrets.AGENT_MCP_SERVERS || vars.AGENT_MCP_SERVERS` — token-bearing values belong in
  a secret (registered secrets get log masking), token-free ones may live in a variable.
- README knob-table entry: the JSON shape, the OAuth prohibition, the model-readability
  of config content (one `echo` away, S3-9), and the review-loop fan-out cost (each
  `opencode run` subprocess boots its own local-server copies).

## Capabilities

### New Capabilities

- `opencode-agent-mcp-servers-knob`: parsing, validation, emission, permission grants
  and credential scrubbing for the `AGENT_MCP_SERVERS` knob. Without it the pipeline
  cannot use MCP servers at all: no knob exists to declare them, the emitted config
  carries no `mcp` block, and MCP tools stay denied by the deny-by-default profiles even
  if a server were configured by other means (verified, research §2.1).

### Modified Capabilities

None — `openspec/specs/` is empty. The predecessor research change carried its own spec;
this change implements its recommendation without modifying it.

## Impact

- Code: `opencode-agent/src/mcp-servers.ts` (new), `openai-config.ts`, `config-shape.ts`
  /`config.ts` (the knob rides `OpenAiSettings`, as `profiles` does), `secrets.ts`,
  `.github/workflows/agent-pipeline.yml` (protected path — one maintainer-merged line),
  `opencode-agent/README.md`. Extends existing modules throughout (`check-spec.ts` for
  non-scalar parsing, `buildOpencodeConfig` as the single seam, `pipelineSecrets` for
  secrets); no existing module covers MCP emission.
- No platform/task instances, no SQLite, no scope-model impact: `opencode-agent/` is
  standalone developer tooling; the knob is repository-scoped Actions configuration
  writable by maintainers only — the no-PR-trust-edge property the research ranked it
  for. No root `docs/architecture/*.md` page is affected; the workspace README and
  `CLAUDE.md` are.
- Known accepted risk: until deferred containment lands, knob credentials are
  model-readable via `OPENCODE_CONFIG_CONTENT` (S3-9); guidance is unauthenticated
  local servers or afford-to-expose static tokens.

## Non-goals

- Per-server/per-profile opt-out knob (deferred maintainer decision; the shape is
  grant-all-configured).
- Credential containment for MCP `headers`/`environment` — no per-server loopback proxy;
  `pipelineSecrets` wiring only, risk documented above.
- Repo-committed config file surfaces, plain or with secret `$PLACEHOLDER` interpolation
  (blocked on the merge-vs-override experiment / parked per the exploration; remote-only
  shape if ever built).
- Status surfacing of failed servers — silent degradation per research §2.2; no
  `GET /mcp` poller (30 s floor).
- Teardown handling for orphaned MCP stdio children (`close()` orphans them — accepted,
  documented; the ephemeral runner absorbs it).
