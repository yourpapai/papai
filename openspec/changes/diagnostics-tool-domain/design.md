## Context

See `proposal.md` for motivation and the stated assumptions.

The domain list is closed in exactly one place: `TOOL_DOMAINS` in `src/tools/tool-metadata.ts`. Everything downstream is generic over `ToolDomain`:

- `ToolPrefs.domainDefaults` (`src/tools/tool-preferences.ts`) parses/validates keys against the domain set and resolves permissions override → domain → risk → implicit `allow`.
- Settings and admin routes (`src/debug/settings/tools-routes.ts`, `src/debug/settings/admin/tool-defaults-routes.ts`) validate `kind: 'domain'` payloads via the exported `isToolDomain`, returning `422 unknown tool domain` otherwise. The settings-UI client schema (`client/settings/fetcher-schemas-tools.ts`) is a plain `z.string()` — no client change needed.
- Presets (`PRESET_RISK_DEFAULTS`) are risk-keyed; admin seeding and `reconcile-durable.ts` (`perToolDomain` free-form record) are domain-agnostic.
- Analytics maps `ToolDomain` onto a **separate bounded enum** `AnalyticsToolDomain` via the module-private `DOMAIN_MAP: Record<ToolDomain, AnalyticsToolDomain>` in `src/analytics/tool-classification.ts`; the fact schemas in `src/analytics/event-props-execution.ts` restate that enum as two `z.enum([...])` literals (`ToolStartedPropsSchema`, `ToolCompletedPropsSchema`). Facts are stored as unconstrained TEXT — no DB CHECK constraint, no migration.
- Disclosure briefs and the `search_tools` hint derive domain from `getToolMetadata`, so they follow classification automatically.

Constraint: `TOOL_METADATA` keys feed `BUILTIN_TOOL_NAMES` → analytics slug generation → behavior-audit closure, so no metadata entries may be added for tools that do not exist yet.

## Goals / Non-Goals

**Goals:**
- `diagnostics` accepted by every domain-validating surface with existing classifications byte-identical.
- Every new string literal (domain array entry, enum members, mapping entry) covered by a mutation-killing assertion even though no diagnostics tool exists yet.

**Non-Goals:**
- No actual diagnostics tools, no `TOOL_METADATA` entries, no UI/preset changes, no new permission-defaulting mechanism (implicit `allow` like every unlisted domain).
- No DB migration or backfill — no persisted schema changes.

## Decisions

1. **New bounded `AnalyticsToolDomain` member `'diagnostics'`** (identity-mapped in `DOMAIN_MAP`), not collapsing onto `'config'` or `'other'`. Precedent: `'coding'` was added for the first-party ACP plugin. The alternatives lose analytical signal; reusing the reserved `'config'` bucket would also contradict the spec scenario pinning `domain: 'diagnostics'` on diagnostics tool facts. The `Record<ToolDomain, …>` typing of `DOMAIN_MAP` makes the mapping entry compile-forced once `TOOL_DOMAINS` grows — `typecheck` alone proves exhaustiveness.
2. **Export `DOMAIN_MAP`** (currently module-private). Without an exported seam, the new `diagnostics: 'diagnostics'` literal is untestable until the sibling change registers a real tool; exporting lets `tests/analytics/tool-classification.test.ts` pin the full mapping by object equality, killing string mutants now. Alternative (classify-through-a-fake-tool test) rejected: it would require a `TOOL_METADATA` entry, which is forbidden.
3. **Extend the two `z.enum` literals in `event-props-execution.ts` in place** rather than extracting a shared `AnalyticsToolDomainsSchema`. The file's convention is inline literals per schema; extraction is a behavior-neutral refactor that widens the diff. Drift between the two literals and the union is caught by the fact-schema tests below.
4. **Domain added empty, tools come later.** No `TOOL_METADATA` entries — phantom names would pollute slug generation and the behavior-audit closure. Guest eligibility and disclosure need no code: `applyGuestReadOnlyFilter` (`src/tools/index.ts:73`) admits read-risk tools by risk, and briefs derive domain from metadata.
5. **Docs updated where the bounded list is restated**: `src/tools/AGENTS.md` (the "richer domains collapse onto …" sentence), `docs/architecture/tools.md` if it repeats the list, and `docs/research/analytics-metrics/02-metric-catalog.md` (the `tool_started`/`tool_completed` domain-enum rows).

**Scope-model impact**: none. No new persisted state is keyed anywhere; the only affected stored state is pre-existing `tool_prefs`, which stays keyed by the config-context id (group-shared across a group's threads), so a group-level `diagnostics` default already applies per-thread exactly like every other domain.

**Capability/tool-prefs gating impact**: none new. Diagnostics tools (when they arrive) resolve permissions through the standard override → domain → risk → `allow` precedence, pick up the `ask` confirmation wrapper, and are guest-eligible iff read-risk.

## Risks / Trade-offs

- [Bounded analytics enum keeps growing with every domain] → Mitigation: the exported, test-pinned `DOMAIN_MAP` documents the full collapse mapping in one place; docs restate it so the next addition is a two-line change.
- [Mutation floor regression — new literals are trivially killable but only if asserted] → Mitigation: four targeted assertions (see tasks): `isToolDomain('diagnostics')`, `DOMAIN_MAP` object-equality, fact-schema accepts `diagnostics` / rejects bogus, `parseToolPrefs` preserves `diagnostics`.
- [Rollback asymmetry] → facts written with `domain: 'diagnostics'` fail schema validation under rolled-back code. Accepted: analytics is additive, dashboards bucket unknown domains, and the volume is zero until the sibling change ships tools.

## Migration Plan

Code-only deploy; no drizzle migration, no backfill (facts are TEXT without CHECK constraints; `tool_prefs` JSON already tolerates new domain keys — they were merely dropped before). Rollback = revert; the only post-rollback artifacts are rejected-in-flight analytics facts per above.

**TDD order** (src edits are gated by the Write/Edit hook pipeline; docs files are not). For each pair, land the failing test first, then the src edit:
1. `tests/tools/tool-metadata.test.ts` — extend the `isToolDomain` case with `expect(isToolDomain('diagnostics')).toBe(true)`; existing `EXPECTED_STATIC` equality proves no metadata entries were added → then edit `tool-metadata.ts`.
2. `tests/analytics/tool-classification.test.ts` — pin exported `DOMAIN_MAP` contents including `diagnostics: 'diagnostics'` → then edit `tool-classification.ts`.
3. Analytics fact-schema test (follow the local `normalizer.test.ts` / event-props pattern): `domain: 'diagnostics'` validates on both schemas; a bogus domain still rejects → then edit `event-props-execution.ts`.
4. Tool-preferences test (local pattern): `parseToolPrefs('{"domainDefaults":{"diagnostics":"ask"}}')` preserves the entry; empty prefs still resolve to `allow` — no src change needed (the parse path is generic once the domain exists), so this pair is regression-only.
5. Docs edits last (no hook, no tests).

In the loop: `bun run test:affected`, then full `bun run test` + `bun run lint` + `bun run typecheck` (typecheck additionally proves `DOMAIN_MAP` exhaustiveness).