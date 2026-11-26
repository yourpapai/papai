<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

See proposal.md — Why, and the umbrella change (`openspec/changes/afk-runner-extraction/`, design D4/D7, tasks 4.1–4.3) for the extraction history. The facts that shape this design:

- Launch precondition met: drain gate confirmed 2026-09-10 (umbrella notes.md) — no master-launched in-flight runs; this run is worktree-pinned on `.worktrees/afk-runner-retire` and exempt by D4. The design does not re-verify it.
- The live engine already runs from `yourpapai/afk-runner` (its Phase-C self-run merged). Papai's `afk-runner/` + `tests/afk-runner/` are a frozen twin; deleting them removes no behavior papai executes.
- **R5 precedent is the doctrine and the warning.** The `sdd-runner` retirement (commit `41fa25b6a`, re-tighten `221c7204d`) swept surfaces beyond its planned inventory — most tellingly `.hooks/tdd/test-resolver.mjs`, missed because *default `rg`/`grep` skip hidden directories*, and the R5 commit itself records this as an inventory gap. The afk-runner retirement has the same hidden-dir surface today: the resolver hardcodes `afk-runner/src/` as a gateable root with three mapping arms, pinned by `.hooks/tests/tdd/test-resolver.test.ts` and `tests/scripts/check.test.ts` (`UNROUTED_GATEABLE_ROOTS`), neither of which the umbrella's 4.2 inventory names. Unlike R5, this plan finds them before the commit.
- The grep gate (`grep -rn "afk-runner" package.json .gitignore scripts/mutation/baseline.json` → empty) is the arbiter of "done": it forces the whole `afk-runner:*` script family out of `package.json` (the task text's "`afk-runner:start`" is a synecdoche; the proposal names all five), the entire `.gitignore` block including its `# afk-runner state` comment, and all 119 `afk-runner/src/**` keys from `scripts/mutation/baseline.json` (669 total keys today).
- Live-reference census beyond the umbrella inventory (verified in this worktree): `knip.config.ts` (`ignoreWorkspaces` + the standalone-workspaces comment above it); `.hooks/tdd/test-resolver.mjs` (root check + `suggestTestPath`/`findTestFile`/`resolveImplPath` arms); `.hooks/tests/tdd/test-resolver.test.ts` (four describe blocks); `tests/scripts/check.test.ts` (the unrouted-roots pin); `AGENTS.md`/`CLAUDE.md` (docs-index rows, `/sdd:auto` routing row, Testing-Notes roots list); `docs/architecture/{commands,sdd-pipeline}.md`; `tests/CLAUDE.md`; `scripts/mutation/README.md` (two normative mentions, one historical anecdote). No references in `Dockerfile`, `scripts/check.sh`, `stryker.config.json`, `.github/workflows/`, or `scripts/detect-duplicates.ts` (R5 already removed the afk jscpd block — no re-tighten needed this time).
- Retained openspec history links the docs being removed: ten-plus deliberately-kept files under `openspec/changes/` (incl. `afk-runner-agent-mcp/`, `afk-runner-mcp-integration-research/`, archives) link `docs/architecture/afk-runner.md` and `afk-runner-mcp-research.md`. Openspec is inherited-untouched, so those links must not dangle.

Project-rule compliance: no tool surface or `tool_prefs` gating touched (developer tooling only); no scope-model ids touched (runner state lives in untracked `.afk-runner/` workdirs, never in papai's DB); no drizzle/DB change; no new dependency (the change strictly *removes* a workspace — `bun.lock` shrinks). No new module is introduced; the change is deletion plus tombstones.

## Goals / Non-Goals

**Goals:**

- One commit-shaped deletion (task 4.2) whose inventory is **complete on the first try** — including the hidden `.hooks/` surface R5 missed — and provably so via the grep gate plus a clean full gate pass.
- Every retained reader lands somewhere useful: tombstones point at `yourpapai/afk-runner`; no live doc, pin, or config describes `afk-runner/src/` as a present papai tree; no retained openspec link dangles.
- The gate machinery (write-hook predicate, mutation roots, check-script parity pin, knip, lockfile) stays exactly in sync — each reference to afk-runner is removed from *both* sides of every mirror pair (resolver ↔ resolver tests ↔ check.test.ts pin ↔ commands.md/tests-CLAUDE prose) in the same commit.

**Non-Goals:** (beyond proposal.md's list — design-level boundaries)

- No behavioral edit to any surviving gate machinery: dropping the afk branches of `test-resolver.mjs` is reference removal, not a re-scoping of what remains gateable (the other five roots are untouched, per R5's "narrow the roots" precedent already applied then).
- No cleanup of historical prose (CHANGELOG, the README's PR-#431 anecdote, `review-loop` comments describing the extracted consumer, `opencode-agent/src/pricing.ts`, resolver-test merge-history comments) — these mention past states and stay, mirroring the inherited pricing.ts decision.
- No change to the new repo, no openspec pruning, no `/sdd:auto` rewiring (all inherited).

## Decisions

### D1 — Deletion inventory: umbrella 4.2 plus the R5-mandated hidden-dir sweep, in one commit

The commit-shaped task 4.2 removes, in this order:

1. **Trees**: `afk-runner/`, `tests/afk-runner/` (the no-upward-imports guard test goes with its tree).
2. **Root `package.json`**: the `"afk-runner"` workspace entry and all five `afk-runner:*` scripts; then `bun install` to regenerate `bun.lock` in the same commit (R5 did exactly this; a stale lockfile entry fails CI).
3. **`.gitignore`**: the `# afk-runner state` comment + `.afk-runner/` line.
4. **`scripts/mutation/baseline.json`**: drop the 119 `afk-runner/src/**` keys. Dead keys are dead weight the grep forbids; the monotonic floor never consults missing files.
5. **`scripts/mutation/README.md`**: the two *normative* mentions — the mapping-table row (`afk-runner/src/foo.ts -> tests/afk-runner/foo.test.ts`) and the gateable-roots sentence in "The gate measures product code". The line-45 PR-#431 anecdote is history and stays (D4 rule below).
6. **`.hooks/tdd/test-resolver.mjs` + `.hooks/tests/tdd/test-resolver.test.ts` + `tests/scripts/check.test.ts`** — the R5 lesson made explicit: drop the afk branches from the resolver (gateable-root `startsWith` check, `suggestTestPath`, `findTestFile`, `resolveImplPath` arms, and their comments), the four afk describe/test groups from the resolver's own suite — with a named disposition for the comment block above the afk cases (test-resolver.test.ts:104-108): its afk present-tense sentences ("afk-runner/src/ … ARE gated", the "never-relaxed gate (docs/architecture/afk-runner.md)" citation) are D4 update-class and go, the block reworded to name `review-loop/src/` alone; its master-merge-history sentences ("a history that never had afk-runner; the merge keeps the superset") are the Non-goals keep-class and stay — and `'afk-runner/src/'` from `UNROUTED_GATEABLE_ROOTS` (with its comment). These three files are one mirror set: the check.test.ts pin *derives* gateable roots from the live predicate and asserts each listed root is gateable-and-unrouted, so dropping the resolver branch without dropping the pin entry fails red (`isGateableImplFile('afk-runner/src/…')` → false), and dropping neither leaves code asserting a root that no longer exists. Edit all three together; the suite is the sync proof.
7. **`knip.config.ts`**: drop `'afk-runner'` from `ignoreWorkspaces` **and from the standalone-workspaces comment above it** (knip.config.ts:23-26, rewording the list as R5's `41fa25b6a` did for sdd-runner). The comment is present-tense normative — D4's update class — and R5's knip sweep edited comment and entry together; a stale entry or comment references a workspace that no longer resolves. The grep gate excludes this file, so only the inventory forces it.
8. **Tombstones** (D2/D3 below): docs-index rows in `AGENTS.md` + `CLAUDE.md` (kept byte-identical to each other — they share content today), the `/sdd:auto` routing row, the Testing-Notes roots list, `docs/architecture/sdd-pipeline.md` header/links/body-prose sentence (D4), `docs/architecture/commands.md` scope sentence, `tests/CLAUDE.md` roots list, and the two doc pointer files.

Alternative rejected: umbrella-inventory-only (leave `.hooks/`, knip, and the pins untouched). Rejected on R5's own recorded doctrine — "every live reference removed" — and because the pin structure makes the half-measure actively wrong: the tests would keep certifying a phantom root. The mirror-sync burden is three files, not a re-architecture.

### D2 — Tombstone shape: pointer files for both docs, not index rows alone

`docs/architecture/afk-runner.md` becomes a **one-line pointer file** (`> Moved to …yourpapai/afk-runner — see docs/architecture/afk-runner.md there`), and — same rule, same evidence — so does `afk-runner-mcp-research.md`. Rationale: the deliberately-retained openspec history (change dirs, archives, specs) links both paths by the dozen; an index row in AGENTS.md does not keep those links resolving, a one-line file at the old path does, and the content itself lives in the new repo via D2-of-umbrella's filter set. The child task mandates the pointer only for `afk-runner.md`; extending it to `mcp-research.md` is the same decision applied consistently (five-plus retained files link it). Alternatives rejected: (a) delete both outright, rely on the index row — dangles every retained link; (b) keep full docs as historical copies — duplicates the new repo's canon and invites drift.

### D3 — `/sdd:auto` command files become stubs, not deletions

`.claude/commands/sdd-auto.md` and `.opencode/commands/sdd-auto.md` (not identical today — the `.claude` copy adds a `--execute`-flag clause; no plan step depends on the identity, since the stub replaces both contents) are reduced to a short tombstone: the pipeline moved to `yourpapai/afk-runner`; clone-and-run there; no runner in papai. The task text lists them under "remove" while the proposal says they "become a tombstone stating the new entry point" and the Non-goals say "the command gets a tombstone pointer" — resolved in favor of the stub: the *operator surface* dies (nothing in papai executes), while anyone invoking the remembered slash command gets the pointer instead of a 404 from their tooling. Alternative rejected: delete the files — loses the discovery channel; AGENTS.md alone is a weaker tombstone for a command-palette surface.

### D4 — Docs classification rule for 4.3: present-tense normative text updated, historical narrative kept

A mention is **updated** when it describes the current repo (gate roots lists in `commands.md`/`tests/CLAUDE.md`/AGENTS/CLAUDE Testing Notes, the `sdd-pipeline.md` header note, its two non-historical "see afk-runner.md" links, and its one present-tense body-prose sentence ("Severity-based convergence", sdd-pipeline.md:162 — "in the afk runner the reclassification is fold-derived" — reworded to name the external runner) (a third link sits inside the R4 "Historical" blockquote near the file's end — kept class, resolves through the pointer file, and is an expected hit in the 4.3 widened grep) — re-pointed to the new repo or the pointer file, with the header gaining the same shape the sdd-runner deletion left there at R5: "deleted, rollback is `git revert`"). A mention is **kept** when it narrates the past (CHANGELOG entries, README's zod-bump anecdote, `review-loop/CLAUDE.md`'s description of the extracted consumer, `opencode-agent` files, resolver-test merge-history comments, and all of `openspec/`). This is the R5 shape — `sdd-pipeline.md`'s "Historical surface (deleted at R5)" header is the template — and it keeps the diff a retirement, not a rewrite.

### D5 — Ordering, TDD-hook interaction, and the mutation gate on this branch

Nothing this change *writes* is gated by the Write/Edit TDD pipeline: the edited files are `.hooks/` sources (the hook's own machinery, outside the product roots), test files, docs, and JSON/YAML config — `isGateableImplFile` gates none of them, and the deletions remove gated files without writing any. The test-first discipline that *does* apply is the pin-sync of D1.6: resolver tests + check.test.ts pin + resolver branches move in one task, and the green suite is the proof they stayed mirrored (edit the pins and branches together; the intermediate red — pin entry present, branch gone, or vice versa — is exactly what the pin exists to catch).

Mutation gate on the PR: deleted `afk-runner/src/**` files select no mutants (they no longer exist in the diff's measurable set), the dropped baseline keys remove the floors that referenced them, and no surviving file's floor is touched — the plan/shard/gate cycle should size to zero-ish work and pass. If a shard plans targets from the *docs/config* legs, they are non-gateable roots and select nothing; this is expected, not a lost shard.

Execution order inside 4.2: pin-sync edits (D1.6) first, then tree deletions and config/doc sweep, then `bun install`, then the grep gate; 4.3 then runs the full battery (`bun test && bun run lint && bun run typecheck`) plus `bun run check:full`'s knip/duplicates legs over the merged result, and does the docs pass over `docs/architecture/` (D4). The tree is green after each task.

### D6 — Runner-state hygiene: the `.gitignore` removal exposes untracked `.afk-runner/` dirs

Removing the ignore entry makes every checkout holding runner state (this worktree's `config.json`; the six terminal runs' stores, all under `.worktrees/*/.afk-runner/` — every run is worktree-pinned per the drain-gate record, notes.md:76-77, and the main checkout has no `.afk-runner/`) show untracked `.afk-runner/` paths in `git status`. That is post-run operator debris, not commit material: nothing enters the deletion commit, and the risk is noise plus an accidental `git add -A`. Mitigation: an operator cleanup note (archive or delete papai-side `.afk-runner/` dirs) rides the change's completion record, executed only after this run reaches its terminal state — the store must not be removed while this worktree-pinned run is live, since resumes read it. `git revert` of the deletion commit restores the ignore entry and never touches the untracked dirs.

## Risks / Trade-offs

- [Hidden-dir inventory still incomplete — something else skips `rg`'s defaults] → D1's census ran with explicit `.hooks/` inclusion and covered Dockerfile/check.sh/stryker/workflows/duplicates-config (all clean); the 4.3 grep widened (`rg -l afk --no-ignore --hidden` minus known-historical classes) is the completion check, and the full gate suite fails loudly on any functional survivor (knip, check.test.ts, resolver tests).
- [Pin/resolver half-edit leaves the mirror set inconsistent] → the check.test.ts pin *derives* roots from the live predicate and fails red on divergence; D1.6 makes the three files one edit unit.
- [Retained openspec links dangle anyway (paths inside the new repo differ)] → pointer files (D2) resolve every link to a one-liner naming the new repo; the new repo carries the full docs by the filter set, so the hop terminates.
- [Untracked `.afk-runner/` exposure invites an accidental commit] → D6: cleanup note post-run; the deletion commit is built from explicit paths, never `add -A`.
- [A resume of *this* run lands on the post-deletion branch where papai no longer contains the runner] → D7-of-umbrella mid-run safety: the run is worktree-pinned, its process holds the loaded module graph, and resumes launch from this worktree, not master; the store outlives the commit. If the worktree is discarded mid-run, recovery is `git revert` + re-launch from the new repo (its history contains the run-state format).
- [`bun.lock` regen drags unrelated churn] → regenerate with the workspace entry removal as the only `package.json` change; R5's identical maneuver committed clean. Any lockfile noise beyond the afk workspace is a stop-and-inspect signal, not something to sweep in.

## Migration Plan

Two commit-shaped steps, tree green after each:

1. **4.2 (deletion commit)**: pin-sync edit (resolver + resolver tests + check.test.ts constant) → `git rm -r afk-runner tests/afk-runner docs/architecture/afk-runner-mcp-research.md` + write the two one-line pointer docs → package.json (workspace entry + five scripts) → `bun install` (lockfile) → `.gitignore` block, baseline.json keys (119), README normative mentions, knip entry, AGENTS/CLAUDE rows + `/sdd:auto` routing row + Testing-Notes list, sdd-auto stubs, sdd-pipeline/commands/tests-CLAUDE doc updates → verify: `grep -rn "afk-runner" package.json .gitignore scripts/mutation/baseline.json` empty, `bun test tests/scripts .hooks/tests` green, `bun run typecheck && bun run lint` green.
2. **4.3 (verification + docs pass)**: full battery (`bun test && bun run lint && bun run typecheck`, plus `bun run check:full` for the knip/duplicates/format legs), then the docs sweep per D4: no `docs/architecture/` page points at a removed file as live content; record the D6 cleanup note in the run's completion artifacts.

Rollback (inherited doctrine): `git revert` of the deletion commit — restores trees, entries, lockfile, and ignore line in one apply; untracked `.afk-runner/` state is untouched by the revert and remains valid for a re-launched run.

## Open Questions

None. The tombstone-vs-delete ambiguity for the command files and the second doc is resolved by D2/D3 from the proposal's own wording plus the retained-link evidence; visibility of `yourpapai/afk-runner` remains the umbrella's deferred question and affects nothing here.
