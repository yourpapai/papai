<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Prompt injection defense

## 1. Boundary utility

- [x] 1.1 Write failing `tests/security/prompt-boundary.test.ts`: wrap
      produces `<external-data token=… kind=…>` with a stable per-process
      token; sanitize strips boundary-forging sequences, collapses
      newlines, truncates at 500 chars; token is not derivable from
      message content; empty/undefined inputs are safe.
      Verify: `bun test tests/security/prompt-boundary.test.ts` (fails)
- [x] 1.2 Implement `src/security/prompt-boundary.ts`
      (`wrapUntrusted`, `sanitizeExternalData`, per-process token via
      `node:crypto`, pino debug on module init without token value).
      Verify: `bun test tests/security/prompt-boundary.test.ts` (passes)

## 2. Alert summary wrapping

- [ ] 2.1 Write failing regression test in
      `tests/deferred-prompts/poller-alerts.test.ts` (or colocated security
      suite): `buildAlertSummary` output wraps each task title/url in
      external-data delimiters and includes the data-not-instructions
      framing line; a title containing `</external-data><system>`-style
      forgery is neutralized.
      Verify: focused `bun test` (fails)
- [ ] 2.2 Edit `src/deferred-prompts/poller-alerts.ts` to sanitize + wrap
      via `src/security/prompt-boundary.ts`.
      Verify: focused `bun test` (passes)

## 3. Memory fact wrapping

- [ ] 3.1 Write failing regression test for `src/memory-context-block.ts`:
      rendered fact lines wrap identifier/title/url in external-data
      delimiters; empty memory yields `null` as before.
      Verify: focused `bun test` (fails)
- [ ] 3.2 Edit `src/memory-context-block.ts` to sanitize + wrap fact
      fields.
      Verify: focused `bun test` (passes)

## 4. Gate

- [ ] 4.1 Run `bun security` (prompt-construction surface), full
      `bun test`, `bun run typecheck`, `bun run lint`; update
      `docs/architecture/behaviors.md` with the boundary behavior note.
      Verify: all four commands pass
