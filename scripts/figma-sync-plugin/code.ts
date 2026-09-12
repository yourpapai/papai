// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isRecord, parseManifest, stringField } from './manifest.js'
import type { PArea, PEntry, PGroup, PManifest } from './manifest.js'

interface HostFontName {
  readonly family: string
  readonly style: string
}

interface HostNode {
  readonly id: string
  readonly type: string
  name: string
  x: number
  y: number
  width: number
  height: number
  readonly children?: readonly HostNode[]
  getPluginData(key: string): string
  setPluginData(key: string, value: string): void
  resize?(width: number, height: number): void
  fills?: Array<Record<string, unknown>>
  clipsContent?: boolean
  cornerRadius?: number
  appendChild?(node: HostNode): void
  characters?: string
  fontName?: HostFontName
  fontSize?: number
}

interface HostPage {
  readonly id: string
  name: string
  readonly children: readonly HostNode[]
}

interface HostImage {
  readonly hash: string
}

declare const figma: {
  readonly root: { readonly children: readonly HostPage[] }
  createPage(): HostPage
  setCurrentPageAsync(page: HostPage): Promise<void>
  createFrame(): HostNode
  createText(): HostNode
  loadFontAsync(font: HostFontName): Promise<void>
  createImage(bytes: Uint8Array): HostImage
  showUI(html: string, options?: { readonly width?: number; readonly height?: number }): void
  closePlugin(message?: string): void
  readonly ui: { postMessage(message: unknown): void; onmessage: ((event: { readonly data: unknown }) => void) | null }
}

const PLUGIN_DATA_KEY = 'papaiFigmaSyncKey'
const MARGIN = 40
const GAP = 60
const TITLE_HEIGHT = 72
const CAPTION_HEIGHT = 20
const CAPTION_GAP = 8

interface SyncReportState {
  created: number
  updated: number
  adopted: number
  stale: number
  imagesPlaced: number
  failed: Array<{ readonly key: string; readonly reason: string }>
  errors: string[]
}

const report: SyncReportState = {
  created: 0,
  updated: 0,
  adopted: 0,
  stale: 0,
  imagesPlaced: 0,
  failed: [],
  errors: [],
}

const frameByKey = new Map<string, HostNode>()
let started = false
let imagesDone = 0
let imagesTotal = 0

const grayPaint = (): Array<Record<string, unknown>> => [{ type: 'SOLID', color: { r: 0.45, g: 0.45, b: 0.45 } }]

const ensureGroupFrame = (page: HostPage, group: PGroup): HostNode => {
  const existing = page.children.find((node) => node.type === 'FRAME' && node.name === group.title)
  const groupFrame = existing ?? figma.createFrame()
  if (existing === undefined) {
    groupFrame.name = group.title
    groupFrame.fills = []
    groupFrame.clipsContent = false
    groupFrame.cornerRadius = 0
  }
  groupFrame.x = 0
  groupFrame.y = group.y
  groupFrame.resize?.(group.width, group.height)
  return groupFrame
}

const collectFrames = (groupFrame: HostNode): { keyed: Map<string, HostNode>; unkeyed: HostNode[] } => {
  const keyed = new Map<string, HostNode>()
  const unkeyed: HostNode[] = []
  for (const child of groupFrame.children ?? []) {
    if (child.type !== 'FRAME') continue
    const stored = child.getPluginData(PLUGIN_DATA_KEY)
    if (stored.length > 0) keyed.set(stored, child)
    else unkeyed.push(child)
  }
  return { keyed, unkeyed }
}

const makeCaption = (groupFrame: HostNode, entry: PEntry, x: number, y: number): void => {
  const caption = figma.createText()
  caption.name = `caption · ${entry.name}`
  caption.fontName = { family: 'Inter', style: 'Regular' }
  caption.fontSize = 11
  caption.characters = entry.name
  caption.fills = grayPaint()
  groupFrame.appendChild?.(caption)
  caption.x = x
  caption.y = y
}

