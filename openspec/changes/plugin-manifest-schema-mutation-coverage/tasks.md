<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Pin plugin-manifest rejection identity

Test-only change. Nothing under `src/` is edited (design.md D6).

## 1. Baseline

- [x] 1.1 Record the starting score and the survivor list:
      `bun test:mutate:file src/plugins/types.ts`, then read
      `reports/paired/src__plugins__types.ts.stryker-report.json`. Expect
      `score=0.5594` against the 0.5725 floor in
      `scripts/mutation/baseline.json`.
      Verify: survivor list captured, grouped as in design.md Context

## 2. Rejection-identity helper

- [x] 2.1 Add a test-local helper in `tests/plugins/manifest-schema.test.ts`
      that parses a manifest, asserts the parse failed, and returns the issues
      so each case asserts one message and one path in a line (design.md D2).
      Verify: `bun test tests/plugins/manifest-schema.test.ts`

## 3. Contribution-permission rejections

- [x] 3.1 Assert message and path for the four contribution-permission
      refines: `contributes.commands` / `commands`, `contributes.jobs` /
      `scheduler`, `contributes.taskProviderTypes` / `provider.task`, and
      `contributes.attachmentTransformers` / `attachments.read`, plus the
      provider-only-fields refine. Add the passing counterpart for at least
      one, so the refine is exercised in both directions.
      Verify: `bun test tests/plugins/manifest-schema.test.ts`

## 4. Provider and config-key rejections

- [x] 4.1 Assert both arms of the `providerConfigValidator` refine: declared
      without `contributes.taskProviderTypes` rejects with its message at
      `providerConfigValidator`; declared with it parses; omitted with no
      provider types parses.
      Verify: `bun test tests/plugins/manifest-schema.test.ts`
- [x] 4.2 Assert message and path for the unmatched `contributes.configKeys`
      refine and for the missing-`main` refine; add the MCP-only passing case
      alongside the existing fixture in `tests/plugins/manifest-mcp.test.ts`
      rather than duplicating it (design.md D5).
      Verify: `bun test tests/plugins/manifest-schema.test.ts tests/plugins/manifest-mcp.test.ts`

## 5. Host-allowlist rejections

- [x] 5.1 Assert message and path for `providerAllowedHostsFromConfig` naming
      an undeclared key, and for `providerAllowedInstanceHostsFromConfig`
      naming a key absent from `providerConfigSchema`; assert the passing case
      where the instance key resolves to a declared `providerConfigSchema`
      entry.
      Verify: `bun test tests/plugins/manifest-schema.test.ts`
- [x] 5.2 Assert the negative cross-check (design.md D3): a key declared only
      in `configRequirements` does not satisfy
      `providerAllowedInstanceHostsFromConfig`, and a key declared only in
      `providerConfigSchema` does not satisfy
      `providerAllowedHostsFromConfig`. Note in the test why the two are not
      interchangeable — instance-config hosts bypass the https and public-IP
      checks in `src/plugins/dynamic-hosts.ts`.
      Verify: `bun test tests/plugins/manifest-schema.test.ts`

## 6. Field-level patterns

- [x] 6.1 Assert `version` accepts `1.2.3`, `1.2.3-beta.1`, and `1.2.3+build.5`
      and rejects `1.2`, `1`, and `v1.2.3` with the semver message.
      Verify: `bun test tests/plugins/manifest-schema.test.ts`
- [x] 6.2 Assert `providerConfigValidator` rejects a leading-digit name and a
      hyphenated name with the identifier message.
      Verify: `bun test tests/plugins/manifest-schema.test.ts`

## 7. Declared defaults

- [x] 7.1 Assert on the parsed output (design.md D4) that an omitted
      `storageScope` is `'context'` and an explicit `group` is preserved; that
      `defaultEnabled`, `mcpServer`, and a config requirement's `sensitive`
      each default to `false`; that each `.optional().default([])` list field
      parses to `[]` rather than `undefined`; and that an omitted `contributes`
      yields empty lists throughout.
      Verify: `bun test tests/plugins/manifest-schema.test.ts`

## 8. Close out

- [x] 8.1 Re-measure: `bun test:mutate:file src/plugins/types.ts`. Expect a
      score at or above the 0.5725 floor. Report any survivor left standing
      after one honest attempt rather than distorting a test to reach a number
      (design.md Risks).
      Verify: score >= 0.5725
- [x] 8.2 If `tests/plugins/manifest-schema.test.ts` trips `max-lines`, split
      it by concern — rejection identity vs. declared defaults — never by
      compressing formatting.
      Verify: `bun run lint`
- [x] 8.3 Run `bun test`, `bun run typecheck`, `bun run lint`, and
      `bun run check:full`; confirm `git diff --stat src/` is empty. Update
      `docs/plugins/developer-guide.md` only if a pinned message contradicts
      what the guide documents.
      Verify: all commands exit 0
