<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0346: Namespace-Aware Story Fixtures — Guarded MSW Resolvers with Fall-Through on a Shared Endpoint

## Status

Accepted

## Date

2026-07-31

## Context

Three settings sections — CodingCredentialsSection (`agent-provider` namespace), CodeHostSection (`forge`), and CodingMcpSection (`mcp`) — all fetch from the single endpoint `/settings/api/coding-credentials?contextId=…&namespace=…`. In the Storybook MSW fixtures, every handler family matched on the URL alone and ignored the `namespace` query parameter, so whichever handler MSW consulted first answered for all three namespaces. CodeHostSection's stories therefore rendered the agent-provider form (Coding agent / Model provider / API key …) instead of the forge form (Code host / Access token …), and the wrong fixture looked deliberate because the stories file carried a comment claiming it shared the endpoint.

The design (`docs/superpowers/specs/2026-07-31-story-fixture-namespace-design.md`) and plan (`docs/superpowers/plans/2026-07-31-story-fixture-namespace.md`) resolved this by making every handler family for the shared endpoint dispatch on the request's `namespace`, so each family answers only its own section and scenarios compose additively.

## Decision Drivers

- **Fall-through is the composition mechanism.** MSW's `executeHandlers` advances to the next matching handler only when a resolver returns `undefined` (no `result?.response`). A guard must therefore return bare `undefined` — never an error-status `HttpResponse`, never `passthrough()`.
- **Guard before any `await`.** In an `async` resolver (the `loading` families that `delay(NEVER_RESOLVE_MS)`), the namespace check must run before the delay; otherwise foreign-namespace requests hang instead of falling through, and the regression test would only catch it as a test timeout.
- **Fixture bodies mirror the route contract.** The server route attaches `allowedAgents` only for `agent-provider` and catalog keys only for `mcp`, so the forge fixture body carries exactly `namespace`, `configured`, `complete`, `missing`, `fields`. Labels are copied verbatim from `src/debug/settings/coding-credentials-fields-meta.ts`.
- **The 300-line `max-lines` ceiling shaped the file layout.** `settings-handlers-personal.ts` was exactly at the limit, so the agent-provider block had to move into a new `settings-handlers-coding.ts` rather than being edited in place; the guard helper got its own `namespace.ts` module so both fixture files import a util instead of each other.
- **The guard must be CI-enforced, not convention.** A future handler family that forgets its guard would silently hijack a sibling section's requests; a unit test asserting every family answers only its own namespace turns that into a build failure.

## Considered Options

### Option 1 — Guarded resolvers returning `undefined` on foreign namespaces (chosen)

Add an `isNamespace(request, namespace)` helper comparing `new URL(request.url).searchParams.get('namespace')` for strict equality; every resolver for the shared endpoint guards on its own namespace and returns `undefined` otherwise; add a forge fixture family and a CI-gated regression test probing foreign namespaces.

- **Pros:** uses MSW's native fall-through, so scenarios compose additively with no dispatcher infrastructure; each family stays independently importable; the test fails the build on any missing guard.
- **Cons:** the guard discipline is per-resolver and must be repeated in every future family; a guard placed after a `delay()` degrades failure mode from wrong-answer to hang.

### Option 2 — A single dispatcher handler that routes on `namespace` internally

One MSW handler for the URL that inspects the query param and delegates to per-namespace fixture maps.

- **Pros:** one place to get the routing right; new namespaces are added in one spot.
- **Cons:** breaks the `HandlerFamily` scenario model (`populated`/`empty`/`error`/`loading` composed per section); scenarios would need to coordinate state inside the dispatcher instead of registering independent handler arrays; contradicts how every other settings fixture file is organized.

### Option 3 — Per-namespace paths in the fixture layer only (e.g. `/settings/api/coding-credentials/agent-provider`)

Give each namespace a distinct URL in the MSW handlers while the real client keeps the single query-param URL.

- **Pros:** no guards needed; MSW path matching does the routing.
- **Cons:** fixtures stop matching the real request URL, so the story layer no longer exercises the actual fetch contract; any path-level handler (e.g. logging middleware, passthrough rules) would diverge from production behavior. Rejected — fixture URLs must mirror the wire.

