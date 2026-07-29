// tests/smoke/harness/image.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../../src/logger.js'
import { type RunDocker, repoRoot, runDocker } from './docker.js'

const log = logger.child({ scope: 'smoke:image' })

export const PAPAI_E2E_IMAGE = 'papai:e2e'

export function buildImageBuildArgs(tag: string, contextDir: string): string[] {
  return ['build', '-t', tag, contextDir]
}

export async function imageExists(tag: string, run: RunDocker = runDocker): Promise<boolean> {
  const { code } = await run(['image', 'inspect', tag])
  return code === 0
}

export async function ensurePapaiE2eImage(opts: { run?: RunDocker; contextDir?: string } = {}): Promise<void> {
  const run = opts.run ?? runDocker
  const contextDir = opts.contextDir ?? repoRoot()
  if (await imageExists(PAPAI_E2E_IMAGE, run)) {
    log.info({ image: PAPAI_E2E_IMAGE }, 'papai:e2e image present, skipping build')
    return
  }
  log.info({ image: PAPAI_E2E_IMAGE, contextDir }, 'Building papai:e2e image')
  const { code, stderr } = await run(buildImageBuildArgs(PAPAI_E2E_IMAGE, contextDir))
  if (code !== 0) throw new Error(`docker build for ${PAPAI_E2E_IMAGE} failed: ${stderr}`)
  log.info({ image: PAPAI_E2E_IMAGE }, 'papai:e2e image built')
}
