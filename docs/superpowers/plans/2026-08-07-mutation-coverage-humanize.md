<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan: mutation coverage for `src/announcements/humanize.ts`

Goal: mutation score **>= 0.9** (from 0.338), test-only. One task per mutant
class. Target file under test unchanged.

## Global constraints

- **Test-only.** Touch only `tests/` and `docs/superpowers/` (+ the one
  `.review-loop/result.json`). Never edit `src/`, `client/`, `plugins/`,
  `scripts/`, or `scripts/mutation/baseline.json`.
- **Exact equality only** for new assertions: `toBe` for scalars/strings,
  `toEqual` only for the one fully-knowable metadata object/array. No
  `toContain` / `startsWith` / `endsWith` where a full value is knowable.
- **DI-first.** Use the existing `deps()` helper for all injected paths.
- **Log observation via the multistream.** `humanize.ts` is transitively
  preloaded (mock-reset → `src/announcements.ts`), so it is cached with the real
  logger before any per-file `mock.module` can apply, and `tests/setup.ts` pins
  `LOG_LEVEL=silent` before that load. So the logging tests use pino's public
  `logMultistream.add()` extension point with a trace-level capture stream and
  raise `logger.level = 'trace'` (pino children inherit it dynamically) — no
  delayed import, no module mock. `setupTestDb()` runs in `beforeEach` so the
  default-deps path's real `resolveAdminLlmConfig` sees a migrated empty
  `llm_admin_roles` table.
- **SPDX header** on the modified test file (already present; keep it).

## Tasks

- [ ] **A — classify system prompt (L27–35).** Add test capturing `opts.system`
      on `generateStructured`; assert `toBe` against the verbatim
      `CLASSIFY_SYSTEM_PROMPT` joined text. Kills `8,9,10,11,12,13,14,15,16`.
- [ ] **B — write system prompt (L39–58).** Add test capturing `opts.system` on
      `generate`; assert `toBe` against the verbatim `SYSTEM_PROMPT` joined
      text. Kills `19,20,21,22,24,25,27,28,29,30,31,32,33,34,35,36,37`.
- [ ] **C — empty-release sentinel (L37).** Add test asserting the returned
      value `toBe` the hardcoded literal string (not the re-imported constant).
      Kills `17`.
- [ ] **D+E — not-configured warn (L14 child scope + L86–94 guard/warn).** With a
      capture stream + `logger.level='trace'` and an `ok:false` config, assert
      exactly one warn whose `scope` `toBe('announcements:humanize')`, metadata
      fields exact, and `msg` `toBe('Central LLM not configured; skipping changelog humanization')`.
      Kills `0,1,47,48,49,51,52,53,54`. (Leaves `50` — see residuals.)
- [ ] **G — failure warn (L109).** Reject in `generateStructured`; assert the
      captured warn's `error` `toBe('boom')`, `scope`, and `msg`
      `toBe('Changelog humanization failed')`. Kills `66,67`.
- [ ] **F-38 — default-deps wiring (L67).** Call `humanizeChangelog('raw')`
      with no deps; assert it resolves to `null` (real default deps → unconfigured
      central LLM) rather than rejecting (`{}`-mutated). Kills `38`.

## Residuals (declared, not killed)

- [x] **`50`** — true equivalent (ternary always-true; `config.missing` only
      exists when `type === 'missing'`).
- [x] **`39`,`40`** — `defaultDeps.generate` body; import-time-snapshot
      reachability + SDK-contract forwarding.
- [x] **`41`,`42`,`43`** — `defaultDeps.generateStructured` body + opaque
      `Output.object` config (only the `ai` SDK reads it).

## Verification gate

- [x] `bun test tests/announcements/humanize.test.ts` green (16 pass).
- [x] `bun test:mutate:file src/announcements/humanize.ts` → killed=62 survived=1
      noCoverage=5 (0.9118), survivors == `{39,40,41,42,43,50}`.
- [ ] `.review-loop/result.json` written; residual `mutantIds` union == measured
      survivors.
