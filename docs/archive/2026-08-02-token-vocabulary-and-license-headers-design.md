<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Token vocabulary unification and license-header repair

Two independent sub-projects, both stacked on `ui-ux-review-01`:

- **J** — retire the legacy design-token alias vocabulary in `client/`.
- **K** — stop `scripts/add-license-headers.ts` duplicating headers.

They share a branch and nothing else. Either can be dropped without affecting the other.

---

## Sub-project J: retire the legacy token vocabulary

### Problem

`client/shared/tokens.css:78` opens a block commented _"legacy aliases: debug/admin SPAs
reference these names"_. Every member is a pure alias with exactly one target, so the codebase
carries two complete vocabularies for the same colours:

| Alias        | Target           | Sites  |
| ------------ | ---------------- | ------ |
| `--fg`       | `--text`         | 68     |
| `--fg2`      | `--text-muted`   | 48     |
| `--fg3`      | `--text-dim`     | 88     |
| `--fg4`      | `--text-dim`     | 22     |
| `--fg-hint`  | `--text-dim`     | 5      |
| `--surface`  | `--surface-1`    | 34     |
| `--raised`   | `--surface-2`    | 28     |
| `--hair`     | `--border`       | 21     |
| **total**    |                  | **314** |

Spread over **75 files**: 28 `shared`, 26 `settings`, 11 `admin`, 7 `debug`, 2 `transcript`,
1 `stories`.

`--fg4` and `--fg-hint` collapsed onto `--text-dim` during sub-project G's contrast
remediation; on `master` they are still distinct colours (`#3a4248` and `#8b978c`). **This work
therefore cannot branch off `master`** — it depends on unmerged sub-project G changes.

### Why this is worth doing

`client/settings/sections/ReposSection.svelte:264` sets `color: var(--fg1)`. **`--fg1` is
defined nowhere.** The declaration resolves to nothing, so `.settings-repos__name` — the
repository name, the most prominent text in each row — silently inherits instead of taking its
intended colour. Present since `fe38bb0bb`; three occurrences on `master`, one surviving here
after sub-project F incidentally removed the other two.

That is what a second vocabulary costs. `--fg1` is a plausible member of a numeric family,
written by someone reasoning by analogy from `--fg2`, and nothing in the toolchain rejects a
custom property that does not exist. It survived a full UX review of that section.

A second symptom: `client/shared/ui/KV.svelte:21` exposes a `dim` prop whose only effect is
`dim ? 'var(--fg4)' : 'var(--fg3)'`. Both branches now resolve to the same colour, so
`dim={true}` reads meaningful and does nothing.

### Approach

Migrate all 314 call sites to their semantic targets, delete the alias block, fix `--fg1`,
remove the inert `dim` prop, and add a guard test that makes an undefined token reference
impossible to write again.

Alternatives rejected:

- **Only the three collapsed aliases** (`--fg3`/`--fg4`/`--fg-hint`, 115 sites). Finishes
  sub-project G exactly, but leaves both vocabularies alive and the next `--fg1`-style typo
  still writable.
- **Fix `--fg1` and the `dim` prop only.** Ships the two genuine defects and defers the cause
  indefinitely.
- **Guard test without migration.** Catches `--fg1` and every future typo, but leaves 314 sites
  speaking the wrong vocabulary and the duplicate aliases in place. The guard test is worth
  having — it is included below — but it is not a substitute for the migration.

### Substitution rule

Every one of the 315 sites (314 aliases + `--fg1`) is the exact literal form `var(--name)`.
Verified: no `var(--x, fallback)` uses, no local redefinitions outside `tokens.css`, no bare
mentions.

**The match must include the closing paren.** `--fg` is a prefix of `--fg1`, `--fg2`, `--fg3`,
`--fg4`, `--fg-hint`; `--surface` is a prefix of `--surface-1`, `--surface-2`,
`--surface-hover`. A word-boundary match on `--surface` hits 14 lines that already correctly
use the semantic tokens, so a careless regex corrupts the very tokens it is migrating toward.
Anchored on `var(--name)`, the eight substitutions are independent and order-insensitive.

### Verification: the zero-diff proof

314 of the 315 sites are pure renames — the resolved CSS is byte-identical, so the render
**must** be pixel-identical. Sub-project I's audit mode turns that from an assertion into an
oracle:

```
bun shoot                 # --update-snapshots=all; all 454 baselines encode the pre-change render
<make the change>
bun run visual:audit      # VISUAL_AUDIT=1, threshold 0.02 -> pixelmatch cutoff 14.09
```

Expected: **449 passed / 5 failed**, the five being the known `DebugApp` / `DebugTopBar` clock
stories, which differ by 47–50 pixels of ticking digits. That floor was established across
three runs on unmodified source with an identical failing set, including one run under heavy
load taking 2.3m against the others' ~45s.

