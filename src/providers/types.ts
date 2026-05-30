// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AppError } from '../errors.js'
import type {
  Activity,
  Agile,
  Attachment,
  Column,
  Comment,
  CommentReaction,
  CreateWorkItemParams,
  Label,
  ListTasksParams,
  Project,
  ProviderConfigRequirement,
  RelationType,
  SavedQuery,
  SetTaskVisibilityParams,
  Sprint,
  Task,
  TaskLabel,
  TaskCommandResult,
  TaskListItem,
  TaskSearchResult,
  TaskVisibility,
  UpdateWorkItemParams,
  UserRef,
  WorkItem,
} from './domain-types.js'
import type { TaskCapability, TaskProviderTrait } from './task-capability.js'

export type {
  Activity,
  Agile,
  Attachment,
  Column,
  Comment,
  CommentReaction,
  CreateWorkItemParams,
  Label,
  ListTasksParams,
  Project,
  ProviderConfigField,
  ProviderConfigRequirement,
  RelationType,
  SavedQuery,
  Sprint,
  SetTaskVisibilityParams,
  Task,
  TaskCommandResult,
  TaskCustomField,
  TaskLabel,
  TaskListItem,
  TaskRelation,
  TaskSearchResult,
  TaskVisibility,
  UpdateWorkItemParams,
  UserRef,
  VisibilityGroupRef,
  WorkItem,
} from './domain-types.js'

export type { TaskCapability, TaskProviderTrait } from './task-capability.js'

export type ToolDueDateInput = Readonly<{ date: string; time?: string }>

/** User search result for identity resolution. */
export type IdentityUser = { id: string; login: string; name?: string }

/** Identity resolver interface for linking chat users to task tracker users. */
export interface UserIdentityResolver {
  /** Search users by query string, returns matching users. */
  searchUsers(query: string, limit?: number): Promise<IdentityUser[]>
}

/** Core task tracker interface: required task CRUD plus optional capability-gated methods. */
export interface TaskProvider {
  /** Provider identifier, e.g. "kaneo", "linear", "jira". */
  readonly name: string
  readonly supportsCustomFields?: boolean
  /** Capabilities this provider supports beyond core task CRUD. */
  readonly capabilities: ReadonlySet<TaskCapability>
  /** Behavioral traits this provider supports beyond generic capabilities. */
  readonly traits: ReadonlySet<TaskProviderTrait>
  /** Config keys this provider needs (shown and validated in /config). */
  readonly configRequirements: readonly ProviderConfigRequirement[]
  /** Which user identifier this provider prefers for assignee/watcher operations. */
  readonly preferredUserIdentifier: 'id' | 'login'

  // --- Core task operations (required) ---
  /** Optional identity resolver for user matching (auto-link). */
  readonly identityResolver?: UserIdentityResolver

  createTask(params: {
    projectId: string
    title: string
    description?: string
    priority?: string
    status?: string
    startDate?: string
    dueDate?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  }): Promise<Task>

  getTask(taskId: string): Promise<Task>

  updateTask(
    taskId: string,
    params: {
      title?: string
      description?: string
      status?: string
      priority?: string
      startDate?: string
      dueDate?: string
      projectId?: string
      assignee?: string
      customFields?: Array<{ name: string; value: string }>
    },
  ): Promise<Task>

  listTasks(projectId: string, params?: ListTasksParams): Promise<TaskListItem[]>

  searchTasks(params: {
    query: string
    projectId?: string
    assigneeId?: string
    limit?: number
    offset?: number
  }): Promise<TaskSearchResult[]>

  deleteTask?(taskId: string): Promise<{ id: string }>
  // --- Optional: shared user lookup helpers ---
  listUsers?(query?: string, limit?: number): Promise<UserRef[]>
  getCurrentUser?(): Promise<UserRef>
  // --- Optional: projects.* ---
  getProject?(projectId: string): Promise<Project>
  listProjects?(): Promise<Project[]>
  createProject?(params: { name: string; description?: string }): Promise<Project>
  updateProject?(projectId: string, params: { name?: string; description?: string }): Promise<Project>
  deleteProject?(projectId: string): Promise<{ id: string }>
  // --- Optional: projects.team ---
  listProjectTeam?(projectId: string): Promise<UserRef[]>
  addProjectMember?(projectId: string, userId: string): Promise<{ projectId: string; userId: string }>
  removeProjectMember?(projectId: string, userId: string): Promise<{ projectId: string; userId: string }>
  // --- Optional: comments.* ---
  getComment?(taskId: string, commentId: string): Promise<Comment>
  addComment?(taskId: string, body: string): Promise<Comment>
  getComments?(taskId: string, params?: { limit?: number; offset?: number }): Promise<Comment[]>
  updateComment?(params: { taskId: string; commentId: string; body: string }): Promise<Comment>
  removeComment?(params: { taskId: string; commentId: string }): Promise<{ id: string }>
  // --- Optional: comments.reactions ---
  addCommentReaction?(taskId: string, commentId: string, reaction: string): Promise<CommentReaction>

  removeCommentReaction?(
    taskId: string,
    commentId: string,
    reactionId: string,
  ): Promise<{ id: string; taskId: string; commentId: string }>

