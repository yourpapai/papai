## Why

papai's codeindex MCP integration landed in July (25447ddbb) against a server with no freshness machinery; the codeindex sibling repo shipped that machinery on Sep 9 (in-server watcher, boot probe, serve-possibly-stale). papai now runs both eras at once — every opencode edit spawns a duplicate reindex process beside the live watcher — while fresh clones/worktrees bootstrap a 51 MB untracked `.codeindex/` DB, `plugins/` product code sits outside the indexed roots, and the setup story for the clone-based distribution model exists nowhere in the docs. This change re-syncs papai's integration with codeindex's current reality.

## What Changes

- **Retire** `.opencode/plugins/codeindex-reindex.ts` — superseded by the codeindex server's own watcher (in-session `fs.watch`, 300 ms debounce, all processes) and boot probe (missing-DB bootstrap, background catch-up, immediate possibly-stale serving). The `code_index` MCP tool remains the manual escape hatch.
- **Index hygiene**: ignore root `.codeindex/` in `.gitignore` (replacing the stale nested-era `codeindex/.codeindex/` pattern). Lands first — sequencing matters, since every worktree bootstrapping an index before then adds untracked DB noise.
- **Widen `.codeindex.json` roots** to `["src", "client", "plugins"]`, aligning the index with the mutation gate's own product-code definition (`isGateableImplFile`); update the CLAUDE.md protocol's root references to match.
- **Correct CLAUDE.md**: fix the wrong codeindex location pointer (`~/Projects/papai/codeindex/` → the sibling-clone layout + `CODEINDEX_DIR` override); replace the plugin credit with the watcher truth.
- **Propagate to skills**: one deferential line (pointing at the root protocol) in `figma-codegen`, `syncing-plan-with-code`, `openspec-verify-change`, `designing-new-provider`. `ux-review` and `openspec-explore`/`openspec-apply-change` stay unchanged.
- **Claude Code parity**: pre-approve the project MCP server via `enabledMcpjsonServers` in `.claude/settings.json`; verify the shared opencode-flavored `.mcp.json` loads in Claude Code (fallback: move opencode-specific keys into `opencode.json`).
- **README setup story**: sibling-clone setup steps, `bun install`, `CODEINDEX_DIR`, `codeindex:*` scripts, per-worktree index behavior (lazy build, one-time v5 wipe rebuild), and the codeindex commit hash verified against.

## Capabilities

### New Capabilities

- `codeindex-integration`: the developer-facing contract for the codeindex MCP tooling — registration resolvable via the sibling clone, local-artifact hygiene, index coverage aligned with product code, freshness owned by the server (no redundant client reindexing), and agent guidance that steers structural queries to the MCP tools. Without it: fresh clones leak untracked DBs, `plugins/` stays in grep-land, duplicate reindex processes run per edit, and contributors have no setup documentation. `openspec/specs/` is currently empty — this is the first main-spec capability; no existing capability covers agent tooling.

### Modified Capabilities

(none — no existing capability specs)

## Impact

- **Scope model**: none — developer/agent tooling only; no platform or task instances, no per-user/group/thread state, no runtime DB changes.
- **Files**: plugin deletion (`.opencode/plugins/codeindex-reindex.ts` — no tests reference it), `.gitignore`, `.codeindex.json`, `CLAUDE.md` (AGENTS.md symlink follows), `.claude/settings.json`, skill files (hardlinked `.claude`/`.agents` pair + separate `.opencode` copies for openspec skills), `README.md`.
- **Dependencies**: none added or removed (`@opencode-ai/plugin` stays — three other plugins import it). The codeindex sibling clone remains a soft, resolved-at-runtime dependency with a clear refusal message.

## Non-goals

- **afk-runner agent arming** via `AGENT_MCP_SERVERS` — a follow-up change, gated on the new `bench/agents` with/without A/B harness supplying numbers (cwd is already `config.repoRoot`; read-only, cred-free, doctrine-compatible).
- **codeindex-repo work** (first-run gitignore warning, registration docs beyond the absolute-path form, release tagging, worktree GC) — lives in the sibling repo.
- **Widening roots further** (`afk-runner/src`, `review-loop/src`, `opencode-agent/src`, `scripts/`) — declined: workspace/tool code with high churn; grep remains acceptable there; a later config edit can widen.
- **Central/shared per-repo DB layout** — rejected: in-tree per-worktree DBs give correct freshness semantics and free GC; a shared layout would orphan and require path-keyed schema changes.
- **Packaging codeindex for npm** — out of scope; clone-based distribution is the model.
