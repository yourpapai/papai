# Design — Figma UI kit fill fidelity

## Context

See proposal.md — Why. Verified state: a programmatic scan of page `18:2` found 69 white-filled containers, all `FRAME` nodes (zero text/vector nodes flagged, so element-level whites are not part of the defect set). Per top: `ui/PageHeader` 2 + its own white component fill, `ui/TopBar` 1, `screen/SettingsApp` 25, `screen/ToolsSection` 19, `screen/MembersSection` 11, `screen/OverviewSection (admin)` 6, `screen/TaskProviderSection` 4. Some screen-level flags are instance-internal (`I…;22:53`, `I…;22:66` shapes) — they inherit from the two broken components and resolve at the definition. Screens and healthy components already use the kit language: dark `#0a0c0a` page fill, dark surface fills, transparent structural frames (established by `figma-ui-kit-backdrops`). The 28 new kit components and 4 other base components scanned clean.

## Goals / Non-Goals

**Goals:**

- An exact, per-node fix inventory (id, name, classification, target fill) recorded before any edit.
- Zero default-white container fills remaining, with a recorded keep-list for intentional whites.
- Fix at definitions so instances propagate; no registry, id, name, variant, or description churn.

**Non-Goals:**

- Geometry, hierarchy, or content edits; new nodes; reparenting.
- Token/variable migration; docs changes; `client/` or `scripts/figma/` edits.

## Decisions

### D1. Three-way classification, decided against the mapped source

Every flagged node is classified by reading the CSS of its `client/` source region (the kit's fidelity standard):

1. **Structural** — the app renders nothing here (layout grouping: `Grid`, `Nav`, `Kicker`, section wrappers, form shells) → `fills = []`.
2. **Surface** — the app paints a visible surface (panel, field, table row) → literal hex from the source's rendered token (`--surface-1`/`--surface-2`/… as in `client/shared/tokens.css`), matching the kit's literal-colors convention.
3. **Element white** — the source itself renders white (text fills, icon strokes, badges like the ADMIN chip if its CSS says white) → keep; node goes on the keep-list.

Classification happens per node during apply, with the source evidence recorded in `audit-baseline.md`; anything ambiguous lands on the keep-list and is reported, never guessed. *Alternative*: bulk-clear every white fill — rejected: it would erase intentional whites and paint nothing where the app shows a surface.

### D2. Fix definitions, never instance internals

Only the 5 screen frames and the 2 component definitions (`ui/PageHeader` itself + children, `ui/TopBar` → `Brand`) are edited. Instance-internal flagged nodes (each screen's PageHeader `Text`/`Action`, TopBar `Brand`) are left alone; they update via propagation. *Alternative*: per-instance overrides — rejected: override pollution, and it would desync instances from their (fixed) source, which the registry read-back treats as drift.

### D3. Fill-only edits, batched and id-anchored

Edits go through `use_figma` in ≤10-node batches keyed by the id list from the inventory (ids are stable — no structural ops are performed). Each node's prior fill is recorded before overwriting (rollback data). No text mutations, so the font-load recipe never triggers. Mutated ids are returned per call and reconciled against the inventory at the end.

### D4. Re-baseline the audit trail with explicit supersession

`figma-ui-kit-components`/`-backdrops` audits froze component fills as "unchanged". This change records a new baseline in its own `audit-baseline.md` (pre-fix scan output + the 69-node defect table), then `audit-post.md` asserts: descriptions byte-identical to `plan` (`mismatches: 0`), ids/names/variants unchanged, and fill deltas vs the old baseline exactly equal to the enumerated defect set (minus keep-list). The supersession of the two components' frozen fills is stated in both files so future audits don't misread it as drift.

### D5. Verify by scan + visual pass

After fixes: re-run the fill scan (expect: zero default whites outside the keep-list) and a `get_screenshot` pass over all 5 screens plus the 2 components, checking dark-theme readability (headings legible, surfaces sit on dark, no white blocks). Exceptions are recorded, not silently accepted.

## Risks / Trade-offs

- [A white container was intentional after all] → D1 forces a per-node source check and keep-list; screenshots catch mistakes; rollback restores the recorded prior fill.
- [Transparent parent reveals a hidden white descendant or wrong stacking] → per-screen visual pass immediately after that screen's batch, not one pass at the very end.
- [Scan over- or under-matches (opacity/visibility edge cases)] → the scan is the inventory generator and the acceptance check, so both sides use the same predicate; keep-list covers intentional survivors.
- [Instance propagation silently skipped (definition fix missed)] → D5's scan would still flag instance-internal whites; reconciliation of mutated ids vs inventory catches unedited definitions.
- [Future audits compare fills against the pre-fix baseline] → D4 records the supersession explicitly in the change's audit files.

## Migration Plan

Fill-only, additive-risk zero: inventory → per-top batches (components first so instance whites clear early) → scan + visual pass → audit-post. Rollback per node = restore the recorded prior fill from `audit-baseline.md`. Archive order: after `figma-ui-kit-components` and `figma-ui-kit-backdrops` (delta extends their pending `figma-ui-kit` capability).

## Open Questions

None.

## TDD / Hook Interactions

No `src/` or `client/` files are created or edited, so the Write/Edit TDD hook pipeline gates nothing beyond the change artifacts themselves; repo diff during apply is openspec artifacts + the two audit files, mirroring `figma-ui-kit-backdrops` (docs-only green: `bun test`, `bun run typecheck`, `bun run lint` still run as the section-4 gate).
