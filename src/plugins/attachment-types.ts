// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Read-only metadata view of a stored attachment, exposed to plugin tools.
 * Plugins receive this through `PluginToolRuntimeContext.attachments.read(...)`.
 * The full `StoredAttachment` is not exposed: plugins do not need DB-internal
 * fields like `blobKey` or `checksum`.
 */
export type PluginAttachmentRecord = {
  attachmentId: string
  filename: string
  mimeType: string | undefined
  size: number | undefined
  createdAt: string
}

/**
 * Facade exposed on `PluginToolRuntimeContext` when the plugin holds the
 * `attachments.read` permission. The facade is bound to the current
 * `storageContextId` — plugins cannot read attachments belonging to a
 * different storage context. Unknown ids throw `attachment_not_found`.
 */
export type PluginAttachmentFacade = {
  read(attachmentId: string): Promise<{
    record: PluginAttachmentRecord
    bytes: Buffer
  }>
}
