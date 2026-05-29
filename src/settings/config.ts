// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function getSettingsPublicBaseUrl(): string | null {
  const raw = process.env['SETTINGS_PUBLIC_BASE_URL']
  if (raw === undefined || raw.trim() === '') return null
  return raw.trim().replace(/\/+$/u, '')
}

export function buildSettingsUrlFromBase(base: string, code: string): string {
  return `${base}/settings?code=${encodeURIComponent(code)}`
}

export function buildSettingsUrl(code: string): string | null {
  const base = getSettingsPublicBaseUrl()
  if (base === null) return null
  return buildSettingsUrlFromBase(base, code)
}
