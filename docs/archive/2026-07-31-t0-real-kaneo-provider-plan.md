<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Real Kaneo Provider T0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exercise the real Kaneo plugin in hermetic T0 stories through a stateful fake REST API, all 29 shared parity groups, and four chat-loop proofs.

**Architecture:** Keep real-provider selection as a pre-start scenario option and extend it to Kaneo. A new stateful fake Kaneo router is registered with `StrictHttpDispatcher.serveHost()`, while the Kaneo plugin factory derives an instance-host-validated runtime HTTP callable and passes it to `KaneoConfig.fetch`. The existing memory Kaneo provider stays the default for every ordinary story.

**Tech Stack:** Bun, TypeScript, Bun test, Zod v4, existing story sandbox and `StrictHttpDispatcher`.

## Global Constraints

- `realTaskProvider` is a scenario option, never a `given.*` fixture.
- Support both `'youtrack'` and `'kaneo'`; ordinary stories keep the memory-backed `kaneo` registration.
- Use `StrictHttpDispatcher.serveHost()` for stateful unordered provider traffic. Do not add `expectAnyOrder`.
- Kaneo conformance executes every one of the 29 existing `PARITY_GROUPS`; no exclusions.
- Fake routes fail loudly for unknown paths, unsupported methods, and malformed bodies.
- A factory may derive runtime HTTP only from manifest-declared instance host keys; task-tool inputs never affect host admission.
- Use `.js` import extensions, strict TypeScript, ASCII, and no lint/type suppression comments.
- Every production behavior change follows red-green-refactor and lands with its focused tests.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `plugins/task-provider-kaneo/index.ts` | Capture `providerRuntime.httpFetch` at plugin activation and close over it in the registered provider factory. |
| `plugins/task-provider-kaneo/entry-runtime.ts` | Accept an optional callable transport and place it on `KaneoConfig`. |
| `plugins/task-provider-kaneo/plugin.json` | Declare the runtime HTTP permission required to expose `providerRuntime.httpFetch`. |
| `tests/plugins/task-provider-kaneo/index.test.ts` | Prove plugin-created providers receive the runtime transport. |
| `tests/stories/harness/fake-kaneo/state.ts` | Fake resource state, deterministic IDs, and response projection helpers. |
| `tests/stories/harness/fake-kaneo/router.ts` | Route matching, request validation, mutations, search/list projections, and error responses. |
| `tests/stories/harness/fake-kaneo/responder.ts` | Adapt dispatcher `Request` objects to the transport-free router. |
| `tests/stories/harness/fake-kaneo/responder.test.ts` | Contract tests for state isolation, payload parsing, routing, and error handling. |
| `tests/stories/harness/fixtures.ts` | Allow real Kaneo plugin approval without replacing default memory-provider registration. |
| `tests/stories/harness/world.ts` | Map selected real provider to its plugin, config, host, and responder. |
| `tests/stories/harness/scenario.ts` | Widen `ScenarioOptions.realTaskProvider`. |
| `tests/stories/harness/{fixtures,world}.test.ts` | Prove both provider selections preserve expected registration ownership. |
| `tests/stories/tasks/kaneo-conformance.story.test.ts` | Execute all shared parity groups against the real Kaneo provider. |
| `tests/stories/tasks/kaneo-real.story.test.ts` | Four real-Kaneo chat-loop scenarios. |
| `tests/stories/catalog/coverage.ts` and `tests/stories/catalog/supporting.ts` | Claim or explicitly support every new literal T0 scenario so the census remains bidirectional. |

### Task 1: Thread Runtime HTTP Through The Kaneo Factory

**Files:**
- Modify: `plugins/task-provider-kaneo/index.ts:30-43,81-91`
- Modify: `plugins/task-provider-kaneo/entry-runtime.ts:6-12,50-60`
- Modify: `plugins/task-provider-kaneo/plugin.json:8-45`
- Test: `tests/plugins/task-provider-kaneo/index.test.ts`

**Interfaces:**
- Consumes: `PluginContext.providerRuntime.httpFetch: (url: string, init?: RequestInit) => Promise<Response>`.
- Produces: `createKaneoProvider(config, fetch?)` and a provider factory that preserves the activation-time runtime transport.

- [ ] **Step 1: Write the failing factory transport test**

Add a test that activates the default Kaneo plugin with a `providerRuntime.httpFetch` spy, retrieves the registered `kaneo` factory, builds a provider, and invokes `listProjects()`. The fake transport returns `[]`; assert it received `https://kaneo.invalid/api/project?workspaceId=workspace-1` and was called once.

