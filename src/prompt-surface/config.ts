// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigValue } from '../config.js'

export const STRUCTURED_PROMPT_SURFACE_KEY = 'structured_prompt_surface'

export function isStructuredPromptSurfaceEnabled(contextId: string): boolean {
  return getConfigValue(contextId, STRUCTURED_PROMPT_SURFACE_KEY) === 'on'
}
