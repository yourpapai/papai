// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const DEFAULT_SYNC_PORT = 7781
export const BOARD_MARGIN = 40
export const BOARD_GAP = 60
export const BOARD_TITLE_HEIGHT = 72
export const BOARD_CAPTION_HEIGHT = 20
export const BOARD_CAPTION_GAP = 8
export const BOARD_GROUP_GAP = 120

export interface ManifestEntry {
  readonly key: string
  readonly name: string
  readonly w: number
  readonly h: number
  readonly col: number
  readonly row: number
}

export interface ManifestGroup {
  readonly title: string
  readonly width: number
  readonly height: number
  readonly cellW: number
  readonly cellH: number
  readonly y: number
  readonly entries: readonly ManifestEntry[]
}

export interface ManifestArea {
  readonly name: string
  readonly pageName: string
  readonly cols: number
  readonly y: number
  readonly groups: readonly ManifestGroup[]
}

export interface SyncManifest {
  readonly version: 1
  readonly areas: readonly ManifestArea[]
}

export interface AreaFiles {
  readonly name: string
  readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[]
}

export interface EntryMeta {
  readonly group: string
  readonly name: string
  readonly w: number
  readonly h: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

export const pngDimensions = (bytes: Uint8Array): { readonly w: number; readonly h: number } => {
  if (bytes.length < 24) throw new Error('png_too_short')
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if ((bytes[index] ?? -1) !== PNG_SIGNATURE[index]) throw new Error('png_bad_signature')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(12) !== 0x49484452) throw new Error('png_missing_ihdr')
  return { w: view.getUint32(16), h: view.getUint32(20) }
}

const capitalize = (value: string): string => value.slice(0, 1).toUpperCase() + value.slice(1)

const groupFor = (mid: readonly string[], spec: string): string => {
  if (mid.length === 0) return spec
  if (mid.length === 1 && mid[0] === 'components') return 'Components'
  if (mid.length === 2 && mid[0] === 'sections' && mid[1] === 'admin') return 'Sections — admin zone'
  return mid.map(capitalize).join(' — ')
}

export const deriveEntryMeta = (area: string, relPath: string, bytes: Uint8Array): EntryMeta => {
  const parts = relPath.split('/')
  const file = parts[parts.length - 1] ?? ''
  if (!file.endsWith('-1.png')) throw new Error('not_a_baseline_png')
  const specDir = parts[parts.length - 2] ?? ''
  const spec = specDir.replace(/\.spec\.ts$/u, '')
  const base = file.slice(0, -'-1.png'.length)
  const mid = parts.slice(0, -2)
  const prefix = `${[area, ...mid, spec].join('-')}-`
  let story = base
  if (base.startsWith(prefix)) story = base.slice(prefix.length)
  else if (base.startsWith(`${spec}-`)) story = base.slice(spec.length + 1)
  story = story.replace(/^—-/u, '').replace(/-/gu, ' ').replace(/\s+/gu, ' ').trim()
  const size = pngDimensions(bytes)
  return {
    group: groupFor(mid, spec),
    name: `${spec} · ${story}`,
    w: Math.round(size.w / 2),
    h: Math.round(size.h / 2),
  }
}

export const boardColumns = (area: string): number => (area === 'admin' ? 3 : 4)

export const pageNameFor = (area: string): string => `${capitalize(area)} UI — stories`

export const buildSyncManifest = (areas: readonly AreaFiles[]): SyncManifest => {
  const built: ManifestArea[] = []
  for (const area of areas) {
    if (area.files.length === 0) throw new Error(`empty_area:${area.name}`)
    const sorted = [...area.files].sort((a, b) => a.path.localeCompare(b.path, 'en', { sensitivity: 'base' }))
    const groupOrder: string[] = []
    const byGroup = new Map<string, { readonly key: string; readonly meta: EntryMeta }[]>()
    for (const file of sorted) {
      const meta = deriveEntryMeta(area.name, file.path, file.bytes)
      if (!byGroup.has(meta.group)) {
        groupOrder.push(meta.group)
        byGroup.set(meta.group, [])
      }
      byGroup.get(meta.group)?.push({ key: file.path, meta })
    }
    const cols = boardColumns(area.name)
    let groupY = 0
    const groups: ManifestGroup[] = []
    for (const title of groupOrder) {
      const items = byGroup.get(title) ?? []
      const cellW = Math.max(...items.map((item) => item.meta.w))
      const cellH = BOARD_CAPTION_HEIGHT + BOARD_CAPTION_GAP + Math.max(...items.map((item) => item.meta.h))
      const rows = Math.ceil(items.length / cols)
      const entries = items.map((item, index) => ({
        key: item.key,
        name: item.meta.name,
        w: item.meta.w,
        h: item.meta.h,
        col: index % cols,
        row: Math.floor(index / cols),
      }))
      const groupYStart = groupY
      groups.push({
        title,
        width: BOARD_MARGIN * 2 + cols * cellW + (cols - 1) * BOARD_GAP,
        height: BOARD_TITLE_HEIGHT + rows * cellH + (rows - 1) * BOARD_GAP + BOARD_MARGIN,
        cellW,
        cellH,
        y: groupYStart,
        entries,
      })
      groupY += (groups[groups.length - 1]?.height ?? 0) + BOARD_GROUP_GAP
    }
    built.push({ name: area.name, pageName: pageNameFor(area.name), cols, y: 0, groups })
  }
  return { version: 1, areas: built }
}

export const countEntries = (manifest: SyncManifest): number =>
  manifest.areas.reduce(
    (sum, area) => sum + area.groups.reduce((groupSum, group) => groupSum + group.entries.length, 0),
    0,
  )

export const SyncReportSchema = z.object({
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  adopted: z.number().int().min(0),
  stale: z.number().int().min(0),
  imagesPlaced: z.number().int().min(0),
  failed: z.array(z.object({ key: z.string().min(1), reason: z.string().min(1) })),
  errors: z.array(z.string().min(1)),
})

export type SyncReport = z.infer<typeof SyncReportSchema>

export const evaluateReport = (
  report: SyncReport,
  expectedEntries: number,
): { readonly ok: boolean; readonly problems: readonly string[] } => {
  const problems: string[] = []
  if (report.errors.length > 0) problems.push(`plugin_errors=${report.errors.length}`)
  if (report.failed.length > 0) problems.push(`failed_images=${report.failed.length}`)
  if (report.imagesPlaced !== expectedEntries) {
    problems.push(`images_placed=${report.imagesPlaced} expected=${expectedEntries}`)
  }
  const touched = report.created + report.updated + report.adopted
  if (touched !== expectedEntries) problems.push(`frames_touched=${touched} expected=${expectedEntries}`)
  return { ok: problems.length === 0, problems }
}
