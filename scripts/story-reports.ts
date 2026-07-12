// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { rm } from 'node:fs/promises'

export const STORY_REPORT_DIRECTORY = 'reports/stories'
export const STORY_MANIFEST_REPORT_PATH = `${STORY_REPORT_DIRECTORY}/manifest.json`
export const STORY_JUNIT_REPORT_PATH = `${STORY_REPORT_DIRECTORY}/junit.xml`

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

export async function removeStoryReport(reportPath: string): Promise<void> {
  try {
    await rm(reportPath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to remove story report ${reportPath}: ${message}`, { cause: error })
  }
}
