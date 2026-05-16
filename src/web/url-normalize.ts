// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const TRACKING_PARAM_PATTERNS = [/^utm_/iu, /^fbclid$/iu, /^gclid$/iu] as const

function isTrackingParam(key: string): boolean {
  return TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key))
}

export function normalizeWebUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  url.hostname = url.hostname.toLowerCase()
  url.hash = ''

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue)
      }

      return leftKey.localeCompare(rightKey)
    })

  url.search = new URLSearchParams(params).toString()
  return url.toString()
}
