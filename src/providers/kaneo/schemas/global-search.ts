import { z } from 'zod'

const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])
const SearchDateTimeSchema = z.iso.datetime({ offset: true })
const SearchActivityTypeEnum = z.enum([
  'comment',
  'task',
  'status_changed',
  'priority_changed',
  'unassigned',
  'assignee_changed',
  'due_date_changed',
  'title_changed',
  'description_changed',
  'create',
])

export const SearchTaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  position: z.number().nullable(),
  number: z.number().nullable(),
  userId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: TaskPriorityEnum,
  startDate: SearchDateTimeSchema.nullable().optional(),
  dueDate: SearchDateTimeSchema.nullable().optional(),
  createdAt: SearchDateTimeSchema,
})

export const SearchProjectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: SearchDateTimeSchema,
  isPublic: z.boolean().nullable(),
  archivedAt: SearchDateTimeSchema.nullable(),
})

export const SearchWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
  metadata: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: SearchDateTimeSchema,
})

export const SearchCommentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  type: SearchActivityTypeEnum,
  createdAt: SearchDateTimeSchema,
  userId: z.string().nullable(),
  content: z.string().nullable(),
  eventData: z.record(z.string(), z.unknown()).nullable(),
  externalUserName: z.string().nullable(),
  externalUserAvatar: z.string().nullable(),
  externalSource: z.string().nullable(),
  externalUrl: z.string().nullable(),
})

export const SearchActivitySchema = SearchCommentSchema

export const RuntimeSearchResultSchema = z.object({
  id: z.string(),
  type: z.enum(['task', 'project', 'workspace', 'comment', 'activity']),
  title: z.string(),
  description: z.string().optional(),
  content: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  workspaceId: z.string().optional(),
  workspaceName: z.string().optional(),
  userId: z.string().optional(),
  userName: z.string().optional(),
  createdAt: SearchDateTimeSchema,
  relevanceScore: z.number(),
  taskNumber: z.number().optional(),
  projectSlug: z.string().optional(),
  priority: z.string().optional(),
  status: z.string().optional(),
})

export const GlobalSearchResponseSchema = z.object({
  tasks: z.array(SearchTaskSchema),
  projects: z.array(SearchProjectSchema),
  workspaces: z.array(SearchWorkspaceSchema),
  comments: z.array(SearchCommentSchema),
  activities: z.array(SearchActivitySchema),
})

export const RuntimeGlobalSearchResponseSchema = z.object({
  results: z.array(RuntimeSearchResultSchema),
  totalCount: z.number(),
  searchQuery: z.string(),
})

export type SearchTask = z.infer<typeof SearchTaskSchema>
export type GlobalSearchResponse = z.infer<typeof GlobalSearchResponseSchema>
export type RuntimeGlobalSearchResponse = z.infer<typeof RuntimeGlobalSearchResponseSchema>