```ts
const httpFetch = mock<(url: string, init?: RequestInit) => Promise<Response>>(() =>
  Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })),
)
plugin.activate({ providerRuntime: { httpFetch }, registration })
const provider = registered.factory({ baseUrl: 'https://kaneo.invalid', credential: 'key', workspaceId: 'workspace-1' })
await provider.listProjects()
expect(httpFetch).toHaveBeenCalledWith('https://kaneo.invalid/api/project?workspaceId=workspace-1', expect.any(Object))
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test tests/plugins/task-provider-kaneo/index.test.ts`

Expected: the request bypasses the injected transport because the registered factory currently calls `createKaneoProvider(config)`.

- [ ] **Step 3: Add the optional callable transport to entry runtime**

Extend the local config type and constructor signature without using `typeof fetch`:

```ts
type KaneoHttpFetch = (url: string, init?: RequestInit) => Promise<Response>

type KaneoConfig = { apiKey: string; baseUrl: string } & Partial<{
  sessionCookie: string
  fetch: KaneoHttpFetch
}>

export function createKaneoProvider(config: Record<string, string>, fetch?: KaneoHttpFetch): TaskProviderLike {
  // keep credential/session-cookie selection unchanged
  const kaneoConfig = isKaneoSessionCookie(credential)
    ? { apiKey: '', baseUrl, sessionCookie: credential, ...(fetch === undefined ? {} : { fetch }) }
    : { apiKey: credential, baseUrl, ...(fetch === undefined ? {} : { fetch }) }
  return new KaneoProvider(kaneoConfig, config['workspaceId'] ?? '')
}
```

Extend `PluginContextLike` with `providerRuntime: { httpFetch: KaneoHttpFetch }`, remove the stale known-gap comment, and register `factory: (config) => createKaneoProvider(config, ctx.providerRuntime.httpFetch)`.

Add the `http` permission to `plugin.json` so `ctx.providerRuntime.httpFetch`
is available. Do not add `providerAllowedHostsFromConfig`: its current dynamic
host mechanism only reads admin/context requirements, while Kaneo's `baseUrl`
is instance-scoped. Instance-config host admission is outside this task.

- [ ] **Step 4: Run focused tests and static checks**

Run: `bun test tests/plugins/task-provider-kaneo/index.test.ts tests/plugins/task-provider-kaneo/client.test.ts && bun run lint && bun run typecheck`

Expected: all focused tests, lint, and typecheck pass.

- [ ] **Step 5: Commit the transport seam**

```bash
git add plugins/task-provider-kaneo/index.ts plugins/task-provider-kaneo/entry-runtime.ts plugins/task-provider-kaneo/plugin.json tests/plugins/task-provider-kaneo/index.test.ts
git commit -m "fix(kaneo): route plugin requests through runtime transport"
```

### Task 2: Build Fake Kaneo State And Core Project/Task Routes

**Files:**
- Create: `tests/stories/harness/fake-kaneo/state.ts`
- Create: `tests/stories/harness/fake-kaneo/router.ts`
- Create: `tests/stories/harness/fake-kaneo/responder.ts`
- Test: `tests/stories/harness/fake-kaneo/responder.test.ts`

**Interfaces:**
- Produces: `createFakeKaneoState()`, `handleFakeKaneoRequest(ctx)`, and `createFakeKaneoResponder(): (request: Request) => Promise<Response>`.
- Consumes: requests whose client prefixes every API route with `/api`.

- [ ] **Step 1: Write failing responder tests for a project and task round trip**

Test `POST /api/project`, `GET /api/project?workspaceId=workspace-1`, `GET /api/column/:projectId`, `POST /api/task/:projectId`, `GET /api/task/:taskId`, and `GET /api/task/tasks/:projectId`. Assert independent responder instances cannot see each other's projects, and that an unknown route returns status 404.

```ts
const respond = createFakeKaneoResponder()
const created = await respond(jsonRequest('POST', '/api/project', { name: 'Alpha', workspaceId: 'workspace-1', slug: 'alpha' }))
expect(created.status).toBe(200)
const missing = await respond(new Request('https://kaneo.invalid/api/not-a-route'))
expect(missing.status).toBe(404)
```

- [ ] **Step 2: Run the responder test and verify it fails**

Run: `bun test tests/stories/harness/fake-kaneo/responder.test.ts`

Expected: failure because `createFakeKaneoResponder` does not exist.

- [ ] **Step 3: Implement state, projections, and core routes**

Use a single deterministic sequence and maps for projects, columns, tasks, comments, labels, relations, and members. Projects automatically receive a `To Do` column so `validateStatus()` can resolve `to-do`. Export the transport-free context:

