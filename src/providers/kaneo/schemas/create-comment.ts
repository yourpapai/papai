import { z } from 'zod'

export const CommentUserSchema = z.object({
  name: z.string(),
  image: z.string().nullable(),
})

export const CreateCommentResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string(),
  content: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  user: CommentUserSchema.optional(),
})

export const CommentListResponseSchema = CreateCommentResponseSchema.array()
