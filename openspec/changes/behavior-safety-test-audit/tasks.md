## 1. Preconditions and durable-copy skeleton

- [ ] 1.1 Preflight the audit environment: run `gh auth status && gh pr view 166 --json number,headRefName,state` and `git rev-parse --verify origin/plugin-core-separation`; record the checked-out HEAD SHA and audit date. Verify: both commands exit 0 and the recorded HEAD matches `git rev-parse HEAD`.
- [ ] 1.2 Create `report.md` skeleton in the change folder — header stamps HEAD SHA, refactor merge-base, audit date — including the pre-committed mechanical verdict rule (design D5) stated before any data, plus an empty `posting-log.md` (design D2). Verify: `grep -F 'restart-safe' openspec/changes/behavior-safety-test-audit/report.md && test -f openspec/changes/behavior-safety-test-audit/posting-log.md`.

## 2. Refactor map (report section 1)

- [ ] 2.1 Measure, don't trust stale docs: capture the refactor diff (`gh pr diff 166` / `git diff master...origin/plugin-core-separation`), compute `git merge-base master origin/plugin-core-separation`, and measure staleness (`git diff --stat <merge-base>..master`) over refactor-touched paths. Verify: `git merge-base master origin/plugin-core-separation` exits 0 and its SHA is stamped in report.md.
- [ ] 2.2 Map separated modules, the plugin-interface level, and cut seams onto current master `src/`/`plugins/`, reading `openspec/changes/hermetic-e2e-core-separation-proof/`, the toolgate change and the 2026-07-08 plan docs as hypotheses only; write report section 1. Verify: section 1 exists with every claim citing its producing command (`grep -c '^## 1\.' openspec/changes/behavior-safety-test-audit/report.md`).

## 3. Coverage evidence (report section 2)

- [ ] 3.1 Run the full hermetic coverage pass once, shared-host rules applied (serial, ≥20 min shell budget, no concurrent suite): `bun run test:coverage`, then record the ratchet verdict with `bun run coverage:ratchet` vs 0.90/0.90. Verify: `reports/coverage/lcov.info` exists and `bun run coverage:ratchet`'s exit code is recorded in report.md.
- [ ] 3.2 Build the per-module line/branch table from `reports/coverage/lcov.info` using the existing readers (`scripts/coverage/normalize-lcov.ts`, `scripts/coverage/ratchet-lib.ts`) via throwaway `bun -e` aggregation (no new module, no new dependency); name the weakest-covered modules the refactor will touch or extract. Verify: table present in report.md with every cell citing `bun run test:coverage` + run date.
- [ ] 3.3 Run the lane coverage gates and record verdicts: `bun run test:stories:coverage` vs 0.72/0.70, plus `bun run test:platform:coverage` and `bun run test:operational:coverage`. Verify: each lane's pass/fail verdict and its command are recorded in report.md.

## 4. Taxonomy and protection matrix (report sections 3–4)

- [ ] 4.1 Classify the suite per `bunfig.toml` lanes and structure (hermetic units / integration / behavioral: T0 stories, e2e, smoke, platform, operational, visual), flagging implementation-coupled vs behavior-pinning files; corroborate with `bun run test:audit`; write report section 3. Verify: taxonomy table present, each lane cites its runner script.
- [ ] 4.2 Build the protection matrix: message pipeline, tool-call loop, response delivery, settings persistence + migrations, deferred-prompt scheduling/firing, opencode-agent phases, git/issue flows × (protecting tests, red lane); every empty cell becomes a named gap; write report section 4. Verify: matrix present and `grep -c 'TBD' openspec/changes/behavior-safety-test-audit/report.md` returns 0.

## 5. Quality machinery verdict (report section 5)

- [ ] 5.1 Summarize whether the gates can carry a refactor of this size: `bun run test:mutate:plan` scope over the refactor diff, per-module floors from `scripts/mutation/baseline.json`, ratchet semantics (score-plus-kills), known flakiness, and each gate's runtime cost; write report section 5. Verify: section 5 present with plan output and floor counts cited.

## 6. Gap map and verdict (report sections 6–7)

- [ ] 6.1 Write the gap map (criticality × refactor exposure from section 1's extraction map), one line per gap naming the user-observable contract a new test would pin — never an internal; write report section 6. Verify: section 6 present and no gap line references only an internal symbol.
- [ ] 6.2 Apply the pre-committed mechanical rule from the report header (floors green under ratchets ∧ no empty matrix cell on an extracted path) and write the verdict: restart-safe as-is, or the minimum coverage additions that must land first; state partiality and unmeasured items explicitly; write report section 7. Verify: verdict matches the rule against the recorded evidence and checklist ticks reflect reality.

## 7. Report self-review

- [ ] 7.1 Read the durable copy end-to-end: all 7 sections present, every measured claim cites producing command + run date, no number precedes its command's run (design D1 evidence-first), unmeasured items explicit. Verify: `grep -cE '^## [0-9]\.' openspec/changes/behavior-safety-test-audit/report.md` returns 7.

## 8. Post the report to issue #453

- [ ] 8.1 Confirm `gh auth status`, then split `report.md` at section boundaries into comments ≤ ~55,000 characters and post sequentially with `gh issue comment 453 --body-file <file>`, retrying failures with backoff. Verify: `gh issue view 453 --json comments` lists the posted comments.
- [ ] 8.2 Record each comment's URL, byte size, and result — or the explicit failure text — in `posting-log.md`; if posting is impossible, log the attempt and keep the durable copy as the deliverable. Verify: `grep -c 'https://github' openspec/changes/behavior-safety-test-audit/posting-log.md` equals the number of posted comments, or the log states the failure.

## 9. Final verification

- [ ] 9.1 Confirm the audit touched nothing outside its folder: `git status --porcelain`. Verify: `git status --porcelain | grep -v 'openspec/changes/behavior-safety-test-audit/'` returns empty.
- [ ] 9.2 Run the full suite and checks to confirm the repo is untouched and green: `bun run test`, then `bun run typecheck`, `bun run lint`. Verify: all three exit 0.
- [ ] 9.3 Doc sweep: this change alters no runtime behavior, so no `docs/architecture/*.md` page should need updating; if any page cited audit numbers that moved, update it, otherwise leave untouched. Verify: `git status --porcelain docs/architecture/` returns empty (or the single updated page is listed and justified in report.md).
