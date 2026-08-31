# Tasks — Narrow the gateable roots to product code

Ordered test-first: each implementation task is preceded by the failing test that pins it. Section 2
is the behavior change; section 1 makes it fail first; section 3 is the D2 guard that stops a later
edit from over-applying it. See design.md.

## 1. Pin the new root set (red)

- [x] 1.1 In `.hooks/tests/tdd/test-resolver.test.ts`, flip the `review-loop/src/cli.ts` assertion
      (currently `isGateableImplFile(...) === true` at :96-101) to `false`, and add explicit `true`
      cases for `src/`, `client/` and `plugins/` so the surviving roots are pinned rather than
      implied. Watch it fail; verify with `bun test .hooks/tests/tdd/test-resolver.test.ts`
- [x] 1.2 In `tests/sdd-runner/test-resolver.test.ts`, flip the two gateable assertions at :31-32
      (`sdd-runner/src/events.ts`, `sdd-runner/src/stages/intake.ts`) to `false`, keeping the
      existing `false` cases for its test file, `package.json` and `README.md`. Watch it fail;
      verify with `bun test tests/sdd-runner/test-resolver.test.ts`

## 2. Narrow the predicate (green)

- [x] 2.1 In `.hooks/tdd/test-resolver.mjs`, drop the `isReviewLoop` and `isSddRunner` conditions
      from `isGateableImplFile` and update its doc comment to state the rule (product roots only)
      rather than list roots. Change nothing else in the file. Verify with
      `bun test .hooks/tests/tdd/test-resolver.test.ts tests/sdd-runner/test-resolver.test.ts`
- [x] 2.2 Confirm the gate's selection follows, with no change to `changed-files.ts`: verify with
      `bun test tests/scripts/mutation/changed-files.test.ts`
- [x] 2.3 Confirm the five write-hook checks still behave for product roots and now no-op for the
      dropped ones; verify with `bun test .hooks/tests/tdd/`

## 3. Guard the path mappers (D2)

- [x] 3.1 Add assertions to `.hooks/tests/tdd/test-resolver.test.ts` and
      `tests/sdd-runner/test-resolver.test.ts` that `suggestTestPath`, `findTestFile` and
      `resolveImplPath` still map `review-loop/src/x.ts` ↔ `tests/review-loop/x.test.ts` and
      `sdd-runner/src/x.ts` ↔ `tests/sdd-runner/x.test.ts` — non-gateable, still mappable. Verify
      with `bun test .hooks/tests/tdd/test-resolver.test.ts tests/sdd-runner/test-resolver.test.ts`
- [x] 3.2 Confirm `test:affected` still reaches both workspaces through `samePackageTestDir`; verify
      with `bun test tests/scripts/test/affected.test.ts` and
      `bun run test:affected --base=HEAD~1`

## 4. Prune the unreachable floors

- [x] 4.1 Remove every `sdd-runner/src/` (81) and `review-loop/src/` (19) key from
      `scripts/mutation/baseline.json`, leaving 329 entries. Verify the file still parses as a
      baseline map and that the remaining keys are exactly the `src/`, `client/` and `plugins/`
      ones: `bun test tests/scripts/mutation/baseline.test.ts`
- [x] 4.2 Confirm the ratchet is unaffected for the surviving roots; verify with
      `bun test tests/scripts/mutation/gates.test.ts tests/scripts/mutation/seed-from.test.ts`

## 5. Docs and full verification

- [x] 5.1 Update the root list where it is enumerated: `scripts/mutation/README.md`,
      `docs/architecture/commands.md`, `docs/guides/tdd-PIPELINES.md` — state the product-code rule
      and that the dropped workspaces keep their unit suites. Verify with
      `bun run format:check`
- [ ] 5.2 Run `bun test`, `bun run typecheck`, `bun run lint` and confirm all green
