# figma-codegen-fallback — design

## Context

This session proved the load-bearing facts (see proposal Why): `get_design_context` on Pro hoists Figma instances into parameterized components from `componentPropertyDefinitions`, and surfaces component descriptions verbatim — our `ui/Btn`/`ui/PageHeader` descriptions (prefixed `CODE:`) flowed through including node ids. The repo already owns: `scripts/figma-sync-lib.ts` + `scripts/figma-sync.ts` (manifest/serve/report pipeline), the `scripts/figma-sync-plugin/` dev plugin (the only Figma-write path reachable from repo code), the `bun shoot` story infra with PNG baselines under `.storybook-shots/`, and a project-skill convention at `.claude/skills/` (`ux-review`). Figma side already has page `Editable UI` with components (`ui/Btn` 19:35, `ui/Input` 22:45, `ui/Field` 22:47, `ui/PageHeader` 22:52, `ui/SidebarLink` 22:62, `ui/TopBar` 22:65) and screens (22:198, 23:58, 23:103, 25:133, 25:221) with `⟶` captions.

## Goals / Non-Goals

Goals: one source of truth for the mapping (repo); validation that turns drift into a failing check; an agent protocol that changes design-to-code output; an objective conformance signal for generated code.

Non-Goals: restating proposal Non-goals. Additionally: not building a general Figma↔code sync (PNG lane stays in `figma:sync`); not parsing Svelte source with the ts-ast seam in v1 (see Decision 4).

## Decisions

1. **Registry is a JSON file in repo, descriptions are a projection.** Alternative considered: Figma descriptions as truth (thin) — rejected because descriptions are unversioned, hand-editable, and undriftable; the registry costs one file and makes the mapping reviewable in PRs and testable headless. Shape mirrors the proposal: `{ name, figmaNode, source, props: { figma → code }, values: { figma → code } }`, sections as a second collection (`{ screen, section, figmaNode, source }`).

2. **`bun figma:connect` splits into a headless core and an agent-run push.** Registry-vs-repo validation (sources exist, schema well-formed) runs in tests with zero Figma access. Figma-side checks (node resolves, `componentPropertyDefinitions` match) and the description push need MCP/plugin auth that repo scripts cannot hold (learned building `figma:sync`), so push is an agent-invoked step: the skill instructs running it via `use_figma` with the canonical description format from the registry. Alternative: extend the `figma-sync-plugin` localhost flow with a "describe" op — rejected for v1; component sets change rarely and the plugin round-trip is heavy. The plugin route stays the documented upgrade path if push frequency ever justifies it.

3. **Canonical description format is machine-parsed, human-readable.** One line per concern, stable order: `CODE: <source> | props: Variant→variant, Label→children | values: Primary→primary, … | section: <name> (screens only)`. The skill teaches parsing this format; the push writes exactly it; idempotence falls out of determinism.

4. **v1 does not parse Svelte sources.** Property dictionaries are hand-maintained in the registry (6 components, small surface). The ts-ast seam parses TypeScript, not `.svelte`; regex-extracting `interface Props` is possible but brittle. Drift is caught behaviorally instead: Decision in the skill spec (surface mismatches) plus the verification loop. A `figma-codegen` follow-up can add AST extraction if hand-maintenance bites.

5. **Pixel diff via `pixelmatch` + `pngjs` (devDependencies).** Existing `figma-sync-lib` reads only IHDR headers; diffing needs full decode. The stack has no image-decode dependency; a hand-rolled PNG decoder fails the minimality ladder (stdlib/installed-dep question answers "no"). Both are tiny, zero-transitive-dep libraries, dev-only. Threshold default 0.1 (pixelmatch convention), configurable per run.

6. **Verification loop is a script (`bun figma:verify`), not a hook.** It runs on demand after a codegen task, taking `--story <path> --figma <nodeId>`; the Figma render arrives via `figma download_assets` (agent-run, same auth constraint as Decision 2) or an existing PNG. Report-only per spec; wiring it into the Write/Edit TDD hook pipeline is explicitly out of scope.

7. **Skill placement and routing.** `.claude/skills/figma-codegen/SKILL.md`, following `ux-review`'s structure; a CLAUDE.md routing-table row marks it required before figma design-to-code work. It encodes: parse `CODE:` descriptions → read live Svelte source → emit mapped usage; compose screens from registered sections; flag unmapped regions; surface drift; then run `bun figma:verify`.

## Risks / Trade-offs

- [Agent ignores the skill] → Skill declares itself mandatory for papai figma codegen and is routed from CLAUDE.md; verification loop catches violations objectively.
- [Node ids churn if Figma components are recreated] → Registry validation fails loudly; re-pointing an id is a one-line registry edit plus re-push.
- [pixelmatch on 2× vs 1× renders produces false mismatches] → `bun shoot` and the Figma export both normalize to a documented scale before diffing; threshold tunable per run.
- [Hand-maintained prop dictionaries drift] → Figma-side validation compares dictionary against live `componentPropertyDefinitions`; Svelte-side drift is surfaced by the skill's drift rule in the moment of codegen.

## Migration Plan

Additive: new registry file, new script, new skill, docs rows. Nothing existing changes behavior (`figma:sync` untouched). Rollback = delete the four additions. No data migration.

## Open Questions

None deferred — granularity (components→screens), audience (agents), and verification scope were resolved with the user during exploration; remaining choices above are implementation-level.
