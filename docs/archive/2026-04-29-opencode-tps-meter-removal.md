# OpenCode TPS Meter Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the local `opencode-tps-meter` plugin integration from this repository while keeping the GitHub fork intact.

**Architecture:** Make one configuration change in `opencode.json` to stop loading the plugin, then remove the nested local plugin checkout from `.opencode/plugins/`. Verification is file-system and remote-state based because no application runtime code changes.

**Tech Stack:** JSON config, local filesystem, Git, GitHub CLI

---

### Task 1: Remove the OpenCode config entry

**Files:**

- Modify: `opencode.json`

- [ ] **Step 1: Edit the plugin list**

Remove this entry from the `plugin` array:

```json
"./.opencode/plugins/opencode-tps-meter",
```

Resulting section:

```json
"plugin": [
  "@ekroon/opencode-copilot-instructions",
  "./.opencode/plugins/tdd-enforcement.ts",
  "./.opencode/plugins/codeindex-reindex.ts"
],
```

- [ ] **Step 2: Read the file to verify the entry is gone**

Run: `read opencode.json`
Expected: the `plugin` array no longer contains `./.opencode/plugins/opencode-tps-meter`

### Task 2: Remove the local plugin checkout

**Files:**

- Delete: `.opencode/plugins/opencode-tps-meter/`

- [ ] **Step 1: Delete the local plugin directory**

Run:

```bash
rm -rf .opencode/plugins/opencode-tps-meter
```

Expected: the directory no longer exists in the workspace.

- [ ] **Step 2: List the remaining plugin directory contents**

Run: `ls .opencode/plugins`
Expected: only `codeindex-reindex.ts` and `tdd-enforcement.ts` remain.

### Task 3: Verify remote preservation

**Files:**

- Verify only: remote repository `wKich/opencode-tps-meter`

- [ ] **Step 1: Check the fork metadata**

Run:

```bash
gh repo view wKich/opencode-tps-meter --json nameWithOwner,isFork,parent,url
```

Expected: the repository exists, `isFork` is `true`, and the parent is `ChiR24/opencode-tps-meter`.

### Task 4: Final workspace verification

**Files:**

- Verify: `opencode.json`
- Verify: `.opencode/plugins/`

- [ ] **Step 1: Re-read the config file**

Run: `read opencode.json`
Expected: the TPS meter plugin path is absent.

- [ ] **Step 2: Re-read the plugin directory**

Run: `read .opencode/plugins`
Expected: the TPS meter directory is absent.

- [ ] **Step 3: Check git status**

Run: `git status --short`
Expected: `opencode.json` is modified and the plugin directory removal appears in the worktree.
