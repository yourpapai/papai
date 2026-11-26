<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Notes: afk-runner-extract-c-retire

## Task 5.2 — widened census with dispositions (design D4 completion check)

Run: `rg -l afk --no-ignore --hidden` over the repo root — **298 files, zero unclassed hits**.
Every file falls in a recorded class. Counts and dispositions:

| Class | Files | Disposition |
| --- | --- | --- |
| `openspec/**` inherited history | 202 | keep (recorded class) |
| `node_modules/**` | 65 | keep (recorded class) |
| `review-loop/**` + `tests/review-loop/**` ("afk-runner-agent-mcp D3" provenance) | 6 | keep (recorded class) |
| `docs/research/**` historical research | 3 | keep (recorded class) |
| `opencode-agent/**` (pricing.ts comment + docs) | 2 | keep (recorded class) |
| Pointer docs `docs/architecture/afk-runner{,-mcp-research}.md` | 2 | task 4.1 tombstones (each hit is the `Moved to yourpapai/afk-runner` line) |
| Command stubs `.claude` + `.opencode` `commands/sdd-auto.md` | 2 | task 4.2 tombstones (hits name `yourpapai/afk-runner`) |
| `CLAUDE.md` (= `AGENTS.md` symlink) | 1 | task 4.3 — every hit names `yourpapai/afk-runner` or the pointer files; none describes a papai tree as present |
| `docs/architecture/sdd-pipeline.md` | 1 | task 4.4 — hits are new-repo-pointing (:12, :14, :16, :37, :162) or inside the two kept "Historical" blockquotes (:259, :274) |
| `CHANGELOG.md` | 1 | keep (recorded class, historical) |
| `scripts/mutation/README.md` | 1 | keep — only the :45 PR-#431 zod anecdote remains (task 3.2 verify re-confirmed) |
| `.afk-runner/config.json` | 1 | keep — `.afk-runner/**` run state (D6) |
| `.git` | 1 | keep — the worktree's `.git` file is a gitdir pointer containing the worktree name `afk-runner-retire` |
| lock/hash substrings | 3 | keep — `.opencode/package-lock.json`, `.opencode/node_modules/.package-lock.json` (its node_modules twin), and `bun.lock:978`, whose single occurrence is inside a base64 sha512 integrity hash (`sha512-a85L9Z…R7zIafkIUPUMf…`) — same class, not a package reference |
| resolver-test merge-history sentences | 0 | the class anticipated hits, but task 1.1's reword ("a history that never had the runner workspace", test-resolver.test.ts:105) dropped the literal token — zero hits today |

### Survivor extensions recorded (outside the task's verbatim class list; none is present-tense normative papai text, so the disposition is keep + rationale)

- `.hooks/sessions/tdd-session-{ses_f7158d81cffeFaM0xzSCYbWT8tC,ses_f75168448ffeosFrIZ8ztKL4ju,ses_f7525b085ffeML8gUaLq8xq3H0}.json` (3) — gitignored TDD-hook session state (`.gitignore:48`); every afk occurrence is this worktree's own absolute path (`.worktrees/afk-runner-retire/…`) recorded as writtenTests provenance — the branch's name, not papai content; regenerates with each hook session and dies with the worktree.
- `reports/jscpd/jscpd-report.html`, `reports/checks/duplicates.log` (2) — gitignored generated evidence (`.gitignore:45`) from `check:full`; afk occurrences are the same worktree-path prefix inside absolute file listings; regenerated on the next run.
- `reports/test/last-run.log`, `reports/test/last-run.junit.xml` (2) — gitignored generated test evidence; afk occurrences are the keep-class `tests/review-loop/agent-command.test.ts` test titles ("opencodeEnv — afk-runner-agent-mcp D3") mirrored into run output — the recorded review-loop class surfacing through generated artifacts.
- `.review-loop/implement-t16.json` (1, appeared when this report was written) — gitignored runner report state (`.gitignore:64`); its only afk occurrences are the `files_written` paths naming this change's directory — self-referential to the change, not papai content.

Result: no source-file survivor; census recorded; zero unclassed hits.

## Task 5.3 — D6 cleanup note (operator note)

The papai-side `.afk-runner/` dirs are worktree-pinned run stores under `.worktrees/*/.afk-runner/`; the main checkout has none. With the `.gitignore` line gone (task 2.1) they surface as untracked paths — that is post-run operator debris, never commit material:

- **Wait for terminal state.** Archive or delete these dirs only after this run reaches a terminal state — resumes read the store, and this run is worktree-pinned (deleting the store under a live run destroys its resume point).
- **Stage explicit paths only, never `git add -A`.** The exposed untracked dirs must not ride into any commit; every commit on this branch comes from named paths.
- **Rollback is safe for them.** `git revert` of the deletion commit restores the ignore line (with trees, entries, and lockfile) and never touches the untracked dirs — the stores stay valid for a re-launched run.