```ts
export type FakeKaneoCtx = Readonly<{
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  state: FakeKaneoState
}>

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
export const errorResponse = (status: number, message: string): Response => json({ error: message }, status)
```

Implement exact core route families: `POST|GET /project`, `GET|PUT|DELETE /project/:id`, `GET|POST /column/:projectId`, `GET|PUT|DELETE /column/:id`, `PUT /column/reorder/:projectId`, `POST /task/:projectId`, `GET|PUT|DELETE /task/:id`, `GET /task/tasks/:projectId`, and `GET /search`. Return the shapes required by the Kaneo Zod response schemas, including `data: { columns, plannedTasks }` for task lists and `{ tasks, projects: [], workspaces: [], comments: [], activities: [] }` for search.

In the responder, parse JSON only for `POST`, `PUT`, and `DELETE`; malformed JSON returns a 400 JSON error. Keep the state private to each responder call.

- [ ] **Step 4: Run responder tests and contracts**

Run: `bun test tests/stories/harness/fake-kaneo/responder.test.ts && bun run test:stories:contracts`

Expected: new fake tests and existing contracts pass.

- [ ] **Step 5: Commit the core simulator**

```bash
git add tests/stories/harness/fake-kaneo
git commit -m "test(stories): add fake Kaneo core API"
```

### Task 3: Complete Fake Kaneo Parity Resources

**Files:**
- Modify: `tests/stories/harness/fake-kaneo/state.ts`
- Modify: `tests/stories/harness/fake-kaneo/router.ts`
- Modify: `tests/stories/harness/fake-kaneo/responder.test.ts`

**Interfaces:**
- Consumes: the actual client routes in `comment-resource.ts`, `label-resource.ts`, `task-relations.ts`, `operations/users.ts`, and `operations/members.ts`.
- Produces: a fake that can satisfy every method invoked by all 29 `PARITY_GROUPS`.

- [ ] **Step 1: Add failing tests for comments, labels, relations, users, and member provisioning**

Cover these representative API contracts: comment create/list/update/delete; label create/list/get/update/attach/detach; relation create/list/delete; workspace-member list; and Better Auth sign-up, invite, accept, and workspace membership paths. Assert unknown methods on a known path return 405 and malformed object bodies return 400 without changing maps.

- [ ] **Step 2: Run the new fake tests and verify they fail**

Run: `bun test tests/stories/harness/fake-kaneo/responder.test.ts`

Expected: the unimplemented route families return 404/405.

- [ ] **Step 3: Implement the remaining exact route families**

Add routes matching the Kaneo client:

```text
POST|GET /comment/:taskId
PUT|DELETE /comment/:commentId
POST /label
GET /label/workspace/:workspaceId
GET|PUT|DELETE /label/:labelId
GET /label/task/:taskId
PUT|DELETE /label/:labelId/task
POST /task-relation
GET /task-relation/:taskId
DELETE /task-relation/:relationId
GET /workspace/:workspaceId/members
POST /auth/sign-up/email
POST /auth/sign-in/email
POST /auth/organization/invite-member
POST /auth/organization/accept-invitation
```

Return ISO timestamps with offsets for comments and relations. Preserve the same relation IDs through list/delete and return `taskId: null` for unattached labels, because `removeLabel()` explicitly checks that field. Seed or create members with `{ id, name, email, image: null, role: 'member' }` so `kaneoListUsers()` validates them. Auth responses must contain `{ user: { id }, token }`; invite returns `{ id }` and membership endpoints mutate the same fake member map.

- [ ] **Step 4: Run fake contracts and production parity binding unit coverage**

Run: `bun test tests/stories/harness/fake-kaneo/responder.test.ts && bun run test:stories:contracts`

Expected: fake tests pass and no existing harness contract regresses.

- [ ] **Step 5: Commit complete fake parity surface**

```bash
git add tests/stories/harness/fake-kaneo
git commit -m "test(stories): complete fake Kaneo parity routes"
```

### Task 4: Register Real Kaneo In The Scenario World

**Files:**
- Modify: `src/plugins/types.ts`
- Modify: `src/plugins/manifest-validation.ts`
- Modify: `src/plugins/context-facade-builders.ts`
- Modify: `src/plugins/context.ts`
- Modify: `tests/stories/harness/fixtures.ts`
- Modify: `tests/stories/harness/world.ts`
- Modify: `tests/stories/harness/scenario.ts`
- Test: `tests/stories/harness/fixtures.test.ts`
- Test: `tests/stories/harness/world.test.ts`

