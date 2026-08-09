<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# MCP integration research

How the opencode-agent pipeline could attach external MCP servers to the
OpenCode sessions it spawns: what the SDK's config surface allows, what the
`opencode` binary actually does with it, which configuration surface would
carry that for a maintainer, and what the CI environment's constraints do to
each candidate.

## Scope

This is a **research document only**. It changes no production code, no
workflow, no configuration. Its one job is to record what was found — from the
pinned SDK types, from live runs of the `opencode` binary, and from the CI
constraints already recorded in `ROADMAP.md` — so a later implementation step
can be planned against evidence rather than guessed at.

## Maintainer decisions in force

Recorded here so every section below evaluates against the same brief:

- **MCP tools are granted to all profiles.** If an MCP server is configured,
  its tools are allowed in every agent profile (`plan` and `build` alike); the
  deny-by-default capability model in `openai-config.ts` gains a grant shape
  that covers them, not a per-profile pick-and-choose.
- **Per-server opt-out is deferred and out of scope for this document's
  recommendation.** It is listed as a follow-up, not designed here.

## Confidence labelling

Every behavioural claim in this document carries one of two labels, the same
convention the sibling documents use:

- **verified** — observed against the real `opencode` binary (or read from a
  pinned file whose exact lines are cited), with the command or method stated.
- **by inspection** — derived from reading source, types or docs without a
  live run; the claim is as strong as the file it cites and no stronger.

Any claim not derivable from the cited material is labelled **by inspection**
explicitly, so a reader can weigh it accordingly.
