# Tasks — Restore the inline-suppression write guard

Ordered test-first. Section 1 adds the two tests that the diagnosed fix must satisfy and that a
naive `parseSync` swap would NOT — they are what makes section 2 correct rather than
accidentally-passing. See design.md D1/D3.

## 1. Pin the fail-closed contract (red)

- [x] 1.1 Add a test to `.hooks/tests/tdd/checks/enforce-write-policy.test.ts`: an edit whose
      `oldString` does not match the file (so reconstruction fails) and whose `newString` is a
      fragment that does not parse standalone — beginning mid-block, e.g.
      `  } else {\n    // <ts-expect-error>\n    return null` — must block and name the directive.
      Watch it fail; verify with
      `bun test ./.hooks/tests/tdd/checks/enforce-write-policy.test.ts`
- [x] 1.2 Add a test pinning that the string-literal exemption still holds on content that parses
      cleanly, alongside the mid-block case, so D3's two halves are pinned together and a future
      edit cannot satisfy one by breaking the other. Verify with the same command

## 2. Replace comment extraction (green)

- [x] 2.1 In `.hooks/tdd/checks/enforce-write-policy.mjs`, drop `import * as ts from 'typescript'`
      and reimplement `extractComments` on `oxc-parser`'s `parseSync`, returning both the comment
      texts and whether the parse reported errors. Verify with
      `bun test ./.hooks/tests/tdd/checks/enforce-write-policy.test.ts`
- [x] 2.2 Add the lexical fallback used when a parse reports errors, and route `countSuppressions`
      through it. Keep the fallback biased toward blocking (D3). Verify with the same command
- [x] 2.3 Make the diff path pick one strategy for both sides: when either the existing or the
      resulting content fails to parse, scan both lexically, so a method mismatch cannot read as an
      added suppression. Verify with the same command
- [x] 2.4 Confirm the whole hook lane is green: `bun test ./.hooks/tests/`
- [x] 2.5 Re-run the end-to-end fail-open probe from the proposal and confirm both payloads now
      block: an `eslint-disable-next-line` write and an `@ts-expect-error` write against
      `src/example.ts`

## 3. Run the lane in CI

- [x] 3.1 Add `"test:hooks": "bun test ./.hooks/tests/"` to `package.json`; verify with
      `bun run test:hooks`
- [x] 3.2 Call it from `scripts/check.sh`'s full-mode `checks` array (the generic leg runs
      `bun run "$check"` and persists `reports/checks/test_hooks.log`), and keep it OUT of the
      `--skip-tests` filter. **Narrowed from the plan: full mode only** — staged mode does not
      classify `.mjs` at all, so it already no-ops on hook-only edits and wiring it in would mean
      rewriting that classification first. See design.md D4. Verify with `bash scripts/check.sh
      --skip-tests`
- [x] 3.3 Confirm the leg actually fails the run when a hook test fails — temporarily break one
      assertion, see the run go red naming it, then restore. Do not commit the break

## 4. Docs and full verification

- [x] 4.1 Record in `docs/guides/tdd-PIPELINES.md` and `docs/architecture/commands.md` that the
      hook lane runs in CI via `test:hooks`, that it needs an explicit path because `.hooks/` is
      outside default discovery, and that the guard fails closed. Verify with `bun run format:check`
- [x] 4.2 Run `bun test`, `bun run typecheck`, `bun run lint`, `bun run check:full` and confirm
      green — `check:full` legs lint, format:check, license-headers, knip, test:client (1998 pass),
      test:hooks (185 pass) and duplicates all green; `test` is 17811 pass / 4 skip / 1 fail. The
      one failure is `tests/git-init-hint.test.ts:68`, which pins a bun 1.4 env-propagation fix and
      fails on any bun 1.3 host (this container: 1.3.11; CI pins 1.4.0) — identical to the
      pre-change baseline and not among this change's files. Standalone typecheck and lint clean.

      Hazard found while verifying: `git commit` runs `check.sh --staged`, which clears the shared
      `reports/checks/` dir out from under an in-flight `check:full`. The first run was discarded
      and re-run clean rather than reported from. Unrelated to this change; worth a follow-up.
