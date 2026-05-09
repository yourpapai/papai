// scripts/behavior-audit/reset.ts
import { rm } from 'node:fs/promises'

import {
  AUDIT_BEHAVIOR_DIR,
  CLASSIFIED_DIR,
  CONSOLIDATED_DIR,
  CONSOLIDATED_MANIFEST_PATH,
  EVALUATED_DIR,
  STORIES_DIR,
} from './config.js'
import { loadProgress, saveProgress } from './progress-io.js'
import { resetPhase2AndPhase3, resetPhase3 } from './progress-resets.js'

export type ResetTarget = 'phase2' | 'phase3' | 'all'

export async function resetBehaviorAudit(target: ResetTarget): Promise<void> {
  if (target === 'all') {
    await rm(AUDIT_BEHAVIOR_DIR, { recursive: true, force: true })
    return
  }

  if (target === 'phase2') {
    await rm(CLASSIFIED_DIR, { recursive: true, force: true })
    await rm(CONSOLIDATED_DIR, { recursive: true, force: true })
    await rm(EVALUATED_DIR, { recursive: true, force: true })
    await rm(STORIES_DIR, { recursive: true, force: true })
    await rm(CONSOLIDATED_MANIFEST_PATH, { force: true })

    const progress = await loadProgress()
    if (progress !== null) {
      resetPhase2AndPhase3(progress)
      await saveProgress(progress)
    }
    return
  }

  await rm(EVALUATED_DIR, { recursive: true, force: true })
  await rm(STORIES_DIR, { recursive: true, force: true })

  const progress = await loadProgress()
  if (progress !== null) {
    resetPhase3(progress)
    await saveProgress(progress)
  }
}

const target = process.argv[2]

if (target === 'phase2' || target === 'phase3' || target === 'all') {
  await resetBehaviorAudit(target)
} else if (target !== undefined) {
  console.error('Usage: bun scripts/behavior-audit/reset.ts <phase2|phase3|all>')
  process.exit(1)
}
