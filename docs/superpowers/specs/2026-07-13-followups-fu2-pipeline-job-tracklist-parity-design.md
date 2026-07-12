<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Follow-ups · FU2: pipelineJobTrackList Parity — Restore the CI-fix Loop (design)

> **Context.** Second sub-project of the post-migration follow-ups program. Reconnects a config→task
> seeding chain that was silently dropped during the kiss→nerv migration, so nerv's CI-fix loop —
> currently dead in production — actually fires for repos that configure a CI job whitelist, and makes
> detected failures visible in chat.
>
> **Repos touched.** `nerv` (core) + `papai` (importer un-drop). **magi: no code** — magi has zero
> pipeline/CI vocabulary; it is not in this data path at all.
>
> **Ground truth.** All file:line anchors below were read directly (2026-07-13) in the nerv/papai/kiss repos.

## Premise correction (read first)

The follow-up was originally logged as a "pipelineJobTrackList nerv-schema parity gap" implying a **magi
wire mismatch**. The code shows otherwise: **magi has no pipeline/CI/job vocabulary anywhere**
(`grep -rniE "\bjob\b|\bCI\b" magi/src` → no hits; magi owns forge _writes_ for coding sessions only,
nerv's `ForgeClient` reads GitLab directly). `pipelineJobTrackList` is a **per-repo CI job-name
whitelist**, ported from the predecessor `kiss`, that gates nerv's CI-fix loop. The real defect is a
**broken config→task seeding chain plus an importer that discards the field** — not a payload mismatch.

## The defect (grounding)

The whitelist is **always `[]`** for every task, so the entire CI-fix loop is dead:

1. **No config surface.** `ProjectRepoConfig` (`nerv/src/db/models/Project.ts:10-16`) has **no
   `pipelineJobTrackList` field** — nothing in nerv can hold an operator-specified job list.
2. **Hardcoded empty seeding.** `TaskService.create()` (`nerv/src/services/TaskService.ts:40`) and
   `.createForgeEvent()` (`:66`) both hardcode `pipelineJobTrackList: []` — there is no source to seed from.
3. **Importer drops it.** `papai/tools/import-kiss-projects-mapping.ts:88-93` (`mapRepo`): when a kiss repo
   carries a non-empty `pipelineJobTrackList`, the importer **pushes a warning and omits the field** —
   `NervProjectRepoDoc` (`:35-41`) has no slot for it.
4. **Dead loop.** `forgePollSweep`'s `pollRepo` (`nerv/src/periodic/sweeps.ts:189`) calls
   `forge.getFailedPipelineJobLogs(projectPath, mrIid, repo.pipelineJobTrackList)` with an always-empty
   whitelist. Inside `GitlabForgeClient.getFailedPipelineJobLogs` (`:198-203`),
   `jobs.filter(j => jobWhitelist.includes(j.name))` against `[]` is always `[]` → returns `null` → the
   `if (failed)` branch never runs → **no `pipeline_failure` WorkItem is ever enqueued** →
   `makePipelineFailureHandler` (`nerv/src/supervisor/ciHandlers.ts`) is dead code. A real CI failure
   produces **zero observable behavior** — no fix, no notification, no crash. A silent no-op.

nerv already has the field _name_ preserved on the runtime task (`TaskRepo.pipelineJobTrackList: string[]`,
`nerv/src/db/models/Task.ts:27,81`) and a second unused copy of the vocabulary on
`nerv/src/domain/promptTypes.ts:18` (`ProjectRef`, consumed only by the zero-caller
`generateAgentsMdContent`) — the plumbing to _fill_ it from config was simply never ported.

## Decisions of record

1. **Not a magi contract fix.** The fix is nerv (seeding + notification) + papai (importer). magi untouched.
2. **Empty = track nothing (opt-in, kiss parity).** The whitelist's semantics are unchanged: an empty/unset
   list tracks no jobs (the loop stays dormant for that repo). FU2 restores the _plumbing_ so a **non-empty**
   configured list is honored end-to-end. A repo with no list is dormant-by-design (documented), not
   silently-broken. No global `DEFAULT_PIPELINE_JOB_TRACK_LIST` fallback (kiss's was never actually
   implemented — only a doc-comment).
3. **Richer job metadata + a chat notification** for detected CI failures — closes the fully-silent UX gap.
4. **Bypass the dead vocabulary.** Wire straight `ProjectRepoConfig → TaskRepo`; do not resurrect
   `promptTypes.ProjectRef` / `generateAgentsMdContent`. Leave `MRViewContext.pipelines: unknown[]` (a dead,
   never-read, always-`[]` field) out of scope.

---

## Component A — config surface + task seeding (nerv)

**Config field.** Add `pipelineJobTrackList?: string[]` to the `ProjectRepoConfig` interface + Mongoose
schema (`nerv/src/db/models/Project.ts:10-16` / schema block). Optional; no default needed at the config
layer (absence → the task gets `[]`).

**Seeding.** `TaskService.create()` and `.createForgeEvent()`
(`nerv/src/services/TaskService.ts:40,66`) seed each `taskRepositories[].pipelineJobTrackList` from the
matching `Project.repositories[]` entry (matched by `projectPath`) instead of the hardcoded `[]`. When the
Project has no matching repo entry, or the entry has no list, seed `[]` (dormant — the decided opt-in
behavior). The existing `TaskRepo.pipelineJobTrackList: string[]` (non-optional, default `[]`) is unchanged.

**Net effect:** a Project whose repo config lists job names produces tasks whose whitelist is actually
populated → `getFailedPipelineJobLogs` can match → the CI-fix loop fires.

## Component B — richer job metadata (nerv)

**Widen `FailedPipelineJob`** (`nerv/src/domain/forge.ts:98-102`) from `{ id, name, log }` to add:
`stage`, `status`, `webUrl`, `duration`, `failureReason` — sourced from GitLab's `JobSchema`
(`@gitbeaker/core`: `stage, status, web_url, duration, failure_reason`). All added fields are typed to match
GitLab's shape (string/number, `failureReason`/`duration` nullable as GitLab reports them).

**Populate** them in `GitlabForgeClient.getFailedPipelineJobLogs`'s job mapping
(`nerv/src/services/GitlabForgeClient.ts:205-214`), mapping GitLab snake_case → nerv camelCase.

**Thread into the fix prompt.** Where `makePipelineFailureHandler` builds the magi follow-up prompt from the
failed job, include the richer fields (stage/status/failureReason/webUrl) so the coding agent gets better
failure context. This is a prompt-content enrichment, not a contract change.

## Component C — CI-failure chat notification (nerv)

Today `makePipelineFailureHandler` (`nerv/src/supervisor/ciHandlers.ts`) only calls `magi.followUp(...)` —
it **never notifies papai**, and `TaskStatus.ci_wait` is contract-only (never set anywhere). So a CI failure
is invisible to the user.

**Wire `PapaiTaskNotifier`** (`nerv/src/services/PapaiTaskNotifier.ts`) into the handler. On a detected
failure with a dispatched fix, post a markdown message to the task's chat context
(`task.contextRef.contextId`) via papai's **existing** `/notify` route — no papai schema change. Message
shape:

```
⚠️ **CI failed:** `<jobName>` (stage: `<stage>`)
status: <status> · [view pipeline](<webUrl>)
→ attempting a fix…
```

**Best-effort.** The notification is wrapped so a notify failure is logged (`warn`) but **never blocks or
fails the fix dispatch** — the fix is the load-bearing action; the message is advisory. `PapaiTaskNotifier`
gains a dedicated method for this non-status-line message (the existing notifier renders only generic
`TaskStatus` lines, which cannot carry job detail). Never log the job log body or any token in this path.

## Component D — importer un-drop (papai)

`papai/tools/import-kiss-projects-mapping.ts`:

- Add `pipelineJobTrackList?: string[]` to `NervProjectRepoDoc` (`:35-41`).
- In `mapRepo` (`:88-93`), **carry** a non-empty `pipelineJobTrackList` into the produced repo doc instead
  of warning-and-dropping. Empty/null/absent → omit the field (no warning needed — nothing to carry).
- Update the two importer tests
  (`papai/tests/tools/import-kiss-projects-mapping.test.ts:96-123`): the "warns per-repo when
  pipelineJobTrackList is set" test becomes "carries pipelineJobTrackList through"; the null/empty test
  keeps asserting no field / no warning.

This reconciles the P3-rollout spec's stated-but-unshipped claim that the importer "carried
`pipelineJobTrackList` onto the nerv repo config" (`docs/superpowers/specs/2026-07-12-migration-p3-rollout-design.md:82`).

---

## Cross-repo contract summary

| #   | Interface                                | Producer → Consumer | Change                                                                       |
| --- | ---------------------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| 1   | `ProjectRepoConfig.pipelineJobTrackList` | nerv (internal)     | new optional schema field                                                    |
| 2   | task seeding                             | nerv (internal)     | seed `taskRepositories[].pipelineJobTrackList` from Project config, not `[]` |
| 3   | `FailedPipelineJob`                      | GitLab → nerv       | widened: + `stage`, `status`, `webUrl`, `duration`, `failureReason`          |
| 4   | CI-failure notification                  | nerv → papai        | new markdown post via the **existing** `/notify` route (no schema change)    |
| 5   | importer repo doc                        | papai (kiss→nerv)   | carry `pipelineJobTrackList` through instead of drop-with-warning            |

---

## Testing strategy

**The regression guard (the test that should have caught this).** `forgePollSweep`'s existing test
(`nerv/tests/periodic/forgePollSweep.test.ts:210-233`) uses a fake `getFailedPipelineJobLogs` that ignores
its whitelist argument, so it passes regardless of the seeding bug. Add a test exercising the **real seeding
path**: a Project whose repo config carries a non-empty `pipelineJobTrackList` → `TaskService.create` → the
non-empty whitelist actually reaches the forge call (assert the argument passed to
`getFailedPipelineJobLogs`, not just the enqueue result).

**nerv:**

- **Seeding:** `TaskService.create` and `.createForgeEvent` populate `taskRepositories[].pipelineJobTrackList`
  from the matching Project repo config; a Project/repo with no list → `[]` (dormant).
- **Metadata:** `getFailedPipelineJobLogs` maps GitLab `stage/status/web_url/duration/failure_reason` onto
  the widened `FailedPipelineJob`; existing whitelist-filter tests still pass with the wider shape.
- **Notification:** `makePipelineFailureHandler` posts the CI-failure markdown (with job name/stage/status/
  webUrl) to the task's context; a notify failure is swallowed (logged) and the `magi.followUp` dispatch
  still happens (best-effort assertion).
- **Prompt enrichment:** the follow-up prompt includes the richer job fields.

**papai:**

- Importer carries a non-empty `pipelineJobTrackList` into `NervProjectRepoDoc`; null/empty omits it with no
  warning. (Rewrite of the two existing importer tests.)

## Out of scope / deferred

- **`MRViewContext.pipelines: unknown[]`** typing/population (dead field: always `[]`, never read).
- A **global `DEFAULT_PIPELINE_JOB_TRACK_LIST`** fallback (opt-in was chosen; kiss's default was never built).
- Resurrecting **`generateAgentsMdContent`** / `promptTypes.ProjectRef` (bypassed; fix goes straight
  config → task).
- Full **`ci_wait` status** wiring (the notification carries the user-facing signal; a status-line rework is
  a separate concern).
- Any **magi** change.

## Open assumptions (resolve during planning)

- **How `TaskService` obtains the Project config** to seed from — whether the Project (with `repositories[]`)
  is already available to `create`/`createForgeEvent`, or requires a `ProjectService.getByForgeProject`
  lookup. Confirm the existing call sites and thread the minimal dependency.
- **The exact `PapaiTaskNotifier` method surface** for a non-status-line message — whether to add a generic
  `notifyMarkdown(contextRef, markdown)` or a purpose-named `notifyCiFailure(contextRef, job)` that builds
  the markdown internally. Confirm how the notifier currently resolves the target context + posts.
- **GitLab field nullability** for `duration`/`failure_reason` on a failed `JobSchema` — confirm the
  `@gitbeaker/core` types so the widened `FailedPipelineJob` fields carry the correct optional/nullable shape.
