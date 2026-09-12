## Purpose

Contract for the codeindex MCP developer tooling: how the server is registered and resolved in every checkout and worktree, what the index covers, who owns freshness, and how agents are steered to it. This is agent-side tooling only — the MCP tools are not papai chat tools, so capability gating and `tool_prefs` do not apply and no papai runtime state is touched.

## ADDED Requirements

### Requirement: MCP registration resolves via the sibling clone

The project's MCP registration SHALL resolve the codeindex server through a committed shim that finds a sibling `codeindex` clone relative to the primary repository root (honoring a `CODEINDEX_DIR` override), from the main checkout and from any worktree. When the clone is absent, the failure SHALL name both remedies (clone the sibling, or set `CODEINDEX_DIR`) before any index work runs.

#### Scenario: Started from a worktree

- **WHEN** the MCP server starts with cwd inside any git worktree of this repository
- **THEN** the shim resolves the sibling clone through the worktree's `.git` gitdir pointer and the server indexes that worktree's own tree

#### Scenario: Sibling clone missing

- **WHEN** no codeindex clone exists at the resolved location and `CODEINDEX_DIR` is unset
- **THEN** the failure message names the sibling-clone location and the `CODEINDEX_DIR` override, and no index database is created

### Requirement: Index artifacts are hygienic

The index database SHALL live under `.codeindex/` inside the tree that was indexed, and that path SHALL be git-ignored at the repository root.

#### Scenario: Fresh clone stays clean

- **WHEN** a fresh clone or worktree builds an index (manually or via the MCP server's bootstrap)
- **THEN** `git status` reports no untracked `.codeindex/` content

### Requirement: Index coverage follows product code

The indexed roots SHALL include `src`, `client`, and `plugins`, matching the repository's product-code definition used by its quality gates.

#### Scenario: Plugin symbol is searchable

- **WHEN** an agent queries the MCP search tool for an exported symbol defined under `plugins/`
- **THEN** the symbol is returned with its file, kind, and scope tier

#### Scenario: Workspace code stays out

- **WHEN** the index is built
- **THEN** files under agent workspace trees (`afk-runner/`, `review-loop/`, `opencode-agent/`, `scripts/`) are not indexed

### Requirement: Each worktree indexes its own tree

The index database and freshness state SHALL be scoped to the tree (checkout or worktree) the server was started in.

#### Scenario: Worktree isolation

- **WHEN** two worktrees on different branches each run the MCP server
- **THEN** each serves symbols and references reflecting its own tree's content, and deleting a worktree removes its index with it

### Requirement: Freshness is owned by the server

The repository SHALL NOT ship client-side reindex automation that duplicates the codeindex server's own watcher and boot probe. A manual reindex escape hatch SHALL remain available to agents and humans (the `code_index` MCP tool and the `codeindex:reindex` script).

#### Scenario: Edit without client-side reindex component

- **WHEN** an agent edits an indexed file through its coding tool
- **THEN** no repository-shipped client component spawns a reindex process; only the server's watcher schedules the catch-up

#### Scenario: Suspected staleness

- **WHEN** an agent suspects results are stale
- **THEN** calling the `code_index` tool with `mode: "incremental"` (or `bun run codeindex:reindex`) converges the index

### Requirement: Agent guidance steers structural queries to the MCP

The root agent instructions SHALL carry the codeindex search protocol, and the skills whose core work is symbol location or code-vs-plan verification (`figma-codegen`, `syncing-plan-with-code`, `openspec-verify-change`, `designing-new-provider`) SHALL each reference the protocol's tools for structural queries in the indexed roots — by pointing at the protocol, not by restating it.

#### Scenario: Skill references the protocol

- **WHEN** a listed skill is loaded in any of the skill trees it lives in (`.claude`, `.agents`, `.opencode`)
- **THEN** its text names the codeindex tools for symbol/impact lookups and defers to the root protocol for the full rules

### Requirement: Setup is documented

The README SHALL document the sibling-clone setup steps (clone, install, optional `CODEINDEX_DIR`), the `codeindex:*` scripts, the per-worktree lazy-index behavior, and the codeindex commit the integration was verified against.

#### Scenario: Contributor follows the setup

- **WHEN** a contributor on a new machine clones this repository and the codeindex sibling, installs dependencies, and opens a session
- **THEN** the MCP server is available without further project configuration, and the README's steps match the refusal message's remedies exactly

### Requirement: Claude Code connects without manual approval

Project settings SHALL pre-approve the project-registered codeindex MCP server so Claude Code sessions in a fresh clone connect without a manual approval step.

#### Scenario: Fresh clone, Claude Code session

- **WHEN** a Claude Code session starts in a fresh clone with the settings applied
- **THEN** the codeindex MCP server connects without prompting the user for project-MCP approval
