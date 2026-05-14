import { z } from 'zod'

// Enums
const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])
const TaskDateTimeSchema = z.iso.datetime({ offset: true })

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
  startDate: TaskDateTimeSchema.nullable().optional(),
  dueDate: TaskDateTimeSchema.nullable().optional(),
  createdAt: TaskDateTimeSchema,
})

// TypeScript types
export type CreateTaskResponse = z.infer<typeof TaskSchema>
