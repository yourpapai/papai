// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type { AttachmentRef, AttachmentSourceProvider, StagedFileDownloadFn, StoredAttachment } from './types.js'
export { loadAttachmentRecord } from './store.js'
export { persistIncomingAttachments } from './ingest.js'
export { listActiveAttachments } from './workspace.js'
export {
  buildAttachmentManifest,
  renderAttachedLine,
  sanitizeForBracket,
  selectAttachmentsForTurn,
  supportsAttachmentModelInput,
} from './resolver.js'
export { getBlobStore, isS3Configured } from './blob-store.js'
export {
  findStagedFilesByMessageId,
  purgeExpiredStagedFiles,
  resolveStagedFile,
  searchStagedFiles,
  stageFileMetadata,
} from './staged.js'
