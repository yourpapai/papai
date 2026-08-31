# Tasks — Restore the inline-suppression write guard

Ordered test-first. Section 1 adds the two tests that the diagnosed fix must satisfy and that a
naive `parseSync` swap would NOT — they are what makes section 2 correct rather than
accidentally-passing. See design.md D1/D3.

## 1. Pin the fail-closed contract (red)

- [ ] 1.1 Add a test to `.hooks/tests/tdd/checks/enforce-write-policy.test.ts`: an edit whose
      `oldString` does not match the file (so reconstruction fails) and whose `newString` is a
      fragment that does not parse standalone — beginning mid-block, e.g.
      `  } else {\n    // <ts-expect-error>\n    return null` — must block and name the directive.
      Watch it fail; verify with
      `bun test ./.hooks/tests/tdd/checks/enforce-write-policy.test.ts`
- [ ] 1.2 Add a test pinning that the string-literal exemption still holds on content that parses
      cleanly, alongside the mid-block case, so D3's two halves are pinned together and a future
      edit cannot satisfy one by breaking the other. Verify with the same command

## 2. Replace comment extraction (green)

- [ ] 2.1 In `.hooks/tdd/checks/enforce-write-policy.mjs`, drop `import * as ts from 'typescript'`
      and reimplement `extractComments` on `oxc-parser`'s `parseSync`, returning both the comment
      texts and whether the parse reported errors. Verify with
      `bun test ./.hooks/tests/tdd/checks/enforce-write-policy.test.ts`
- [ ] 2.2 Add the lexical fallback used when a parse reports errors, and route `countSuppressions`
      through it. Keep the fallback biased toward blocking (D3). Verify with the same command
- [ ] 2.3 Make the diff path pick one strategy for both sides: when either the existing or the
      resulting content fails to parse, scan both lexically, so a method mismatch cannot read as an
      added suppression. Verify with the same command
- [ ] 2.4 Confirm the whole hook lane is green: `bun test ./.hooks/tests/`
- [ ] 2.5 Re-run the end-to-end fail-open probe from the proposal and confirm both payloads now
      block: an `eslint-disable-next-line` write and an `@ts-expect-error` write against
      `src/example.ts`

## 3. Run the lane in CI

- [ ] 3.1 Add `"test:hooks": "bun test ./.hooks/tests/"` to `package.json`; verify with
      `bun run test:hooks`
- [ ] 3.2 Call it from `scripts/check.sh` in both full and `--staged` modes, matching the existing
      leg structure (each leg's output persisted under `reports/checks/<name>.log`). Verify with
      `bun run check:full` and `bun run check --staged`
- [ ] 3.3 Confirm the leg actually fails the run when a hook test fails — temporarily break one
      assertion, see `check:full` go red naming it, then restore. Do not commit the break

## 4. Docs and full verification

- [ ] 4.1 Record in `docs/guides/tdd-PIPELINES.md` and `docs/architecture/commands.md` that the
      hook lane runs in CI via `test:hooks`, that it needs an explicit path because `.hooks/` is
      outside default discovery, and that the guard fails closed. Verify with `bun run format:check`
- [ ] 4.2 Run `bun test`, `bun run typecheck`, `bun run lint`, `bun run check:full` and confirm
      green
