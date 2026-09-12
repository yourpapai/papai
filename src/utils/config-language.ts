// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigValue } from '../config.js'
import { isSupportedLocale, type Locale } from '../i18n/index.js'

/** Resolve the effective locale for a config context; `en` when unset or invalid. */
export function getContextLanguage(configContextId: string): Locale {
  const stored = getConfigValue(configContextId, 'language')
  if (stored !== null && isSupportedLocale(stored)) return stored
  return 'en'
}
