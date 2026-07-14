// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.

import type { StorySandboxBackend } from './story-manifest.js'

export type StorySnapshotOptions = Readonly<{
  root: string
  seed: number
  bunVersion?: string
  sandboxBackend?: StorySandboxBackend
}>
