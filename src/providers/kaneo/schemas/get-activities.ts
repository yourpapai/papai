import { z } from 'zod'

// Enums
const ActivityTypeEnum = z.enum([
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
  'created',
])

// Activity item schema
export const ActivityItemSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  type: ActivityTypeEnum,
  createdAt: z.string().or(z.object({})),
  updatedAt: z.string().optional(),
  userId: z.string().nullable(),
  content: z.string().nullable(),
  eventData: z.record(z.string(), z.unknown()).nullable().optional(),
  externalUserName: z.string().nullable(),
  externalUserAvatar: z.string().nullable(),
  externalSource: z.string().nullable(),
  externalUrl: z.string().nullable(),
})
