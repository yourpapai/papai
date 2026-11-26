# Design — Narrow the gateable roots to product code

## Context

`selectChangedMutationTargets` (`scripts/mutation/changed-files.ts:106`) is the gate's only scoping
authority. It diffs the branch, then filters:

```
.filter((relPath) => deps.isGateableImpl(relPath, input.projectRoot))
.filter((relPath) => !isGeneratedSourceFile(relPath))
.filter((relPath) => !isInstrumentationIncompatibleFile(relPath))
.filter((relPath) => !isLocaleDataFile(relPath))
```

`stryker.config.json`'s `mutate` globs do **not** constrain it — `buildPairedConfig` overwrites
`mutate` with `[srcFile]` per run (`config-builder.ts:117`). So `isGateableImplFile` alone decides
what the gate measures, and narrowing it is the whole mechanism of this change.

## Decisions

### D1 — Narrow the shared predicate, accepting the TDD-hook consequence

`isGateableImplFile` has six consumers: the mutation gate, and five Write/Edit hook checks
(`enforce-tdd.mjs:31`, `tdd-nudge.mjs:38`, `verify-tests-pass.mjs:52`,
`verify-no-new-surface.mjs:46`, `snapshot-surface.mjs:21`). Narrowing it therefore also stops the
test-first nudge and the surface checks from firing on `review-loop/src/` and `sdd-runner/src/`
edits.

Taken deliberately, not as a side effect: the rationale is that these workspaces are internal
infrastructure, and that reading applies to the write hook exactly as it applies to the gate. One
predicate keeps both surfaces telling the same story about what "gateable" means. The hooks are
advisory anyway (`docs/architecture/commands.md:75` — "Local hooks are advisory; the hard gate is
CI"), and both workspaces keep their real coverage: `tests/sdd-runner/` (107 files) and
`tests/review-loop/` (50 files) still run in the full suite, and `bun run test:affected` still
reaches them (D2).

**Rejected: a mutation-only root list in `scripts/mutation/`.** It keeps the hook untouched, but
buys that with two lists that mean "gateable", free to drift — the exact failure this change
exists to end. Recorded because it is the natural objection: if the nudge turns out to matter for
`sdd-runner/`, this is the fallback, and it is a one-file addition.

### D2 — Narrow only the predicate; leave every path mapper intact

`test-resolver.mjs` also exports `suggestTestPath`, `findTestFile` and `resolveImplPath`, and
`coverage-map.ts` has a parallel `samePackageTestDir` — all four map `review-loop/src/x.ts` ↔
`tests/review-loop/x.test.ts` and the `sdd-runner` equivalent. **None of them changes.**

They serve consumers that must keep working for these workspaces:

- `scripts/test/affected-cli.ts:66` → `listCandidateTests` → `samePackageTestDir`; deleting the
  branches would silently stop `bun run test:affected` from finding sdd-runner and review-loop
  tests.
- `scripts/mutation/score-fingerprint.ts:137` and `paired-run-deps.ts:42` call `findTestFile`
  directly.

Mapping a path is not the same question as gating it. Only the predicate carries policy, so only
the predicate moves — five lines in one function.

### D3 — Prune the unreachable baseline floors

429 entries today; 81 `sdd-runner/src/` + 19 `review-loop/src/` become unreachable, because
`resolveRatchet` (`baseline.ts:164`) only looks up files present in `perFile` and no run can put
them there again. They are inert, not harmful — but `baseline.json` is a committed artifact people
read as the statement of what the gate enforces, and 100 floors nothing can enforce is misleading
data in it. `seedMerge` is per-key max, so nothing removes them on its own.

Pruned in the same commit as the predicate, so the two never disagree. Reversible: git history
holds the values, and re-adding a root would re-seed within one master run.

### D4 — No new failure mode for an empty target set

`changedFilesRun` logs and returns `null` on zero targets; the plan job emits an empty matrix and
the gate renders a verdict over carried-over scores. That path is untouched. After this change a
zero-target run is the correct outcome for an infrastructure-only PR — the spec requirement in
this change states that explicitly so it is not re-diagnosed as a bug later.

## Answers to the standing design questions

- **Capability / tool_prefs gating:** unaffected. No tool surface.
- **Scope model:** unaffected. Nothing persists per storage context, config context, platform
  instance or user; this is build tooling.
- **DB / migrations:** none.
- **New dependencies:** none.
- **New module:** none — this deletes conditions from an existing predicate. D1 records why no new
  module is introduced.
- **Hook/TDD interactions:** the change *edits* the hook's own predicate. No file it touches is
  itself gateable (`.hooks/`, `scripts/`, `openspec/`, `docs/` are all outside every root, before
  and after), so the write pipeline stays silent throughout and cannot object to its own narrowing
  mid-edit. Test-first order below.

## Test-first order

1. Invert the root assertions in `.hooks/tests/tdd/test-resolver.test.ts` (`review-loop/src/cli.ts`
   → `false`, currently pinned `true` at :96-101) and in `tests/sdd-runner/test-resolver.test.ts`
   (:31-32, `sdd-runner/src/events.ts` and `.../stages/intake.ts` → `false`), and add positive
   assertions holding `src/`, `client/`, `plugins/` gateable. Watch them fail.
2. Narrow `isGateableImplFile`. Watch them pass.
3. Assert in the same files that `suggestTestPath` / `findTestFile` / `resolveImplPath` still map
   both workspaces — the D2 guard, which fails loudly if someone later "finishes the job" by
   deleting those branches.
4. Prune `baseline.json`.

## Risks

- **A real regression in `sdd-runner/`or `review-loop/` now ships unnoticed by mutation testing.**
  Accepted: that is the change. Their unit suites still gate in CI.
- **Someone re-adds a root without re-seeding**, and the first PR touching it measures files with
  no floor. Harmless — a first-touch file has no baseline entry today either, and the master seed
  fills it on merge.
