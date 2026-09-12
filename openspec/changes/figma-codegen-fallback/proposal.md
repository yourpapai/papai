# figma-codegen-fallback — proposal

## Why

Agents translating papai's Figma boards into code get generic React+Tailwind sketches instead of the real Svelte components from `client/shared/ui`. Official Figma Code Connect — which would render prop-accurate snippets — requires Organization/Enterprise; fpv.dev is Professional. A spike confirmed that on Pro, `get_design_context` already surfaces component instances, their properties, and component descriptions (`ui/Btn → client/shared/ui/Btn.svelte` flowed through verbatim). A repo-owned protocol can therefore deliver the agent-facing value of Code Connect at zero plan cost.

## What Changes

- Add a **registry** (`scripts/figma/registry.json`): Figma component/section → Svelte source, Figma-property → code-prop dictionary, value maps (`Primary` → `primary`). Components first, then the five existing editable screens' sections.
- Add **`bun figma:connect`**: validates the registry (sources exist; Figma node ids and property definitions current) and pushes canonical `CODE:` descriptions into Figma.
- Add the **`figma-codegen` agent skill**: when generating code from papai Figma nodes, resolve `CODE:` descriptions → read the live Svelte source → emit real papai components with mapped props instead of the generic sketch.
- Add a **verification loop**: after generation, render the touched component/section via the existing `bun shoot` story infra and pixel-compare against the Figma-side render; report diffs.

## Capabilities

### New Capabilities

- `figma-codegen-registry`: versioned mapping plus validation/push. Without it, agents guess component mappings and stale node ids or descriptions go undetected — the bridge silently rots.
- `figma-codegen-skill`: the agent-facing protocol. Without it, descriptions surface but nothing obligates an agent to honor them; output stays generic.
- `figma-codegen-verification`: the compare loop. Without it, generated code has no design-conformance check beyond eyeballing.

### Modified Capabilities

None — no existing spec under `openspec/specs/` governs Figma tooling.

## Impact

- Extends the `scripts/figma-sync-lib.ts` family (new `scripts/figma-connect.ts` + registry) rather than a new pipeline; the skill follows the existing `.claude/skills/` convention (`ux-review`). Docs affected: `docs/architecture/commands.md`, `docs/architecture/storybook-screenshots.md`, CLAUDE.md skill routing table.
- Developer tooling only: no runtime surfaces, no platform/task instances, no persisted state, no scope-model impact, no new runtime dependencies (any devDependency for PNG diffing is justified in design.md).
- Known ceiling: the fallback reads live source through an agent, so it can be fresher than a published template, but it cannot provide the Dev Mode snippet panel or deterministic template execution.

## Non-goals

- Official Code Connect parity (`.figma.ts` templates, publish CLI, Dev Mode snippets) — needs Org/Enterprise; revisit if the plan upgrades.
- MCP auth inside repo scripts (not possible today); Figma-side validation stays agent- or plugin-run.
- Regenerating the five screens' Figma frames from code — `figma:sync`'s PNG lane is unchanged.
- Auto-committing generated code without review.
