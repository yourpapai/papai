<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: In-process AST scanning

## Context

All three scanners currently reach a `SourceFile` through
`src/ts-ast/source-parser.ts`, which drives `typescript/unstable/async` (`API`,
project, snapshot) served by a `tsgo` child process. Four observed 7.0.2
behaviors are load-bearing workarounds there (config-parse cache, pinned
open-file text, connect race, Bun's missing `stdout._handle.fd`). The I/O
guard in `tests/stories/harness/io-guard.ts` admits that binary via
`TSGO_EXECUTABLE` + execution-root containment. `typescript` sits in runtime
dependencies because production plugin discovery parses at boot.

`oxc-parser@0.143.0` is already installed (knip's dependency) with native
bindings for every platform including linux-arm64-musl (the alpine image);
Bun's own transpiler is oxc, and `Bun.Transpiler` is already used in-repo
(`scripts/svelte-plugin.ts`). `Bun.Transpiler.scanImports()` alone was
rejected as insufficient: it silently drops non-literal dynamic imports, which
would gut the "unresolvable import must fail discovery" contract that protects
`manifestHash` integrity. Full-AST `oxc-parser` preserves it.

## Goals / Non-Goals

**Goals:**

- Zero child processes from parsing, in production and under the guard.
- Scanner outputs bit-identical to today, proven before migration.
- `typescript` back to devDependencies; smaller production image.
- Frozen-input churn reduced (a small adapter over a stable semver'd API
  instead of workaround-laden code over `unstable`).

**Non-Goals:**

- No change to scanner public seams beyond what parity forces (the seam stays
  async even though oxc is sync — callers are already async).
- No migration of typechecking, Storybook's nested `typescript@5.9.3`, or
  svelte2tsx.
- No freeze-rule redesign; the story re-baseline follows the established
  harness-change-on-master protocol.
- Upstream issues (TypeScript standalone parse API; Stryker sandbox patch)
  are filed and linked, not tracked here.

## Decisions

### D1: `oxc-parser` behind the existing seam, all three scanners

Rewrite `src/ts-ast/source-parser.ts` as an oxc adapter keeping the
`SourceParser` interface (`parse`, `parseAll`, `close` — close becomes a
no-op). `discovery-import-scan.ts`, `scripts/story/scenarios.ts`, and
`tests/smoke/harness/story-markers.ts` swap `typescript/unstable/ast`
predicates for oxc AST walks over the same shapes.

Alternatives: keeping tsgo with only a tightened guard (still an unobservable
process and unstable API); `Bun.Transpiler.scanImports` (drops non-literal
dynamic imports — violates the discovery contract); regex scanning (worse).
Partial migration (discovery only) was declined: it closes the guard hole but
leaves frozen-input churn and two parsers to maintain; the parity oracle
covers the full migration at near-zero extra cost.

### D2: Parity oracle gates the swap

Before any production edit, a throwaway comparison run extracts scenario
manifests over the whole `tests/stories/**` corpus and plugin graphs/hashes
over the real `plugins/` with both parsers and diffs them. Identical output =
go; any diff = investigate before proceeding. The oracle is not committed;
its evidence is recorded in tasks.

### D3: Guard returns to zero allowances

Delete `TSGO_EXECUTABLE`, `spawnExecutable`/`isAllowedTsgoSpawn`, both
spawn-mock branches' tsgo carve-outs, and the two outside-the-root probe
scenarios in `io-guard-probe.ts` that pin the allowance. The probes that pin
*denial* of everything else stay. `tests/CLAUDE.md` guard wording reverts to
"no child process, ever".

### D4: Dependency placement

Add `oxc-parser: 0.143.0` (exact, matching knip's resolution so the binding
binary is shared). Move `typescript` to devDependencies; verify
`bun install --frozen-lockfile --production` installs neither `typescript`
nor any `@typescript/typescript-*` package, and that the alpine image builds
(the musl binding must resolve in `prod-deps`).

### D5: Stryker sentinel pin (rides this change)

A focused test in `tests/scripts/mutation/stryker-config.test.ts` asserts
`stryker.config.json` sets `tsconfigFile` to the sentinel and that the file
does not exist, failing with a pointer to the `scripts/mutation/README.md`
section. Independent of the parser swap; small enough to ride.

### D6: TypeScript canary in nightly

A scheduled job (`.github/workflows/nightly.yml`) installs `typescript@latest`
in a scratch install, runs `bun run typecheck` and a discovery smoke
(`discoverPlugins('plugins')` with no plugins in error). Failure is a canary
badge, not a PR gate. This is what lets the root keep the caret range.

### D7: Re-baseline protocol for frozen inputs

The swap edits `scripts/story/scenarios.ts` and harness tests — frozen files.
Sequence: land the parser/scanner change on master as a harness change,
re-record the story manifest `treeHash`/baseline SHA per the existing
qualification protocol, then re-run any in-flight qualification branches
against the new baseline. `src/ts-ast/` stays in the frozen parser-support
set (now a tiny adapter); `tests/scripts/story-frozen-inputs.helpers.ts`
needs no shape change.

Two frozen-file constraints shape the edits themselves:

- **The oxc adapter stays one file.** `scripts/story/inputs.ts` (itself
  frozen) lists `src/ts-ast/source-parser.ts` by name in
  `FROZEN_PARSER_SUPPORT`; splitting the adapter would require editing that
  frozen list. Under `max-lines` pressure, extract within the file or accept
  the extra `inputs.ts` edit riding the same re-baseline window — never a
  quiet second file.
- **Every frozen-input touch rides the one re-baseline commit.** In
  particular the `expectRejection` retirement (task 6.3) edits frozen
  `tests/utils/test-helpers.ts`; doing it after the baseline is recorded
  would invalidate the just-recorded proof. Bundle it with task 6.1.

Re-baseline timing is not free-floating: in-flight qualification branches
(`trusted-module-hermetic-qualification`, `hermetic-e2e-core-separation-proof`)
must rebase against the new baseline or their proofs void — coordinate the
landing with them rather than racing it.

### D8: Sequencing relative to the TypeScript 7 branch

This change builds on the tsgo-based parser state: it rewrites
`src/ts-ast/source-parser.ts` and deletes a guard allowance that exist only
on `claude/typescript-7-upgrade-iau4py` (PR #359). PR #359 merges first;
this change follows on master. Folding part of it into that PR is possible
only for the additive pieces (Stryker pin test, canary job), never the swap
itself — the parity oracle compares against the tsgo parser as landed.

### D9: Verification reality for guard changes

As with PR #359's guard work: local guard verification runs through the story
lane's preload (no Docker here); the container truth (`--read-only`,
`--pids-limit`, `--cap-drop ALL` against zero spawns) is CI's
`Hermetic Full-Stack Stories` job. TDD write hooks will also enforce
suite-first ordering on the scanner rewrites (tasks 2.2/2.3), and the
mutation ratchet CI gate judges the whole branch diff — the 5.3 spot-check
is advisory, the gate is not.

## Risks / Trade-offs

- [oxc AST differs from tsc AST in edge constructs] → Parity oracle over the
  real corpus and real plugins is exactly the test; any diff surfaces as a
  task before migration proceeds.
- [Production image: oxc musl binding fails to resolve under alpine
  prod-deps] → D4 verifies the image build explicitly; binding is smaller
  than the tsgo platform package, so size regresses only if dedupe fails —
  exact pin prevents that.
- [New direct runtime dependency on the oxc release train] → Exact pin;
  upgrades are deliberate and covered by the same existing test suites
  (discovery, manifest, markers, mutation ratchet).
- [oxc drops a construct a future plugin uses (e.g. decorators)] → Same
  failure mode exists today with tsc; discovery errors are loud, per-plugin,
  and non-fatal to other plugins.
- [Re-baseline collides with in-flight qualification branches] → D7 lands the
  harness change on master first; branches rebase against the new baseline
  per existing protocol (same as any harness change).
- [Guard changes verified only via lane preload locally] → D9: CI's
  `Hermetic Full-Stack Stories` job is the container truth; local preload
  runs catch everything except sandbox-flag interactions.
- [Adapter outgrows one file under max-lines pressure] → D7 constraint:
  extract within the file or extend `FROZEN_PARSER_SUPPORT` in the same
  re-baseline window; never a quiet second file.
- [Stryker or nightly changes break unrelated lanes] → Both are additive and
  isolated: a pin test and a scheduled non-gating job.

## Migration Plan

1. Parity oracle (throwaway) — record evidence.
2. Land swap on master: adapter rewrite, scanner predicate swaps, guard
   allowance deletion, dependency moves, pin test, canary job.
3. Re-record story baseline; full `check:full`, story lanes, storybook build,
   `bun install --production` image verification.
4. Update docs: `CLAUDE.md` TS-7 paragraph, `tests/CLAUDE.md` guard paragraph,
   `scripts/mutation/README.md` pin-test reference.
5. Rollback: single revert commit restores the tsgo parser and its guard
   allowance; no data or schema changes exist.

## Open Questions

- Does the oxc walk need `sourceType: 'unambiguous'` for any `.js` plugin
  source, or is extension-driven selection sufficient? Answerable during
  implementation without changing the approach.
- Canary cadence (nightly vs weekly) — decided when wiring the job.
