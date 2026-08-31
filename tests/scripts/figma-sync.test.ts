// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  BOARD_CAPTION_GAP,
  BOARD_CAPTION_HEIGHT,
  BOARD_MARGIN,
  BOARD_TITLE_HEIGHT,
  DEFAULT_SYNC_PORT,
  SyncReportSchema,
  buildSyncManifest,
  countEntries,
  deriveEntryMeta,
  evaluateReport,
  pageNameFor,
  pngDimensions,
} from '../../scripts/figma-sync-lib.js'
import { parseArgs } from '../../scripts/figma-sync.js'

const makePng = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(45)
  const view = new DataView(bytes.buffer)
  for (const [index, byte] of [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].entries()) {
    bytes[index] = byte
  }
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

const file = (path: string, width = 1280, height = 720): { path: string; bytes: Uint8Array } => ({
  path,
  bytes: makePng(width, height),
})

describe('parseArgs', () => {
  test('defaults to admin+settings, shooting, and the canonical port', () => {
    expect(parseArgs([])).toEqual({
      areas: ['admin', 'settings'],
      shoot: true,
      port: DEFAULT_SYNC_PORT,
      timeoutSec: 900,
    })
  })

  test('accepts --areas with trimming, --no-shoot, --port, and --timeout-sec', () => {
    expect(parseArgs(['--areas', ' admin , settings ', '--no-shoot', '--port', '7782', '--timeout-sec', '30'])).toEqual(
      {
        areas: ['admin', 'settings'],
        shoot: false,
        port: 7782,
        timeoutSec: 30,
      },
    )
  })
})

describe('pngDimensions', () => {
  test('reads IHDR width and height', () => {
    expect(pngDimensions(makePng(1280, 720))).toEqual({ w: 1280, h: 720 })
  })

  test('rejects a bad signature', () => {
    const bytes = makePng(10, 10)
    bytes[0] = 0x00
    expect(() => pngDimensions(bytes)).toThrow('png_bad_signature')
  })

  test('rejects truncated input', () => {
    expect(() => pngDimensions(makePng(10, 10).slice(0, 10))).toThrow('png_too_short')
  })
})

describe('deriveEntryMeta', () => {
  test('strips the full area-subdir-spec prefix', () => {
    const meta = deriveEntryMeta(
      'settings',
      'sections/ToolsSection.spec.ts/settings-sections-ToolsSection-Populated-1.png',
      makePng(1280, 720),
    )
    expect(meta).toEqual({ group: 'Sections', name: 'ToolsSection · Populated', w: 640, h: 360 })
  })

  test('maps sections/admin to the admin-zone group', () => {
    const meta = deriveEntryMeta(
      'settings',
      'sections/admin/AdminUsersSection.spec.ts/settings-sections-admin-AdminUsersSection-Error-1.png',
      makePng(1280, 720),
    )
    expect(meta.group).toBe('Sections — admin zone')
    expect(meta.name).toBe('AdminUsersSection · Error')
  })

  test('maps components and halves narrow viewport sizes', () => {
    const meta = deriveEntryMeta(
      'settings',
      'components/SettingsFieldShell.spec.ts/settings-components-SettingsFieldShell-Hint-prop-1.png',
      makePng(640, 900),
    )
    expect(meta.group).toBe('Components')
    expect(meta.name).toBe('SettingsFieldShell · Hint prop')
    expect(meta).toMatchObject({ w: 320, h: 450 })
  })

  test('falls back to the spec-name prefix for interactive stories', () => {
    const meta = deriveEntryMeta(
      'settings',
      'SettingsApp.spec.ts/SettingsApp-—-personal-narrow-1.png',
      makePng(640, 900),
    )
    expect(meta.group).toBe('SettingsApp')
    expect(meta.name).toBe('SettingsApp · personal narrow')
  })

  test('handles the area-prefixed root spec stories', () => {
    const meta = deriveEntryMeta('admin', 'AdminApp.spec.ts/admin-AdminApp-Default-1.png', makePng(1280, 720))
    expect(meta.group).toBe('AdminApp')
    expect(meta.name).toBe('AdminApp · Default')
  })
})

