<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# kiss MCP Fleet — Feature-Parity Follow-ups (sequenced roadmap)

> **Type.** Sequencing roadmap for the _feature-parity_ follow-ups accumulated across Plans 1–9 + 8b of
> the kiss MCP fleet migration (`docs/superpowers/plans/2026-07-1{0,1}-kiss-mcp-plugins-plan*.md`). It
> decomposes the feature backlog into five ordered, independently-shippable plans (F1–F5). Each F-plan
> becomes its own `writing-plans` cycle when reached; this document is the parent they hang off.
>
> **Scope boundary.** This roadmap covers ONLY the _feature-completeness_ follow-ups. The _cross-cutting
> polish_ follow-ups (per-plugin redaction-prompt override, `mcp_redaction` settings-UI panel +
> unset/DELETE, `abortSignal` threading, the dead `key === 'key'` branch in `mcp-sentry/format.ts`) and
> the _magi-side_ follow-ups (`npm_publish` sandbox capability, the `ask` fail-open gate fix) are
> **explicitly deferred** — see §5. They were weighed and consciously sequenced after feature parity.

## Goal

Close the remaining kiss feature gaps in the migrated MCP plugin fleet, in an order that ships every
unblocked (pure-papai) enhancement before anything gated on an architectural decision or cross-repo
change. Nothing here alters magi, geofront, the broker, or the in-sandbox tunnel except where a plan is
explicitly flagged as cross-repo (F5, and only under the rejected option).

## Prioritization decision (of record)

The backlog was triaged by **priority driver = feature parity** (chosen over security-hardening,
redaction-foundation-completion, and cross-cutting-hygiene, all of which are deferred to §5). Within
feature parity, plans are ordered so that:

1. **Clean, pure-papai items ship first** (F1–F3), ordered by agent-facing value.
2. **Items carrying an unresolved decision ship last** (F4–F5), so the whole effort is never blocked on
   a decision or cross-repo coordination.

## The five plans

### F1 — Figma full-simplify + token pooling _(clean; size L; highest value)_

**Gap.** The moderate Figma port keeps structure/dimensions/text only. kiss's `mcp-figma` additionally
(a) extracts a compact CSS-layout string per node from Figma layout fields, and (b) de-duplicates
repeated text styles into a `globalVars` table so the agent gets design-to-code-grade fidelity instead
of a raw node dump. It also (c) rotates across a **pool of Figma tokens** on HTTP 429.

**Work items.**

- Port the CSS-layout string extractor: map Figma auto-layout fields (`layoutMode`, `primaryAxis*`,
  `counterAxis*`, `padding{Left,Right,Top,Bottom}`, `itemSpacing`) → a compact
  `display/flex-direction/justify-content/align-items/padding/gap` string per node.
- Port text-style `globalVars` dedup: collect distinct text styles into a keyed table, replace inline
  style objects with references.
- Token pooling: accept a comma-separated `X-Figma-Token` pool (context config); on `429`, rotate to the
  next token and retry with bounded attempts; surface exhaustion as a clean tool error.

**Source.** kiss `mcp/figma-mcp/` simplify logic (the layout extractor + globalVars builder) and its
token-rotation wrapper.

**Acceptance gate.** Unit tests over the pure shapers (layout extractor + globalVars dedup are pure
functions — table-test them against fixture node trees); token-rotation test with a mocked 429; full
`bun run lint` + `bun run knip` + `bun run check:full` 12/12; listing verification unchanged (still the
same figma tool set, richer output). Redaction unaffected (figma is not AI-redacted).

**Depends on.** Nothing.

### F2 — GitLab read completeness _(clean; size S–M)_

**Gap.** The initial `mcp-gitlab` port returns only the first page of the repo tree and MR list, and
`gitlab_get_job` does not accept a full job URL.

**Work items.**

- Link-header pagination: follow `Link: … rel="next"` for the repo tree (recursive listing) and the MR
  list (`all=true` semantics), with `p-limit`-bounded fetches and a sane hard page cap that is `log()`-ed
  when hit (no silent truncation).
- `jobUrl` convenience: `gitlab_get_job` accepts either a numeric job id or a full GitLab job URL and
  parses the project path + job id out of the URL (`encodeURIComponent` each derived path segment).

**Source.** kiss `mcp/gitlab-mcp/` pagination + job-url parsing.

**Acceptance gate.** Unit tests: multi-page Link-header following (mocked paged responses, assert full
accumulation + cap-hit log), job-url parser table tests (bare id, full url, malformed url → clean
error). Full lint/knip/check:full green; listing unchanged.

**Depends on.** Nothing. Independent of F4 (reads vs writes).

### F3 — Minor polish _(clean; size S)_

**Gap.** Two small niceties.

**Work items.**

- **TeamCity config-envelope flattening:** unwrap TeamCity's nested `{property:[{name,value}]}` envelopes
  into flat camelCase objects in the shaped output. MUST preserve the existing recursive
  `sanitizeTeamCityConfig` secret-redaction (the only secret protection for teamcity — flatten AFTER
  sanitizing, never around it).
- **RAG `top_k` (OPTIONAL — YAGNI candidate):** kiss does NOT expose result-count control, so this is a
  _new_ feature, not parity. Include ONLY if there is concrete demand at plan-writing time; otherwise
  drop it and F3 is teamcity-only. Default position: **drop it.**

