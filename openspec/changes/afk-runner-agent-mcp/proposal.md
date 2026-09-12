<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: afk-runner-agent-mcp

## Why

afk-runner's stage agents spawn bare: the runner delivers no config, so
agents have zero MCP servers and the `--model` reference resolves only if
ambient config defines the provider (verified, research §1.1). The
verified research (`docs/architecture/afk-runner-mcp-research.md` §5)
settles the route: a per-spawn `OPENCODE_CONFIG_CONTENT` builder fed by an
operator knob — options (a)+(c) as one two-layer design — is the only
surface verified live on the spawn shape, authoritative over ambient config,
per-role composable, and validated at start.

## What Changes

- A per-spawn config builder at the seam that already holds role and model
  (`afk-runner/src/agent-layer.ts`, beside `modelFor`), composing the provider
  block, per-name permission keys over the base map (`<server>_*: "allow"` for
  granted servers, `<server>_*: "deny"` for shed servers), and the `mcp` map,
  serialized into the child environment.
- Server set: a global base map plus optional per-role narrowing — checking
  roles (reviewer, skeptic) shed the work servers drafter/decomposer/atomicity
  carry — role keys validated against `AgentRoleSchema`.
- The content reaches children as an explicit option threaded through
  review-loop's `buildAgentCommand` (the opencode branch inherits
  `process.env` today; the builder never reads ambient env).
- Dead-server visibility: L0/L1 agent-noise events under §4.2's payload
  discipline (names, statuses, counts — never environments, headers, or
  token-bearing URLs); a failed server degrades to bounded status data,
  never failing the run.
- Config surface deliberately open: design decides between an operator knob
  parsed-and-refused at start or keys beside the strict five-key runner
  config schema. Either way, present-but-invalid configuration fails the
  run-starting verbs before any spawn or spend, naming the offending key.
- Inherited as decided, not re-litigated: untrusted input never defines a
  server; grants are allow-or-absent; the §1.2 precedence facts (delivered
  content overlays discovered files and wins every same-key conflict).

## Capabilities

### New Capabilities

- `afk-runner-agent-mcp`: the afk-runner agent MCP injection surface — config
  composition, per-role server-set narrowing, env threading to opencode
  children, invalid-config refusal, and dead-server degradation events.
  Without it, runner agents keep zero MCP access and their provider
  resolution stays hostage to ambient config. No existing capability covers
  this: `afk-runner-execution` governs the spawn walk, not what the spawn
  carries; the sibling `opencode-agent`'s `mcp-servers.ts` is precedent only,
  outside afk-runner.

### Modified Capabilities

(none — the spawn seam's requirements are unchanged; review-loop threading is
implementation, not requirement change.)

## Impact

- Code: `afk-runner/src/agent-layer.ts`, new modules `mcp-servers.ts` +
  `agent-config.ts`, `agent-noise-schemas.ts`, spawn threading through
  `cli.ts`/`run.ts`/the graph agent factories, review-loop's
  `agent-command.ts` + `agent-runner.ts`.
- Platform/task instances: none — no papai chat or task provider is touched.
  Scope impact: none; config keys are per-invocation environment at the
  runner level, outside papai's scope model; no persisted state, no DB
  migration, no new packages (rides the pinned opencode binary).
- Docs: `docs/architecture/afk-runner.md`, status note in
  `docs/architecture/afk-runner-mcp-research.md`.

## Non-goals

- Credential containment for the content route (named follow-up; until it
  lands, prefer servers needing no credential in the content).
- Repo-local `opencode.json` as the mechanism (checked-in complement only).
- The claude `--mcp-config` route and its backend-threading prerequisite.
- Per-server opt-out; new failure kinds, settle outcomes, or budget semantics.
