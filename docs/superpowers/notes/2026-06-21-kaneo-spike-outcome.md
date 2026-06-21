<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase-0 Spike Outcome — Kaneo group-member provisioning

**Date:** 2026-06-21
**Kaneo image:** `ghcr.io/usekaneo/kaneo:2.7.2` (the production-pinned image), Postgres 16.
**Method:** brought up the real Kaneo container via the e2e `docker-lifecycle` helper
(`docker compose -f docker-compose.yml -f docker-compose.test.yml up -d kaneo`, exposed on
`localhost:11337`), then probed Better Auth / Kaneo HTTP endpoints with (a) a service-account
**api-key** and (b) the owner **session cookie**. Service account, workspace, member, and
invitation were all created purely over HTTP (no papai DB). Each probe was run twice
(independent runs) with identical results.

## Results

| Probe                                             | Auth              | HTTP | Verdict                                              |
| ------------------------------------------------- | ----------------- | ---- | ---------------------------------------------------- |
| `POST /api/auth/organization/add-member`          | api-key           | 404  | **FAIL**                                             |
| `POST /api/auth/organization/add-member`          | owner cookie      | 404  | **FAIL**                                             |
| `GET  /api/workspace/{id}/members` (after add)    | api-key           | 200  | member absent                                        |
| `POST /api/auth/organization/invite-member`       | owner cookie      | 200  | **PASS** (returns `invitationId`, `status: pending`) |
| `POST /api/auth/organization/accept-invitation`   | **member** cookie | 200  | **PASS** (`status: accepted`)                        |
| `GET  /api/workspace/{id}/members` (after accept) | api-key           | 200  | **member present** ✓                                 |
| `POST /api/auth/admin/set-password`               | api-key/cookie    | 404  | **FAIL**                                             |

## Decision

- **Member provisioning mechanism: invite-member + member auto-accept** (NOT `add-member`).
  Better Auth's `add-member` is server-only and is **not mounted as an HTTP route** in Kaneo
  2.7.2 (404). The viable, fully-programmatic flow is:
  1. `sign-up/email` the member → capture the member's **session cookie** + `userId`.
  2. Owner `invite-member` (member email, role) → capture `invitationId`.
  3. Member `accept-invitation` with the **member's own session cookie** + `invitationId`.
  4. Member now appears in `GET /workspace/{id}/members` → assignable.

  The bot already controls the member's session from step 1, so auto-accept needs no email link.

- **Credential delivery: encrypted-password-at-creation (Branch B).** `admin/set-password` is
  **not reachable over HTTP** (404), so the reveal-once-via-reset path (Branch A) is **not
  viable**. Capture the generated password at member sign-up, store it encrypted at rest
  (`encryptInstanceConfig`), and reveal it once via the settings UI; rotation is out of scope.

## Impact on the implementation plan

`docs/superpowers/plans/2026-06-21-kaneo-group-member-provisioning.md` must be revised before
execution:

1. **Task 2.2** — replace `doAddMember` (`organization/add-member`) with the
   **invite + accept** flow above. `kaneoProvisionMember` must return the member's session/id
   and run invite (owner auth) then accept (member auth). The reuse path (existing account)
   still needs an invite+accept against the new workspace using a member session — note: a
   reused account's session is not held by the bot, so reuse may require re-authenticating that
   member (sign-in) or inviting + accepting at first opportunity. **Open design point.**
2. **Task 4.1** — drop Branch A (`admin/set-password`); ship **Branch B** (encrypted password)
   only. Keep the `encrypted_password` column from Task 2.3.
3. The provider seam (`provisionWorkspaceMember`) signature is unchanged; only the Kaneo
   implementation mechanism changes.

## Reproduction

The spike was run with a throwaway script (`scripts/kaneo-phase0-spike.ts`, since removed). To
reproduce: bring up `kaneo` via the e2e compose overlay, create owner+workspace+api-key over
HTTP, then issue the probes in the table above. The two `KANEO_*` secrets and the image tag come
from `.env` / `docker-compose.yml`.
