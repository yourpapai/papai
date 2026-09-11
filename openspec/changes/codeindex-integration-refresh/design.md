## Context

papai's codeindex client integration landed 2026-07-09 (`.mcp.json`, worktree-aware shim `scripts/codeindex-cli*.ts`, `.codeindex.json`, `codeindex:*` scripts, opencode reindex plugin) against a server with no freshness machinery. The sibling repo shipped that machinery 2026-09-09 (in-server watcher with `isIndexable` pre-filtering, boot probe, WAL + `busy_timeout`, serve-possibly-stale). papai's shim runs the sibling's working tree live, so the watcher is already active here — the July-era plugin now spawns duplicate reindex processes beside it. `openspec/specs/` is empty; this change creates the first capability. All verification facts below were read from the current sibling HEAD.

## Goals / Non-Goals

**Goals:**

- Make the clone-based distribution model (one sibling clone serving the main checkout, all worktrees, and both agent runtimes) explicit, hygienic, and documented.
- Single owner for index freshness (the server), with the manual escape hatch preserved.
- Align index coverage with the mutation gate's product-code definition.
- Steer skill-guided structural queries to the MCP without duplicating the root protocol.

**Non-Goals:**

- Proposal-level exclusions (afk-runner arming, codeindex-repo work, further root widening, central DB, npm packaging) stay excluded.
- No new product code in `src/`/`client/`/`plugins/`; no papai DB, runtime, or chat-tool surface changes.

## Decisions

### D1 — Retire the plugin, don't keep it as belt-and-suspenders

The watcher covers the server-alive window for edits from *all* processes (fs.watch), not just opencode tool calls; the boot probe covers the dead window and — since the freshness change — serves immediately with `possibly_stale` marks while catching up in background. The plugin's only unique value (pre-warming so the next session's first query isn't stale) was eliminated by serve-immediately. Its inline `INDEXED_ROOTS`/ext/test filters duplicate `.codeindex.json` knowledge and drift the moment roots change (D2 would leave it silently wrong). Alternative — keep one release as observer — rejected: the duplicate spawns cost real WAL write contention today, and rollback is a `git revert` that restores the file verbatim.

### D2 — Roots become `["src", "client", "plugins"]`

`plugins/` (175 impl files) is product code under the same mutation-gate predicate (`isGateableImplFile`) as `src/`+`client/`; exiling it to grep-land contradicts the protocol's own promise. Workspace trees stay out: high churn, lower navigation traffic, grep acceptable (recorded as declined). Cost: ~16% corpus growth, one background catch-up. The CLAUDE.md protocol's "inside `src/`/`client/`" wording updates in lockstep.

### D3 — In-tree per-worktree DB stays; no central cache

Correctness: each worktree's DB reflects that tree's content; rebase → mtime drift → probe dirty → catch-up. Free GC: delete a worktree, its DB dies with it (a cache-dir layout keyed by path hash would orphan). Zero config: config discovery is cwd-based (`resolveRepoRoot = process.cwd()`), config is committed, so worktrees need nothing. 51 MB per actively-indexed tree × lazy lifecycle (only trees where an agent actually calls a tool build one) keeps the 56-worktree worst case hypothetical.

### D4 — Hygiene via root `.gitignore`, landing first

Replace the stale nested-era `codeindex/.codeindex/` pattern with `.codeindex/`. Sequencing: this is the change's first task — every worktree that bootstraps an index before it lands creates a 51 MB untracked blob.

### D5 — One shared `.mcp.json`, verified against Claude Code; pre-approve via settings

Keep the single opencode-flavored `.mcp.json` (lazy lifecycle, directTools) and add `enabledMcpjsonServers: ["codeindex"]` to `.claude/settings.json`. Unknown: whether Claude Code tolerates the opencode-specific keys (`settings`, `lifecycle`, `directTools`, `cwd`). Verified in the settings task by starting a Claude Code session; fallback is a split — vanilla `.mcp.json` for Claude Code, opencode-specific fields moved into `opencode.json`'s mcp entry.

### D6 — Skill propagation mechanics

`.claude/skills` ↔ `.agents/skills` are hardlink pairs (one content, two paths) but write-tools that temp+rename break the link: after each skill edit, verify both inodes still match and `ln -f` to restore if not. `.opencode/skills` holds independent copies of the openspec skills only — edit separately, preserving existing deliberate divergences (e.g. `/opsx-explore` vs `/openspec-explore` command names). Pattern: one deferential line per skill pointing at the root protocol (`code_symbol`/`code_search`/`code_impact` for structural lookups in indexed roots) — no restated tables, so nothing to drift.

### D7 — Record the verified codeindex commit

The shim runs the sibling's working tree, so papai effectively tracks codeindex HEAD (moving; exactly one tag exists). Rather than pin (overkill for a single-author pair), the README records the commit hash the live smoke verified against, making any later drift attributable.

### Hook/TDD interactions

No product code is written or modified — the one TS change is a file *deletion* (`.opencode/plugins/codeindex-reindex.ts`, zero test references). The Write/Edit TDD hook pipeline therefore gates nothing new; the shim keeps its existing coverage (`tests/scripts/codeindex-cli.test.ts`, `tests/scripts/codeindex-portability.test.ts`). Verification is greppable content checks for docs/config (repo precedent) plus one operator-run live smoke (below), which is the change's only behavioral proof.

**Live smoke (operator-run, outside the suite):** from this worktree, start the MCP via `bun run scripts/codeindex-cli.ts mcp`, assert the four tools answer (including a `plugins/` symbol), assert no reindex process spawns on an edit (only the in-server watcher status changes), and record the sibling HEAD hash in the README as part of that task.

## Risks / Trade-offs

- [Sibling HEAD regresses watcher/freshness invisibly] → D7 hash recording; the manual `code_index` escape hatch is documented in the protocol; rollback of the whole change is `git revert`.
- [Claude Code rejects the flavored `.mcp.json`] → D5 fallback split, decided by the settings task's verification, not by guesswork.
- [Hardlink breakage during skill edits] → per-file inode check + `ln -f` restore step in the tasks.
- [`plugins/` indexing adds catch-up CPU on old machines] → background catch-up only; possibly-stale serving keeps first queries unblocked.
- [Skill one-liners drift from the protocol] → single deferential pattern pointing at CLAUDE.md; no duplicated rule content.

## Migration Plan

Land in task order: hygiene (D4) → plugin retirement (D1) → roots + protocol wording (D2) → docs/skills/settings (D5–D7). Existing per-tree DBs rebuild once on the codeindex v5 schema bump — self-healing, expected, no action. Rollback: revert the commit(s); the plugin file returns verbatim from history.

## Open Questions

- Mirror `figma-codegen`/`syncing-plan-with-code`/`designing-new-provider` into `.opencode/skills` too? Deferrable — opencode's skill set is a separate curation decision with no spec impact; this change only edits skills where they already exist.
