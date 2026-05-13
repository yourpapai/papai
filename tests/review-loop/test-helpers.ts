import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ReviewLoopConfig } from '../../review-loop/src/config.js'

const tempDirs: string[] = []

export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function createReviewLoopConfigFixture(
  repoRoot: string,
  overrides?: Partial<ReviewLoopConfig>,
): ReviewLoopConfig {
  return {
    repoRoot,
    workDir: path.join(repoRoot, '.review-loop'),
    maxRounds: 5,
    maxNoProgressRounds: 2,
    reviewer: {
      command: '/usr/local/bin/claude-acp-adapter',
      args: [],
      env: {},
      sessionConfig: {},
      invocationPrefix: '/review-code',
      requireInvocationPrefix: false,
    },
    fixer: {
      command: 'opencode',
      args: ['acp'],
      env: {},
      sessionConfig: {},
      verifyInvocationPrefix: '/verify-issue',
      fixInvocationPrefix: null,
      requireVerifyInvocation: false,
    },
    ...overrides,
  }
}
