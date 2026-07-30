# Task 5 Report: Register adapter scenarios

## Result

Registered the five adapter scenarios one-to-one in the Tier 3 platform catalog,
made the scenario test titles consume that registry, and promoted precisely the
five corresponding `needs-seam@3` catalog records to executable Tier 3 mappings.
`SCN-deferred-poller-lifecycle` remains `needs-seam@4` with
`scheduler-due-seed` and `scheduler-chat-di`; no Tier 4 file changed.

## TDD evidence

The crosscheck was changed first and failed as expected: it found three rather
than eight Tier 3 executable records and reported all five unregistered source
markers. After registration and catalog promotion, the same command passed all
three checks with 30 assertions.

## Verification

- `bun test tests/platform/catalog-crosscheck.test.ts` — pass (3 tests).
- `bun test:platform` — pass outside the sandbox (8 tests: three existing
  Mattermost and all five new fake-boundary scenarios).
- `bun run typecheck` — pass.
- `bun security` — pass outside the sandbox with Semgrep via Docker.
- `bun test:mutate:changed` — sandboxed execution could not bind Stryker's
  local logging server; an approved rerun started and completed the first
  target (`src/chat/kontur-talk/config.ts`, score 0.9210526315789473) before
  the command-session handle was lost. No baseline was changed.

The sandbox also blocks `Bun.serve(port: 0)`, so the Kontur scenario cannot run
there; the approved platform-lane rerun proved this was environmental and passed
the real lane.
