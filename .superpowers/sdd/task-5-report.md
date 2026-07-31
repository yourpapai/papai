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
- `bun test:mutate:changed` — pass outside the sandbox: all three changed
  production targets completed with no skipped or errored files
  (`src/chat/kontur-talk/config.ts` 0.9210526315789473,
  `src/chat/kontur-talk/index.ts` 0.5439560439560439,
  `src/chat/telegram/index.ts` 0.546448087431694; aggregate
  0.5806451612903226). No baseline was changed.

The sandbox blocks `Bun.serve(port: 0)` and Stryker's local logging socket, so
the approved platform-lane and mutation reruns proved those failures were
environmental and completed the real lanes.
