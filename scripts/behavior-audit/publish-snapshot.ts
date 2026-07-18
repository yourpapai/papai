// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { STORIES_DIR } from './config.js'

export function formatDateStamp(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function resolveBranchName(): string {
  return process.env['BEHAVIOR_AUDIT_PUBLISH_BRANCH'] ?? 'audit-output'
}

export function resolveTagName(): string {
  return process.env['BEHAVIOR_AUDIT_PUBLISH_TAG'] ?? 'audit-output-latest'
}

export function buildCommitMessage(dateStamp: string): string {
  return `chore(audit): snapshot for ${dateStamp}`
}

export function resolveStoriesPath(): string {
  return STORIES_DIR
}

async function publishSnapshot(): Promise<number> {
  const storiesPath = resolveStoriesPath()
  const branch = resolveBranchName()
  const tag = resolveTagName()
  const dateStamp = formatDateStamp(new Date())

  const fs = await import('node:fs/promises')
  const constants = await import('node:fs')
  try {
    await fs.access(storiesPath, constants.constants.F_OK)
  } catch {
    console.error(`Error: no audit output to publish (${storiesPath} does not exist)`)
    return 1
  }
  const entries = await fs.readdir(storiesPath)
  if (entries.length === 0) {
    console.error(`Error: no audit output to publish (${storiesPath} is empty)`)
    return 1
  }

  console.log(`Publishing ${entries.length} entries from ${storiesPath} to branch ${branch} (tag ${tag})`)
  console.log(`Date stamp: ${dateStamp}`)
  console.log('Orphan-branch publish requires git plumbing; run within GitHub Actions.')

  return 0
}

if (import.meta.main) {
  const exitCode = await publishSnapshot()
  process.exit(exitCode)
}
