<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Figma codegen fallback (design-to-code without Code Connect)

Official Figma Code Connect — prop-accurate snippets in Dev Mode — needs
Organization/Enterprise. This is the repo-owned fallback that delivers the
agent-facing value on a Pro plan: a versioned registry mapping papai's Figma
components and screen sections to their live Svelte sources, a validator, a
push step that stamps canonical `CODE:` descriptions onto Figma components,
an agent skill that resolves those descriptions to real papai code, and a
report-only pixel compare for the result.

## The pieces

| Piece                                   | What it does                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `scripts/figma/registry.json`           | Source of truth. Components (`ui/Btn` → `client/shared/ui/Btn.svelte` + prop/value dictionaries), screens, and screen sections. |
| `bun figma:connect validate`            | Headless check: registry schema, mapped sources exist, base kit present, sections reference registered screens. Exit non-zero naming offenders. |
| `bun figma:connect plan`                | Prints the canonical `CODE:` payload per mapped node. Touches nothing.                                   |
| Push (agent-run, via `use_figma`)       | Writes component descriptions into Figma. Repo scripts cannot reach the Figma MCP — this step is always agent-run. |
| `.claude/skills/figma-codegen/SKILL.md` | The agent protocol. Mandatory before any design-to-code task on papai Figma files.                       |
| `bun run figma:verify`                  | Pixel-compares the implemented render against the Figma render. Report-only.                             |

## The canonical `CODE:` format

One line, concerns separated by `|`, stable order:

    CODE: client/shared/ui/Btn.svelte | props: Variant→variant, Label→children | values: Primary→primary, Secondary→secondary, … | section: Bind form

- `CODE:` — repo source path rendering this node.
- `props:` — Figma property name → code prop.
- `values:` — Figma value → code value.
- `section:` — screen-section entries only.

Only **components** carry descriptions: Figma frames (screens, section
regions) have no description field, and frame annotations are typed-property
annotations with no freeform text. Screens and sections are resolved by
looking their **frame name** up in the registry (or plan output).

## Keeping the registry current

- **Re-point a moved node id**: one-line edit in `registry.json`, then
  `bun figma:connect validate`, then re-push (below).
- **Add a component/section**: add the entry (components require name, node
  id, source, `props`, `values`; sections require `screen`, `section`, node
  id, `source`), validate, re-push. Section sources are regions inside the
  screen's file — `source` is the file containing the region.
- **Prop dictionaries are hand-maintained** (v1 does not parse Svelte). When
  a component's props change in Figma or code, update the dictionary in the
  same PR as the change; the skill's drift rule catches mismatches at
  codegen time.
- Validation and push are separate on purpose: validation runs headless in
  tests/CI, the push needs the Figma MCP.

## Pushing descriptions to Figma (agent-run)

1.  Emit the payloads:

        bun run figma:connect plan

2.  Verify the file before writing: every payload carries the registry's
    `fileKey` — confirm it matches the Figma file the MCP session targets
    before pushing anything (node ids are file-scoped; a duplicated or
    re-created file breaks every lookup silently).

3.  In the Figma MCP, set each **component** node's `description` to its
    payload's `description` (`use_figma`; node ids come from the plan
    output, canonical scripts in the skill). Screen/section frames are
    verified against plan output, not pushed.

4.  Confirm idempotence: read the descriptions back and compare with plan
    output — zero mismatches means the push is a no-op from here on. Plan is
    deterministic, so re-pushing an unchanged registry writes identical
    bytes.

## Generating code from a papai Figma node (agents)

Load `.claude/skills/figma-codegen/SKILL.md` first — it is routed as
mandatory from the CLAUDE.md skill table. The short version:

1.  Read the node (`get_design_context`). Component instances surface their
    `CODE:` description.
2.  Parse the description; open the mapped `.svelte` file and read its
    `interface Props` — the source is the contract, the registry is the
    translation table.
3.  Translate props through `props:`/`values:`; omit properties with no
    dictionary entry; never invent code props.
4.  Compose screens from registered sections (resolve frame names via the
    registry); flag unregistered regions as unmapped.
5.  Surface drift explicitly (renamed prop, missing variant) — proceed only
    with what both sides share.

## Verifying generated code against designs

Report-only, on demand (see "Verifying generated code against designs" in
`docs/architecture/storybook-screenshots.md`):

    bun run figma:verify --story <baseline.png> --figma <figma.png|node-id> [--threshold 0.1]

- Story side: a `.storybook-shots/` baseline from `bun shoot`.
- Figma side: a PNG exported via the Figma MCP (`download_assets`), or a bare
  node id → explicit `status=skip` naming the missing side.
- Renders are bilinearly normalized to the smaller size before
  `pixelmatch`; pass/fail is the mismatched-pixel ratio against
  `--threshold`; failures write the diff image under `reports/figma-verify/`.

## Limits

- No Dev Mode snippet panel or deterministic template execution — the
  fallback reads live source through an agent, so it can be fresher than a
  published template but never tool-integrated.
- Hand-maintained dictionaries can drift; caught behaviorally (skill drift
  rule + verification loop), not by AST parsing.
- The verification loop is report-only and on demand — never a commit gate.
- If push frequency ever justifies it, the documented upgrade path is a
  "describe" op in `scripts/figma-sync-plugin/` (the only repo-reachable
  Figma-write path).