**Acceptance gate.** TeamCity: table tests asserting flatten output AND that a secret-bearing config is
still redacted post-flatten (regression guard on `sanitizeTeamCityConfig`). Full lint/knip/check:full
green.

**Depends on.** Nothing.

### F4 — GitLab write tools _(gated on a decision; size M)_

**Gap.** kiss's `mcp-gitlab` can post MR comments, create discussions, and update MR
title/description/state. papai deferred these pending the papai/magi forge-write boundary.

**Decision of record (papai/magi forge-write boundary).** The `mcp-gitlab` plugin OWNS _lightweight
review-collaboration writes_ — `post_comment`, `create_discussion`, `update_mr` (title/description),
`set_mr_state` (open/close/reopen). magi retains its EXCLUSIVE ownership of _code-delivery writes_
(push / PR-open / merge via forge connections). Rationale: these are agent-_conversational_ actions on
an MR, a different concern from delivering code; they use the plugin's own `PRIVATE-TOKEN` credential
(not magi's forge connection). The line: **plugin = talk about the MR; magi = deliver the code.**

**Work items.**

- Implement the four write tools on the existing `mcp-gitlab` client (Bearer/`PRIVATE-TOKEN`,
  `encodeURIComponent` every path segment).
- Assign each a **default tool policy of `ask`** (writes must not be silently `allow`), overridable to
  `deny` per context — consistent with the existing coding write-tool gating.
- No new credential surface; reuse the plugin's existing GitLab token config.

**Acceptance gate.** Unit tests over request-shaping for each write (mocked upstream, assert method +
path + body + policy default `ask`). Full lint/knip/check:full green; listing shows the four new tools.

**Depends on.** F2 recommended-first (same client/file; sequencing avoids merge churn) but not strictly
required.

> **Note on the deferred magi `ask` fail-open (§5).** F4's `ask` default is only _enforced_ once the
> magi-side `ask` gate is fixed. Until then, `ask` behaves as `allow` in the sandbox. F4 still ships the
> correct policy metadata — it is future-correct and does no harm — but this document records that F4's
> guarantee is contingent on the deferred magi fix, so the two should ideally land together.

### F5 — Mattermost binary-attachment delivery _(gated on a mechanism; size M)_

**Gap.** Mattermost binary/large attachments cannot reach the agent as inline text; today papai returns
a metadata note only.

**Decision of record (delivery mechanism).** Deliver via **(b) papai-hosted short-lived signed URL** —
the plugin stages the fetched bytes behind a short-TTL papai URL and the tool returns the link for the
agent to fetch. **Rejected: (a) sandbox filesystem staging** (magi + geofront write bytes into the
sandbox) — heavier cross-repo lift that widens magi's surface. Option (b) preserves the "zero
magi/geofront changes" property that made the whole migration clean.

**Work items.**

- A short-TTL, single-use signed-URL staging surface for plugin-fetched bytes (scoped to the requesting
  context; auto-expiring; never lists/enumerates).
- `mcp-mattermost` attachment tool returns the signed URL for binary/large files; **falls back to
  today's metadata-note** if staging is unavailable.
- Bytes staged this way are still subject to the plugin's redaction posture for any inline text portion;
  binary payloads are opaque (documented).

**Acceptance gate.** Unit tests: signed-URL mint/expiry/single-use; attachment tool returns URL for
binary + falls back to note when staging disabled. Full lint/knip/check:full green.

**Depends on.** The staging surface (new, papai-side) — build it within F5, no magi/geofront change.

## §5 — Consciously deferred (NOT in this roadmap)

Recorded so nothing is silently dropped. These were weighed and sequenced _after_ feature parity per the
chosen priority driver:

- **Cross-cutting polish (papai):** per-plugin/per-tool redaction-prompt override (context-scoped
  `redaction_prompt`); `mcp_redaction` settings-UI panel + unset/DELETE route + `clearMcpRedactionConfig`;
  `abortSignal` threading through all plugin HTTP clients; remove the dead `key === 'key'` branch in
  `mcp-sentry/format.ts`.
- **magi-side (separate repo):** `npm_publish` sandbox capability; the `ask` fail-open gate fix
  (`magi/src/mcp-broker/gate.ts:153`) — **security-relevant**; until fixed, every `ask` write policy in
  the fleet (incl. F4's) is effectively `allow`. Flagged here as the highest-leverage deferred item.

These remain a live backlog; a future brainstorm can re-prioritize them (e.g. pull the magi `ask` fix
forward alongside F4).

## Non-goals

- No changes to magi, geofront, the broker, or the in-sandbox tunnel (F5 uses a papai-side surface; the
  cross-repo option (a) was rejected).
- No new plugins — every F-plan enhances an already-migrated plugin.
- No re-litigation of the migration's architecture (Approach A) — settled in the master design spec.

## Testing posture (all plans)

Follow the fleet's established process: pure shapers get table tests; HTTP clients get mocked-`httpFetch`
tests; each plan ends on full `bun run lint` + `bun run knip` + `bun run check:full` 12/12 (standalone
`bun test` + free port 9100 to avoid the known contention flake) and a listing-verification check.
SPDX headers, `.js` import extensions, no lint-disable/type-ignore, `encodeURIComponent` every
caller-supplied path segment, max-lines respected by splitting (not gaming).

## Execution order

F1 → F2 → F3 → F4 → F5. F1–F3 may proceed immediately in any order (value order shown). F4 and F5 carry
decisions now settled above, so they are unblocked for planning but sequenced last. Each becomes its own
`writing-plans` cycle.