## Decision

Every MSW handler family serving `/settings/api/coding-credentials` guards on `isNamespace(request, '<own-namespace>')` and returns `undefined` when it does not match. The guard runs before any `await`. The agent-provider and forge families live together in a new `client/stories/msw/settings-handlers-coding.ts`; the `mcp` families were guarded in place in `settings-handlers-personal-2.ts`; the shared `isNamespace` helper lives in `client/stories/msw/namespace.ts`. CodeHostSection's stories and visual spec were retargeted to new `settings-code-host-*` scenario keys backed by a forge fixture whose body and labels mirror the server route exactly.

## Rationale

Fall-through via `undefined` is the only mechanism that keeps the existing per-family scenario composition working: a scenario registers exactly the handler arrays it needs, and MSW walks them in order until one produces a response. The alternatives either centralize routing in a way that fights the `HandlerFamily` model (Option 2) or decouple fixtures from the real request contract (Option 3). The regression test (`tests/client/stories/msw/coding-credentials-namespace.test.ts`) deliberately probes only *foreign* namespaces — the `loading` families delay for 60 s on their own namespace, so asserting positively on them would stall the test; a missing guard fails fast with a received-namespace list instead.

## Consequences

### Positive

- CodeHostSection stories and screenshots show the real forge form (`Code host`, `Access token`, and the self-hosted reveal of `Instance URL (enterprise / self-hosted)`), verified by reading the regenerated PNGs.
- A forgotten guard on any future family fails CI with a precise message (`answers only its own namespace`) rather than silently serving wrong fixtures.
- CodingCredentialsSection and CodingMcpSection baselines stayed pixel-identical without re-baselining, proving the guards changed nothing for the sections that already worked.
- `settings-handlers-personal.ts` dropped back under the 300-line ceiling, restoring lint headroom.

### Negative

- Guard discipline is repetitive: every new family for this endpoint must remember three rules (guard, return `undefined`, guard before `await`). Mitigated by the module-header comment in `settings-handlers-coding.ts` and the CI test.
- The self-hosted reveal of `instance_url` is only provable visually (a dedicated reveal state plus the narrow long-value-overflow state), adding two screenshot baselines to maintain.

### Risks

- If MSW changes its fall-through semantics (`executeHandlers` breaking on `result?.response`), all guards stop composing. Mitigation: the behavior is pinned by the regression test, which would fail on upgrade.
- Fixture drift from the server route's per-namespace body shape would reintroduce believable-but-wrong stories. Mitigation: labels and body keys are copied verbatim from `coding-credentials-fields-meta.ts` and `coding-credentials-routes.ts`, with source line references kept in comments.

## Implementation Notes

- Commits: `a03f9506c` (guard agent-provider fixtures), `47c669f76` (guard mcp fixtures), `7a4cee9ec` (forge fixtures + CodeHostSection retarget), `d47bed6cb` (visual spec retarget); follow-ups `2fb1367a7` (foreign-namespace-only probing) and `b1306207d` (forge label rename) extended the same pattern.
- Later work appended three more forge scenario keys (`settings-code-host-save-error`, `-incomplete`, `-self-hosted`) on the same guarded family.
- The TDD write hook required exact-name mirror tests (`namespace.test.ts`, `settings-handlers-coding.test.ts`) before the new source files could be written.

## Related Decisions

- ADR-0238: Storybook agent screenshot pipeline — the visual verification lane this decision feeds.
- ADR-0239 / ADR-0293: Storybook settings coverage and story family conventions — the `HandlerFamily` scenario model preserved here.
- ADR-0284: Scenario catalog hermetic stories — scenario keys (`settings-code-host-*`) added by this decision.

## References

- Design: `docs/superpowers/specs/2026-07-31-story-fixture-namespace-design.md`
- Plan: `docs/superpowers/plans/2026-07-31-story-fixture-namespace.md`
- Guard test: `tests/client/stories/msw/coding-credentials-namespace.test.ts`
- Server contract: `src/debug/settings/coding-credentials-routes.ts`, `src/debug/settings/coding-credentials-fields-meta.ts`
