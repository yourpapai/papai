import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { PROGRESS_PATH } from './config.js'
import { validateOrMigrateProgress } from './progress-migrate.js'
import type { Progress } from './progress.js'

export async function loadProgress(): Promise<Progress | null> {
  const file = Bun.file(PROGRESS_PATH)
  if (!(await file.exists())) {
    return null
  }

  const text = await file.text()
  const progress = validateOrMigrateProgress(JSON.parse(text))
  if (progress === null) {
    throw new Error('Invalid behavior-audit progress file')
  }
  return progress
}

export async function saveProgress(progress: Progress): Promise<void> {
  await mkdir(dirname(PROGRESS_PATH), { recursive: true })
  await Bun.write(PROGRESS_PATH, JSON.stringify(progress, null, 2) + '\n')
}
