<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## Context

See `proposal.md` — Why. The relevant current state:

- `afk-runner/src/cli.ts` `defaultCliDeps` builds the launch config inline: `repoRoot: cwd`, `workDir: <cwd>/.afk-runner`, `model: process.env['AFK_RUNNER_MODEL'] ?? 'opencode'`, `budget: 5`, no `deadline`. Every verb dispatches through this one sync factory inside `cliMain`.
- `afk-runner/src/config.ts` owns the tested five-key contract: `loadRunnerConfig(configPath)` (strict unknown-key rejection with named key + replacement pointer, `workDir` resolved against the file's `repoRoot`, work dir mkdir'd, `budget: null` ⇒ unmetered via `autonomyOf`). Its `FiveKeySchema` defaults `workDir` to `.sdd-runner` — the drift the proposal names. It has zero production callers.
- Autonomy and deadline consumption are already config-driven and stay untouched: `autonomyOf(config)` derives `costCeilingUsd`/`metered`/`deadlineMinutes`, and the gate prelude/resume waiter consume that as-is (`afk-runner-autonomy` unchanged, per proposal Impact).
- `.gitignore` covers `.sdd-runner/` but not `.afk-runner/`.
- The doc-flag pin in `tests/afk-runner/cli.test.ts` reads `.claude/commands/sdd-auto.md` only and asserts the documented flag inventory is exactly `['--depth']`; the `.opencode/commands/sdd-auto.md` twin is byte-similar today but unpinned.
- Runtime constraints: `loadRunnerConfig` is async (`node:fs/promises`), so wiring it into launch makes resolution async; `cliMain` is already async. The Write/Edit TDD hook gates `afk-runner/src/**` (impl → `tests/afk-runner/<name>.test.ts`); the mutation ratchet floors `afk-runner/src/**` — `scripts/mutation/baseline.json` carries 76 afk-runner records, including both files edited here, so `config.ts` and `cli.ts` are measured against their recorded scores and kills.

## Goals / Non-Goals

**Goals:**

- One resolution seam every verb shares: file at the work dir → `AFK_RUNNER_MODEL` → compiled defaults, with the file wholesale-authoritative and failures loud (never silent fallback).
- Make the standing default work dir mechanically single-sourced (schema default, CLI fallback, and file lookup all read one constant) and ignore-covered.
- Keep the change launch-time only: no run-state, event, or autonomy-semantics edits.

**Non-Goals:**

- Field-level merging of file and environment (the ladder is per-rung, not per-key — see D3).
- Any CLI flag surface or env entry beyond `AFK_RUNNER_MODEL` (proposal already declines flags; see D6).
- Recording launch provenance (which rung won) in run state — see Open Questions.
- Touching `runCli` (bare run-dir fold) — it consumes no config and gains no resolution step.

## Decisions

### D1 — The ladder lives in `config.ts` as `resolveRunnerConfig`

A new exported async `resolveRunnerConfig` in `afk-runner/src/config.ts` implements the whole ladder; `cli.ts` consumes it and stays a thin assembly/dispatch layer. Rationale: all three rungs (file contract, env entry, compiled defaults) are configuration semantics, and co-locating them with `FiveKeySchema` is what makes the `.sdd-runner`/`.afk-runner` drift class impossible to reintroduce silently — the original bug was two modules owning "the default". Existing module coverage: `config.ts` already owns `RunnerConfig`, the schema, and `loadRunnerConfig`; no new module is introduced, and no new dependency is needed (`node:fs/promises` + zod are already in use). Alternative — resolve inside `cli.ts`: declined, it re-splits default ownership across modules; alternative — per-verb resolution helpers: declined, the spec requires one resolution shape shared by all verbs.

### D2 — The lookup path is pinned to the standing default

The candidate file is always `<repoRoot>/.afk-runner/config.json`, where `repoRoot` is the CLI's standing root (`process.cwd()`), derived from a single exported `DEFAULT_WORK_DIR = '.afk-runner'`. The schema's `workDir` `.default(...)`, the CLI's no-file fallback, and this lookup path all read that one constant — "one default stands in both places" becomes a code property, not a convention. A file's own `workDir` key may relocate bookkeeping elsewhere, but it never relocates the lookup: honoring a file-declared work dir for finding the file would be circular. Alternative — a `AFK_RUNNER_WORKDIR` env entry: declined, the environment carries the model entry only (spec: "The environment entry SHALL carry no budget or deadline", and a work-dir entry is the same anticipated-only shape).

### D3 — A present file is wholesale-authoritative; absence is the only fall-through

Resolution is rung-switching, not key-merging:

- Candidate exists → the resolution **is** `loadRunnerConfig(candidate)`. The file's five keys govern as loaded — its `repoRoot` and `workDir` resolution, its mkdir, its rejection rules. No environment value is consulted for any key; no per-key overlay.
- Candidate absent → the today-shape built from defaults: `{ repoRoot: cwd, workDir: resolve(cwd, DEFAULT_WORK_DIR), model: env['AFK_RUNNER_MODEL'] ?? DEFAULT_MODEL, budget: DEFAULT_BUDGET_USD }` — no `deadline`.
- A present-but-invalid file (unknown/removed key, wrong shape, bad JSON) throws out of `loadRunnerConfig` with its existing named-key/pointer error contract and fails the verb before any run work; only file **absence** falls through.

Rationale: the spec makes the file "authoritative for the whole five-key configuration" precisely so a run's configuration is one artifact; merging would re-create the ambiguity the ladder removes, and would need a second, merged-error semantics beside the loader's tested one. Alternative — per-key precedence (file `budget` over env `model` over defaults per key): declined as above.

### D4 — Defaults become named constants shared by every rung

Extract `DEFAULT_MODEL = 'opencode'`, `DEFAULT_BUDGET_USD = 5`, `DEFAULT_WORK_DIR = '.afk-runner'` in `config.ts`; `FiveKeySchema`'s `.default(...)` calls and the absent-file fallback both read them (the budget constant also retires the duplicate `5` in `AUTONOMY_DEFAULTS` where it is the same number). Alternative — leave the literals: declined, three copies of `5` and two names for the work dir is the exact drift this change exists to end.

### D5 — `.afk-runner` stands; `.gitignore` gains it beside the legacy entry

