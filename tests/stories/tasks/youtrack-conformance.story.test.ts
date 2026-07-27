// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { PARITY_GROUPS, type ParityGroup } from '../harness/parity/expectations.js'
import { required } from '../harness/parity/group.js'
import { youtrackCustomFieldGroups } from '../harness/parity/youtrack-custom-field-groups.js'
import { YOUTRACK_PARITY_EXCLUSIONS } from '../harness/parity/youtrack-parity-exclusions.js'
import { scenario, type ScenarioApi } from '../harness/scenario.js'

// Runs the shared PARITY_GROUPS contract directly through the real YouTrack
// plugin resolved by `resolveRealTaskProvider`, grouped into six domain
// scenarios. This proves provider conformance and provider resolution inside
// the hermetic story lane — it does NOT exercise the chat tool loop (see
// youtrack-real.story.test.ts for that).
//
// The domain partition below mirrors the module a group is authored in
// (tests/stories/harness/parity/expectations/*.ts), not a prefix of the
// group's id: several ids don't carry their module's name (e.g.
// 'SCN-parity-task-search' is a search.ts group, 'SCN-parity-task-label' and
// 'SCN-parity-identity' are projects.ts groups, and every errors.ts group
// carries the prefix of the domain it errors on rather than 'error'). The
// custom-field groups (task-shaped: createTask/getTask/updateTask) join the
// tasks domain as the closest fit.
const excluded = new Set(YOUTRACK_PARITY_EXCLUSIONS.map((entry) => entry.group))
const included: readonly ParityGroup[] = [
  ...PARITY_GROUPS.filter((group) => !excluded.has(group.id)),
  ...youtrackCustomFieldGroups,
]

type Domain = Readonly<{ id: string; title: string; groupIds: readonly string[] }>

const DOMAIN_TASKS: Domain = {
  id: 'tasks',
  title: 'task groups',
  groupIds: [
    'SCN-parity-task-create',
    'SCN-parity-task-get',
    'SCN-parity-task-update',
    'SCN-parity-task-delete',
    'SCN-parity-task-list-sort',
    'SCN-parity-task-list-paging',
    'SCN-parity-task-dates',
    'SCN-parity-task-full-property',
    'SCN-parity-task-preserve-startdate',
    'SCN-parity-task-null-dates',
    'SCN-parity-task-special-chars',
    'SCN-parity-task-long-title',
    'SCN-youtrack-custom-field-status',
    'SCN-youtrack-custom-field-priority',
  ],
}

const DOMAIN_SEARCH: Domain = {
  id: 'search',
  title: 'search groups',
  groupIds: [
    'SCN-parity-task-search',
    'SCN-parity-search-all-projects',
    'SCN-parity-search-empty',
    'SCN-parity-search-projectid-limit',
  ],
}

const DOMAIN_COMMENTS: Domain = {
  id: 'comments',
  title: 'comment groups',
  groupIds: [
    'SCN-parity-comment-crud',
    'SCN-parity-comment-id-stability',
    'SCN-parity-comment-long',
    'SCN-parity-comment-special-chars',
  ],
}

const DOMAIN_RELATIONS: Domain = {
  id: 'relations',
  title: 'relation groups',
  groupIds: ['SCN-parity-relation', 'SCN-parity-relation-multiple'],
}

const DOMAIN_PROJECTS: Domain = {
  id: 'projects',
  title: 'project groups',
  groupIds: ['SCN-parity-project-crud', 'SCN-parity-task-label', 'SCN-parity-identity'],
}

const DOMAIN_ERRORS: Domain = {
  id: 'errors',
  title: 'error groups',
  groupIds: [
    'SCN-parity-task-errors',
    'SCN-parity-comment-errors',
    'SCN-parity-relation-errors',
    'SCN-parity-project-label-errors',
  ],
}

const DOMAINS: readonly Domain[] = [
  DOMAIN_TASKS,
  DOMAIN_SEARCH,
  DOMAIN_COMMENTS,
  DOMAIN_RELATIONS,
  DOMAIN_PROJECTS,
  DOMAIN_ERRORS,
]

const groupsFor = (domain: Domain): readonly ParityGroup[] =>
  included.filter((group) => domain.groupIds.includes(group.id))

