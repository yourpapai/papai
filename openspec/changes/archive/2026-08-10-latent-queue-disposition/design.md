<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Latent queue disposition

Motivation and scope: see `proposal.md`. Predecessor artifact:
`superpowers-residue-cleanup` (the report-only triage, design D4) whose
commit `f2af3d2c4` recorded the two "Lane 1 or Lane 3, user gate" findings
this change now dispositions.

## Context

Two latent drafts in the frozen `docs/superpowers/` tree were left undecided
by the cleanup change. Verified current state:

- `chat-provider-as-plugin` (`specs/2026-05-23-chat-provider-as-plugin-design.md`)
  — unshipped; its stated blocker (ChatRouter, `platform_instances`) cleared,
  sibling task-provider spec landed. The in-flight `plugin-core-separation`
  refactor + hermetic E2E harness (the "global refactoring" track per archived
  `docs/archive/2026-07-12-hermetic-full-stack-e2e-harness-design.md`) now
  actively reshapes the same core/plugin boundary. A stale `chat-as-plugin`
  branch exists (last 2026-06-05, 3883-file divergence vs master) — unusable
  as-is.
- `llm-rate-limiting-and-plans` (3-file cluster: `notes/…-plans.md`,
  `notes/…-plans-phases.md`, `specs/2026-05-21-…-design.md`) — unshipped; no
  `src/quota/`, no plan/quota tables. ~2.8 mo old; grounding stale.

## Goals / Non-Goals

**Goals:** record both dispositions as first-class ADRs (not buried banner
notes); act on the retire side by archiving the rate-limit cluster; leave the
deferred chat-provider draft exactly where reachable thinking lives.

**Non-goals:** see proposal Non-goals — no adoption, no re-design, no branch
revival, no runtime impact.

## Decisions

### D1 — chat-provider: defer-in-place (frozen tree), not archive

The draft stays in `docs/superpowers/specs/`. Alternatives rejected: (a)
archive to `docs/archive/` — would signal "historical/done", wrong for a
deferred item whose re-evaluation is pending and may still yield adoption;
(b) delete — loses the thinking the post-refactor re-evaluation needs; (c)
port into an OpenSpec change now — collides with the active refactor, the
core reason for deferral. The revisit trigger is recorded sharply in ADR-0380
so "defer" does not become a perpetual non-decision.

### D2 — rate-limit: archive to `docs/archive/`, not delete

The 3-file cluster moves to `docs/archive/` together. Alternatives rejected:
(a) delete outright — loses reference value for the eventual fresh research
(the design's failure modes and algorithm survey remain useful even if the
grounding is stale); (b) defer-in-place like chat-provider — the user's
disposition is retire, and leaving it in the live legacy tree keeps a "maybe"
alive that the retire decision explicitly closes. `docs/archive/` is the
established home for historical-but-readable design docs (precedent: the tier
roadmap and hermetic-harness design live there).

### D3 — two ADRs (0380/0381), not one

The dispositions are unrelated (different domains, different statuses —
Deferred vs Retired). A single combined ADR would conflate two independent
decisions and obscure each. Numbering follows sequentially after 0379.
Status conventions match the repo's existing ADRs (e.g. 0379: `## Status`
field). ADR-0380 uses status **Deferred** with an explicit revisit trigger;
ADR-0381 uses **Retired** with the archive location noted.

### D4 — rate-limit cluster flattens into `docs/archive/`; cross-dir links rewritten

`docs/archive/` is flat by convention (no subdirs; dated-filename pattern).
All three files land together at the top of `docs/archive/`. Their internal
links then resolve as follows: the phases companion's `./<note>.md` link
already works (same dir). The design spec (`2026-05-21-…`) has **five**
`../notes/<file>.md` references — written when it lived in `specs/` — that
would break under flattening; these are rewritten to `./<file>.md` (co-located)
in the same move. After that, every internal link in the cluster resolves.
The single in-tree external reference — `superpowers-residue-cleanup`'s own
(historical) findings — points at the old path; that reference is itself
historical record and is not rewritten (matching the cleanup change's policy
of not editing historical artifacts).

### D5 — README index + license headers

Each new ADR gets the standard BUSL-1.1 header and a row in
`docs/adr/README.md`'s index table (Date, Implementation Status = Deferred /
Retired, Last Commit filled at land time). No other README changes.

## Risks / Trade-offs

- **Future agent misses the defer trigger and re-asks "what about
  chat-provider?"** → Mitigation: ADR-0380 is first-class and indexed; its
  revisit trigger names the concrete condition (post `plugin-core-separation`
  - hermetic proof landing) and the action (re-evaluate supersession vs
    focused migration; do not revive the stale branch).
- **Stale `chat-as-plugin` branch misleads a future contributor into building
  on it** → Mitigation: ADR-0380 records its unusable divergence explicitly.
- **Archived rate-limit draft is later mistaken for current direction** →
  Mitigation: `docs/archive/` banner + ADR-0381's Retired status make the
  "historical, supersede-by-fresh-research" posture explicit.
- **Relative-link breakage on move** → Mitigation: D4 — flatten together and
  rewrite the design spec's five `../notes/` references to `./` post-move;
  verified by a post-move grep in tasks.

## Migration Plan

1. Write ADR-0380 (chat-provider defer) + ADR-0381 (rate-limit retire) in
   `docs/adr/`.
2. `git mv` the 3 rate-limit files to `docs/archive/` together.
3. Add the two index rows to `docs/adr/README.md`.
4. Validate + gate.

Rollback: all text and file moves; `git revert` the commits.

## Open Questions

None.