**Interfaces:**
- Produces: `ScenarioOptions.realTaskProvider?: 'youtrack' | 'kaneo'`.
- Consumes: `createFakeKaneoResponder()` and existing `createFakeYouTrackResponder()`.
- Produces: `PluginProviderRuntime.forInstance(config: Record<string, string>): (url: string, init?: RequestInit) => Promise<Response>` for manifests that declare instance host keys.

- [ ] **Step 1: Write failing instance-host and world tests**

Add a provider-runtime test that a manifest declaring `providerAllowedInstanceHostsFromConfig: ['baseUrl']` receives a callable that permits only the hostname parsed from the factory config and rejects a different host. Add manifest-validation tests rejecting keys that are not instance-scoped `providerConfigSchema` keys. Add one fixture test proving `approveRealTaskProviderPlugin('kaneo')` activates a descriptor owned by `task-provider-kaneo` when no memory fake is registered. Add one world test that constructs `{ realTaskProvider: 'kaneo' }`, assigns a Kaneo task instance, starts the world, resolves the provider, and observes `provider.name === 'kaneo'` after a `listProjects()` request.

- [ ] **Step 2: Run targeted contracts and verify failure**

Run: `bun test tests/stories/harness/fixtures.test.ts tests/stories/harness/world.test.ts`

Expected: the instance-host runtime method and manifest declaration do not exist; TypeScript also rejects `'kaneo'` as `realTaskProvider`, or the memory registration owns the type.

- [ ] **Step 3: Implement per-instance admission, then provider descriptors and conflict-free ordering**

Add `providerAllowedInstanceHostsFromConfig` to the plugin manifest schema and validate every key against `providerConfigSchema` entries with `scope: 'instance'`. Extend the runtime facade with `forInstance(config)`: it parses only the manifest-declared config URL values into a fresh allowlist and returns an `httpFetch` callable using the existing guarded provider runtime. The returned callable must reject hosts not in that derived set. Declare Kaneo's `baseUrl` in this new manifest field and change its plugin factory to use `ctx.providerRuntime.forInstance(config)`.

Create a typed descriptor map in `world.ts`:

```ts
type RealTaskProviderType = 'youtrack' | 'kaneo'
type RealProviderSetup = Readonly<{
  instanceConfig: Record<string, string>
  host: string
  responder: () => (request: Request) => Promise<Response>
}>
```

Keep YouTrack setup byte-for-byte equivalent. For Kaneo, approve the real plugin before startup, register `kaneo.invalid` with `createFakeKaneoResponder()`, and seed instance config `{ baseUrl: 'https://kaneo.invalid', credential: 'fake-token', workspaceId: 'workspace-1' }`. Do not call `fixtures.registerTaskProvider()` for a real Kaneo world; continue calling it for default and real-YouTrack worlds. This is the ownership distinction that permits the real Kaneo plugin to register `kaneo`.

Widen the fixture approval map and `ScenarioOptions`; thread the exact union through `executeScenario` into `createScenarioWorld`.

- [ ] **Step 4: Run targeted and complete harness contracts**

Run: `bun test tests/stories/harness/fixtures.test.ts tests/stories/harness/world.test.ts && bun run test:stories:contracts`

Expected: selected unit tests and all story contracts pass.

- [ ] **Step 5: Commit world registration**

```bash
git add src/plugins/types.ts src/plugins/manifest-validation.ts src/plugins/context-facade-builders.ts src/plugins/context.ts plugins/task-provider-kaneo/index.ts plugins/task-provider-kaneo/plugin.json tests/plugins tests/stories/harness/fixtures.ts tests/stories/harness/world.ts tests/stories/harness/scenario.ts tests/stories/harness/fixtures.test.ts tests/stories/harness/world.test.ts
git commit -m "test(stories): register real Kaneo provider worlds"
```

### Task 5: Add All-Group Kaneo Conformance Stories

**Files:**
- Create: `tests/stories/tasks/kaneo-conformance.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/catalog/supporting.ts`
- Test: `tests/stories/harness/catalog-{coverage,census}.test.ts`

**Interfaces:**
- Consumes: `PARITY_GROUPS`, `scenario()`, and `{ realTaskProvider: 'kaneo' }`.
- Produces: literal, catalog-accounted T0 scenarios that each execute a nonempty partition of the 29 groups.

- [ ] **Step 1: Write the failing partition assertion and one tasks-domain scenario**