`FiveKeySchema.workDir` default flips `.sdd-runner` → `.afk-runner` (the CLI fallback already stands there, and `.afk-runner` is the post-R5 name — `.sdd-runner` is the deleted workspace's). `.gitignore` adds `.afk-runner/` under the runner-state section. The existing `.sdd-runner/` entry **stays**: checkouts with pre-R5 bookkeeping keep it covered, and removing it buys nothing. Consequence worth recording: the config file itself is ignore-covered, i.e. a per-machine local launch surface — that is the intent (the C8 matrix calibrates per checkout, not per repo). Alternatives — flip the CLI to `.sdd-runner` (resurrects a retired name; more callers move), or drop the `.sdd-runner/` ignore line (surfaces old dirt in stale checkouts): both declined.

### D6 — The environment stays model-only and unscanned

Only `AFK_RUNNER_MODEL` is read. No `AFK_RUNNER_BUDGET`/`AFK_RUNNER_DEADLINE` entries are added, and unknown `AFK_RUNNER_*` entries are neither scanned nor rejected — simply unread, matching the repo's stance against anticipated-only surface (same reasoning as the no-flags non-goal). Alternative — fail loudly on `AFK_RUNNER_BUDGET`: declined; it guards a surface nobody documents and the spec assigns spend override to the file alone.

### D7 — Resolution is async; deps assembly stays sync and takes the resolved config

`cliMain` awaits `resolveRunnerConfig` once, before dispatch, for the seven verbs that consume `CliDeps`; `defaultCliDeps` becomes a pure sync assembler taking the resolved `RunnerConfig` (spawn seam, `execGit`, driver, gate-wait wiring unchanged — the driver cwd already follows `config.repoRoot`, so a file-declared root now correctly drives the OpenSpec driver too). This keeps the DI shape tests already use (`makeFakePipeline().deps` hands config in) and makes the resolution seam independently testable by handing `resolveRunnerConfig` a temp `repoRoot` plus an env record instead of `process.env`. Alternative — a `readFileSync`-based sync resolution: declined; it would duplicate a second parser beside the tested async loader.

### D8 — The file is named `config.json`

`.afk-runner/config.json`. Natural JSON naming, consistent with the loader's existing test fixtures. Alternatives — `runner.json`, or a repo-root `afk-runner.json`: declined; the spec pins the file "at the work dir".

### D9 — Both command-doc twins gain the prose; the pin goes total over both

`.claude/commands/sdd-auto.md` and `.opencode/commands/sdd-auto.md` each gain a launch-configuration section: the file path and five-key shape, the `AFK_RUNNER_MODEL` entry, the compiled defaults, file-over-environment-over-defaults precedence, `budget: null` ⇒ unmetered, the optional `metered` override key (an explicit value beats the `budget !== null` derivation), `deadline` in minutes arming the resume waiter. The prose names **no flag form** — configuration rides the ladder, no `--budget`/`--deadline`/`--model`. The pin test is extended to read both twins and keep the exact-inventory assertion (`['--depth']`) over each, so the twin cannot drift from the pinned doc. The pin's lexical reach stays the existing extractor's — backticked `--flag` tokens with a lowercase first letter (`documentedFlags` in `tests/afk-runner/cli.test.ts`): a plain-text or uppercase `--` token in the new prose passes the pin while still violating the requirement's whole-body clause, an inherited mechanism limitation this change extends to the twin but does not broaden (the requirement bounds the doc author; the pin is its enforcement floor). Alternative — keep pinning only the `.claude` doc: declined; twin drift is exactly the silent rot the pin exists to catch, and the modified requirement names both docs.

### Test-first order (TDD hook interaction)

All implementation edits land under `afk-runner/src/`, which the Write/Edit hook gates with the mapping `afk-runner/src/<name>.ts` → `tests/afk-runner/<name>.test.ts`:

1. Red: `tests/afk-runner/cli.test.ts` — resolution (file governs launch; absent file keeps env+defaults; neither → defaults), precedence (file model beats env entry beats default), rejection (removed key `budgetUsd` / unknown key / wrong shape fails the verb loudly, no fallback); `tests/afk-runner/config.test.ts` — the default-flip expectation and the `resolveRunnerConfig` rung matrix.
2. Green: `config.ts` (D1–D5) then `cli.ts` (D7). `tests/afk-runner/agent-seam.test.ts`'s direct `defaultCliDeps('/tmp')` caller is updated for the takes-config signature.
3. Docs + pin: the two command docs (D9), the architecture doc the proposal's Impact declares (`docs/architecture/afk-runner.md` CLI/config rows), then the pin extension. `docs/architecture/commands.md` is deliberately not edited: it documents bun-script semantics, story qualification, and hook policy only — its sole `afk-runner` mention is the hook-scope path list, untouched here — so no row or section of it goes stale from this change.
4. `.gitignore` entry (D5).

The mutation ratchet measures both edited impl files against their baselines (`config.ts` 0.729 / 86 killed, `cli.ts` 0.497 / 164 killed): the new resolution logic in `config.ts` can dilute its score — a below-floor score with kills held prints `WARN`, a kill regression fails the gate and needs stronger tests or a baseline update through the recorded workflow.

### Project-rule callouts

- **Capability/tool-prefs gating**: no impact — no chat tool is added or changed; the runner is repo-local dev tooling outside the capability catalog and `tool_prefs`.
- **Scope model**: no impact — no DB writes, no platform-instance/config-context/storage-context/user ids key anything; all new state is the operator-authored config file under the ignored work dir.
- **DB/drizzle**: none.
- **New dependencies/modules**: none — `config.ts` covers the need (D1).

## Risks / Trade-offs

- [Pinned default changes shape] `tests/afk-runner/config.test.ts` asserts the defaulted `workDir` as `.sdd-runner` (one case, the "defaults workDir and budget when omitted" test — the explicit-`.sdd-runner`-input case resolves input to output and survives the flip) → update that expectation in the same red step as the ladder tests; the strict-rejection and metered contracts in `config-strict.test.ts` are untouched.
- [Present-but-unreadable file mislabels as "not found"] `loadRunnerConfig`'s read wrapper says "not found" for any read error (e.g. `EACCES`) → accepted: the launch still fails loudly naming the path, never falls back, and the error-message contract is pinned unchanged by the proposal. Re-shaping it would touch a tested contract for an edge the front door does not hit.
- [Config file is untracked by design] the ignore entry that keeps bookkeeping clean also keeps the launch config out of git → intentional (per-checkout calibration); the command doc states it, so nobody expects the file to round-trip through a clone.
- [Resolution failure is a new pre-work failure mode for every verb] `status`/`report`/`runs` previously could not fail before touching the work dir → accepted and spec-mandated: a broken config must fail every verb, not just `start`; the error names the file.
- [Doc prose could accidentally backtick a `--` token] the pin's inventory assertion fails the build the moment it does → that is the guard working as designed, not a flake.
- [File-declared `repoRoot` creates a directory at load time] `loadRunnerConfig` mkdirs the file's work dir during resolution, so a typo'd root materializes a stray (ignored-name) directory before later steps fail → accepted; the five-key contract is unchanged and operator-authored.

## Migration Plan

Single change, no data migration — resolution is launch-time only; existing runs resume exactly as before (the durability spec's fallback path is untouched; no event or state shape changes).

1. Land in the test-first order above; run `bun run test:affected` in the loop, one full `bun run test` plus `afk-runner:typecheck`/`lint` before finishing.
2. Operator adoption is opt-in per checkout: create `.afk-runner/config.json` when a calibrated budget/deadline/unmetered run is wanted; absence keeps today's behavior byte-for-byte.
3. Rollback: `git revert` of the change, then re-add the `.afk-runner/` line to `.gitignore` (or delete the leftover work dir). The revert reverses the ignore hunk too — the pre-change `.gitignore` covers only `.sdd-runner/` — so any `.afk-runner/` bookkeeping launched runs left behind would otherwise surface as untracked tree dirt; the surviving sibling `.sdd-runner/` line never covered it.

## Open Questions

- Should run state (or the memo) record which precedence rung launched it (file vs env vs defaults, plus the resolved budget/model), so the `analyze` corpus report can attribute live-proof outcomes to their launch configuration? Additive observability only — the specs, the ladder, and the task breakdown hold either way, so it can be decided when the U3 live-proof matrix actually needs it.
