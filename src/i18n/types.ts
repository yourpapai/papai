// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Typed i18n catalogs.
 *
 * `Dictionary` is the authoritative shape of a locale catalog. Every locale
 * file is typed against it, so adding a key to `en` forces every other locale
 * to provide it at compile time.
 */
export interface Dictionary {
  commands: {
    start: {
      welcome: string
    }
    stop: {
      nothingRunning: string
      stoppingNow: string
      windingDown: string
    }
  }
  auth: {
    groupNotAllowed: string
    groupMemberNotAllowed: string
    dmNotAllowed: string
    userBlocked: string
  }
  progress: {
    toolStarted: string
    toolFinished: string
    statusSuccess: string
    statusFailed: string
    durationSuffix: string
    inputLabel: string
    outputLabel: string
    errorLabel: string
    reasoningTitle: string
    reasoningHidden: string
  }
  picker: {
    prompt: string
    english: string
    russian: string
    saved: string
  }
}

/** Dotted path to a string leaf of a `Dictionary` (e.g. `'commands.stop.stoppingNow'`). */
export type DictionaryKey = PathLeaves<Dictionary>

type PathLeaves<T> = T extends string
  ? never
  : { [K in keyof T & string]: T[K] extends string ? K : `${K}.${PathLeaves<T[K]>}` }[keyof T & string]

/** Named-slot interpolation values for `t()`; slots are written as `{name}`. */
export type TranslationParams = Record<string, string | number>
