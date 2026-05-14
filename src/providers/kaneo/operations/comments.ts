import type { Comment } from '../../types.js'
import { addComment } from '../add-comment.js'
import type { KaneoConfig } from '../client.js'
import { getComments } from '../get-comments.js'
import { mapComment } from '../mappers.js'
import { removeComment } from '../remove-comment.js'
import { updateComment } from '../update-comment.js'

export async function kaneoAddComment(config: KaneoConfig, taskId: string, body: string): Promise<Comment> {
  const result = await addComment({ config, taskId, comment: body })
  return mapComment(result)
}

export async function kaneoGetComments(config: KaneoConfig, taskId: string): Promise<Comment[]> {
  const results = await getComments({ config, taskId })
  return results.map(mapComment)
}

export async function kaneoUpdateComment(
  config: KaneoConfig,
  params: { taskId: string; commentId: string; body: string },
): Promise<Comment> {
  const result = await updateComment({
    config,
    taskId: params.taskId,
    activityId: params.commentId,
    comment: params.body,
  })
  return mapComment(result)
}

export async function kaneoRemoveComment(
  config: KaneoConfig,
  params: { taskId: string; commentId: string },
): Promise<{ id: string }> {
  const result = await removeComment({ config, activityId: params.commentId })
  return { id: result.id }
}