describe('buildSyncManifest', () => {
  const manifest = buildSyncManifest([
    {
      name: 'settings',
      files: [
        file('sections/ToolsSection.spec.ts/settings-sections-ToolsSection-Populated-1.png'),
        file('sections/ToolsSection.spec.ts/settings-sections-ToolsSection-Empty-1.png'),
        file('components/SettingsFieldShell.spec.ts/settings-components-SettingsFieldShell-Error-1.png'),
        file('sections/admin/AdminGroupsSection.spec.ts/settings-sections-admin-AdminGroupsSection-Empty-1.png'),
        file('SettingsApp.spec.ts/SettingsApp-—-sidebar-link-hover-1.png'),
      ],
    },
  ])

  const groups = manifest.areas[0]?.groups ?? []

  test('orders groups by first appearance in case-insensitive path order', () => {
    expect(groups.map((group) => group.title)).toEqual([
      'Components',
      'Sections — admin zone',
      'Sections',
      'SettingsApp',
    ])
  })

  test('lays entries out on a grid and sizes groups', () => {
    const sections = groups.find((group) => group.title === 'Sections')
    expect(sections?.entries.map((entry) => [entry.col, entry.row])).toEqual([
      [0, 0],
      [1, 0],
    ])
    expect(sections?.cellW).toBe(640)
    expect(sections?.cellH).toBe(BOARD_CAPTION_HEIGHT + BOARD_CAPTION_GAP + 360)
    expect(sections?.width).toBe(BOARD_MARGIN * 2 + 4 * 640 + 3 * 60)
    expect(sections?.height).toBe(BOARD_TITLE_HEIGHT + 388 + BOARD_MARGIN)
  })

  test('stacks groups vertically with a gap', () => {
    expect(groups[0]?.y).toBe(0)
    expect(groups[0]?.height).toBe(BOARD_TITLE_HEIGHT + 388 + BOARD_MARGIN)
    expect(groups[1]?.y).toBe(BOARD_TITLE_HEIGHT + 388 + BOARD_MARGIN + 120)
  })

  test('derives page names and column counts per area', () => {
    expect(pageNameFor('admin')).toBe('Admin UI — stories')
    expect(pageNameFor('settings')).toBe('Settings UI — stories')
    expect(manifest.areas[0]?.cols).toBe(4)
  })

  test('counts every entry across groups', () => {
    expect(countEntries(manifest)).toBe(5)
  })

  test('refuses an area with no files', () => {
    expect(() => buildSyncManifest([{ name: 'empty', files: [] }])).toThrow('empty_area:empty')
  })
})

describe('SyncReportSchema and evaluateReport', () => {
  const report = {
    created: 2,
    updated: 3,
    adopted: 0,
    stale: 1,
    imagesPlaced: 5,
    failed: [],
    errors: [],
  }

  test('accepts a well-formed report', () => {
    expect(SyncReportSchema.safeParse(report).success).toBe(true)
  })

  test('rejects negative or non-integer counters', () => {
    expect(SyncReportSchema.safeParse({ ...report, created: -1 }).success).toBe(false)
    expect(SyncReportSchema.safeParse({ ...report, imagesPlaced: 1.5 }).success).toBe(false)
  })

  test('ok when every entry is touched and every image placed', () => {
    const outcome = evaluateReport(SyncReportSchema.parse(report), 5)
    expect(outcome.ok).toBe(true)
    expect(outcome.problems).toEqual([])
  })

  test('flags shortfalls', () => {
    const outcome = evaluateReport(SyncReportSchema.parse({ ...report, imagesPlaced: 4 }), 5)
    expect(outcome.ok).toBe(false)
    expect(outcome.problems).toContain('images_placed=4 expected=5')
  })

  test('flags plugin errors and failed images', () => {
    const outcome = evaluateReport(
      SyncReportSchema.parse({ ...report, failed: [{ key: 'a.png', reason: 'no_frame' }], errors: ['boom'] }),
      5,
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.problems).toContain('plugin_errors=1')
    expect(outcome.problems).toContain('failed_images=1')
  })
})
