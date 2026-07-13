// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildDarwinStorySandboxCommand } from './story-sandbox-macos.js'

export type StorySandboxRequest = Readonly<{
  platform: NodeJS.Platform
  appRoot: string
  dependencyRoot: string
  tempRoot: string
  reportPaths: readonly string[]
  bunExecutable: string
  command: readonly string[]
}>

export function buildStorySandboxCommand(request: StorySandboxRequest): readonly string[] {
  if (request.platform === 'darwin') return buildDarwinStorySandboxCommand(request)
  throw new Error(`Story sandbox backend is not implemented for ${request.platform}`)
}
