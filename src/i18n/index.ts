// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { en } from './locales/en.js'
import { ru } from './locales/ru.js'
import type { Dictionary, DictionaryKey, TranslationParams } from './types.js'

export type { Dictionary, DictionaryKey, TranslationParams } from './types.js'

export const SUPPORTED_LOCALES = ['en', 'ru'] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]

const DICTIONARIES: Record<Locale, Dictionary> = { en, ru }

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function lookup(dictionary: Dictionary, key: string): string | undefined {
  let node: unknown = dictionary
  for (const segment of key.split('.')) {
    if (!isRecord(node)) return undefined
    node = node[segment]
  }
  return typeof node === 'string' ? node : undefined
}

function interpolate(template: string, params: TranslationParams): string {
  return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  )
}

export function t(key: DictionaryKey, locale: Locale = 'en', params?: TranslationParams): string {
  const localized = locale === 'en' ? undefined : lookup(DICTIONARIES[locale], key)
  if (localized !== undefined) return params === undefined ? localized : interpolate(localized, params)

  const fallback = lookup(en, key)
  if (fallback === undefined) throw new Error(`i18n key not found: ${key}`)
  if (locale !== 'en') {
    logger.warn({ key, locale }, `i18n key missing in ${locale} dictionary, falling back to en`)
  }
  return params === undefined ? fallback : interpolate(fallback, params)
}