const partitioned = DOMAINS.flatMap((domain) => groupsFor(domain).map((group) => group.id))
if (new Set(partitioned).size !== partitioned.length) {
  throw new Error(`YouTrack conformance domains overlap: ${partitioned.join(', ')}`)
}
const unpartitioned = included.filter((group) => !partitioned.includes(group.id)).map((group) => group.id)
if (unpartitioned.length > 0) {
  throw new Error(`YouTrack conformance domains omit groups: ${unpartitioned.join(', ')}`)
}

async function runDomainScenario(
  { given, world, resolveRealTaskProvider }: ScenarioApi,
  domain: Domain,
): Promise<void> {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance(undefined, 'youtrack')
  given.assign(dm, instance)

  // No chat turn runs in this scenario (the provider is exercised directly
  // through the resolver), so the runtime/plugin activation that a chat turn
  // would otherwise trigger via `when.message` must be requested explicitly —
  // real task provider types register only once plugins activate.
  await world.ensureStarted()

  const provider = await resolveRealTaskProvider(dm)
  const groups = groupsFor(domain)
  if (groups.length === 0) {
    // Every projects.ts group (project-crud, task-label, identity) is a
    // YOUTRACK_PARITY_EXCLUSIONS entry for this binding, so the 'projects'
    // domain has no shared parity group left to run. Still exercise a live
    // createProject round trip so this scenario proves resolution rather
    // than being a vacuous no-op — and so the declared fake-YouTrack host
    // actually receives a request (the hermetic io-guard fails a declared,
    // unused host).
    const project = required(
      await provider.createProject?.({ name: `Conformance ${domain.id} (no applicable groups)` }),
      'provider.createProject result',
    )
    expect(project.name).toBe(`Conformance ${domain.id} (no applicable groups)`)
    return
  }
  for (const group of groups) {
    const project = required(
      await provider.createProject?.({ name: `Conformance ${group.id}` }),
      'provider.createProject result',
    )
    await group.run({ provider, projectId: project.id })
  }
}

// Each group gets its own project because the parity groups assume a clean
// project; state is shared across groups within one scenario, which is why
// per-group projects matter. Six literal scenario names below (not a loop
// over DOMAINS with a template literal) because the manifest/catalog AST
// extractor (scripts/story/scenarios.ts extractStoryScenarios) requires the
// scenario name to be a TypeScript string literal — a template literal fails
// `ts.isStringLiteral` and throws at manifest build time.

scenario(
  'SCN-youtrack-conformance-tasks: real YouTrack provider satisfies the shared task groups',
  (api) => runDomainScenario(api, DOMAIN_TASKS),
  { realTaskProvider: 'youtrack' },
)

scenario(
  'SCN-youtrack-conformance-search: real YouTrack provider satisfies the shared search groups',
  (api) => runDomainScenario(api, DOMAIN_SEARCH),
  { realTaskProvider: 'youtrack' },
)

scenario(
  'SCN-youtrack-conformance-comments: real YouTrack provider satisfies the shared comment groups',
  (api) => runDomainScenario(api, DOMAIN_COMMENTS),
  { realTaskProvider: 'youtrack' },
)

scenario(
  'SCN-youtrack-conformance-relations: real YouTrack provider satisfies the shared relation groups',
  (api) => runDomainScenario(api, DOMAIN_RELATIONS),
  { realTaskProvider: 'youtrack' },
)

// All three shared project groups (SCN-parity-project-crud, SCN-parity-task-label,
// SCN-parity-identity) are YOUTRACK_PARITY_EXCLUSIONS entries for this binding, so
// this scenario never runs a shared ParityGroup — it only proves that the real
// provider resolves and round-trips a `createProject` call. Do not rename this back
// to claiming shared project-group conformance.
scenario(
  'SCN-youtrack-conformance-projects: real YouTrack provider resolves and round-trips createProject (shared project groups are excluded for this binding)',
  (api) => runDomainScenario(api, DOMAIN_PROJECTS),
  { realTaskProvider: 'youtrack' },
)

scenario(
  'SCN-youtrack-conformance-errors: real YouTrack provider satisfies the shared error groups',
  (api) => runDomainScenario(api, DOMAIN_ERRORS),
  { realTaskProvider: 'youtrack' },
)
