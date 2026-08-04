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
  name: string
  shortName: string
  description: string | undefined
  archived: boolean
}

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
    seq: 0,
  }
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
  return state
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
  state.seq = 0
}

export const nextId = (state: FakeYouTrackState, prefix: string): string => {
  state.seq += 1
  return `${prefix}-${state.seq}`
}

export const nextTs = (state: FakeYouTrackState): number => {
  state.seq += 1
  return 1_700_000_000_000 + state.seq
}
