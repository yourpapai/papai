## 1. Preparation

- [x] 1.1 Baseline audit (preserve-check input, mirroring `figma-ui-kit-components`): `bun run figma:connect validate` (expect `status=ok components=34 screens=5 sections=13`), `bun run figma:connect plan`, live read-back of all 34 component descriptions, and resolution check of all 18 screen/section node ids; record in `audit-baseline.md` in the change folder — verify: validate ok + read-back `mismatches: 0`
- [x] 1.2 Read each of the 34 mapped sources' CSS and pick its plate fill (default `#0a0c0a`; `--surface-1`/`--surface-2` where the source composes onto a panel surface); record the per-component fill table in `audit-baseline.md` — verify: every entry has a fill + source token named

## 2. Backdrop plates (Figma, file `o8B8JfxhFeOHqIfpv0eSdZ`, page `Editable UI`)

- [x] 2.1 Create the `backdrop/<name>` plate frames behind all 34 kit component sets per design D4 (sibling frames, set + padding, `#828d84` label, ≤10 ops per `use_figma` call, fills from 1.2); never reparent or edit a component — verify: layer tree shows plates as siblings named `backdrop/*`
- [x] 2.2 Visual pass (`get_screenshot` over page regions): every transparent-background component (`ui/Select`, `ui/Segmented`, `ui/Pill` neutral/mute, `settings/SettingsTable`, …) is legible on its plate — verify: no light-on-light rendering; note exceptions (if any) in `audit-post.md`

## 3. Docs

- [x] 3.1 Add a backdrop-plate note to `docs/architecture/figma-codegen.md`: plates are canvas furniture (`backdrop/*` sibling frames) — never component content, never registry entries, never codegen input — verify: note present and consistent with skill wording
- [x] 3.2 Add the same one-line rule to `.claude/skills/figma-codegen/SKILL.md` step 1 (read the node) — verify: skill text updated

## 4. Verification

- [x] 4.1 Post audit vs baseline: re-run `validate` + `plan` + live read-back (`mismatches: 0`), all 34 component node ids resolve, component fills/variants/descriptions unchanged, 18 screen/section ids unchanged; record in `audit-post.md` — verify: `mismatches: 0` + no baseline drift
- [x] 4.2 Run full `bun test`, `bun run typecheck`, `bun run lint` (repo diff is docs-only; expect green) and confirm the two doc updates from section 3 are the only repo changes — verify: all three commands pass
- [x] 4.3 Archive this change only after `figma-ui-kit-components` archives (the delta presumes the `figma-ui-kit` capability spec that change creates) — verify: archive order respected
