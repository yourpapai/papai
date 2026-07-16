// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildLinuxStorySandboxCommand } from './story-sandbox-linux.js'

export type StorySandboxBackend = 'linux-docker'

const UNSUPPORTED_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['aix', 'freebsd', 'openbsd', 'sunos'])

export type StorySandboxRequest = Readonly<{
  platform: NodeJS.Platform
  appRoot: string
  tempRoot: string
  reportPaths: readonly string[]
  bunExecutable: string
  command: readonly string[]
}>

export function selectStorySandboxBackend(platform: NodeJS.Platform): StorySandboxBackend {
  if (UNSUPPORTED_PLATFORMS.has(platform)) throw new Error(`Story sandbox backend is not implemented for ${platform}`)
  return 'linux-docker'
}

export function buildStorySandboxCommand(request: StorySandboxRequest): readonly string[] {
  selectStorySandboxBackend(request.platform)
  return buildLinuxStorySandboxCommand(request)
}
