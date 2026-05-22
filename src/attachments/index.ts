// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type {
  AttachmentRef,
  AttachmentSourceProvider,
  AttachmentStatus,
  SaveAttachmentInput,
  StageFileParams,
  StagedFileDownloadFn,
  StagedFileRef,
  StagedFileStatus,
  StagedResolutionError,
  StoredAttachment,
} from './types.js'
export { loadAttachmentRecord, saveAttachment } from './store.js'
export { persistIncomingAttachments } from './ingest.js'
export { listActiveAttachments } from './workspace.js'
export {
  buildAttachmentManifest,
  buildHistoryAttachmentLines,
  selectAttachmentsForTurn,
  supportsAttachmentModelInput,
} from './resolver.js'
export {
  createInMemoryBlobStoreForTesting,
  resetBlobStoreForTesting,
  setBlobStoreForTesting,
  buildBlobKey,
  createS3BlobStore,
  getBlobStore,
  isS3Configured,
  type BlobStore,
  type InMemoryBlobStore,
} from './blob-store.js'
export {
  findStagedFilesByMessageId,
  purgeExpiredStagedFiles,
  resolveStagedFile,
  searchStagedFiles,
  stageFileMetadata,
} from './staged.js'
