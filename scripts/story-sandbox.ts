// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildLinuxStorySandboxCommand } from './story-sandbox-linux.js'
import { buildDarwinStorySandboxCommand } from './story-sandbox-macos.js'

export type StorySandboxBackend = 'darwin-sandbox-exec' | 'linux-docker'

export type StorySandboxRequest = Readonly<{
  platform: NodeJS.Platform
  appRoot: string
  dependencyRoot: string
  tempRoot: string
  reportPaths: readonly string[]
  bunExecutable: string
  command: readonly string[]
}>

export function selectStorySandboxBackend(platform: NodeJS.Platform): StorySandboxBackend {
  if (platform === 'darwin') return 'darwin-sandbox-exec'
  if (platform === 'linux') return 'linux-docker'
  throw new Error(`Story sandbox backend is not implemented for ${platform}`)
}

export function buildStorySandboxCommand(request: StorySandboxRequest): readonly string[] {
  const backend = selectStorySandboxBackend(request.platform)
  if (backend === 'darwin-sandbox-exec') return buildDarwinStorySandboxCommand(request)
  return buildLinuxStorySandboxCommand(request)
}
