<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# FU2 · pipelineJobTrackList Importer Un-drop (papai) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the kiss→nerv Project importer from silently dropping a repo's `pipelineJobTrackList`; carry a non-empty list through into the produced nerv repo doc so nerv's Component A (config seeding, out of scope here) has a field to read from.

**Architecture:** This is `papai`'s slice of Component D of the FU2 design
(`docs/superpowers/specs/2026-07-13-followups-fu2-pipeline-job-tracklist-parity-design.md`). It touches exactly one pure-mapping file and its test — no I/O, no DB, no schema migration on the papai side (papai only produces the Mongo document nerv's own migration/importer consumes; `KissProjectRepoRef.pipelineJobTrackList` already exists as an input field, and the raw-BSON parser `toKissRepoRef` already parses it — see Findings below). The nerv-side config surface, task seeding, job metadata, and chat notification (Components A/B/C) are a **separate plan, not part of this one**.

**Tech Stack:** Bun test runner (`bun:test`), strict TypeScript, no I/O in this module (pure functions only).

---

## Findings from reading the real code (2026-07-13)

**File:** `/Users/ki/Projects/yourpapai/papai/tools/import-kiss-projects-mapping.ts`

- `KissProjectRepoRef` (`:12-18`) **already has** `pipelineJobTrackList?: string[] | null` — the kiss-side input type needs no change.
- `NervProjectRepoDoc` (`:35-41`) has **no** `pipelineJobTrackList` field — this is the gap Task 1 fixes.
- The raw-BSON parser `toKissRepoRef` (`:149-165`) already extracts `pipelineJobTrackList` via `asStringArrayOrNullOrUndefined` onto `KissProjectRepoRef` — no change needed there either. The gap is purely in `mapRepo`'s kiss→nerv repo-doc mapping.
- **Exact current drop behavior**, `mapRepo` (`:82-101`):
  ```ts
  function mapRepo(
    repo: KissProjectRepoRef,
    gitlabBaseUrl: string,
    label: string,
    warnings: string[],
  ): NervProjectRepoDoc {
    if (isSetValue(repo.pipelineJobTrackList)) {
      warnings.push(
        `project "${label}" repo "${repo.projectPath}": dropping kiss field "pipelineJobTrackList" ` +
          '(nerv Project.repositories has no matching field yet)',
      )
    }
    return {
      projectPath: repo.projectPath,
      repoUrl: `${trimTrailingSlash(gitlabBaseUrl)}/${repo.projectPath}.git`,
      description: repo.description,
      ...(repo.defaultBranch === undefined ? {} : { baseBranch: repo.defaultBranch }),
      ...(repo.worktreeSubdir === undefined ? {} : { worktreeSubdir: repo.worktreeSubdir }),
    }
  }
  ```
  `isSetValue` (`:69-74`) treats `undefined`/`null`/`false`/empty-string/empty-array as "not set"; a non-empty array is "set". So today: non-empty `pipelineJobTrackList` → warning pushed, field **never** copied onto the returned doc. Empty/null/absent → no warning, field also never copied (there's nothing else to omit — it was never in the return object to begin with).
- `mapRepo` is called from `mapKissProjectToNervProject` (`:104-122`) as `mapRepo(r, opts.gitlabBaseUrl, label, warnings)` (`:110`) — `label` and `warnings` are threaded in only so `mapRepo` can push the per-repo drop warning. Once that warning is removed, both params become dead — verified live (see "Verification performed" below): oxlint's `no-unused-vars` and TS's `TS6133` both fire on `label`/`warnings` if left in place unused. The plan removes both params and updates the call site, rather than leaving them unused.
- A naive `{ pipelineJobTrackList: repo.pipelineJobTrackList as string[] }` cast (guarded by `isSetValue`) was tried and rejected by lint: `typescript(no-unsafe-type-assertion)` (`string[]` narrower than `string[] | null | undefined`) and `typescript(non-nullable-type-assertion-style)` both fired. The plan instead uses a small typed helper (`carriedPipelineJobTrackList`) that narrows via an `if`/ternary, not a cast — this passed lint clean when verified.

**File:** `/Users/ki/Projects/yourpapai/papai/tests/tools/import-kiss-projects-mapping.test.ts`

- Current test 1 to rewrite (`:96-109`), `'warns per-repo when pipelineJobTrackList is set (nerv has no matching repo field yet)'`:
  ```ts
  test('warns per-repo when pipelineJobTrackList is set (nerv has no matching repo field yet)', () => {
    const { warnings } = mapKissProjectToNervProject(
      {
        _id: 'p1',
        title: 'Demo',
        repositories: [{ projectPath: 'team/demo', description: 'd', pipelineJobTrackList: ['build', 'test'] }],
      },
      OPTS,
    )
    expect(warnings).toEqual([
      'project "Demo" repo "team/demo": dropping kiss field "pipelineJobTrackList" ' +
        '(nerv Project.repositories has no matching field yet)',
    ])
  })
  ```
- Current test 2 to keep semantically, rewritten for the new field-carrying assertion shape (`:111-123`), `'does not warn about pipelineJobTrackList when null or empty'`:
  ```ts
  test('does not warn about pipelineJobTrackList when null or empty', () => {
    const { warnings } = mapKissProjectToNervProject(
      {
        _id: 'p1',
        repositories: [
          { projectPath: 'a', description: 'd', pipelineJobTrackList: null },
          { projectPath: 'b', description: 'd', pipelineJobTrackList: [] },
        ],
      },
      OPTS,
    )
    expect(warnings).toEqual([])
  })
  ```

## Verification performed while writing this plan

Before writing this plan, the two source/test edits below were applied to the real files, run red→green, lint- and typecheck-verified, then **fully reverted** (`git checkout --`) — the papai working tree has no leftover changes from this research; only this plan file is new. `git status --short` at the end shows only the pre-existing untracked `docs/scenarios/` and this plan.

---

## Task 1: Carry `pipelineJobTrackList` through the importer instead of dropping it

**Files:**

- Modify: `/Users/ki/Projects/yourpapai/papai/tools/import-kiss-projects-mapping.ts:35-41` (`NervProjectRepoDoc`), `:82-101` (`mapRepo`), `:110` (call site in `mapKissProjectToNervProject`)
- Test: `/Users/ki/Projects/yourpapai/papai/tests/tools/import-kiss-projects-mapping.test.ts:96-123`

- [ ] **Step 1: Rewrite the two importer tests to expect carry-through (red against current drop behavior)**

Replace both tests at `tests/tools/import-kiss-projects-mapping.test.ts:96-123` (the block from `test('warns per-repo when pipelineJobTrackList is set...` through the closing `})` of `'does not warn about pipelineJobTrackList when null or empty'`) with:

```ts
test('carries pipelineJobTrackList through when set', () => {
  const { doc, warnings } = mapKissProjectToNervProject(
    {
      _id: 'p1',
      title: 'Demo',
      repositories: [{ projectPath: 'team/demo', description: 'd', pipelineJobTrackList: ['build', 'test'] }],
    },
    OPTS,
  )
  expect(doc.repositories[0]?.pipelineJobTrackList).toEqual(['build', 'test'])
  expect(warnings).toEqual([])
})

test('omits pipelineJobTrackList (no warning) when null or empty', () => {
  const { doc, warnings } = mapKissProjectToNervProject(
    {
      _id: 'p1',
      repositories: [
        { projectPath: 'a', description: 'd', pipelineJobTrackList: null },
        { projectPath: 'b', description: 'd', pipelineJobTrackList: [] },
      ],
    },
    OPTS,
  )
  expect(doc.repositories[0]?.pipelineJobTrackList).toBeUndefined()
  expect(doc.repositories[1]?.pipelineJobTrackList).toBeUndefined()
  expect(warnings).toEqual([])
})
```

No other test in the file changes — `'maps repositories, deriving repoUrl from the gitlab base URL'` (`:18-37`) and the rest are unaffected (that repo fixture never sets `pipelineJobTrackList`, so its `toEqual` on the full repo doc stays correct with the field omitted).

- [ ] **Step 2: Run the tests to verify red**

Run: `bun test tests/tools/import-kiss-projects-mapping.test.ts`

Expected: FAIL — 1 failing test, `'carries pipelineJobTrackList through when set'`, with an assertion failure like:

```
expect(received).toEqual(expected)
- ["build", "test"]
+ undefined
```

(15 pass / 1 fail — `'omits pipelineJobTrackList (no warning) when null or empty'` already passes today since the field is already absent from the returned doc, just for the wrong reason: it was never wired up at all.)

- [ ] **Step 3: Add the field to `NervProjectRepoDoc`**

In `tools/import-kiss-projects-mapping.ts`, change (`:35-41`):

```ts
export interface NervProjectRepoDoc {
  projectPath: string
  repoUrl: string
  baseBranch?: string
  worktreeSubdir?: string
  description?: string
}
```

to:

```ts
export interface NervProjectRepoDoc {
  projectPath: string
  repoUrl: string
  baseBranch?: string
  worktreeSubdir?: string
  description?: string
  pipelineJobTrackList?: string[]
}
```

- [ ] **Step 4: Carry the field in `mapRepo`, drop the warning, remove the now-dead `label`/`warnings` params**

Replace `mapRepo` (`:82-101`):

```ts
function mapRepo(
  repo: KissProjectRepoRef,
  gitlabBaseUrl: string,
  label: string,
  warnings: string[],
): NervProjectRepoDoc {
  if (isSetValue(repo.pipelineJobTrackList)) {
    warnings.push(
      `project "${label}" repo "${repo.projectPath}": dropping kiss field "pipelineJobTrackList" ` +
        '(nerv Project.repositories has no matching field yet)',
    )
  }
  return {
    projectPath: repo.projectPath,
    repoUrl: `${trimTrailingSlash(gitlabBaseUrl)}/${repo.projectPath}.git`,
    description: repo.description,
    ...(repo.defaultBranch === undefined ? {} : { baseBranch: repo.defaultBranch }),
    ...(repo.worktreeSubdir === undefined ? {} : { worktreeSubdir: repo.worktreeSubdir }),
  }
}
```

with:

```ts
/** Non-empty kiss `pipelineJobTrackList` to carry through; null/empty/absent → undefined (omit, no warning). */
function carriedPipelineJobTrackList(list: string[] | null | undefined): string[] | undefined {
  return list !== null && list !== undefined && list.length > 0 ? list : undefined
}

function mapRepo(repo: KissProjectRepoRef, gitlabBaseUrl: string): NervProjectRepoDoc {
  const pipelineJobTrackList = carriedPipelineJobTrackList(repo.pipelineJobTrackList)
  return {
    projectPath: repo.projectPath,
    repoUrl: `${trimTrailingSlash(gitlabBaseUrl)}/${repo.projectPath}.git`,
    description: repo.description,
    ...(repo.defaultBranch === undefined ? {} : { baseBranch: repo.defaultBranch }),
    ...(repo.worktreeSubdir === undefined ? {} : { worktreeSubdir: repo.worktreeSubdir }),
    ...(pipelineJobTrackList === undefined ? {} : { pipelineJobTrackList }),
  }
}
```

Do **not** use a type assertion (`as string[]`) to narrow `repo.pipelineJobTrackList` inline in the return object — this was tried during plan verification and rejected by lint (`typescript(no-unsafe-type-assertion)` and `typescript(non-nullable-type-assertion-style)`, both firing on the same line). The `carriedPipelineJobTrackList` helper's `if`/ternary narrows via control flow instead, which is lint-clean.

- [ ] **Step 5: Update the call site to match the new `mapRepo` signature**

In `mapKissProjectToNervProject` (`:104-122`), change (`:110`):

```ts
const repositories = (kiss.repositories ?? []).map((r) => mapRepo(r, opts.gitlabBaseUrl, label, warnings))
```

to:

```ts
const repositories = (kiss.repositories ?? []).map((r) => mapRepo(r, opts.gitlabBaseUrl))
```

`label` and `warnings` are still declared and used elsewhere in `mapKissProjectToNervProject` (the `DROPPED_PROJECT_FIELDS` loop at `:107-109` and the returned `{ doc, warnings }` at `:121`) — only the `mapRepo` call arguments shrink; nothing else in the function changes.

- [ ] **Step 6: Run the tests to verify green**

Run: `bun test tests/tools/import-kiss-projects-mapping.test.ts`

Expected: PASS — `16 pass, 0 fail` (same total test count as before Step 1; two tests were rewritten in place, none added or removed).

- [ ] **Step 7: Lint and typecheck**

Run: `bun run lint` and `bun run typecheck`

Expected: no findings for `tools/import-kiss-projects-mapping.ts` or `tests/tools/import-kiss-projects-mapping.test.ts` from either command. (Verified clean during plan-writing with exactly the code in Steps 3-5; the unused-param and unsafe-cast pitfalls documented in Steps 4-5 are exactly what surfaced and were fixed before finalizing this plan.)

- [ ] **Step 8: Commit**

```bash
git add tools/import-kiss-projects-mapping.ts tests/tools/import-kiss-projects-mapping.test.ts
git commit -m "$(cat <<'EOF'
fix(import-kiss-projects): carry pipelineJobTrackList through instead of dropping it

The kiss->nerv Project importer warned-and-discarded a repo's non-empty
pipelineJobTrackList because NervProjectRepoDoc had no matching field. This
silently broke nerv's CI-fix loop for every migrated repo (FU2 Component D;
nerv-side config seeding is tracked separately). Add the optional field to
NervProjectRepoDoc and carry a non-empty list through in mapRepo; null/empty
still omits the field with no warning.
EOF
)"
```

---

## Self-review

**Spec coverage.** The spec's Component D (`docs/superpowers/specs/2026-07-13-followups-fu2-pipeline-job-tracklist-parity-design.md:119-132`) has exactly three asks: (1) add `pipelineJobTrackList?: string[]` to `NervProjectRepoDoc` — Task 1 Step 3; (2) `mapRepo` carries non-empty, omits null/empty/absent with no warning — Task 1 Step 4; (3) rewrite the two existing tests (`:96-123`) accordingly — Task 1 Step 1. All three are covered by one task; no gaps. Components A/B/C (nerv) and the cross-repo contract table's rows 1-4 are explicitly out of scope for this plan per the assignment.

**Placeholder scan.** No "TBD"/"similar to"/prose-only steps; every code-bearing step shows the complete before/after code, exact file:line anchors, and exact `bun test`/`bun run lint`/`bun run typecheck` commands with expected pass counts.

**Type/signature consistency.** `NervProjectRepoDoc.pipelineJobTrackList?: string[]` (Step 3) matches the return-object literal in `mapRepo` (Step 4) and the test assertions in Step 1 (`doc.repositories[0]?.pipelineJobTrackList`). `mapRepo`'s new two-arg signature (Step 4) matches its call site (Step 5). `carriedPipelineJobTrackList`'s input type (`string[] | null | undefined`) matches `KissProjectRepoRef.pipelineJobTrackList`'s existing declared type (`string[] | undefined | null` per `:17` in the file as read) with no cast needed.

## Spec ambiguity noted (none blocking)

None found for Component D specifically — the spec's task description (`:123-129`) maps 1:1 onto the real file's structure once read. The only thing the spec doesn't call out explicitly is that `mapRepo`'s `label`/`warnings` parameters become unused once the per-repo warning is removed (the spec only says "carry... instead of warning-and-dropping"); this plan resolves that by removing the now-dead parameters rather than leaving them unused, which was confirmed necessary by actually running lint/typecheck against the change (see Findings). This is a mechanical consequence of the spec's own instruction, not a genuine ambiguity in what to build.
