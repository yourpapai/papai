// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import packageJson from '../package.json' with { type: 'json' }
import { readChangelogFile as defaultReadChangelogFile } from './changelog-reader.js'
import type { ChatProvider } from './chat/types.js'
import { dmTarget } from './chat/types.js'
import { getDrizzleDb } from './db/drizzle.js'
import { versionAnnouncements } from './db/schema.js'
import { logger } from './logger.js'
import { extractChangelogSection } from './utils/changelog.js'

export interface AnnouncementsDeps {
  readChangelogFile: () => Promise<string>
}

const defaultAnnouncementsDeps: AnnouncementsDeps = {
  readChangelogFile: defaultReadChangelogFile,
}

const log = logger.child({ scope: 'announcements' })

const VERSION: string = packageJson.version
type RouterInstanceLookup = { getInstance: (id: string) => unknown }

const hasRouterInstanceLookup = (chat: ChatProvider): chat is ChatProvider & RouterInstanceLookup =>
  typeof Reflect.get(chat, 'getInstance') === 'function'

function isVersionAnnounced(version: string): boolean {
  const row = getDrizzleDb().select().from(versionAnnouncements).where(eq(versionAnnouncements.version, version)).get()
  return row !== undefined
}

function markVersionAnnounced(version: string): boolean {
  try {
    getDrizzleDb().insert(versionAnnouncements).values({ version, announcedAt: new Date().toISOString() }).run()
    log.info({ version }, 'Version marked as announced')
    return true
  } catch {
    // Unique constraint violation - version already announced
    return false
  }
}

async function sendAnnouncementToAdmin(
  platformInstanceId: string,
  adminUserId: string,
  markdown: string,
  chat: ChatProvider,
): Promise<boolean> {
  try {
    if (hasRouterInstanceLookup(chat)) {
      const instance = chat.getInstance(platformInstanceId)
      if (instance === undefined || instance === null) return false
    }
    const result = await chat.sendMessage(platformInstanceId, dmTarget(adminUserId), markdown)
    if (result === false) return false
    log.debug({ version: VERSION }, 'Announcement sent to admin')
    return true
  } catch (error) {
    log.warn(
      { version: VERSION, error: error instanceof Error ? error.message : String(error) },
      'Failed to send announcement to admin',
    )
    return false
  }
}

export async function announceNewVersion(
  chat: ChatProvider,
  platformInstanceId: string,
  adminUserId: string,
  ...args: [] | [deps: AnnouncementsDeps]
): Promise<void> {
  log.debug({ version: VERSION }, 'Checking if version announcement is needed')

  const effectiveDeps = args.length === 0 ? defaultAnnouncementsDeps : args[0]
  const changelogSection = await loadChangelogSection(effectiveDeps)
  if (changelogSection === null) return

  if (isVersionAnnounced(VERSION)) {
    log.debug({ version: VERSION }, 'Version already announced, skipping')
    return
  }

  log.info({ version: VERSION }, 'Sending version announcement to admin')

  const message = `🆕 papai v${VERSION} has been released!\n\n${changelogSection}`
  const success = await sendAnnouncementToAdmin(platformInstanceId, adminUserId, message, chat)
  if (success) markVersionAnnounced(VERSION)

  log.info({ version: VERSION, success }, 'Version announcement complete')
}

async function loadChangelogSection(deps: AnnouncementsDeps): Promise<string | null> {
  let changelogContent: string
  try {
    changelogContent = await deps.readChangelogFile()
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Could not read CHANGELOG.md')
    return null
  }

  const section = extractChangelogSection(VERSION, changelogContent)
  if (section === null) {
    log.warn({ version: VERSION }, 'No changelog section found for version, skipping announcement')
    return null
  }
  return section
}
