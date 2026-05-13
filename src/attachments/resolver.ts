import type { AttachmentRef } from './types.js'

const MULTIMODAL_MODEL_PREFIXES = [
  'gpt-4o',
  'gpt-4.1',
  'gpt-5',
  'claude-3',
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-haiku-4',
  'gemini-1.5',
  'gemini-2',
] as const

export function supportsAttachmentModelInput(modelName: string): boolean {
  return MULTIMODAL_MODEL_PREFIXES.some((prefix) => modelName.startsWith(prefix))
}

const renderRef = (attachment: AttachmentRef): string => {
  const meta: string[] = []
  if (attachment.mimeType !== undefined) meta.push(attachment.mimeType)
  if (attachment.size !== undefined) meta.push(`${attachment.size} bytes`)
  const suffix = meta.length === 0 ? '' : ` (${meta.join(', ')})`
  return `${attachment.attachmentId} ${attachment.filename}${suffix}`
}

export function buildAttachmentManifest(attachments: readonly AttachmentRef[]): string | null {
  if (attachments.length === 0) return null
  return `[Available attachments: ${attachments.map(renderRef).join('; ')}]`
}

const ATTACHMENT_ID_RE = /\batt_[a-z0-9-]+\b/gi

export function selectAttachmentsForTurn(params: {
  text: string
  newAttachmentIds: readonly string[]
  activeAttachments: readonly AttachmentRef[]
}): AttachmentRef[] {
  const mentioned = new Set<string>()
  const matches = params.text.matchAll(ATTACHMENT_ID_RE)
  for (const match of matches) mentioned.add(match[0])
  const selectedIds = new Set<string>([...params.newAttachmentIds, ...mentioned])
  return params.activeAttachments.filter((attachment) => selectedIds.has(attachment.attachmentId))
}

export function buildHistoryAttachmentLines(attachments: readonly AttachmentRef[]): string[] {
  return attachments.map((attachment) => `[User attached ${attachment.attachmentId}: ${attachment.filename}]`)
}
