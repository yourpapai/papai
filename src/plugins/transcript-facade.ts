// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mintTranscriptToken } from '../mcp-server/token.js'
import { getSettingsPublicBaseUrl } from '../settings/config.js'
import { deny } from './deny.js'
import type { PluginToolRuntimeContext } from './types.js'

/** Mints papai `/t/<token>` transcript URLs, gated on the `coding.secrets` permission (mirrors `coding-secrets-facade.ts`). */
export function buildTranscriptFacade(
  pluginId: string,
  hasPermission: boolean,
): PluginToolRuntimeContext['transcript'] {
  return Object.freeze({
    mintUrl(magiSessionId: string): string | null {
      if (!hasPermission) deny(pluginId, 'coding.secrets')
      const base = getSettingsPublicBaseUrl()
      if (base === null) return null
      return `${base}/t/${encodeURIComponent(mintTranscriptToken(magiSessionId))}`
    },
  })
}
