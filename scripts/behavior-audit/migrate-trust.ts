import { mkdir, readdir, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { EXTRACTED_DIR, PROGRESS_PATH } from './config.js'
import { loadManifest, saveManifest } from './incremental.js'
import { loadProgress } from './progress-io.js'
import type { Progress } from './progress.js'

export interface MigrationResult {
  readonly extractedFilesRemoved: number
  readonly progressReset: boolean
  readonly manifestReset: boolean
}

async function atomicSaveProgress(progress: Progress): Promise<void> {
  const dir = dirname(PROGRESS_PATH)
  const tempPath = join(dir, `.${basename(PROGRESS_PATH)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  await mkdir(dir, { recursive: true })
  await Bun.write(tempPath, JSON.stringify(progress, null, 2) + '\n')
  await rename(tempPath, PROGRESS_PATH)
}

async function removeExtractedArtifacts(): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(EXTRACTED_DIR)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return 0
    }
    throw error
  }

  const jsonFiles = entries.filter((entry) => entry.endsWith('.json'))
  await Promise.all(jsonFiles.map((file) => unlink(join(EXTRACTED_DIR, file))))
  return jsonFiles.length
}

async function resetPhase1Progress(): Promise<boolean> {
  const progress = await loadProgress()
  if (progress === null) return false

  progress.phase1.completedTests = {}
  progress.phase1.completedFiles = []
  progress.phase1.stats = {
    filesTotal: progress.phase1.stats.filesTotal,
    filesDone: 0,
    testsExtracted: 0,
    testsFailed: 0,
  }

  await atomicSaveProgress(progress)
  return true
}

async function resetPhase1ManifestEntries(): Promise<boolean> {
  const manifest = await loadManifest()
  if (manifest === null) return false

  const updatedTests = Object.fromEntries(
    Object.entries(manifest.tests).map(([key, entry]) => [
      key,
      { ...entry, phase1Fingerprint: null, lastPhase1CompletedAt: null },
    ]),
  )

  await saveManifest({ ...manifest, tests: updatedTests })
  return true
}

export async function migrateToTrustSchema(): Promise<MigrationResult> {
  const extractedFilesRemoved = await removeExtractedArtifacts()
  console.log(`Removed ${extractedFilesRemoved} extracted artifact(s) from ${EXTRACTED_DIR}`)

  const progressReset = await resetPhase1Progress()
  console.log(progressReset ? 'Reset phase 1 progress' : 'No progress file found, skipped')

  const manifestReset = await resetPhase1ManifestEntries()
  console.log(manifestReset ? 'Reset phase 1 manifest entries' : 'No manifest file found, skipped')

  return { extractedFilesRemoved, progressReset, manifestReset }
}

if (import.meta.main) {
  const result = await migrateToTrustSchema()
  console.log('\nMigration complete:', JSON.stringify(result, null, 2))
}
