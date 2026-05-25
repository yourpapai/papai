// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AttachmentSourceProvider, StagedFileDownloadFn } from './types.js'

export type StagedDownloaderDeps = {
  downloadFileFromInstance: (
    platformInstanceId: string,
    sourceProvider: AttachmentSourceProvider,
    fileId: string,
  ) => Promise<Buffer | null>
}

export function createStagedDownloader(deps: StagedDownloaderDeps): StagedFileDownloadFn {
  return (
    platformFileId: string,
    sourceProvider: AttachmentSourceProvider,
    sourcePlatformInstanceId: string,
  ): Promise<Buffer | null> => deps.downloadFileFromInstance(sourcePlatformInstanceId, sourceProvider, platformFileId)
}
