# dedupe-lint-typecheck

## Goal

Resolve issue #360's actionable item: the repo's check surface runs **two full TypeScript type-check passes** — `bun run lint` (oxlint with `.oxlintrc.json` `options.typeAware: true, typeCheck: true`, powered by `oxlint-tsgolint`) and `bun run typecheck` (`tsgo --noEmit`). `scripts/check.sh` runs both in staged mode (lint at ~line 200, typecheck at ~line 209) and full mode (checks array at line 335), and `package.json` `check:verbose` runs both in parallel. The issue author could not verify the redundancy (no node_modules in their container); this container also lacks node_modules. **This change is verification-first**: empirically establish which pass subsumes which, then remove the redundancy only where equivalence is proven; if they are not substitutable, ship the finding as documentation and change nothing that weakens a gate.

## Verified starting facts (read from the repo)

- `.oxlintrc.json` enables `typeAware` + `typeCheck` (type-aware lint rules over a full checker pass); `oxlint-tsgolint` is a devDependency.
- `typecheck` script is `tsgo --noEmit` over the root `tsconfig.json` (strict, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`).
- In check.sh **staged** mode, oxlint runs on staged files only, while typecheck is project-wide — so staged-mode `typecheck` is load-bearing (a staged edit can break an unstaged file's types) and must survive any dedup.
- The dedup opportunity is therefore **full mode / `check:verbose`**, where both passes are project-wide.
- No existing `openspec/changes/*` change covers this (`remove-redundant-workspace-checks` is about per-workspace check entries, a different composition question).

## Files to touch

- `scripts/check.sh` — full-mode checks array; keep staged-mode `typecheck`.
- `package.json` — `check:verbose` script composition.
- `tests/scripts/check.test.ts` — update expected check composition test-first.
- `AGENTS.md` timing table + `docs/architecture/commands.md` (and any doc describing the check surface) to match the outcome.
- `.oxlintrc.json` — only if the experiment's outcome is disabling lint's type-check pass instead of dropping the tsgo run.

## Intended behaviour change

1. **Experiment (with `bun install` done first)**: (a) time `bun run lint` with and without `typeCheck` to quantify the embedded type-check cost; (b) plant probe errors in a scratch `src/` file — a type mismatch, and separately a `noUnusedLocals`-style violation — and record which gate (lint vs typecheck) reports each; (c) record findings in the change's `design.md`.
2. **If the surviving single pass reports every probe class project-wide**: drop the redundant entry from `check.sh` full mode and `check:verbose` (preferred direction: keep `tsgo --noEmit` as the authoritative type gate unless evidence shows the tsgolint path reports strictly more), update `tests/scripts/check.test.ts` first, update docs/timings.
3. **If neither subsumes the other** (likely edge: type-aware lint rules ≠ full compiler diagnostics like `noUnusedLocals`): remove no gate; instead document in `AGENTS.md`/`docs/architecture/commands.md` why both passes exist (so this question is not re-derived), and close the change as findings-only.
4. Never weaken diagnostic coverage: a gate may be removed only when the surviving gate demonstrably catches the same error class on the same file scope.

## Verification

- `bun test tests/scripts/check.test.ts` (composition assertions, updated test-first).
- Probe drills: each planted error is caught by exactly one surviving gate; a clean tree passes `./scripts/check.sh --skip-tests` end-to-end.
- Full `bun run test`, `bun run typecheck`, `bun run lint` green before finish; before/after timings recorded in `design.md`.

## Non-goals

- Consolidating `scripts/svelte-plugin.ts` onto Vite / `@sveltejs/vite-plugin-svelte` — the issue itself routes this to a separate proposal; do not touch the Svelte loader, `scripts/build-client.ts`, or `.storybook/main.ts` here.
- Removing staged-mode `typecheck`; touching the mutation ratchet, coverage lanes, `test:client`, or CI workflow files beyond the check composition.
- Any runtime (`src/`, `client/`) behavior change.

## Capabilities

None — skip_specs proposed because this is dev-tooling (lint/type-check pipeline composition and its documentation); no downstream observer of the system's contract sees an added, changed, or removed requirement.