const syncEntry = (
  groupFrame: HostNode,
  group: PGroup,
  entry: PEntry,
  keyed: Map<string, HostNode>,
  unkeyed: HostNode[],
): 'created' | 'adopted' | 'updated' => {
  const cellX = MARGIN + entry.col * (group.cellW + GAP)
  const cellY = TITLE_HEIGHT + entry.row * (group.cellH + GAP)
  let frame: HostNode | undefined = keyed.get(entry.key)
  let disposition: 'created' | 'adopted' | 'updated' = 'updated'
  if (frame === undefined) {
    const suffix = ` · ${entry.name}`
    frame = unkeyed.find((node) => node.name === entry.name || node.name.endsWith(suffix))
    if (frame === undefined) {
      frame = figma.createFrame()
      frame.name = entry.name
      frame.fills = []
      frame.cornerRadius = 4
      frame.clipsContent = false
      groupFrame.appendChild?.(frame)
      makeCaption(groupFrame, entry, cellX, cellY)
      disposition = 'created'
    } else {
      disposition = 'adopted'
    }
    frame.setPluginData(PLUGIN_DATA_KEY, entry.key)
  }
  frame.x = cellX
  frame.y = cellY + CAPTION_HEIGHT + CAPTION_GAP
  if (frame.width !== entry.w || frame.height !== entry.h) frame.resize?.(entry.w, entry.h)
  frameByKey.set(entry.key, frame)
  return disposition
}

const syncGroup = (page: HostPage, group: PGroup): void => {
  const groupFrame = ensureGroupFrame(page, group)
  const { keyed, unkeyed } = collectFrames(groupFrame)
  const manifestKeys = new Set(group.entries.map((entry) => entry.key))
  for (const key of keyed.keys()) {
    if (!manifestKeys.has(key)) report.stale += 1
  }
  for (const entry of group.entries) {
    const disposition = syncEntry(groupFrame, group, entry, keyed, unkeyed)
    if (disposition === 'created') report.created += 1
    else if (disposition === 'adopted') report.adopted += 1
    else report.updated += 1
  }
}

const syncArea = async (area: PArea): Promise<void> => {
  const existingPage = figma.root.children.find((page) => page.name === area.pageName)
  const page = existingPage ?? figma.createPage()
  if (existingPage === undefined) page.name = area.pageName
  await figma.setCurrentPageAsync(page)
  for (const group of area.groups) syncGroup(page, group)
}

const runManifest = async (manifest: PManifest): Promise<void> => {
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' }),
  ])
  await manifest.areas.reduce<Promise<void>>(
    (chain: Promise<void>, area: PArea): Promise<void> => chain.then(() => syncArea(area)),
    Promise.resolve(),
  )
  const keys = [...frameByKey.keys()]
  imagesTotal = keys.length
  if (keys.length === 0) {
    figma.ui.postMessage({ type: 'finish', report })
    return
  }
  figma.ui.postMessage({ type: 'plan', keys })
}

const placeImage = (key: string, bytes: Uint8Array): void => {
  const frame = frameByKey.get(key)
  if (frame === undefined) {
    report.failed.push({ key, reason: 'no_frame' })
    return
  }
  const image = figma.createImage(bytes)
  frame.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }]
  report.imagesPlaced += 1
}

const sendFinish = (): void => {
  figma.ui.postMessage({ type: 'finish', report })
}

const uiHtml: unknown = Reflect.get(globalThis, '__html__')
if (typeof uiHtml !== 'string') throw new Error('missing_html_global')
figma.showUI(uiHtml, { width: 420, height: 260 })

figma.ui.onmessage = (event: { readonly data: unknown }): void => {
  const message = event.data
  if (!isRecord(message)) return
  const type = stringField(message, 'type')
  if (type === 'manifest' && !started) {
    started = true
    const manifest = parseManifest(message['manifest'])
    if (manifest === null) {
      report.errors.push('invalid_manifest')
      sendFinish()
      return
    }
    runManifest(manifest).then(
      () => undefined,
      (error: unknown) => {
        report.errors.push(error instanceof Error ? error.message : String(error))
        sendFinish()
      },
    )
    return
  }
  if (type === 'image') {
    const key = stringField(message, 'key')
    if (key === null) return
    imagesDone += 1
    if (message['ok'] === true && message['buffer'] instanceof ArrayBuffer) {
      placeImage(key, new Uint8Array(message['buffer']))
    } else {
      report.failed.push({ key, reason: stringField(message, 'error') ?? 'fetch_failed' })
    }
    figma.ui.postMessage({ type: 'progress', done: imagesDone, total: imagesTotal })
    if (imagesDone >= imagesTotal) sendFinish()
    return
  }
  if (type === 'reportSent') {
    figma.closePlugin('papai figma sync complete')
  }
}
