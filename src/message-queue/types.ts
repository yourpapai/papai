import type { ContextType, ReplyFn } from '../chat/types.js'

type QueueContextInfo = Readonly<{
  contextType: ContextType
}>

type QueueConfigContextInfo = Partial<
  Readonly<{
    configContextId: string | undefined
  }>
>

export type QueueItem = Readonly<{
  text: string
  userId: string
  username: string | null
  storageContextId: string
  newAttachmentIds: readonly string[]
}> &
  QueueContextInfo &
  QueueConfigContextInfo

export type CoalescedItem = Readonly<{
  text: string
  userId: string
  username: string | null
  storageContextId: string
  newAttachmentIds: readonly string[]
  reply: ReplyFn
}> &
  QueueContextInfo &
  QueueConfigContextInfo
