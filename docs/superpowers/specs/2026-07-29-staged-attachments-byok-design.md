<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Staged attachments and BYOK — Phase 3 persistence-and-security design

Date: 2026-07-29
Status: approved

## Problem

The Phase 3 catalog foundation has four pending, executable-as-is records that
cover persistence and security invariants not claimed by the adjacent broad
stories. `SCN-task-attachments` proves task-provider relay/upload/delete, not
the staged-file lifecycle. `SCN-settings-api-byok` proves a caller-context
settings write without disclosure, not encrypted credential merge/clear or
unreadable-data behavior.

The catalog records are:

- `SCN-attachments-staged-scope-search`
- `SCN-attachments-staged-resolution`
- `SCN-byok-context-credentials`
- `SCN-byok-unreadable-credentials`

## Decision

Implement the records as one cohesive persistence-and-security slice with two
focused Tier-0 story files: one for staged attachments and one for BYOK. The
stories share deterministic database setup, scope-boundary reasoning, and
secret-disclosure controls, but no scenario crosses from one subsystem into the
other.

This is preferable to two separate slices because all four records are already
Tier-0-ready and the split would duplicate catalog-promotion and frozen-story
qualification work. It is preferable to one broad story because staged-file
lifecycle and credential security have different entry points, state machines,
and failure contracts. The common implementation slice is a review boundary,
not evidence that the four behaviors are one invariant.

## Goals

- Promote exactly the four listed catalog IDs with literal Tier-0 story mappings.
- Prove staged-file search and resolution boundaries using real staged-file
  persistence, group-context widening, and deterministic download results.
- Prove per-config-context encrypted BYOK merge/clear behavior without
  disclosing raw credentials.
- Prove unreadable enabled BYOK data fails closed at both the settings response
  and runtime LLM-resolution boundaries.
- Preserve the catalog's one-behavior-per-ID rule.

## Non-goals

- Production behavior changes, migrations, configuration fields, or new runtime
  seams.
- Task attachment relay/upload/delete coverage beyond the existing
  `SCN-task-attachments` record.
- General settings authorization coverage beyond the existing
  `SCN-settings-api-byok` record.
- Any assertion of raw secrets, decrypted payloads, or ciphertext values.
- A generic staged-file retry policy: a deliberate re-send, not repeat
  resolution of a terminal staged row, is the behavior under test.

## Story-family shape

The attachment story enters through the real staged-file APIs/tools, real
scenario SQLite state, in-memory blob storage, and a deterministic downloader.
It owns staged discovery, resolution state transitions, and intentional re-send
semantics.

The BYOK story enters through the real settings API and encrypted configuration
store, then invokes the real LLM resolver. It owns config-context isolation,
partial update/clear behavior, unreadable stored data, and sanitized
observability.

Shared generic scenario setup is allowed. Neither story calls the other
subsystem. The implementation moves only these four records from `AUDIT_RECORDS`
to `EXECUTABLE_STORY_MAPPINGS`; all other Phase 3 records remain pending.

## Deterministic staged-attachment scenarios

Use one scoped platform instance, two threads in group A, and one thread in
group B. Stage uniquely named files:

- `A-1`: `alpha-plan.txt` in group A/thread 1.
- `A-2`: `alpha-notes.txt` in group A/thread 2.
- `B-1`: `alpha-private.txt` in group B/thread 1.

For `SCN-attachments-staged-scope-search`, search from group A/thread 1 with a
common query:

- Without `groupContextId`, only `A-1` is returned.
- With group A's config context, `A-1` and `A-2` are returned.
- `B-1` is never returned, including when its sender and filename also match.
- Resolving an A staged ID from group B returns `not_found`; the downloader and
  attachment persistence are not invoked.

For `SCN-attachments-staged-resolution`, stage `retry-me.txt` in group
A/thread 1. The downloader returns `null` for its first attempt. The story
asserts `download_failed`, then resolves the same staged ID again and asserts the
terminal prior-failure result with no second downloader invocation and no
attachment record.

The story deliberately re-stages that platform file with a new delivery/message
identity. The existing platform-file/context row is reset to `staged`, as
defined by the unique upsert; it is not a new staged ID. The downloader now
returns fixed bytes. That deliberately re-staged reference resolves once to a
new attachment; a second resolution returns `already_resolved` with the same
attachment identity. The re-send is the new resolution attempt, not an implicit
retry of the terminal failed state.

## Deterministic BYOK scenarios

Use two independently authorized settings contexts, A and B. Enable A and save
deterministic non-production credential sentinel strings with a base URL and
model values. Submit a partial update that changes one non-secret field and
clears one optional field.

For `SCN-byok-context-credentials`, assert A's public state reflects the
specified merge/clear result while B remains disabled and unchanged. Assert that
all serialized settings responses and sanitized scenario events omit every
credential sentinel. The story asserts public state (`enabled`, `complete`, and
field presence/masking), never decrypted values or ciphertext.

For `SCN-byok-unreadable-credentials`, seed a separate enabled context with a
structurally invalid encrypted-payload marker that is not a credential. Assert
that settings GET reports enabled, incomplete, unreadable state; all required
roles missing; and empty fields, providers, and roles. Its response and the
scenario event trace omit both the invalid marker and every credential sentinel.

Call `resolveLlmConfig` for that context. It must return the stable unreadable
BYOK error result, not a usable configuration or a central-provider fallback. A
separate readable context remains unaffected.

## Security and failure handling

- Credential data is opaque test input only. No fixture name, assertion,
  checkpoint, response, event trace, log assertion, catalog rationale, or this
  specification contains a raw credential value.
- Tests assert absence from serialized HTTP responses and sanitized event traces;
  they assert metadata rather than plaintext or ciphertext equality.
- Cross-context staged IDs behave as absent. The stories do not weaken existing
  authorization or config-scope resolution.
- An enabled unreadable BYOK record fails closed: it cannot create a usable LLM
  configuration and it does not fall back to central credentials.
- A downloader `null` result records terminal staged failure. Repeated
  resolution does not silently download again; only a deliberate re-send creates
  a fresh staged attempt.
- Existing result shapes remain intact: `not_found`, `download_failed`, and
  `already_resolved`. Failure paths create no workspace attachment.

## Eventual verification

The eventual implementation runs:

```sh
bun test:stories:contracts
bun test:stories
bun test:stories:stress
bun run test -- tests/attachments/staged tests/byok-llm tests/debug/settings/byok tests/llm-providers
BASE_REF=<approved-baseline-sha> bun test:stories:compat --manifest-only
BASE_REF=<approved-baseline-sha> bun test:stories:compat
```

The targeted suites aid diagnosis but do not replace the deterministic Tier-0
proofs. Frozen-input compatibility qualification is required because the future
implementation changes catalog and story inputs.
