// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'

import type { StrykerReport } from './score-merger.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const readJsonRecord = (filePath: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!isRecord(parsed)) {
    throw new Error(`${filePath} must contain a JSON object`)
  }
  return parsed
}

export const readStrykerReport = (reportPath: string): StrykerReport => {
  const parsed: unknown = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  if (!isStrykerReport(parsed)) {
    throw new Error(`${reportPath} must contain a Stryker JSON report object`)
  }
  return parsed
}

const isStrykerReport = (value: unknown): value is StrykerReport => {
  if (!isRecord(value)) return false
  const files = value['files']
  if (files === undefined) return true
  return isRecord(files)
}