  listLabels?(): Promise<Label[]>
  listTaskLabels?(taskId: string): Promise<TaskLabel[]>
  getLabelByName?(labelName: string): Promise<Label[]>
  createLabel?(params: { name: string; color?: string }): Promise<Label>
  updateLabel?(labelId: string, params: { name?: string; color?: string }): Promise<Label>
  removeLabel?(labelId: string): Promise<{ id: string }>
  addTaskLabel?(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }>
  removeTaskLabel?(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }>
  // --- Optional: tasks.relations ---
  addRelation?(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }>

  updateRelation?(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }>

  removeRelation?(taskId: string, relatedTaskId: string): Promise<{ taskId: string; relatedTaskId: string }>

  listWatchers?(taskId: string): Promise<UserRef[]>
  addWatcher?(taskId: string, userId: string): Promise<{ taskId: string; userId: string }>
  removeWatcher?(taskId: string, userId: string): Promise<{ taskId: string; userId: string }>
  addVote?(taskId: string): Promise<{ taskId: string }>
  removeVote?(taskId: string): Promise<{ taskId: string }>

  setVisibility?(
    taskId: string,
    params: SetTaskVisibilityParams,
  ): Promise<{ taskId: string; visibility: TaskVisibility }>
  applyCommand?(params: {
    query: string
    taskIds: string[]
    comment?: string
    silent?: boolean
  }): Promise<TaskCommandResult>

  // --- Optional: statuses.* ---
  listStatuses?(projectId: string): Promise<Column[]>
  createStatus?(
    projectId: string,
    params: { name: string; icon?: string; color?: string; isFinal?: boolean },
    confirm?: boolean,
  ): Promise<Column | { status: 'confirmation_required'; message: string }>
  updateStatus?(
    projectId: string,
    statusId: string,
    params: { name?: string; icon?: string; color?: string; isFinal?: boolean },
    confirm?: boolean,
  ): Promise<Column | { status: 'confirmation_required'; message: string }>
  deleteStatus?(
    projectId: string,
    statusId: string,
    confirm?: boolean,
  ): Promise<{ id: string } | { status: 'confirmation_required'; message: string }>
  reorderStatuses?(
    projectId: string,
    statuses: { id: string; position: number }[],
    confirm?: boolean,
  ): Promise<undefined | { status: 'confirmation_required'; message: string }>

  // --- Optional: attachments.* ---
  listAttachments?(taskId: string): Promise<Attachment[]>
  uploadAttachment?(
    taskId: string,
    file: { name: string; content: Uint8Array | Blob; mimeType?: string },
  ): Promise<Attachment>
  deleteAttachment?(taskId: string, attachmentId: string): Promise<{ id: string }>

  // --- Optional: workItems.* ---
  listWorkItems?(taskId: string, params?: { limit?: number; offset?: number }): Promise<WorkItem[]>
  createWorkItem?(taskId: string, params: CreateWorkItemParams): Promise<WorkItem>
  updateWorkItem?(taskId: string, workItemId: string, params: UpdateWorkItemParams): Promise<WorkItem>
  deleteWorkItem?(taskId: string, workItemId: string): Promise<{ id: string }>

  // --- Optional: agiles, sprints, history, saved queries ---
  listAgiles?(): Promise<Agile[]>
  listSprints?(agileId: string): Promise<Sprint[]>
  createSprint?(
    agileId: string,
    params: {
      name: string
      goal?: string
      start?: string
      finish?: string
      previousSprintId?: string
      isDefault?: boolean
    },
  ): Promise<Sprint>
  updateSprint?(
    agileId: string,
    sprintId: string,
    params: {
      name?: string
      goal?: string | null
      start?: string | null
      finish?: string | null
      previousSprintId?: string | null
      isDefault?: boolean
      archived?: boolean
    },
  ): Promise<Sprint>
  assignTaskToSprint?(taskId: string, sprintId: string): Promise<{ taskId: string; sprintId: string }>
  getTaskHistory?(
    taskId: string,
    params?: {
      categories?: string[]
      limit?: number
      offset?: number
      reverse?: boolean
      start?: string
      end?: string
      author?: string
    },
  ): Promise<Activity[]>
  listSavedQueries?(): Promise<SavedQuery[]>
  runSavedQuery?(queryId: string): Promise<TaskSearchResult[]>
  countTasks?(params: { query: string; projectId?: string }): Promise<number>

  buildTaskUrl(taskId: string, projectId?: string): string
  buildProjectUrl(projectId: string): string
  classifyError(error: unknown): AppError
  /** Provider-specific instructions to append to the LLM system prompt. */
  getPromptAddendum(): string
  /** Normalize due date input from tool format to provider-specific format. */
  normalizeDueDateInput(dueDate: ToolDueDateInput | undefined, timezone: string): string | undefined
  /** Format due date output from provider format to tool/display format. */
  formatDueDateOutput(dueDate: string | null | undefined, timezone: string): string | null | undefined
  /** Normalize list task params (e.g., due date filters) for provider-specific handling. */
  normalizeListTaskParams(params: Readonly<ListTasksParams>): ListTasksParams
}
