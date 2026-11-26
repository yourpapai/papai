# Tasks

## 1. Regression tests (failing first)

- [x] 1.1 Add a table-driven test for the provisioning email builder covering scoped context ids (`pi:<b64>:ctx:<b64>`), `@user:server`, numeric ids, unicode names, and the empty string; each row asserts the derived address passes `z.email()` and its local part matches `[A-Za-z0-9._-]+` — run `bun test tests/plugins/task-provider-kaneo/provision.test.ts` and confirm the scoped-context-id row fails on the current builder
- [x] 1.2 Add a test driving `provisionKaneoUser` with a scoped group context id and a null username through the mocked Kaneo transport, asserting the sign-up request body's email is valid and the outcome carries a credential/workspace — run `bun test tests/plugins/task-provider-kaneo/provision.test.ts` and confirm it fails before implementation
- [x] 1.3 Add a test asserting a failed sign-up (HTTP 400) returns `{status:'failed'}` and leaves `plugin:task-provider-kaneo:provider:credential` / `:workspaceId` unset for the context — run `bun test tests/plugins/task-provider-kaneo/provision.test.ts`

## 2. Implementation

- [x] 2.1 Implement the provisioning email builder (strip leading `@`, replace characters outside `[A-Za-z0-9._-]`, collapse/trim dashes, cap stem length, fall back to `papai` when empty) and wire it into the sign-up identity in `plugins/task-provider-kaneo/provision-requests.ts`; keep the `<stem>-<8 hex>@pap.ai` shape — run `bun test tests/plugins/task-provider-kaneo/provision.test.ts` until every row passes
- [x] 2.2 Confirm both call paths now provision with an opaque actor id: group (`provisionAndConfigure('<scoped id>', null, …)`) and null-username DM (`maybeProvisionKaneo`) — run `bun test tests/plugins/task-provider-kaneo/provision.test.ts` and `bun test tests/plugins/task-provider-kaneo/`

## 3. Documentation

- [x] 3.1 Update `docs/architecture/environment.md` (provision route section) to state that the synthetic account identity is sanitized from the config context id/user id and that groups provisioned while this was broken must re-run Provision — verify with `bun run format:check`
- [x] 3.2 Update `docs/architecture/plugins.md` (provider provision hook) to record the identity contract: the hook receives an opaque config context id, so a provider deriving an account identity from it must sanitize it — verify with `bun run format:check`

## 4. Integration verification

- [x] 4.1 With Docker available (image already cached from this investigation), bring up the pinned Kaneo image via `docker compose -f docker-compose.yml -f docker-compose.test.yml up -d kaneo-postgres kaneo`, run `provisionAndConfigure('<scoped group id>', null, { publicUrl, internalUrl })` and confirm the outcome is `provisioned`, then run `kaneoProvisionMember` and confirm the invited member appears at `GET /api/workspace/{id}/members`; tear the stack down with `down -v`
- [x] 4.2 Run `bun run test`, `bun run typecheck`, `bun run lint`, and `bun security`; confirm all green and that the change's spec delta validates with `openspec validate --strict fix-kaneo-group-provisioning`
- [x] 4.3 Run `bun test:mutate:changed --base=HEAD~1` (or `--base=<merge-base>`) so the changed files' mutation scores are seeded for the CI ratchet; confirm no target falls below its recorded floor

## Workflow follow-up

- Archive the change after review approval and PR merge, per `openspec/config.yaml` archive guidance.
