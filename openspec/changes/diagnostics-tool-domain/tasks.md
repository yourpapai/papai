## 1. Tool domain recognized

- [x] 1.1 Extend the `isToolDomain` case in `tests/tools/tool-metadata.test.ts` with `expect(isToolDomain('diagnostics')).toBe(true)` (mutation-killing assertion for the new array literal); confirm it fails for the right reason. Verify: `bun test tests/tools/tool-metadata.test.ts`
- [x] 1.2 Add `'diagnostics'` to the `TOOL_DOMAINS` const array in `src/tools/tool-metadata.ts` — no `TOOL_METADATA` entries (phantom names pollute slug generation and behavior-audit closure); the unchanged `EXPECTED_STATIC` equality test proves no tools were added. Verify: `bun test tests/tools/tool-metadata.test.ts`

## 2. Analytics classification

- [ ] 2.1 Add a failing test in `tests/analytics/tool-classification.test.ts` pinning the exact contents of `DOMAIN_MAP` by object equality, including `diagnostics: 'diagnostics'` (kills the mapping-literal mutant before any diagnostics tool exists). Verify: `bun test tests/analytics/tool-classification.test.ts`
- [ ] 2.2 In `src/analytics/tool-classification.ts`: add `'diagnostics'` to the `AnalyticsToolDomain` union, `export` the `DOMAIN_MAP` const, add the `diagnostics: 'diagnostics'` entry. Verify: `bun test tests/analytics/tool-classification.test.ts && bun run typecheck` (typecheck proves `Record<ToolDomain, …>` exhaustiveness)

## 3. Analytics fact schemas

- [ ] 3.1 Add a fact-schema test (follow the local `tests/analytics/normalizer.test.ts` / event-props pattern): `tool_started` and `tool_completed` props payloads with `domain: 'diagnostics'` validate; a payload with a bogus domain still rejects. Verify: `bun test tests/analytics/` (new cases fail)
- [ ] 3.2 Add `'diagnostics'` to the two `domain: z.enum([...])` literals (`ToolStartedPropsSchema` ~line 61, `ToolCompletedPropsSchema` ~line 73) in `src/analytics/event-props-execution.ts`, in place, no shared-schema extraction. Verify: `bun test tests/analytics/`

## 4. Tool preferences (regression-only, no src change)

- [ ] 4.1 Following the local pattern, add a tool-preferences test: `parseToolPrefs('{"domainDefaults":{"diagnostics":"ask"}}')` preserves `diagnostics: 'ask'` instead of dropping the key, and empty prefs resolve every tool to `allow` via `resolveToolPermission`. Verify: `bun test tests/tools/tool-preferences.test.ts` (or the file hosting the local pattern)

## 5. Docs restating the bounded domain list

- [ ] 5.1 Update the "richer domains collapse onto …" sentence in `src/tools/AGENTS.md` to include `diagnostics`; check `docs/architecture/tools.md` and update if it repeats the list; update the `tool_started`/`tool_completed` domain-enum rows in `docs/research/analytics-metrics/02-metric-catalog.md`. Verify: `grep -rn "diagnostics" src/tools/AGENTS.md docs/architecture/tools.md docs/research/analytics-metrics/02-metric-catalog.md`

## 6. Full verification

- [ ] 6.1 Run `bun run test:affected` in the loop, then the full `bun run test` plus `bun run typecheck` and `bun run lint`; read `reports/test/` artifacts for any failure, confirm zero regressions and that no affected `docs/architecture/*.md` page still omits `diagnostics`. Verify: `bun run test && bun run typecheck && bun run lint`