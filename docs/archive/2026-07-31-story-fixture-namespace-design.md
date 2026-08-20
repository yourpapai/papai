<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Namespace-aware story fixtures

**Date:** 2026-07-31
**Status:** Design approved, pending spec review

## Problem

`GET /settings/api/coding-credentials` serves three namespaces off one URL, selected by a
`namespace` query parameter: `agent-provider`, `forge`, and `mcp`
(`src/debug/settings/coding-credentials-fields-meta.ts:17`; the route branches on it at
`src/debug/settings/coding-credentials-routes.ts:209`). The client sends it on every read
(`client/settings/coding-credentials-fetchers.ts:14`).

No handler in the Storybook fixture layer reads it. A scan of all eight handler files —
roughly 222 handlers — turns up no use of `searchParams` or path params anywhere: a handler
is chosen by which scenario a story names, and then answers every request to its URL
identically.

The consequence lands on `CodeHostSection`. It requests the `forge` namespace
(`client/settings/sections/CodeHostSection.svelte:72`), but its four stories name the
`settings-coding-credentials-*` scenarios, whose handlers return `agent-provider` data
unconditionally (`client/stories/msw/settings-handlers-personal.ts:65`, `:90`). Every
screenshot therefore shows _Coding agent / Model provider / Auth method / API key / Base URL
/ Model_ under a "Code host" title.

The fixture layer has families for two of the three namespaces — `codingCredentialsHandlers`
(agent-provider) and `codingMcpHandlers` (mcp, at
`client/stories/msw/settings-handlers-personal-2.ts:175`) — and none for `forge`.
`CodingMcpSection` is correct only by accident: its scenario serves MCP unconditionally and
no other section is mounted alongside it.

The cost is not only review blindness. The `kind` select, the conditional `instance_url`
reveal, and the Access token field carry no visual-regression baseline at all, so a
regression in this section's real UI cannot be caught by `bun shoot`.

The finding is H1 of the CodeHostSection UX review
([`docs/ux-reviews/CodeHostSection.md`](../../ux-reviews/CodeHostSection.md)).

## Scope

This is sub-project **A** of four decomposed from that review. Sub-project **C** (control
target size floor) is complete. The others are tracked separately and are not addressed
here:

- **B** — `SettingsFieldShell` ↔ `Field` parity (inline validation / error channel).
- **D** — CodeHostSection's section-local fixes.

A is confined to the coding-credentials endpoint. Making the whole fixture layer
request-aware was considered and rejected (see Alternatives).

**Explicitly out of scope: the composed `SettingsApp` scenarios.** They register no
coding-credentials handler, but all three coding sections sit inside the collapsible
Advanced block (`client/settings/SettingsApp.svelte:245`), and `advancedCollapsed`
initialises to `!ADVANCED_IDS.includes(initialHash)` (`:102`). Storybook renders with no URL
hash, so Advanced is collapsed and the sections never mount. No fetch is issued and nothing
is broken there.

## Design

### 1. The namespace guard

Add a helper to the fixture layer:

```ts
/** True when the request targets `namespace`. Handlers sharing an endpoint must
 *  return `undefined` otherwise, so MSW falls through to the next handler. */
export const isNamespace = (request: Request, namespace: string): boolean =>
  new URL(request.url).searchParams.get('namespace') === namespace
```

Every resolver on `/settings/api/coding-credentials` becomes:

```ts
http.get('/settings/api/coding-credentials', ({ request }) =>
  isNamespace(request, 'forge') ? HttpResponse.json(forgePopulated) : undefined,
)
```

Fall-through is load-bearing and holds in the installed MSW (2.15.0): `executeHandlers`
advances to the next handler unless a resolver produced a response — it breaks only on
`result?.response` (`node_modules/msw/lib/core/utils/executeHandlers.js:33`–`41`). A
resolver returning `undefined` is therefore "not mine, keep looking".

This keeps the existing `HandlerFamily` shape (`settings-handlers-personal.ts:12`–`17`) and
every existing scenario key working. Scenarios compose additively: spreading two families
lets each answer only its own namespace.

Two handlers need no namespace and stay logically unguarded:
`/settings/api/coding-credentials/models` is a different URL, and the `error` family's 500
is namespace-agnostic. The `error` and `loading` handlers are still guarded so the rule is
uniform across the endpoint — an unguarded 500 in a composed scenario would fail every
namespace, not just its own.

### 2. The forge fixture

A new `forgeHandlers: HandlerFamily` beside the existing two, modelled field-for-field on
`FIELDS_META.forge` (`coding-credentials-fields-meta.ts:63`–`79`):

| Field         | Required | Sensitive | Control                     |
| ------------- | -------- | --------- | --------------------------- |
| `kind`        | yes      | no        | `select` over `FORGE_KINDS` |
| `instance_url`| no       | no        | text                        |
| `forge_token` | yes      | yes       | text                        |

`FORGE_KINDS` is `['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted']`
(`src/coding-credentials/types.ts:56`).

The response body carries only `namespace`, `configured`, `complete`, `missing`, and
`fields`. It must **not** carry `allowedAgents`, `catalog`, `pluginServers`,
`maxMcpServers`, or `selections`: the route attaches `allowedAgents` only for
`agent-provider` and the MCP keys only for `mcp`
(`coding-credentials-routes.ts:213`–`225`). Those fields are optional in the client schema
(`client/settings/fetcher-schemas.ts:79`–`98`), so an over-broad fixture would validate
while misrepresenting the endpoint.