A sixth failure is a real defect, and the failing story name localizes it. A mis-mapped alias
(for example `--fg3` -> `--text` instead of `--text-dim`) is a YIQ delta in the thousands
against a cutoff of 14.09; it cannot hide.

**`bun shoot` must not run after a change under test.** The audit compares against whatever is
on disk, so re-baselining post-change converts the proof into a tautology. It runs once before
Task J1, and again only where a task explicitly calls for it.

### Guard test

A test that collects every `--x:` declaration under `client/` and asserts every `var(--x)`
reference resolves to one of them.

Definitions are collected from **all of `client/`**, not just `tokens.css`, so a component that
scopes its own custom property is not a false positive. None of the eight aliases are locally
redefined — verified — but other properties may be.

This closes the class of bug rather than the instance. Retiring the vocabulary makes `--fg1`
less likely; the guard test makes it impossible.

### Tasks

`bun shoot` runs once before J1. Each task ends with `bun run visual:audit`.

#### J1 — guard test and the `--fg1` fix

Write the guard test first. It fails on `--fg1`: undefined reference. Then change
`ReposSection.svelte:264` from `var(--fg1)` to `var(--text)` and the test goes green.

`--fg1` -> `--text` is an **inference about intent, not a recorded decision**. It is
well-supported — the sibling `.settings-repos__url` uses `--fg2` -> `--text-muted`, and this
rule styles the row's primary text, so the brightest foreground is the only sensible reading —
but it is a judgment call and must be flagged to the reviewer rather than buried in a
mechanical diff.

Audit expectation: **ReposSection stories fail.** That failure is the evidence the bug was
real. Read the diff PNG to confirm the repository name brightened, then re-baseline
(`bun shoot -g ReposSection`).

This task comes first because the guard test is red until `--fg1` is fixed, and because it
isolates the single intended visual change into the first commit — leaving J2 and J3 to land on
a re-baselined tree where zero diff is the expectation.

#### J2 — migrate the 314 call sites

Apply the eight substitutions across the 75 files, anchored on `var(--name)`.

Audit expectation: **449 / 5, unchanged.** Guard test stays green.

The reviewer's job here is to check the substitution rule and the audit result, not to read 314
lines.

#### J3 — delete the alias block and the inert prop

- Delete the eight alias definitions from `client/shared/tokens.css`.
- Invert `tests/client/shared/tokens.test.ts:48`, currently
  `test('keeps legacy aliases so debug/admin SPAs still resolve')` — an assertion actively
  pinning the block in place. It must assert the aliases are **absent**. That test also lumps
  `--s4:` in with the aliases; `--s4` is a spacing-scale token, not legacy, so move it into the
  `defines layout + sizing tokens` list (which does not currently assert it) rather than
  dropping it.
- Remove `KV.svelte`'s `dim` prop. After J2 both branches read `var(--text-dim)` literally,
  making the deadness self-evident.

Deleting the definitions is provably inert **because J2 landed first**: with zero references
remaining, removing them cannot affect resolution.

**No production code passes `dim`.** Its only consumer is `client/shared/ui/KV.stories.svelte:24`
— `<Story name="Dim" args={{ k: 'Idle since', v: '3h', dim: true }} />`. Removing the prop
therefore deletes that story, which deletes its generated spec entry and its baseline PNG.

Audit expectation: **448 / 5.** The pass count drops by one because the suite now has 453
baselines, not 454. This is the one place in sub-project J where a changed count is correct;
everywhere else a change from 449 is a defect. Regenerate the spec (`bun shoot:gen`) and remove
the orphaned baseline before the audit run, or the deleted story presents as a failure.

Guard test stays green.

`public/*.css` need no attention — `git ls-files public/` is empty; they are concatenated from
`client/**` by `storybook:prepare`, which a Playwright `globalSetup` regenerates every run.

---

## Sub-project K: stop `add-license-headers.ts` duplicating headers

### Problem

`updateExistingHeader` requires the SPDX line at exactly `startIndex` (0, or 1 past a shebang):

```ts
const startIndex = headerStartIndex(lines)
if (lines[startIndex] !== SPDX_LINE) return null
```

33 files repo-wide begin with a path comment:

```
// src/byok-llm/blob-codec.ts        <- line 1
// SPDX-License-Identifier: BUSL-1.1 <- line 2, header already correct
```

The check fails, the function returns `null`, and control falls through to `addHeader`, which
prepends a **second** complete four-line header. The file then starts with SPDX, so every
subsequent run reports "skipped."

Three properties make this worth real work rather than a one-line patch:

