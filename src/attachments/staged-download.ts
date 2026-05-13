import type { AttachmentSourceProvider, StagedFileDownloadFn } from './types.js'

export type StagedDownloaderDeps = {
  telegramFetcher: (fileId: string) => Promise<Buffer | null>
  mattermostFetcher: (fileId: string) => Promise<Buffer | null>
}

export function createStagedDownloader(deps: StagedDownloaderDeps): StagedFileDownloadFn {
  const resolveProvider = (
    platformFileId: string,
    sourceProvider: AttachmentSourceProvider,
  ): Promise<Buffer | null> => {
    if (sourceProvider === 'telegram') return deps.telegramFetcher(platformFileId)
    if (sourceProvider === 'mattermost') return deps.mattermostFetcher(platformFileId)
    // Discord does not produce fileCandidates on IncomingMessage, so staged files
    // are never created for Discord conversations. This default path is unreachable
    // in practice for Discord; it serves as a graceful fallback for unknown providers.
    return Promise.resolve(null)
  }

  return resolveProvider
}
