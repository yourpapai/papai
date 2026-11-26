# Design

## Context

See `proposal.md` — Why. The failing path, as it exists today:

1. `src/debug/settings/provision-routes.ts` resolves the provision hook for the context's bound task instance. For a group scope it always passes `username: null` (groups have no per-operator account); for a DM it passes the resolved platform username, which can also be null.
2. `plugins/task-provider-kaneo/provision.ts` (`provisionAndConfigure`) forwards `userId = <config context id>` and `username` to `provisionKaneoUser`.
3. `plugins/task-provider-kaneo/provision-requests.ts` builds the synthetic account identity: when `username` is null it uses the raw `platformUserId` as the email local part. Config context ids are scoped (`pi:<b64>:ctx:<b64>`, `src/chat/scoped-context.ts`), so the local part contains `:`.
4. Kaneo's Better Auth validates the body with Zod-style email validation and rejects it: `400 {"message":"[body.email] Invalid email address","code":"VALIDATION_ERROR"}`. `provisionAndConfigure` returns `{status:'failed'}`; the settings route answers 422; no credential or workspace is stored.

Observed against `ghcr.io/usekaneo/kaneo:2.7.2` (the pinned image, brought up with the repo's `docker-compose.yml` + `docker-compose.test.yml` overlay):

| Probe | Result |
| --- | --- |
| `provisionAndConfigure('pi:dGct…:ctx:LTEw…', null)` | `{"status":"failed","error":"Sign-up failed (400): … Invalid email address"}` |
| sign-up `a_b-c-1234@pap.ai` | 200 |
| sign-up `pi:dGct-1234@pap.ai` | 400 invalid email |
| `organization/create` with name `User pi:…` / slug `papai-pi:…` | 200 (unchanged, accepted) |
| `kaneoProvisionMember` (sign-up → invite → accept) on a validly provisioned workspace | 200, member appears in `/api/workspace/{id}/members` |
| cross-group reuse (sign-in → invite → accept) | 200, same provider user id |

The last two rows matter for scope: the member-provisioning seam and the `Authorization: Bearer <apiKey>` invite header are not the defect, so this change does not touch them.

Downstream consequence, which is the reported symptom: with nothing stored at the group's config context, `TaskProviderResolver.resolve()` returns null (`src/providers/resolver.ts`), `prepareTurnProvider` returns early and never fires `maybeEnsureGroupMembership` (`src/llm-orchestrator.ts`), and `ensureWorkspaceMember` returns `'skipped'` for both the `group_member:added` subscriber and the startup backfill (`src/providers/membership/ensure-member.ts`). No invite is ever attempted.

## Goals / Non-Goals

Goals: make the generated account identity valid for every actor id the core can supply, so group workspaces and null-username DMs provision; pin that contract with unit tests that fail on today's builder.

Design-level non-goals: unifying this sanitizer with `toEmailLocalPart` in the member path (different contract — truncate at `:` vs sanitize all characters); changing the provision hook signature to carry an explicit actor label; any retry/backoff machinery.

## Decisions

### D1 — Sanitize every illegal local-part character; do not truncate at `:`

Alternatives considered:

- **Reuse `toEmailLocalPart`** (`plugins/task-provider-kaneo/operations/members.ts`): it cuts everything from the first `@` or `:`, so every scoped id collapses to `pi`. Valid but indistinguishable in Kaneo's member list and logs, and it silently loses the only distinguishing prefix. Rejected.
- **Pass the native context id** instead of the config context id: the provision hook contract (`TaskProviderProvision`) receives a context id, not a platform/native id, and the settings route deliberately reports the config context id (`requireScope` result). Changing the seam to add a native id widens a provider-agnostic contract for one provider's formatting quirk. Rejected for this change (recorded as a non-goal).
- **Use a fully synthetic `papai-<uuid>@pap.ai`** with no id at all: simplest and always valid, but throws away the operational affordance of recognizing which context an account belongs to in Kaneo's UI. Rejected as the primary form; kept as the fallback when sanitization yields nothing.

Chosen: a provisioning-local `toProvisionEmailLocalPart(actorId)` that strips a leading `@`, replaces every character outside `[A-Za-z0-9._-]` with `-`, collapses runs, trims edge dashes, caps the stem length, and falls back to `papai` when empty. The result keeps the existing `<stem>-<8 hex>@pap.ai` shape, so uniqueness (and existing operator expectations) are unchanged.

### D2 — The helper stays in the Kaneo plugin's provisioning module

The need is specific to one provision hook and one provider's identity API; core has no notion of a provisioning account identity, and no other provider implements a provision hook today. A new shared module would be a seam with one caller. The helper is exported from `provision-requests.ts` (or a sibling `provision-identity.ts` if the file's max-lines budget would otherwise be breached) so tests can call it directly and pin the contract per id shape.

### D3 — Contract test is "the produced body passes a real email validator"

The regression is invisible to the current mocked-fetch tests because they assert request shapes, not validity. Tests assert the generated local part matches `[A-Za-z0-9._-]+`, that the final address passes `z.email()`, and that the sign-up body sent through `provisionKaneoUser` carries such an address for each id shape (scoped context id, `@user:server`, numeric, unicode, empty). This mirrors Better Auth's own validation, which is what rejected the request.

### D4 — No contract or schema change

The provision hook signature, the settings route's status codes (422 for a failed outcome, `registration_disabled` as its own outcome), and the stored config keys (`plugin:task-provider-kaneo:provider:credential` / `:workspaceId`) stay as they are. No migration, no backfill, no new persisted state. The workspace display name (`User pi:…`) and slug stay unsanitized — verified accepted — to keep the diff to the failing field.

## Risks / Trade-offs

- **Already-broken groups stay broken until an operator presses Provision again** → no automatic group provisioning exists and adding it is out of scope; document the re-provision step in `docs/architecture/environment.md` (provision route) as part of this change.
- **Two different contexts could sanitize to the same stem** → the 8-hex random suffix already disambiguates; a genuine collision surfaces as a provider-side duplicate-email failure, which the failed-outcome contract already handles with no partial state, and the next attempt mints a new suffix.
- **Capping the stem length could truncate distinguishing tails** → only affects very long identifiers; the suffix and the stored credential mapping remain the source of truth.
- **Better Auth rate limits `/sign-up/email` (429 observed on bursts)** → unchanged: the failed outcome writes nothing and the next turn retries; no queueing in this change.

## Migration Plan

No schema or data migration. Deploy, then re-run Provision for each group that failed before the fix (settings → group → Task provider → Provision). Rollback is a plain revert: successfully provisioned contexts keep their stored binding, and failed ones are still failed.

## Hook / TDD notes

The write hook gates `plugins/task-provider-kaneo/provision-requests.ts` and any new file; tests come first in `tests/plugins/task-provider-kaneo/provision.test.ts` (failing on today's builder), then implementation. `bun security` runs because the change touches credential provisioning. Docs update is part of the tasks.

## Open Questions

None.
