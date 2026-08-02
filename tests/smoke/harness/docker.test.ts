// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/smoke/harness/docker.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { DockerResult } from './docker.js'
import { buildDockerRunArgs, isDockerAvailable, parsePublishedPort, repoRoot } from './docker.js'

describe('docker helpers', () => {
  test('buildDockerRunArgs emits a detached run with published port, host-gateway and env', () => {
    const args = buildDockerRunArgs({
      image: 'papai:e2e',
      env: { CHAT_PROVIDER: 'mattermost', ADMIN_USER_ID: 'admin-user-1' },
      detached: true,
      publishContainerPort: 9100,
      addHostGateway: true,
    })

    expect(args.slice(0, 2)).toEqual(['run', '-d'])
    expect(args).toContain('--add-host=host.docker.internal:host-gateway')
    expect(args).toContain('-p')
    expect(args).toContain('127.0.0.1::9100')
    expect(args).toContain('-e')
    expect(args).toContain('CHAT_PROVIDER=mattermost')
    expect(args).toContain('ADMIN_USER_ID=admin-user-1')
    expect(args.at(-1)).toBe('papai:e2e')
  })

  test('buildDockerRunArgs emits a foreground --rm run when not detached', () => {
    const args = buildDockerRunArgs({ image: 'papai:e2e', env: { ADMIN_USER_ID: '' }, detached: false })

    expect(args.slice(0, 2)).toEqual(['run', '--rm'])
    expect(args).not.toContain('-d')
    expect(args).toContain('ADMIN_USER_ID=')
    expect(args.at(-1)).toBe('papai:e2e')
  })

  test('parsePublishedPort reads the host port from docker port output', () => {
    expect(parsePublishedPort('127.0.0.1:54321\n')).toBe(54321)
    expect(parsePublishedPort('0.0.0.0:7\n[::]:7\n')).toBe(7)
  })

  test('repoRoot points at a directory that contains the Dockerfile', async () => {
    const file = Bun.file(`${repoRoot()}Dockerfile`)
    expect(await file.exists()).toBe(true)
  })

  test('isDockerAvailable reports false when the docker CLI errors', async () => {
    const failing = (): Promise<DockerResult> => Promise.resolve({ code: 127, stdout: '', stderr: 'not found' })
    expect(await isDockerAvailable(failing)).toBe(false)
  })
})
