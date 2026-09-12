## 1. Hygiene first

- [ ] 1.1 In `.gitignore`, replace the stale nested-era `codeindex/.codeindex/` pattern with a root `.codeindex/` pattern. Verify: `git check-ignore -v .codeindex/index.db` resolves to the new pattern, and `grep -n "codeindex" .gitignore` shows no `codeindex/`-prefixed leftover.

## 2. Freshness ownership

- [x] 2.1 Delete `.opencode/plugins/codeindex-reindex.ts` (server watcher owns freshness; no test references it; `@opencode-ai/plugin` dep stays for the three remaining plugins). Verify: `test ! -f .opencode/plugins/codeindex-reindex.ts && grep -rn "codeindex" .opencode/plugins/ --include="*.ts" | grep -v node_modules` returns nothing.

## 3. Index coverage and protocol truth

- [x] 3.1 Widen `.codeindex.json` `roots` to `["src", "client", "plugins"]`, then rebuild this worktree's index. Verify: `grep -n '"plugins"' .codeindex.json` and `bun run codeindex:reindex && bun run codeindex:stats` exits 0 with the index built under the now-ignored `.codeindex/` (tree stays clean per 1.1).
- [x] 3.2 In `CLAUDE.md`: fix the codeindex location pointer (sibling-clone layout at `../codeindex` relative to the main checkout, `CODEINDEX_DIR` override, README setup section as canonical); replace the reindex-plugin sentence with the server-watcher truth (boot probe + in-session fs.watch; `code_index` `mode: "incremental"` as the manual escape hatch); extend the protocol's indexed-roots mentions from `src/`/`client/` to include `plugins/`. Verify: `grep -n "codeindex" CLAUDE.md` shows no `~/Projects/papai/codeindex` path, no plugin-reindex claim, and `plugins/` in the protocol rows (AGENTS.md follows via symlink: `grep -c plugins CLAUDE.md AGENTS.md` equal).

## 4. Skill propagation

- [x] 4.1 Add one deferential codeindex line (naming `code_symbol`/`code_search`/`code_impact` and pointing at the root protocol, no restated rules) to `figma-codegen`, `syncing-plan-with-code`, and `designing-new-provider` (`.claude`/`.agents` hardlink pair) and to `openspec-verify-change` (hardlink pair plus the independent `.opencode/skills` copy, preserving its `/opsx-` command-name divergence). After each edit, confirm the hardlink pair still shares an inode and `ln -f` to restore if the write broke it. Verify: `grep -rln "codeindex" .claude/skills .agents/skills .opencode/skills` lists exactly the four skills in the pair trees and the one skill in `.opencode`, and `stat -f "%i" .claude/skills/<skill>/SKILL.md .agents/skills/<skill>/SKILL.md` matches for all four.

## 5. Claude Code parity

- [x] 5.1 Add `"enabledMcpjsonServers": ["codeindex"]` to `.claude/settings.json`, then verify in a live Claude Code session that the server connects without an approval prompt and tolerates the opencode-flavored `.mcp.json` keys; if Claude Code rejects the file, apply the design D5 split (vanilla `.mcp.json`, opencode-specific keys into `opencode.json`) and re-verify. Verify: session shows the codeindex tools available; `grep -n enabledMcpjsonServers .claude/settings.json`.

## 6. README setup story

- [x] 6.1 Add a developer-tooling section to `README.md`: sibling-clone steps (`git clone` + `bun install`), `CODEINDEX_DIR` override, `codeindex:index`/`reindex`/`stats` scripts, per-worktree lazy index (builds on first tool call, one-time v5-schema rebuild expected), and the remedies matching the shim's refusal message. Verify: `grep -n "CODEINDEX_DIR\|codeindex:index\|worktree" README.md` returns hits for each.

## 7. Live smoke and verified-commit recording

- [x] 7.1 Operator-run smoke from this worktree (outside the suite, per repo live-proof convention): `bun run scripts/codeindex-cli.ts mcp` starts and answers all four tools, including a `code_search`/`code_symbol` hit for an exported symbol under `plugins/`; edit an indexed file and observe no spawned reindex process (only in-server watcher status movement); then record the sibling HEAD verified against (`git -C ../codeindex rev-parse --short HEAD` at smoke time) in the README section from 6.1. Verify: the recorded hash is greppable in README.md (`grep -n "verified against" README.md`).

## 8. Full gates

- [x] 8.1 Run the full suite and checks, update any affected docs (`CLAUDE.md`/`README.md` covered in 3.2/6.1; no `docs/architecture/` page changes required — no runtime behavior changed), and run `bun security` since a plugin-surface path was touched. Verify: `bun run test`, `bun run typecheck`, `bun run lint`, `bun security` all green; `openspec validate codeindex-integration-refresh --strict` passes.