1. It corrupts on first contact.
2. The corruption is permanent.
3. **The natural verification — run it again — reports clean.**

Today it is contained only by a human noticing 37 unexpected files in `git status` and
hand-reverting, which happened again during sub-project I's Task 3. One lapse writes permanent
damage.

The script is not, as previously recorded, non-idempotent: run 1 on a clean tree stamps 37
files, run 2 stamps 0. It is perfectly idempotent, which is precisely why the defect hides.

### Approach

Bound the header search to the leading comment run. Scan forward from `startIndex` for the SPDX
line **while lines are `//` comments or blank**, stopping at the first line of real code. On a
hit at index `i`:

- preserve `[startIndex, i)` verbatim — the path comment, or whatever preamble is present;
- normalize the four-line header in place at `i`;
- keep the remainder unchanged.

Idempotent by construction: the second run finds SPDX at the same `i` and produces identical
bytes.

**The bound is load-bearing.** `src/analytics/tool-slug-generation.ts` contains a second SPDX
line in its module body, because it generates a stamped file. An unbounded search would find it
and mangle the file. That file is the existing proof that the scan must stop at the first
non-comment line.

Alternatives rejected:

- **Guard only** — skip the file when a header exists anywhere. Prevents duplication but leaves
  those 33 files permanently un-normalized, so the next year rollover silently skips them.
  Trades a loud bug for a quiet one.
- **Strip the 33 path comments** so line 1 becomes SPDX. Fixes today's files and leaves the
  script fragile; any future leading comment — an eslint directive, a `@vitest-environment`
  pragma, a file-level JSDoc — re-arms it.
- **Scope the script to changed files.** The whole-repo sweep is the script's purpose, not the
  defect, and this would not address duplication at all.

### Tasks

#### K1 — bound the scan

Both tests use the existing harness in `tests/scripts/license-setup.test.ts`
(`createHeaderScriptRepo()`, `writeRepoFile()`, `runCommand()`), which builds a throwaway repo
and invokes the real script. No new infrastructure.

1. **Path-comment preamble** (red). Write a file whose line 1 is `// src/thing.ts` followed by
   a valid header. Assert exactly one SPDX line survives, the path comment is still line 1, and
   the header is intact. Fails today by producing two headers.
2. **Fixed point.** Run the script twice over the same temp repo; assert the second run changes
   nothing. The current script satisfies this property only _after_ it has done the damage, so
   pinning it means the damage cannot be what establishes it.

Then implement the bounded scan and take both tests green.

### Acceptance criterion

> After the fix, `bun run license:headers` on a clean tree reports **0 stamped**.

Today it reports `37 stamped, 3395 skipped`. Those 37 already carry correct 2026 headers, so
the in-place normalization is a no-op for them — zero is the right expectation, not a hopeful
one. Assert only the stamped count: the skipped count is the repo's file total and drifts with
every file this branch adds.

---

## Risks

- **`bun shoot` after a change erases the evidence.** Every J task brief must state the
  ordering explicitly.
- **The 5-flake floor assumes a healthy Storybook server.** It died once during sub-project I's
  Task 2b. Those failures are loud — navigation aborts, `ERR_ABORTED`, `ERR_CONNECTION_REFUSED`
  — and are distinguishable from pixel diffs, but a run containing them must not be used to
  re-baseline.
- **`--fg1` -> `--text` is a judgment call.** Flag it to the reviewer explicitly.
- **75 files in one commit is a large diff.** The review target is the substitution rule and the
  audit result.
- **The guard test could false-positive on locally scoped custom properties.** Mitigated by
  collecting definitions from all of `client/`.

## Out of scope

- The spacing scale (`--s3`…`--s9`) and other token families — they are the scale, not aliases.
- The markdown path in `add-license-headers.ts`. The same class of fragility exists in
  principle, but no file exhibits it and no cost is being paid.
- Disabled-control contrast and the `token-contrast.test.ts` opacity blind spot. `.ui-btn:disabled`
  and `.ui-seg__opt:disabled` reduce contrast via `opacity`, which the contrast ratchet does not
  model — so it stays green over text that may sit far below 4.5:1. A real finding, tracked
  separately.

## Expected gate result

`bun run check:full` currently returns **10/12**, with `test` and `review-loop:test` failing on
pre-existing review-loop load flakiness documented in PR #212: the branch changes zero
`review-loop/` files, `bun run review-loop:test` alone passes 247/0 in 50.5s against 5 failures
and 3 errors in 337.8s inside the gate, and failures land on the 5s/15s timeout boundaries.

**Plans derived from this spec must state 10/12 as the expected baseline, naming those two
checks.** Sub-project I's plan said "expect 12/12" and the discrepancy cost a diagnostic detour.
