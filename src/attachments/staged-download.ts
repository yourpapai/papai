import type { AttachmentSourceProvider, StagedFileDownloadFn } from './types.js'

export type StagedDownloaderDeps = {
  telegramFetcher: (fileId: string) => Promise<Buffer | null>
  mattermostFetcher: (fileId: string) => Promise<Buffer | null>
}

let activeDownloader: StagedFileDownloadFn | null = null

export function createStagedDownloader(deps: StagedDownloaderDeps): StagedFileDownloadFn {
  const resolveProvider = (
    platformFileId: string,
    sourceProvider: AttachmentSourceProvider,
  ): Promise<Buffer | null> => {
    if (sourceProvider === 'telegram') return deps.telegramFetcher(platformFileId)
    if (sourceProvider === 'mattermost') return deps.mattermostFetcher(platformFileId)
    return Promise.resolve(null)
  }

  return resolveProvider
}

export function setStagedDownloader(fn: StagedFileDownloadFn): void {
  activeDownloader = fn
}

export function getStagedDownloader(): StagedFileDownloadFn | null {
  return activeDownloader
}
