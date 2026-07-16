// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ReviewLoopConfig } from '../../review-loop/src/config.js'
import type { ProgressReporter } from '../../review-loop/src/progress-log.js'

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
    agentTimeoutMs: 600_000,
    buildTimeoutMs: 600_000,
    checkCommand: 'bun check:full',
    reviewer: {
      model: 'ollama-cloud/kimi-k2.6:cloud',
      extraArgs: [],
    },
    fixer: {
      model: 'opencode/claude-sonnet-4-6',
      extraArgs: [],
    },
    matcher: {
      model: 'ollama-cloud/kimi-k2.6:cloud',
      extraArgs: [],
    },
    ...overrides,
  }
}

export function silentReporter(): ProgressReporter {
  return {
    dynamic: false,
    event() {},
    live() {},
    clearLive() {},
    log() {},
  }
}
