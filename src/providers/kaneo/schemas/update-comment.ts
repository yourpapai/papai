import { CreateCommentResponseSchema } from './create-comment.js'

export const UpdateCommentResponseSchema = CreateCommentResponseSchema

export type UpdateCommentResponse = z.infer<typeof UpdateCommentResponseSchema>
