<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Vite+ migration assessment

**Date:** 2026-08-25
**Question:** Is migrating papai's build / test / check surface onto Vite+ (`vp`) worth doing?
**Verdict:** **No.** Do not migrate. The overlap is near-zero-value and the one non-overlapping
piece (`vp test`) is blocked by a hard runtime incompatibility.

---

## 1. What Vite+ actually ships

Measured, not read off marketing. `vp` v0.3.0 was installed into a scratch `VP_HOME` in a
throwaway container and asked to describe itself:

```
$ vp toolchain --global
vite-plus@0.3.0
├── depends on @voidzero-dev/vite-plus-core@0.3.0
│   ├── bundles vite@8.2.2
│   │   └── uses rolldown@1.2.5
│   ├── bundles rolldown@1.2.5
│   └── bundles tsdown@0.22.14
├── depends on vitest@4.1.11
├── depends on oxlint@1.79.0
├── depends on oxlint-tsgolint@7.0.2001
├── depends on oxfmt@0.64.0
└── compiles vite-task
```

Licensing is a non-issue: Vite+ shipped MIT / fully open source, after VoidZero dropped the
originally-announced paid tier for startups and enterprises. Maturity is a real issue — the
troubleshooting page states plainly that *"Vite+ is in beta: stable, but not yet complete"*, and
the CLI is at 0.3.0.

## 2. Overlap against papai's actual surface

| papai surface | today | Vite+ equivalent | net effect |
| --- | --- | --- | --- |
| lint | `oxlint@1.78.0` + `.oxlintrc.json` | `vp lint` → `oxlint@1.79.0` | **parity**; one patch version, config moves into `vite.config.ts` |
| format | `oxfmt@0.63.0` + `.oxfmtrc.json` | `vp fmt` → `oxfmt@0.64.0` | **parity**; same |
| type-aware lint | `oxlint-tsgolint`, `typeAware: true` already set | `vp check` typeAware path | **already have it** |
| typecheck | `tsgo --noEmit` (TS7 native preview) | `vp check` `typeCheck: true` | **already have it** (see §5) |
| test | `bun test`, 1,889 files | `vp test` → Vitest 4 on Node | **blocked**, see §3 |
| client build | `Bun.build` + custom Svelte plugin | `vp build` → Vite 8 / Rolldown | genuine gap — but doesn't need Vite+, see §4 |
| library build | n/a (app, not a package) | `vp pack` → tsdown | not applicable |
| task running | `bun run`, `scripts/check.sh` | `vp run` + Vite Task caching | marginal, see §6 |
| package manager | `bun install`, `bun.lock`, `patchedDependencies` | `vp install` delegating to Bun | wrapper only |
| runtime | Bun 1.4.0 (pinned in CI + Dockerfile) | manages a **Node.js** runtime | actively unwanted |

Everything else in `scripts/check.sh` and CI has **no Vite+ counterpart at all**: `knip`,
`jscpd` duplicates, Semgrep (`bun security`), `actionlint` (`bun workflows:lint`), Stryker
mutation testing on the patched `@hughescr/stryker-bun-runner`, Playwright visual snapshots,
Storybook, the BUSL license-header gate, and the coverage ratchet. Adopting `vp` would add a
second orchestration layer beside `check.sh` rather than replacing it.

## 3. The blocker: papai is a Bun-runtime application, Vite+ is a Node toolchain

`vp test` is Vitest, which runs on Node. papai does not.

| coupling | count |
| --- | --- |
| files importing `bun:test` | **1,900** |
| test files total | 1,889 |
| files importing `bun:sqlite` (Drizzle driver) | **170** (90 in `src/`+`plugins/`, 80 in `tests/`) |
| `mock.module()` call sites | 209 (across 60 files) |
| `spyOn` / `mock.restore` call sites | 134 / 75 |
| `Bun.file` / `Bun.write` / `Bun.spawn(Sync)` | 193 / 87 / 67 |
| `Bun.serve` / `Bun.cron` / `Bun.Glob` / `Bun.Transpiler` | 20 / 1 / 8 / 1 |

`bun:test` is not API-compatible with Vitest at the seams this repo leans on hardest —
`mock.module()` has no direct Vitest equivalent that preserves the repo's delayed-import mocking
pattern, and 209 call sites is not a codemod. Beyond the tests, the *production* server is Bun:
`Dockerfile` ends in `CMD ["bun", "run", "src/index.ts"]`, the database layer is Drizzle over
`bun:sqlite`, HTTP is `Bun.serve`, and scheduling uses `Bun.cron`. Moving to Vitest means moving
off Bun, which means replacing the SQLite driver, the HTTP server, the process spawner, and the
scheduler — a runtime migration, not a toolchain one.

It would also cost the thing that makes this suite tractable. The full suite is budgeted at ~3–4
minutes on a 4-vCPU container for 1,889 files; that is a Bun number.

Downstream casualties of the same move: the 2,447-line `scripts/test/` harness (report
persistence, JUnit join, `test:failures` / `test:show` / `test:log` / `test:slowest`,
`test:affected` import-graph heuristic, load-aware serial/parallel mode selection), the
Stryker config pinned to `"testRunner": "bun"` with a local patch, `bunfig.toml` preload and
timeout semantics, and the coverage ratchet reading Bun's lcov.

