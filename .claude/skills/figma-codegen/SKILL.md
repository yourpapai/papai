---
name: figma-codegen
description: Use when generating code from any papai Figma node — design-to-code on papai files, translating a Figma frame/component/section into client/ code, or checking whether a Figma node maps to a real papai Svelte component. Resolves CODE: descriptions to live Svelte sources instead of emitting the generic sketch.
---

# Figma codegen (papai components from Figma nodes)

Generate papai-idiomatic Svelte from papai Figma nodes: resolve mapped components
to their live sources, translate props through the registry, and verify the
result against the design.

<HARD-GATE>
This skill is MANDATORY before any figma design-to-code task on papai Figma
files. When a mapped component is involved, the generic design-to-code sketch
(restyled divs, invented Tailwind classes) MUST NOT be the final output.
</HARD-GATE>

## When to Use

- Any design-to-code request that targets a papai Figma file (settings/admin
  screens, shared-ui components).
- Translating a Figma frame, component, or screen section into `client/` code.
- Checking whether a Figma component maps to real code before generating.

**Do NOT use** for: syncing story screenshots into Figma (`bun figma:sync`,
see `docs/architecture/storybook-screenshots.md`); UX review (`ux-review`
skill); regenerating Figma frames from code.

Background reading: `docs/architecture/figma-codegen.md` (registry, push,
verify loop end to end).

## The registry

`scripts/figma/registry.json` is the source of truth for the component↔code
mapping. Each entry carries the Figma node id, the repo source path, a
property dictionary (Figma property name → code prop), and value maps (Figma
value → code value). `bun figma:connect validate` checks it headlessly.

Components first: the base kit (`ui/Btn`, `ui/Input`, `ui/Field`,
`ui/PageHeader`, `ui/SidebarLink`, `ui/TopBar`) must resolve before any
screen-section entry is used.

## Procedure

1. **Read the node.** Use `get_design_context` (Figma MCP) on the target node.
   Figma surfaces each component instance's name, properties, and the
   component description verbatim.

2. **Parse `CODE:` descriptions.** A description starting with `CODE:` is the
   canonical mapping, one concern per `|`-separated clause in stable order:

   ```
   CODE: client/shared/ui/Btn.svelte | props: Variant→variant, Label→children | values: Primary→primary, … | section: Bind form
   ```

   - `CODE:` — the repo source path (relative to repo root) that renders this node.
   - `props:` — Figma property name → code prop, comma-separated, `→` between the pair.
   - `values:` — Figma value → code value, same shape.
   - `section:` — present only on screen-section entries; names the region.

   Note: only **components** carry `CODE:` descriptions — Figma frames
   (screens, section regions) have no description field. Resolve a screen or
   section frame by looking its **frame name** up in
   `scripts/figma/registry.json` (`screens`/`sections` collections) or in
   `bun run figma:connect plan` output (`name`/`figmaNode`/`description`).

3. **Read the live source.** Open the mapped `.svelte` file and read its
   `interface Props` before emitting code. The registry dictionary is the
   translation table, but the source is the contract — emit the component as
   it exists now, not as the sketch imagines it.

4. **Translate props.** For each Figma property on the instance: map the name
   through `props:`, map the value through `values:`, then emit real usage —
   e.g. a `ui/Btn` instance with `Variant=Danger`, `Label=Remove` becomes
   `<Btn variant="danger">Remove</Btn>` with the mapped import.

   - A Figma property with **no entry in the dictionary is omitted** — never
     invent a code prop for it.
   - A value with no entry in the value map is reported (see drift rule).

5. **Compose screens from registered sections.** For a registered screen,
   resolve each registered section to its source region and compose the
   output from those regions. Any region with no registered section falls
   back to faithful structure from the design **and is marked unmapped** in
   the output (a short note naming the region), never silently invented.

6. **Surface drift — never silently resolve it.** When Figma and source
   disagree (renamed prop, missing variant, value map gap), report the
   mismatch explicitly in the response, then proceed using only the
   properties both sides share. Do not pick a side quietly.

7. **Refresh stale mappings.** When a mapped component's description is
   missing, does not start with `CODE:`, or disagrees with
   `bun run figma:connect plan` output: run

   ```bash
   bun run figma:connect plan
   ```

   and push each returned payload for a **component** node to its description
   via the Figma MCP (`use_figma`, setting the node's `description` to the
   payload's `description` field). Screen and section frames cannot store
   descriptions — their mapping lives in the registry, keyed by frame name;
   verify (don't push) them against plan output. Plan is deterministic, so
   re-pushing an unchanged registry is a no-op. If `plan` output disagrees
   with the live Figma property definitions (renamed/removed component
   properties), fix `scripts/figma/registry.json` first — the registry is the
   source of truth, Figma descriptions are a projection of it.

8. **Verify the result.** After generating code for a mapped component or
   section, run the compare loop (`bun run figma:verify --story <baseline>
--figma <png-or-node-id>`; see "Verifying generated code against designs"
   in `docs/architecture/storybook-screenshots.md`) and report the measured
   diff. Report-only: it never edits code or baselines.

## Output contract

- Mapped components appear as real papai components with mapped imports.
- Unmapped Figma properties are omitted, never invented.
- Unregistered screen regions are flagged as unmapped.
- Drift is reported in the response, not silently resolved.
- The verification measurement is reported with the paths to both renders.
