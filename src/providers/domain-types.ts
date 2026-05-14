export type Attachment = {
  id: string
  name: string
  mimeType?: string
  size?: number
  url: string
  thumbnailUrl?: string
  author?: string
  createdAt?: string
}

export type UserRef = {
  id: string
  login?: string
  name?: string
}

export type VisibilityGroupRef = {
  id?: string
  name: string
}

export type TaskVisibility =
  | {
      kind: 'public'
    }
  | {
      kind: 'restricted'
      users?: UserRef[]
      groups?: VisibilityGroupRef[]
    }

export type SetTaskVisibilityParams =
  | {
      kind: 'public'
    }
  | {
      kind: 'restricted'
      userIds: [string, ...string[]]
      groupIds?: string[]
    }
  | {
      kind: 'restricted'
      userIds?: string[]
      groupIds: [string, ...string[]]
    }

export type CommentReaction = {
  id: string
  reaction: string
  author?: UserRef
  createdAt?: string
}

export type TaskCustomField = {
  name: string
  value: string | number | boolean | string[] | null
}

/** Normalized task returned by all providers. */
export type Task = {
  id: string
  title: string
  description?: string | null
  status?: string
  priority?: string
  assignee?: string | null
  startDate?: string | null
  dueDate?: string | null
  createdAt?: string
  projectId?: string
  url: string
  labels?: TaskLabel[]
  relations?: TaskRelation[]
  number?: number
  reporter?: UserRef
  updater?: UserRef
  votes?: number
  watchers?: UserRef[]
  commentsCount?: number
  resolved?: string
  attachments?: Attachment[]
  customFields?: TaskCustomField[]
  visibility?: TaskVisibility
  parent?: { id: string; idReadable?: string; title: string }
  subtasks?: Array<{ id: string; idReadable?: string; title: string; status?: string }>
}

export type ListTasksParams = {
  status?: string
  priority?: string
  assigneeId?: string
  page?: number
  limit?: number
  sortBy?: 'createdAt' | 'priority' | 'dueDate' | 'position' | 'title' | 'number'
  sortOrder?: 'asc' | 'desc'
  dueBefore?: string
  dueAfter?: string
}

/** Minimal task representation for list results. */
export type TaskListItem = {
  id: string
  title: string
  number?: number
  status?: string
  priority?: string
  dueDate?: string | null
  resolved?: string
  url: string
}

/** Minimal task representation for search results. */
export type TaskSearchResult = {
  id: string
  title: string
  number?: number
  status?: string
  priority?: string
  projectId?: string
  url: string
}

export type Project = {
  id: string
  name: string
  description?: string | null
  url: string
}

export type Comment = {
  id: string
  body: string
  author?: string
  createdAt?: string
  reactions?: CommentReaction[]
}

export type Label = {
  id: string
  name: string
  color?: string
}

/** Label as attached to a task (may have additional fields). */
export type TaskLabel = {
  id: string
  name: string
  color?: string
}

export type Column = {
  id: string
  name: string
  order?: number
  isFinal?: boolean
}

export type RelationType = 'blocks' | 'blocked_by' | 'duplicate' | 'duplicate_of' | 'related' | 'parent' | 'child'

/** Normalized work item (time tracking entry) returned by providers. */
export type WorkItem = {
  id: string
  taskId: string
  author: string
  /** YYYY-MM-DD */
  date: string
  /** ISO-8601 PnHnM e.g. "PT2H30M" */
  duration: string
  description?: string
  type?: string
}

export type CreateWorkItemParams = {
  /** Natural or ISO-8601 duration, e.g. "2h 30m" or "PT2H30M" */
  duration: string
  /** ISO date "YYYY-MM-DD", defaults to today */
  date?: string
  description?: string
  type?: string
  author?: string
}

export type UpdateWorkItemParams = {
  duration?: string
  date?: string
  description?: string
  type?: string
}

export type TaskRelation = {
  type: RelationType
  taskId: string
}

export type Agile = {
  id: string
  name: string
}

export type Sprint = {
  id: string
  agileId: string
  name: string
  start?: string
  finish?: string
  archived: boolean
  goal?: string | null
  isDefault?: boolean
  unresolvedIssuesCount?: number
}

export type Activity = {
  id: string
  timestamp: string
  author?: string
  category: string
  field?: string
  added?: string
  removed?: string
}

export type SavedQuery = {
  id: string
  name: string
  query?: string | null
}

export type TaskCommandResult = {
  query: string
  taskIds: string[]
  comment?: string
  silent?: boolean
}
