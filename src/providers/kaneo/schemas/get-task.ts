import { z } from 'zod'

// Enums
const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

// Task schema (response)
export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  position: z.number().nullable(),
  number: z.number().nullable(),
  userId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: TaskPriorityEnum,
  startDate: z.string().nullable().optional(),
  dueDate: z.unknown().optional(),
  createdAt: z.unknown(),
})