`missing` follows `allRequiredFields` (`src/coding-credentials/store.ts:60`), so the empty
state is `['kind', 'forge_token']` — both required fields.

The populated state has `configured: true`, `complete: true`, `missing: []`, a masked
`forge_token` mirroring how the agent-provider fixture masks its API key, and `kind` set to
`github` with an empty `instance_url`. The SaaS kind is deliberate: `instance_url` must
start hidden for the reveal interaction in section 5 to be observable. The `loading` state
delays past the screenshot deadline and `error` returns a 500, matching the existing
families.

### 3. Scenario and story wiring

Four new keys in `client/stories/msw/scenarios.ts` —
`settings-code-host-{populated,empty,error,loading}` — each registering only the forge
family, because `CodeHostSection` is the sole component mounted in its own stories.

`client/settings/sections/CodeHostSection.stories.svelte` retargets its four stories from
the `settings-coding-credentials-*` keys to these. Its comment, which currently reads "same
endpoint as CodingCredentialsSection", is replaced by one naming the namespace — that
comment is what made the wrong fixture look deliberate.

The `settings-coding-credentials-*` and `settings-coding-mcp-*` keys keep their names and
meaning. They only gain guards.

### 4. Guard regression test

New file `tests/client/stories/msw/coding-credentials-namespace.test.ts`, using msw's
exported `getResponse`. For each of the three families, assert its handlers answer their own
namespace and produce no response for the other two.

This is what makes the chosen approach safe. Its one weakness is that three families now
share a URL and correctness depends on every one of them carrying a guard; a future fourth
namespace whose handler forgets it would silently hijack a sibling section — the exact bug
being fixed here. The test converts that from a review burden into a failing build.

`tests/client/**` is excluded from default `bun test` discovery by `bunfig.toml`; the
working invocation is
`bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`.
CI runs it: `test:client` is in the check list at `scripts/check.sh:296`.

### 5. Verification and re-baseline

Restart Storybook before shooting. `bun storybook:prepare` concatenates CSS at startup and
`playwright.config.ts` sets `reuseExistingServer: true`, so a warm server silently serves
stale assets.

Then `bun shoot -g CodeHostSection` and read the regenerated PNGs. The four states must show
_Code host / Instance URL / Access token_ instead of the agent-provider form.

Add one manual state to `tests/visual/settings/sections/CodeHostSection.spec.ts`, below
`// @generated-end auto-screenshots`, covering the conditional `instance_url` field. It is
revealed client-side when the selected kind is `github-enterprise` or `gitlab-self-hosted`
(`needsInstanceUrl`, `src/coding-credentials/types.ts:63`), so an interaction proves the
reveal works rather than merely that the field renders:

```ts
test('CodeHostSection — self-hosted kind reveals Instance URL', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codehostsection--populated')
  await sharedPage.getByTestId('coding-select-kind').selectOption('gitlab-self-hosted')
  await expect(sharedPage).toHaveScreenshot()
})
```

`coding-select-kind` follows the section's existing testid pattern
(`CodeHostSection.svelte:212`), which the spec file already uses throughout.

Re-shoot `CodingCredentialsSection` and `CodingMcpSection` as well. Their baselines must be
unchanged — that is the regression check that the guards did not break the two sections that
already worked.

Acceptance:

1. `bun run check` passes.
2. The guard test passes, and fails when any single guard is removed.
3. CodeHostSection's four baselines plus the self-hosted state show the forge form.
4. CodingCredentialsSection and CodingMcpSection baselines are unchanged.

## What this does not fix

This gives the forge form screenshot coverage, which is review finding H1. The other
findings anchored in that form — the unmarked-but-server-required `instance_url`, the
unrendered connection status, the absent first-setup guidance — stay open under sub-projects
B and D. Fixing the fixture is what makes those reviewable at all.

One adjacent inaccuracy is noted and deliberately left alone: the existing agent-provider
empty fixture declares `missing: ['provider_api_key']`
(`settings-handlers-personal.ts:77`) although `agent` and `provider` are also required
(`coding-credentials-fields-meta.ts:20`, `:28`). Correcting it would change the
CodingCredentialsSection baselines, which this sub-project uses as its
did-not-break-anything control.

## Alternatives considered

**Single dispatching handler with a state map.** One handler owns the endpoint and takes a
namespace→state map defaulting to populated. No fall-through subtlety, and a namespace
cannot be left unhandled. Rejected because it introduces a second idiom into a layer with
exactly one, and would rewrite every existing coding-credentials scenario key for no gain in
coverage.

**Enumerate scenario keys per combination.** Literal handler lists per scenario, no new
mechanism. Cheapest and most obvious to read, but combinations multiply with each namespace
and each state, and nothing prevents the next shared-endpoint section from repeating this
bug.

**Layer-wide request-awareness.** Build a general param-aware fixture pattern and audit all
222 handlers for endpoints whose response should vary by request. Rejected as unbounded: the
audit's cost is unknown until it runs, and only one endpoint is known to need it.

**Second fixture with a stored self-hosted kind.** A separate forge fixture whose stored
`kind` is `gitlab-self-hosted` with an `instance_url` value, wired as its own story. It
would cover the loaded-from-server state, but not the client-side reveal, which is where the
logic lives. The interaction test covers the reveal and the revealed field together, for one
spec state instead of a fixture plus a scenario plus a story.
