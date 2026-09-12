// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * A stateful in-memory fake YouTrack REST server. It models exactly the request
 * shapes YouTrackProvider builds and the `fields=` projection shapes its mappers
 * parse (plugins/task-provider-youtrack/mappers.ts). It is NOT a fidelity model
 * of a real YouTrack — both this fake and the parity expectations are authored
 * here, so this lane proves request-building + response-mapping + contract
 * conformance, never drift against a live YouTrack.
 */

// ---------- Stored entities ----------

export type StoredProject = {
  id: string
  /** The Hub id the team endpoints are keyed by; YouTrack exposes it as `ringId`. */
  ringId: string
  name: string
  shortName: string
  description: string | undefined
  archived: boolean
}

export type StoredVisibility =
  | { kind: 'unlimited' }
  | { kind: 'limited'; userIds: readonly string[]; groupIds: readonly string[] }

export type StoredIssue = {
  id: string
  idReadable: string
  numberInProject: number
  summary: string
  description: string | undefined
  projectDbId: string
  created: number
  updated: number
  state: string | undefined
  priority: string | undefined
  dueDateMs: number | undefined
  assigneeLogin: string | undefined
  watcherIds: string[]
  voted: boolean
  visibility: StoredVisibility
}

export type StoredAttachment = {
  id: string
  issueId: string
  name: string
  mimeType: string
  size: number
  created: number
}

export type StoredWorkItem = {
  id: string
  issueId: string
  minutes: number
  dateMs: number
  text: string | undefined
  typeId: string | undefined
}

export type StoredUser = {
  id: string
  ringId: string
  login: string
  fullName: string
  email: string
}

export type StoredSavedQuery = {
  id: string
  name: string
  /** `null` models a saved query that carries no search string. */
  query: string | null
}

export type StoredComment = {
  id: string
  issueId: string
  text: string
  created: number
  updated: number | undefined
}

export type StoredLink = {
  id: string
  ownerIssueId: string
  targetIssueId: string
  typeName: string
  direction: string
}

export type StoredStateValue = {
  id: string
  name: string
  ordinal: number
  isResolved: boolean
}

export type StoredAgile = {
  id: string
  name: string
}

export type StoredSprint = {
  id: string
  agileId: string
  name: string
  goal: string | undefined
  start: number | undefined
  finish: number | undefined
  archived: boolean
  isDefault: boolean
  issueIds: readonly string[]
}

export type FakeYouTrackState = {
  projects: Map<string, StoredProject>
  issues: Map<string, StoredIssue>
  issuesByReadable: Map<string, string>
  comments: Map<string, StoredComment>
  links: Map<string, StoredLink>
  stateValues: Map<string, StoredStateValue[]>
  agiles: Map<string, StoredAgile>
  sprints: Map<string, StoredSprint>
  attachments: Map<string, StoredAttachment>
  workItems: Map<string, StoredWorkItem>
  savedQueries: Map<string, StoredSavedQuery>
  users: Map<string, StoredUser>
  /** The Hub team roster, keyed by project ringId, holding user ringIds. */
  teams: Map<string, string[]>
  /** Per-query count of `-1` answers already served; see `router-queries.ts`. */
  countFlakes: Map<string, number>
  seq: number
}

export type FakeYouTrackCtx = {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  state: FakeYouTrackState
}

// ---------- Bundle seeds (values the provider resolves status/priority against) ----------

export const STATE_BUNDLE_ID = 'state-bundle-1'
export const PRIORITY_BUNDLE_ID = 'enum-bundle-1'
export const SAVED_QUERY_ALL_ID = 'saved-query-all'
export const SAVED_QUERY_EMPTY_ID = 'saved-query-empty'
export const WORK_ITEM_TYPES: readonly { id: string; name: string }[] = [
  { id: 'wit-development', name: 'Development' },
  { id: 'wit-testing', name: 'Testing' },
]
/** `me` is the authenticated user every fake request acts as. */
export const DIRECTORY_LOGINS: readonly string[] = ['me', 'bob', 'carol']
export const STATE_VALUES: readonly string[] = ['Open', 'In Progress', 'Done']
export const PRIORITY_VALUES: readonly string[] = ['high', 'normal', 'low']

// ---------- State + id helpers ----------

export const createFakeYouTrackState = (): FakeYouTrackState => {
  const state: FakeYouTrackState = {
    projects: new Map(),
    issues: new Map(),
    issuesByReadable: new Map(),
    comments: new Map(),
    links: new Map(),
    stateValues: new Map(),
    agiles: new Map(),
    sprints: new Map(),
    attachments: new Map(),
    workItems: new Map(),
    savedQueries: new Map(),
    users: new Map(),
    teams: new Map(),
    countFlakes: new Map(),
    seq: 0,
  }
  seedFakeYouTrackDefaults(state)
  return state
}

/**
 * Seeds the baseline every fake instance starts from: the shared state bundle
 * and the default agile board. `resetFakeYouTrackState` reapplies it so a reset
 * instance is indistinguishable from a freshly created one.
 */
const seedFakeYouTrackDefaults = (state: FakeYouTrackState): void => {
  state.stateValues.set(
    STATE_BUNDLE_ID,
    STATE_VALUES.map((name, index) => ({
      id: nextId(state, 'state-val'),
      name,
      ordinal: index,
      isResolved: name === 'Done',
    })),
  )
  const boardId = nextId(state, 'agile')
  state.agiles.set(boardId, { id: boardId, name: 'Main Board' })
  // Two saved queries: one that searches, and one that carries no search string
  // at all -- YouTrack allows both, and the provider rejects the second.
  state.savedQueries.set(SAVED_QUERY_ALL_ID, { id: SAVED_QUERY_ALL_ID, name: 'Everything', query: '' })
  state.savedQueries.set(SAVED_QUERY_EMPTY_ID, { id: SAVED_QUERY_EMPTY_ID, name: 'Unset', query: null })
  for (const login of DIRECTORY_LOGINS) {
    state.users.set(login, {
      id: login,
      ringId: `ring-${login}`,
      login,
      fullName: `Fake ${login}`,
      email: `${login}@youtrack.invalid`,
    })
  }
}

export const resetFakeYouTrackState = (state: FakeYouTrackState): void => {
  state.projects.clear()
  state.issues.clear()
  state.issuesByReadable.clear()
  state.comments.clear()
  state.links.clear()
  state.stateValues.clear()
  state.agiles.clear()
  state.sprints.clear()
  state.attachments.clear()
  state.workItems.clear()
  state.savedQueries.clear()
  state.users.clear()
  state.teams.clear()
  state.countFlakes.clear()
  state.seq = 0
  seedFakeYouTrackDefaults(state)
}

export const nextId = (state: FakeYouTrackState, prefix: string): string => {
  state.seq += 1
  return `${prefix}-${state.seq}`
}

export const nextTs = (state: FakeYouTrackState): number => {
  state.seq += 1
  return 1_700_000_000_000 + state.seq
}
