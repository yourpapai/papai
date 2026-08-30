// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface PEntry {
  readonly key: string
  readonly name: string
  readonly w: number
  readonly h: number
  readonly col: number
  readonly row: number
}

export interface PGroup {
  readonly title: string
  readonly width: number
  readonly height: number
  readonly cellW: number
  readonly cellH: number
  readonly y: number
  readonly entries: readonly PEntry[]
}

export interface PArea {
  readonly name: string
  readonly pageName: string
  readonly cols: number
  readonly groups: readonly PGroup[]
}

export interface PManifest {
  readonly version: number
  readonly areas: readonly PArea[]
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const numberField = (source: Record<string, unknown>, key: string): number | null => {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export const stringField = (source: Record<string, unknown>, key: string): string | null => {
  const value = source[key]
  return typeof value === 'string' ? value : null
}

const parseEntry = (value: unknown): PEntry | null => {
  if (!isRecord(value)) return null
  const key = stringField(value, 'key')
  const name = stringField(value, 'name')
  const w = numberField(value, 'w')
  const h = numberField(value, 'h')
  const col = numberField(value, 'col')
  const row = numberField(value, 'row')
  if (key === null || name === null || w === null || h === null || col === null || row === null) return null
  return { key, name, w, h, col, row }
}

const parseGroup = (value: unknown): PGroup | null => {
  if (!isRecord(value)) return null
  const title = stringField(value, 'title')
  const width = numberField(value, 'width')
  const height = numberField(value, 'height')
  const cellW = numberField(value, 'cellW')
  const cellH = numberField(value, 'cellH')
  const y = numberField(value, 'y')
  const rawEntries = value['entries']
  if (
    title === null ||
    width === null ||
    height === null ||
    cellW === null ||
    cellH === null ||
    y === null ||
    !Array.isArray(rawEntries)
  ) {
    return null
  }
  const entries: PEntry[] = []
  for (const raw of rawEntries) {
    const entry = parseEntry(raw)
    if (entry === null) return null
    entries.push(entry)
  }
  return { title, width, height, cellW, cellH, y, entries }
}

const parseArea = (value: unknown): PArea | null => {
  if (!isRecord(value)) return null
  const name = stringField(value, 'name')
  const pageName = stringField(value, 'pageName')
  const cols = numberField(value, 'cols')
  const rawGroups = value['groups']
  if (name === null || pageName === null || cols === null || !Array.isArray(rawGroups)) return null
  const groups: PGroup[] = []
  for (const raw of rawGroups) {
    const group = parseGroup(raw)
    if (group === null) return null
    groups.push(group)
  }
  return { name, pageName, cols, groups }
}

export const parseManifest = (value: unknown): PManifest | null => {
  if (!isRecord(value)) return null
  const version = numberField(value, 'version')
  const rawAreas = value['areas']
  if (version !== 1 || !Array.isArray(rawAreas)) return null
  const areas: PArea[] = []
  for (const raw of rawAreas) {
    const area = parseArea(raw)
    if (area === null) return null
    areas.push(area)
  }
  return { version: 1, areas }
}
