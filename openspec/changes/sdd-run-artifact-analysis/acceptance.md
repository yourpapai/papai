# Acceptance run — sdd-run-artifact-analysis (task 5.2)

Corpus: 14 run dirs across 8 workdirs (`.worktrees/{.sdd-runner, translate-announcement, sdd-runner-decomposition, sdd-runner-fancy-ui, claude-agent-ci, tests-consolidation, review-loop-claude, knowledge-base-plugin-2nd}/.sdd-runner`), via `bun run sdd-runner:start -- analyze <workdirs…>`.

## Comparison against the exploration's hand-measured numbers

| Metric | Hand-measured | Analyzer | Verdict |
| --- | --- | --- | --- |
| duplicate resolution entries | 78 | **78** | exact match — the analyzer's within-round dup definition reproduces the forensics |
| R2-eligible | 11/26 | **11**/29 | eligible count exact; denominator differs (see below) |
| era-contaminated runs | 1 | **1** (`2026-08-21T19-44-19-770Z-2f6e644a`) | exact match — phantom answers [2,3,4,5] + `.bak` residue |
| gates pending forever | 3 (one 8+ days) | **3** (ages 8d, 9d, 1046m) | exact match |
| R4 gates | 31 | **28** | delta, explained below |
| stranded-complete | 5 | **2** | delta, explained below |
| merged-unimplemented | 1 | **0** | delta, explained below |

## Delta explanations

- **R4 28 vs 31**: the analyzer counts emitted `auto_decision` events (28 after excluding the era-contaminated trilogy's 2; 30 corpus-wide including it). The hand count of 31 came from `auto-policy.jsonl` sidecar lines, which record every ladder evaluation — including waiter re-evaluations — not just committed decisions. Event-scoped is the pinned definition; the jsonl delta is the waiter/preview residue.
- **R2 denominator 29 vs 26**: the analyzer counts every cap-hit convergence pair (round === cap, verdict open) as a gate state; the exploration counted 26 gate states at presentation moments. The eligible numerator — the number any decision turns on — is 11 either way.
- **stranded-complete 2 vs 5**: the ground-truth join is run-scoped (spec: "for each analyzed run's change folder"); it reports the two run-named completed-but-unmerged changes (`sdd-runner-fancy-ui`, `tests-consolidation`). The hand count of 5 walked the whole openspec tree, including changes whose runs no longer exist in any retained workdir.
- **merged-unimplemented 0 vs 1**: the worst artifact (`openspec/changes/knowledge-base-plugin`, on master with 0/81 tasks done) is real, but no run in any retained workdir names it — its run dir was deleted, so the run-scoped join cannot see it. Recovering orphaned change folders (scanning openspec/changes directly) is deliberately outside this change's spec; it is the natural follow-up if the corpus keeps losing run dirs.

## Conclusion

The three numbers that motivated the change (78 dup entries, 11 R2-eligible, 1 era-contaminated run, 3 forever-pending gates) reproduce exactly; the three deltas are definitional (event-scoped vs jsonl, run-scoped vs openspec-tree-wide), each documented above.
