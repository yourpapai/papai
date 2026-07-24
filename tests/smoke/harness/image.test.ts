// tests/smoke/harness/image.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { DockerResult } from './docker.js'
import { buildImageBuildArgs, ensurePapaiE2eImage, imageExists, PAPAI_E2E_IMAGE } from './image.js'

const ok: DockerResult = { code: 0, stdout: '', stderr: '' }

function respondNoImageThenFailedBuild(args: string[]): Promise<DockerResult> {
  if (args[0] === 'image') return Promise.resolve({ code: 1, stdout: '', stderr: 'No such image' })
  return Promise.resolve({ code: 1, stdout: '', stderr: 'build blew up' })
}

describe('papai:e2e image builder', () => {
  test('buildImageBuildArgs tags the given context', () => {
    expect(buildImageBuildArgs('papai:e2e', '/repo/')).toEqual(['build', '-t', 'papai:e2e', '/repo/'])
  })

  test('imageExists is true when docker image inspect exits 0', async () => {
    expect(await imageExists(PAPAI_E2E_IMAGE, () => Promise.resolve(ok))).toBe(true)
  })

  test('ensurePapaiE2eImage skips the build when the image already exists', async () => {
    const calls: string[][] = []
    await ensurePapaiE2eImage({
      run: (args) => {
        calls.push(args)
        return Promise.resolve(ok)
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.slice(0, 2)).toEqual(['image', 'inspect'])
  })

  test('ensurePapaiE2eImage builds when the image is absent and throws on failure', async () => {
    await expect(ensurePapaiE2eImage({ run: respondNoImageThenFailedBuild, contextDir: '/repo/' })).rejects.toThrow(
      'build blew up',
    )
  })
})
