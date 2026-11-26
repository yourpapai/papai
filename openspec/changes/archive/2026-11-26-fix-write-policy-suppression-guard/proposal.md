# Restore the inline-suppression write guard and run the hook lane in CI

## Why

`enforceWritePolicy` — the guard behind CLAUDE.md's "Never add lint-disable or type-ignore
comments — hook policy blocks them" — has been **failing open since 2026-08-27**. It allows every
suppression comment it is supposed to block:

```
enforceWritePolicy({tool_name:'write', tool_input:{file_path:'src/evil.ts',
  content:'// eslint-disable-next-line no-eval\neval(x)\n'}, cwd}) -> null   // null = allow
```

Root cause: `.hooks/tdd/checks/enforce-write-policy.mjs:6` imports `typescript` and calls
`ts.createScanner`. The TypeScript 7 upgrade (#359, `2fec0352`) removed the standalone parser —
`typescript@7.0.2` exports neither `createScanner` nor `SyntaxKind`, so `extractComments` throws
`TypeError`, the function's outer `catch` swallows it, and every call returns `null`. It is the
**only** remaining `typescript` import in the repo; the migration moved every other scanner to
`src/ts-ast/source-parser.ts` and missed this one.

Nothing caught it because **`.hooks/tests/**` never runs in CI**: bun's default discovery skips the
dot-directory (0 of the last full run's 1603 files were under `.hooks/`), and no `check.sh`,
`package.json` or `ci.yml` leg invokes it. Its 7 covering tests have been red on master for four
days, unseen. Two further tests pass *vacuously* — they assert `null` and a guard that always
returns `null` satisfies them.

## What Changes

- Extract comments with `oxc-parser`'s `parseSync` (already a direct dependency, the same parser
  family as the `src/ts-ast/source-parser.ts` seam) instead of the deleted TypeScript scanner.
- Make extraction **fail closed**: when a parse reports errors — which is normal for the edit
  *fragments* the fallback path scans — fall back to a lexical scan rather than trusting a
  comment list the parser may have dropped. Verified: oxc returns `comments: []` for a fragment
  beginning mid-block, so a plain `parseSync` swap would silently reintroduce the fail-open.
- Stop swallowing extraction failures silently: a guard that cannot analyse content must not
  report "allow".
- Add a `test:hooks` leg so `.hooks/tests/**` runs in CI (183 tests, 1.8s).

## Capabilities

### New Capabilities

- `write-policy-guard`: the write-time policy contract — which files are protected, what counts as
  an added suppression, and that the guard fails closed when it cannot analyse content. No
  existing capability covers it; `mutation-gate` covers the CI ratchet's verdict and says nothing
  about write-time policy. Without it the fail-open behavior has no stated contract to violate,
  which is exactly how it went unnoticed for four days.

## Non-goals

- **Changing which directives are blocked.** The five matchers stay as they are.
- **Making the guard async / routing it through `src/ts-ast/source-parser.ts`.** That seam is
  async and lives in product code; a `.mjs` hook must stay synchronous and must not depend on
  `src/`. See design.md D2.
- **Auditing other hooks for TS-7 breakage.** Confirmed unnecessary — this is the only remaining
  `typescript` import in the repo.
- **Reworking `.hooks/` test placement** (e.g. moving it under `tests/`). Wiring the existing lane
  in is the smaller fix.

## Impact

- `.hooks/tdd/checks/enforce-write-policy.mjs`, `.hooks/tests/tdd/checks/enforce-write-policy.test.ts`.
- `package.json` (`test:hooks`), `scripts/check.sh` (new leg).
- Docs: `docs/guides/tdd-PIPELINES.md`, `docs/architecture/commands.md`.
- **Scope impact: none** — local hook + CI tooling. No platform instance, task instance, or config
  context.
- Security-relevant: this restores an enforcement path that is currently inert.
