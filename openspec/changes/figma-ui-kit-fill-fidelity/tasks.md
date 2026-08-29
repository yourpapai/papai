## 1. Preparation

- [x] 1.1 Baseline audit (mirroring the prior two kit changes): `bun run figma:connect validate` (expect `status=ok components=34 screens=5 sections=13`), `bun run figma:connect plan`, live read-back of all 34 component descriptions, and resolution check of all 18 screen/section node ids; run the container fill scan over page `18:2` and record its full output in `audit-baseline.md` — verify: read-back `mismatches: 0` + scan reproduces the 69-container defect set
- [x] 1.2 Build the per-node fix inventory: classify every flagged node per design D1 by reading its mapped `client/` source CSS (structural → transparent; surface → literal token hex; element-white → keep-list with evidence); record prior fills, classification, source evidence, and target fill per node id in `audit-baseline.md` — verify: inventory covers exactly the scan output, every target fill names its source token or `transparent`, every keep-list entry cites source CSS

## 2. Component definitions (fix first — instances propagate)

- [ ] 2.1 Fix `ui/PageHeader` (component fill + `Text` + `Action`) and `ui/TopBar` (`Brand`) per the inventory, fill-only edits in one `use_figma` call returning mutated ids; never touch instance-internal nodes — verify: mutated ids match the inventory's component rows
- [ ] 2.2 Visual check of both components and one screen containing their instances (`screen/MembersSection`): instance whites cleared via propagation, no overrides added — verify: fill scan shows zero white frames under `ui/PageHeader`, `ui/TopBar`, and instance subtrees

## 3. Screen fixes (one batch per screen, visual pass immediately after each)

- [ ] 3.1 `screen/SettingsApp` (25 nodes): apply inventory fills in ≤10-node `use_figma` batches, then `get_screenshot` pass — verify: scan clean for this top + screenshot shows dark theme with legible headings and no white blocks
- [ ] 3.2 `screen/ToolsSection` (19 nodes): same batch-then-screenshot loop — verify: scan clean + screenshot readable
- [ ] 3.3 `screen/MembersSection` (remaining screen-local nodes): same loop — verify: scan clean + screenshot readable
- [ ] 3.4 `screen/OverviewSection (admin)` (6 nodes): same loop — verify: scan clean + screenshot readable
- [ ] 3.5 `screen/TaskProviderSection` (4 nodes): same loop — verify: scan clean + screenshot readable

## 4. Verification

- [ ] 4.1 Post audit vs baseline: re-run validate + plan + live read-back (`mismatches: 0`), all 52 registered ids still resolve, names/variant definitions unchanged; re-run the fill scan (expect zero default whites outside the keep-list) and confirm fill deltas vs the old baseline equal exactly the inventory's fixed set; record everything incl. the D4 supersession note in `audit-post.md` — verify: `mismatches: 0` + scan clean + deltas reconcile
- [ ] 4.2 Full visual pass across all 5 screens and the 2 fixed components: dark-theme readability (headings, surfaces on dark, no white blocks); record any accepted exceptions in `audit-post.md` — verify: no unexplained exceptions
- [ ] 4.3 Run full `bun test`, `bun run typecheck`, `bun run lint` (repo diff is openspec artifacts + audit files only; expect green) and confirm no `src/`, `client/`, `scripts/figma/`, or docs changes are needed — verify: all three commands pass + `git status` shows only change-folder files
- [ ] 4.4 Archive this change only after `figma-ui-kit-components` and `figma-ui-kit-backdrops` archive (the delta extends their pending `figma-ui-kit` capability) — verify: archive order respected
