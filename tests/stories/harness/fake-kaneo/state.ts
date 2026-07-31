// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * A stateful in-memory fake Kaneo REST API. It models exactly the request
 * shapes the Kaneo provider builds (plugins/task-provider-kaneo) and the
 * response shapes its Zod schemas parse. It is NOT a fidelity model of a real
 * Kaneo — both this fake and the parity expectations are authored here, so this
 * lane proves request-building + response-mapping + contract conformance,
 * never drift against a live Kaneo.
 *
 * Covers the full parity surface: project/column/task/search core routes plus
 * comment, label, task-relation, workspace-member, and Better Auth routes that
 * the Kaneo client and member-provisioning flow invoke.
 */

// ---------- Stored entities ----------

export type StoredProject = {
  id: string
  workspaceId: string
  name: string
  slug: string
  icon: string | undefined
  description: string | undefined
  isPublic: boolean
  createdAt: string
}

export type StoredColumn = {
  id: string
  projectId: string
  name: string
  slug: string
  icon: string | undefined
  color: string | undefined
  isFinal: boolean
  position: number
}

export type StoredTask = {
  id: string
  projectId: string
  position: number
  number: number
  userId: string | null
  title: string
  description: string
  status: string
  priority: string
  startDate: string | undefined
  dueDate: string | undefined
  createdAt: string
}

export type StoredComment = {
  id: string
  taskId: string
  userId: string
  content: string
  createdAt: string
  updatedAt: string
}

export type StoredLabel = {
  id: string
  workspaceId: string
  name: string
  color: string
  createdAt: string
  taskId: string | null
}

export type StoredRelation = {
  id: string
  sourceTaskId: string
  targetTaskId: string
  relationType: string
  createdAt: string
}

export type StoredUser = {
  id: string
  name: string
  email: string
}

export type StoredInvitation = {
  id: string
  email: string
  organizationId: string
  role: string
  userId: string | undefined
}

export type StoredMember = {
  id: string
  organizationId: string
  name: string
  email: string
  role: string
}

export type FakeKaneoState = {
  projects: Map<string, StoredProject>
  columns: Map<string, StoredColumn>
  tasks: Map<string, StoredTask>
  comments: Map<string, StoredComment>
  labels: Map<string, StoredLabel>
  relations: Map<string, StoredRelation>
  members: Map<string, StoredMember>
  users: Map<string, StoredUser>
  userIndex: Map<string, string>
  invitations: Map<string, StoredInvitation>
  seq: number
}

export type FakeKaneoCtx = Readonly<{
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  state: FakeKaneoState
}>

// ---------- State + id helpers ----------

export const createFakeKaneoState = (): FakeKaneoState => ({
  projects: new Map(),
  columns: new Map(),
  tasks: new Map(),
  comments: new Map(),
  labels: new Map(),
  relations: new Map(),
  members: new Map(),
  users: new Map(),
  userIndex: new Map(),
  invitations: new Map(),
  seq: 0,
})

export const resetFakeKaneoState = (state: FakeKaneoState): void => {
  state.projects.clear()
  state.columns.clear()
  state.tasks.clear()
  state.comments.clear()
  state.labels.clear()
  state.relations.clear()
  state.members.clear()
  state.users.clear()
  state.userIndex.clear()
  state.invitations.clear()
  state.seq = 0
}

export const nextId = (state: FakeKaneoState, prefix: string): string => {
  state.seq += 1
  return `${prefix}-${state.seq}`
}

const BASE_EPOCH_MS = Date.parse('2026-01-01T00:00:00.000Z')

export const nextTimestamp = (state: FakeKaneoState): string => {
  state.seq += 1
  return new Date(BASE_EPOCH_MS + state.seq).toISOString()
}

// ---------- Domain helpers ----------

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')

/** Every new project gets a default `To Do` column so the provider's
 *  validateStatus() resolves the `to-do` slug without an extra round trip. */
export const DEFAULT_COLUMN_NAME = 'To Do'

/** Kaneo derives a comment's author from the session; the fake has no auth on
 *  comment routes, so every comment is attributed to this fixed author id. */
export const COMMENT_AUTHOR_USER_ID = 'user-1'
