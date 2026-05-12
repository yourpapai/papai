export type AttachmentStatus = 'available' | 'tool_only' | 'rejected' | 'unavailable'

export type AttachmentSourceProvider = 'telegram' | 'mattermost' | 'discord' | 'unknown'

export type AttachmentRef = {
  attachmentId: string
  contextId: string
  filename: string
  status: AttachmentStatus
} & Partial<{
  mimeType: string
  size: number
}>

export type StoredAttachment = AttachmentRef & {
  sourceProvider: AttachmentSourceProvider
  checksum: string
  blobKey: string
  createdAt: string
  content: Buffer
} & Partial<{
    sourceMessageId: string
    sourceFileId: string
    clearedAt: string | null
    lastUsedAt: string | null
  }>

export type SaveAttachmentInput = {
  contextId: string
  sourceProvider: AttachmentSourceProvider
  filename: string
  status: AttachmentStatus
  content: Buffer
} & Partial<{
  sourceMessageId: string
  sourceFileId: string
  mimeType: string
  size: number
}>

export type StagedFileStatus = 'staged' | 'resolved' | 'failed' | 'expired'

export type StagedFileRef = {
  stagedId: string
  contextId: string
  messageId: string | null
  senderId: string
  senderUsername: string | null
  filename: string
  mimeType: string | null
  size: number | null
  platformFileId: string
  sourceProvider: AttachmentSourceProvider
  status: StagedFileStatus
  createdAt: string
  expiresAt: string
}

export type StageFileParams = {
  contextId: string
  messageId: string | null
  senderId: string
  senderUsername: string | null
  filename: string
  mimeType: string | null
  size: number | null
  platformFileId: string
  sourceProvider: AttachmentSourceProvider
}

export type StagedResolutionError =
  | { status: 'staged_file_expired'; message: string }
  | { status: 'download_failed'; message: string }
  | { status: 'already_resolved'; attachmentId: string }
  | { status: 'not_found'; message: string }

export type StagedFileDownloadFn = (
  platformFileId: string,
  sourceProvider: AttachmentSourceProvider,
) => Promise<Buffer | null>
