<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: One YAML edit, and the boundary that keeps it from contradicting a checker

## Context

See `proposal.md` — Why. What matters for the approach is the delivery path, which already
exists end to end:

```
  openspec/config.yaml
     rules:
       proposal: [...]
       design:   [...]
       tasks:    [...]
            │
            ▼
  openspec instructions <artifact> --change <name> --json
     → { instruction, template, rules[], context, dependencies }
            │
     ┌──────┴───────────────────────────┬───────────────────────┐
     ▼                                  ▼                       ▼
  sdd-runner                      opencode-agent          Claude Code skills
  draft.ts:59                     plan-draft.ts:159       openspec-propose,
  "Project rules:" + rules        "Rules:" + rules        openspec-update-change
```

Both TypeScript drafters parse `rules` from the CLI payload (`openspec-driver.ts` in each
workspace, `rules: payload.rules ?? []`) and forward every entry verbatim. Neither filters,
reorders, or rewrites them.

The tension to resolve sits one artifact over: `rules.tasks` asks for independently
verifiable chunks, and `decompose.ts:92` runs a second agent whose entire job is to *split*
any task bundling several atomic pieces.

## Goals / Non-Goals

**Goals.** Ask the necessity question wherever a proposal is drafted. Keep declined scope
visible. Leave task decomposition alone, and say so where both rules are read.

**Non-Goals.** Enforcing the answer. Reaching intake, depth profiles, or the gate protocol.
Any change to how rules are delivered.

## Decisions

### D1: Configuration, not code

The rule is added to `openspec/config.yaml` and nothing else ships. Rung 2 of the ladder
this change is descended from — is it already in this codebase — answers itself: the
delivery mechanism exists, is used by both drafters, and is covered by their tests.

*Alternative considered: a shared prompt constant carried by each drafter*, as
`agent-minimality-ladder` does for production code. Rejected here because that change has
no configuration path to use — instruction blocks are TypeScript — while this one does. Two
mechanisms for two problems that genuinely differ is not duplication.

### D2: Two rungs only — necessity and existing coverage

The production-code ladder has seven rungs. Five of them (stdlib, native platform feature,
installed dependency, one line, minimum implementation) are about *how code is written* and
mean nothing to a proposal, which describes behaviour. Rung 5 already has an artifact-level
form in `rules.design` ("justify why existing stack cannot cover the need") and stays there.

Adding the full ladder to an artifact rule would be the over-build the ladder exists to
prevent, and would produce proposals arguing about standard libraries.

### D3: The boundary is documented, not enforced

```
   ADMISSION                     │  DIVISION
   ── does this scope exist? ──▶ │ ── how is it broken up? ──▶
   rules.proposal                │  rules.tasks
   rules.design                  │  decompose.ts atomicity checker
   (this change)                 │  (unchanged)
```

*Why not a test asserting `rules.tasks` never gains a minimality rule.* It would have to
match on phrasing in YAML, which is brittle in the direction that matters — a rule worded
differently slips through, and a legitimate future edit fails for using a banned word. The
honest mechanism for a rule about prose is a sentence in the architecture doc, read by the
person editing the rules. This change deliberately does not build machinery it cannot make
reliable.

*What is pinned by a test* is the delivery contract: a rule present in the configuration
reaches the drafter. That is mechanical, already nearly covered, and is what actually
breaks silently.

### D4: Declined scope goes to Non-goals, which already exists

`rules.proposal` already requires a Non-goals section. The new rule routes rejected scope
into it rather than creating a second place for the same information. Without that routing
the necessity question makes proposals *shorter and less informative* — scope disappears
with no record — which is the failure mode of every minimality rule applied carelessly.

## Risks / Trade-offs

**A drafter answers the necessity question with boilerplate** → Likely at first, and not
separable from every other prose rule in this file. The mitigation is that the answer is
visible in the proposal a human reads at the gate, where a boilerplate justification is
more obvious than a silently admitted capability is today.

**Non-goals sections grow long** → Accepted, and preferable to the alternative. A long
Non-goals list is a record of decisions; the same change with a short one is the same
decisions, unrecorded.

**The two rule sets are read as contradictory before anyone finds the doc** → The reason
the boundary sentence is a task in this change rather than a follow-up. It goes in the same
commit as the rules.

**A future rule added to `rules.tasks` reintroduces the contradiction** → Unmitigated by
machinery, by choice (D3). The doc sentence and review are the guard.

## Migration Plan

Configuration only: no persisted shape, no schema, no code path. Changes in flight are
unaffected — `rules` are read when an artifact is drafted, so the 21 open changes keep the
artifacts they already have and only new drafting sees the rule. Rollback is deleting the
two entries.