Start from the YouTrack domain runner but set `included = PARITY_GROUPS`. Define six static domain lists covering tasks, search, comments, relations, projects/labels/identity, and errors. Fail module setup when the flattened IDs have duplicates or do not exactly equal all `PARITY_GROUPS` IDs. Add a literal Kaneo tasks scenario that starts the world, resolves the provider, creates an isolated project per group, and calls `group.run({ provider, projectId })`.

- [ ] **Step 2: Run the story runner and verify failure**

Run: `bun run test:stories`

Expected: the real Kaneo provider or one or more fake routes are not yet available; retain the first concrete route/schema failure as the next implementation signal.

- [ ] **Step 3: Complete literal domain scenarios and catalog entries**

Create six literal scenarios, each using `{ realTaskProvider: 'kaneo' }`; do not generate scenario names dynamically because manifest extraction requires string literals. For every group, create a project named `Conformance ${group.id}` before `group.run`. Add each new scenario ID to the matching T0 catalog record when it proves an existing behavior; put conformance-only scenarios in `SUPPORTING_STORIES` with the rationale that they provide provider-wiring coverage rather than a new behavior claim.

- [ ] **Step 4: Run conformance, catalog, and full story verification**

Run: `bun run test:stories:contracts && bun run test:stories`

Expected: all 29 groups execute exactly once, catalog census has no orphans/dangling entries, and all stories pass.

- [ ] **Step 5: Commit Kaneo conformance coverage**

```bash
git add tests/stories/tasks/kaneo-conformance.story.test.ts tests/stories/catalog/coverage.ts tests/stories/catalog/supporting.ts
git commit -m "test(stories): run Kaneo parity through real plugin"
```

### Task 6: Add Four Real-Kaneo Chat-Loop Stories And Final Verification

**Files:**
- Create: `tests/stories/tasks/kaneo-real.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/catalog/supporting.ts`

**Interfaces:**
- Consumes: real Kaneo world option, fake auth/member routes, and existing scripted LLM helpers.
- Produces: chat-loop proof of activation, mapping, error translation, and member-provision capability behavior.

- [ ] **Step 1: Write four failing literal story scenarios**

Add scenarios mirroring the YouTrack suite, all with `{ realTaskProvider: 'kaneo' }`:

```text
SCN-task-kaneo-real-create
SCN-task-kaneo-real-fields
SCN-task-kaneo-real-error
SCN-task-kaneo-real-gating
```

The create story calls `tasks.projects.create`. The fields story creates a project, then calls `tasks.create` with `status: 'to-do'` and `priority: 'high'`, resolving the real provider to assert the mapped values. The error story calls `tasks.create` with `projectId: 'no-such-project'`, asserts the model reply, then asserts the direct provider rejection is a `KaneoClassifiedError` with `project-not-found`: `createTask()` validates status by listing the missing project's columns before it can POST `/task/:projectId`. The group story includes a real group member, runs a project-create turn, asserts `members.provision` is advertised, and verifies a `kaneoWorkspaceMembers` row exists for that chat user.

- [ ] **Step 2: Run the selected stories and verify failure**

Run: `bun run test:stories`

Expected: failure until fake auth/member flows, task error shape, and catalog accounting are complete.

- [ ] **Step 3: Complete story assertions and catalog accounting**

Use `callCapability()` followed by `answer()` exactly as the YouTrack stories do. Make every real-provider proof resolve the provider or inspect the persisted workspace-member row, so passing text alone cannot hide a memory-provider fallback. Add the four IDs to existing behavior records where applicable; otherwise add explicit supporting rationales. Keep all IDs literal.

- [ ] **Step 4: Run full required verification**

Run: `bun run test:stories:contracts && bun run test:stories && bun run lint && bun run typecheck`

Expected: all harness contracts, T0 stories, lint, and typecheck pass with no Kaneo parity exclusions.

- [ ] **Step 5: Commit final chat-loop coverage**

```bash
git add tests/stories/tasks/kaneo-real.story.test.ts tests/stories/catalog/coverage.ts tests/stories/catalog/supporting.ts
git commit -m "test(stories): cover real Kaneo chat loops"
```

## Plan Self-Review

- Spec coverage: Tasks 1-4 implement runtime transport, stateful fake, strict host behavior, and real-provider registration; Tasks 5-6 deliver all 29 parity groups and four chat-loop stories.
- Scope: The plan does not change the default memory provider, Tier 1 parity lane, `given.*`, or dispatcher FIFO APIs.
- Consistency: Every `realTaskProvider` use is the pre-start `'youtrack' | 'kaneo'` union; fake traffic uses `serveHost()`; all planned tests use literal T0 scenario IDs and catalog accounting.
