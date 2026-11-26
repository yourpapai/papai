# Plumbing: `diagnostics` tool domain

## Goal
Introduce a first-class `diagnostics` tool domain so that current and future bot self-diagnostics tools (health/status/version introspection) flow through every tool-classification surface: `TOOL_DOMAINS` metadata, analytics fact classification, progressive-disclosure briefs, and `tool_prefs` permissions. **Plumbing only** — no new tools are invented and no existing tool is reclassified; the sibling issue that adds the actual diagnostics tools consumes this.

## Assumptions (stated, not blocking)
- **Analytics target**: add `'diagnostics'` as a new bounded `AnalyticsToolDomain` value (precedent: `'coding'` was added for the first-party ACP plugin), rather than collapsing onto `'other'` or the reserved-but-currently-unused `'config'` bucket. If the maintainer prefers freezing the bounded enum, the one-line fallback is `diagnostics: 'config'` in `DOMAIN_MAP` and skip the enum edits — everything else stands.
- **`tool_prefs` default stance**: implicit `allow` (identical to every unlisted domain — diagnostics tools are expected to be read-risk). No new default-permission mechanism is introduced; the deliverable is that the domain is *accepted* by the prefs/admin/settings surfaces.
- **Guest mode**: read-risk diagnostics tools become guest-eligible automatically via `applyGuestReadOnlyFilter` (`src/tools/index.ts:73`); nothing to change.
- **Disclosure briefs**: `buildBriefs` (`src/tools/disclosure/tool-brief.ts`) and the `search_tools` empty-result domain hint derive the domain from `getToolMetadata`, so briefs pick the domain up automatically once a tool is classified under it — no code change, verified by derivation and existing tests.

## Files to touch
1. `src/tools/tool-metadata.ts` — add `'diagnostics'` to the `TOOL_DOMAINS` const array. Do **not** add `TOOL_METADATA` entries (keys feed `BUILTIN_TOOL_NAMES` → analytics slug generation → behavior-audit closure; phantom names would pollute those).
2. `src/analytics/tool-classification.ts` — add `'diagnostics'` to the `AnalyticsToolDomain` union; `export` the currently module-private `DOMAIN_MAP`; add `diagnostics: 'diagnostics'`. (The `Record<ToolDomain, …>` typing makes the mapping entry compile-forced once the domain exists.)
3. `src/analytics/event-props-execution.ts` — add `'diagnostics'` to the two `domain: z.enum([...])` literals (`ToolStartedPropsSchema` line ~61, `ToolCompletedPropsSchema` line ~73); the normalizer shapes derive from these schemas, and tool-domain facts are stored as unconstrained TEXT (no DB CHECK, no migration).
4. Docs that restate the bounded domain list: `src/tools/AGENTS.md` (the "richer domains collapse onto …" sentence), `docs/architecture/tools.md` if it repeats the list, and `docs/research/analytics-metrics/02-metric-catalog.md` (the `tool_started`/`tool_completed` domain-enum rows).

Verified as needing **no change** (all generic over `ToolDomain`): settings UI client (`client/settings/fetcher-schemas-tools.ts` uses plain `z.string()`), `src/debug/settings/tools-routes.ts` + `admin/tool-defaults-routes.ts` (validate via `isToolDomain`), system-prompt permission fragments, presets (`PRESET_RISK_DEFAULTS` is risk-keyed), admin defaults seeding, `reconcile-durable.ts` (`perToolDomain` is a free-form record).

## Intended behavior change
- `isToolDomain('diagnostics')` returns true; `tool_prefs` JSON containing `domainDefaults: { diagnostics: 'allow'|'ask'|'deny' }` parses and persists instead of the key being silently dropped as unknown.
- Settings and admin `kind: 'domain'` toggles accept `domain: 'diagnostics'` (previously 422 `unknown tool domain`).
- Any future `TOOL_METADATA` entry classified under `diagnostics` emits `toolDomain: 'diagnostics'` analytics facts accepted by the fact schemas, carries that domain in disclosure briefs, inherits the implicit-`allow` permission default, and is guest-eligible when read-risk. All existing tool classifications stay byte-identical (`EXPECTED_STATIC` table in `tests/tools/tool-metadata.test.ts` is unchanged).

## Verification
- `tests/tools/tool-metadata.test.ts`: extend the `isToolDomain` case with `expect(isToolDomain('diagnostics')).toBe(true)` (file has a mutation floor of 1 in `scripts/mutation/baseline.json`; the new array literal needs a killing assertion). The existing `EXPECTED_STATIC` count/equality test proves no metadata entries were added.
- `tests/analytics/tool-classification.test.ts`: pin the exact contents of the newly exported `DOMAIN_MAP` (object equality including `diagnostics: 'diagnostics'`) so the new entry's string literal is mutation-covered even before any diagnostics tool exists.
- Analytics fact-schema test (follow the local pattern in `tests/analytics/normalizer.test.ts` / `event-props` suites): a `tool_started`/`tool_completed` props payload with `domain: 'diagnostics'` validates; one with a bogus domain still rejects.
- Tool-preferences test (follow the local pattern): `parseToolPrefs('{"domainDefaults":{"diagnostics":"ask"}}')` preserves `diagnostics: 'ask'`; empty prefs still resolve every tool to `allow` via `resolveToolPermission`.
- In the loop: `bun run test:affected`, then the full `bun run test` plus `bun run lint` and `bun run typecheck` before done — `typecheck` alone additionally proves the `Record<ToolDomain, …>` exhaustiveness of `DOMAIN_MAP`.
