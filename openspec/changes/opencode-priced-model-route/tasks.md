<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Pre-flight — pin the red state and the rates

- [x] 1.1 Capture the pre-edit red state with one probe (the "failing test" this change turns
      green): `opencode run --auto --format json --model zai-coding-plan/glm-5.3-flash "Reply
      with the single word ok" | jq -c 'select(.part.type=="step_finish") | .part |
      {cost, tokens}'` — expect `cost: 0` (or absent) beside non-zero tokens, the exact C8
      condition behind `costKnown: false`. Verify: the probe line is saved for the 4.1 record.
- [x] 1.2 Enumerate every `zai-coding-plan` model id the SDD route can resolve:
      `opencode models | grep zai-coding-plan`, cross-checked against the machine config's
      `agent` block (`general`/`explore`/`scout` → `glm-5.3-flash`) and C8's `glm-5.3` fallback
      spelling. Verify: the id list is recorded (goes into the 4.1 record).
- [x] 1.3 Record per-model official API list rates (input / output / cache_read / cache_write,
      USD per 1M tokens) from the provider's official pricing page — Flash at its own rates,
      any non-Flash id at its own; never a copy of the Flash row (design D2). Verify: rates are
      recorded with source URL and date (goes into the 4.1 record).

## 2. The config edit

- [x] 2.1 Edit `~/.config/opencode/opencode.json`: add
      `provider["zai-coding-plan"].models[<id>].cost` blocks with the recorded rates — a
      models-only entry (no `npm` / `baseURL` / credential fields); `synthetic`, `localhost`
      and `kontur` stay untouched. Verify: a structural read prints exactly the added blocks
      and nothing else, e.g. `python3 -c "import json;
      print(json.dumps(json.load(open('$HOME/.config/opencode/opencode.json'))
      ['provider']['zai-coding-plan'], indent=2))"` — names and rates only, no secret values.
- [x] 2.2 Confirm the entry merged rather than shadowed the built-in provider. Verify:
      `opencode models | grep zai-coding-plan` still lists every id from 1.2 (auth and
      transport intact).

## 3. Green probes — the acceptance oracle

- [x] 3.1 Level 1 (opencode alone): re-run the 1.1 probe — the `step_finish` part now carries
      `cost > 0`. Verify: same command as 1.1 shows a non-zero `cost` beside non-zero tokens.
- [x] 3.2 Level 2 (runner seam): a probe spawn recorded through the runner — the smallest
      scratch run (tiny doc-task file) under `AFK_RUNNER_MODEL=zai-coding-plan/glm-5.3-flash` —
      then `bun afk-runner/src/cli.ts analyze <probe-workdir> --json` and assert the probe run's
      `usage` reads `costKnown: true` with `costUsd > 0`. Verify: the analyze JSON for the probe
      work dir reports cost known — the `gate-signals.ts:139` predicate, the oracle the proposal
      names.

## 4. Record and close

- [x] 4.1 Write `openspec/changes/opencode-priced-model-route/notes.md` as the verification
      record: the red (1.1) and green (3.1, 3.2) probe lines, the enumerated ids (1.2), the
      rates with source and date (1.3), the shadow-pricing reading (list-price metering, not
      billed spend — design D3), and the rollback (delete the added cost blocks). Verify: the
      file exists and carries all five records.
- [x] 4.2 Confirm the repository is untouched and the suite stays green — the negative proof for
      a machine-config-only change: `git status --porcelain` shows only this change folder, then
      `bun run test` and `bun run typecheck` and `bun run lint` all pass. No
      `docs/architecture/*.md` page needs an edit: no repository behavior changed, and the C9
      drill this re-arms is already listed in `docs/architecture/afk-runner.md`'s scope seed.