## 4. The one real gap Vite+ points at — and why it doesn't justify Vite+

There *is* a defensible criticism buried here, and it's worth separating from the Vite+ question.

The client is built by `scripts/build-client.ts` (152 lines) using `Bun.build` with a hand-written
79-line Svelte loader (`scripts/svelte-plugin.ts`) that drives `svelte/compiler` and hand-rolls
CSS collection and concatenation, emitting four IIFE bundles. Meanwhile `.storybook/main.ts`
already runs **Vite 8** with the real `@sveltejs/vite-plugin-svelte` — and its comments record the
friction of having no root `vite.config.ts` to share, including a manual plugin-order splice.

So papai maintains two Svelte pipelines that must agree. Consolidating the client build onto Vite
would delete `svelte-plugin.ts`, let Storybook and the app share one config, and bring a real HMR
dev server for `client/`.

**But that is plain Vite, which the repo already depends on.** None of it requires `vp`,
Rolldown-via-Vite+, or a Node runtime — `bunx vite build` works. If this is worth doing, it is
worth doing as a standalone change scoped to `client/`, keeping `check:bundle-isolation` and the
existing tests as the gate. Vite+ adds nothing to it except a beta CLI wrapper.

## 5. Second-order finding: possible double type-check (independent of Vite+)

Vite+'s headline `vp check` pitch is *"speeding up static checks by 2× compared to running
type-aware lint rules and type-checks separately."* papai appears to be doing exactly the thing
that pitch targets, and can fix it without Vite+:

- `.oxlintrc.json` already sets `"typeAware": true, "typeCheck": true`, and `oxlint-tsgolint` is
  an installed devDependency — so `bun run lint` (~35 s) is running the tsgolint type-check path.
- `scripts/check.sh` *also* runs `typecheck` → `tsgo --noEmit` (~24 s) as a separate parallel check.

If oxlint's `typeCheck` genuinely covers what `tsgo --noEmit` reports, one of the two is
redundant. **Not verified** — `node_modules` was not installed in the container this assessment
ran in, so neither binary could be executed. Worth a 10-minute experiment locally (introduce a
type error, see which checks catch it) before touching anything. They run in parallel today, so
the win is CI CPU rather than wall-clock, and dropping `tsgo` would be a real loss of coverage if
the two disagree.

## 6. `vp run` task caching: the only slice adoptable without the rest

`vp run --cache <script>` caches `package.json` script results with automatic input tracking, and
works on any script regardless of runtime. It is the one Vite+ feature that does not require
Vitest, Node, or a `vite.config.ts` rewrite.

It still isn't compelling here. papai already has targeted incrementality where it matters —
`test:affected`, Stryker's `incremental` file, the mutation score cache, GitHub Actions caching —
and the remaining checks are cheap (`knip` 4.6 s, `format:check` 2.9 s, `duplicates` 1.3 s). The
expensive one is the test suite, whose inputs are ~all of `src/` + `tests/`, so it would miss the
cache on nearly every commit. Adding a beta CLI to CI to cache 9 seconds of fast checks is a bad
trade.

## 7. Cost if attempted anyway

Rough shape, worst-to-least: rewrite 1,889 test files off `bun:test`; replace 209 `mock.module()`
sites; swap the Drizzle `bun:sqlite` driver and its 170 call sites; replace `Bun.serve`,
`Bun.cron`, `Bun.spawn`, `Bun.file`, `Bun.Glob`, `Bun.Transpiler`; rebuild the `scripts/test/`
harness against Vitest reporters; re-source the Stryker runner; rewrite `Dockerfile`, `ci.yml`,
and every other workflow off `oven-sh/setup-bun`. Months of work, whose *best case* is a slower
test suite, an equivalent linter, and an equivalent formatter.

## 8. Recommendation

1. **Do not migrate to Vite+.** Remove it from consideration.
2. Optionally bump `oxlint` 1.78.0 → 1.79.0 and `oxfmt` 0.63.0 → 0.64.0 — that is the entire
   toolchain delta Vite+ was offering, and it's a `bun update`.
3. Consider, as a *separate* proposal: consolidating the client build onto plain Vite so the app
   and Storybook share one Svelte pipeline and `scripts/svelte-plugin.ts` can go away (§4).
4. Consider, as another separate item: verifying and resolving the `lint`-vs-`typecheck`
   type-check overlap (§5).

## 9. Reconsider if

- `vp test` gains a Bun runtime target (today it is Vitest-on-Node, full stop).
- papai moves off Bun for unrelated reasons — then Vite+ becomes a live option rather than a
  forcing function.
- Vite+ reaches 1.0 **and** the client grows enough that a shared Vite config plus task caching
  outweighs running a second orchestrator beside `check.sh`.

## Sources

- <https://viteplus.dev/llms-full.txt> (full docs, fetched 2026-08-25)
- `vp toolchain --global`, `vp` v0.3.0
- <https://voidzero.dev/posts/announcing-vite-plus-beta>
- <https://github.com/voidzero-dev/vite-plus>
