// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { assertLinuxStorySandboxBackend, isLinuxStorySandboxRequired } from './sandbox.js'

export type StorySandboxDockerMode = 'available' | 'unavailable'

export function classifyStorySandboxDockerMode(
  environment: Readonly<Record<string, string | undefined>>,
  verifyBackend: () => void,
): StorySandboxDockerMode {
  try {
    verifyBackend()
    return 'available'
  } catch (error) {
    if (isLinuxStorySandboxRequired(environment)) throw error
    return 'unavailable'
  }
}

export function runStorySandboxTests(args: readonly string[]): Promise<number> {
  const mode = classifyStorySandboxDockerMode(process.env, assertLinuxStorySandboxBackend)
  const child = Bun.spawn([process.execPath, 'test', 'tests/scripts/story-sandbox.test.ts', ...args], {
    env: { ...process.env, PAPAI_STORY_SANDBOX_DOCKER_MODE: mode },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return child.exited
}

if (import.meta.main) process.exitCode = await runStorySandboxTests(process.argv.slice(2))
