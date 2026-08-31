# Tasks — afk-runner-operator-paper-cuts

Every task is red-first: the failing test lands before the implementation,
green before moving on. No prerequisites — the change is independent of
`afk-runner-loop-memory` and touches seams the landed mirrors left alone.

## 1. Write-guard scoping (pipeline delta)

- [x] 1.1 Red-first in `tests/afk-runner/work/agent-layer.test.ts`: an agent that dirties a sibling change folder (`openspec/changes/other-change/x.md`, run's change `add-thing`) fails with the diff-guard error naming the offending path **and the allowed folder**; an agent that dirties a prefix-sharing sibling (`openspec/changes/add-thing-extra/spec.md`) also fails — the shared prefix does not widen the guard; the existing own-folder green test stays untouched and green. Then scope the guard in `afk-runner/src/agent-layer.ts`: allowed prefix `` `openspec/changes/${options.changeName}/` `` threaded from the spawn options (trailing slash load-bearing), no fallback branch (design D1), violation message names the allowed folder. Verify: `bun test tests/afk-runner/work/agent-layer.test.ts`

## 2. Intake warns (cli delta, sink + wording)

- [x] 2.1 Red-first in `tests/afk-runner/work/intake.test.ts`: an override `S` emits one warn line through the intake deps sink — `--depth S skips scope estimation`, the interpolated cap `(S: 1)`, and the tail clause `skips the atomicity stage` + `decompose presents the final gate`; an override `M` warns with `(M: 3)` and no atomicity claim; estimator L vs prescreen S emits the disagreement warn naming both readings and `taking the higher`; no sink on the deps → silent, no throw; the depth event still carries `disagreement: true` and `IntakeResult` keeps its shape (design D2). Then implement: `stdout?: (line: string) => void` on `IntakeDeps` + the two warn helpers in `afk-runner/src/work/intake.ts` (design D3 wording). Verify: `bun test tests/afk-runner/work/intake.test.ts`
- [x] 2.2 Red-first in `tests/afk-runner/drive/loop.test.ts`: a driven intake with a depth override surfaces the warn on `RunDeps.stdout` prefixed `intake: `. Then wire the sink at the `intakeModule` construction in `afk-runner/src/graph/pipeline-work.ts`: `stdout: (line) => deps.stdout?.(\`intake: ${line}\`)`. Verify: `bun test tests/afk-runner/drive/loop.test.ts`

## 3. Doc pin (cli delta, parser seam)

- [ ] 3.1 Red-first in `tests/afk-runner/cli.test.ts`: `parseStartArgs` pins the current inline behavior — `['task.md', '--depth', 'S']` → `{ taskFile: 'task.md', depthOverride: 'S' }`; invalid depth value keeps the `invalid --depth` error; missing task file keeps the usage error. Then extract the parsing from `runStartCommand` in `afk-runner/src/cli.ts` verbatim into the exported pure `parseStartArgs` and consume it (design D4). Verify: `bun test tests/afk-runner/cli.test.ts`
- [ ] 3.2 Red-first in `tests/afk-runner/cli.test.ts`: the pin — every `--<flag>` token documented in `.claude/commands/sdd-auto.md` parses through `parseStartArgs` with its documented value form (today: `--depth S`); the tripwire is demonstrated red once against a doctored doc fixture carrying a bogus `--wait` (in-test string, never the real file). Nothing to implement beyond 3.1 — the test is the deliverable. Verify: `bun test tests/afk-runner/cli.test.ts`

## 4. Docs and full gate

- [ ] 4.1 Update `docs/architecture/afk-runner.md`: the intake note (the two `intake:` warn lines with their exact wording sources — round caps, S tail — and the per-execution re-warn on resumed overrides) and the write-guard note (own-change-folder scoping, prefix-sharing sibling, the stated no-fallback rule from design D1). Same commit as the final code. Verify: `bun run lint`
- [ ] 4.2 Full gates: `bun run test`, `bun run typecheck`, `bun run lint` — all green; `openspec validate --strict` green; every tasks.md box checked. Verify: `bun run test:status`
