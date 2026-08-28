// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { z } from 'zod'

export const BASE_KIT_COMPONENTS = [
  'ui/Btn',
  'ui/Input',
  'ui/Field',
  'ui/PageHeader',
  'ui/SidebarLink',
  'ui/TopBar',
] as const

export const FigmaNodeSchema = z.string().regex(/^\d+:\d+$/u, 'expected "<node>:<id>" figma node id')

export const ComponentEntrySchema = z.object({
  name: z.string().min(1),
  figmaNode: FigmaNodeSchema,
  source: z.string().min(1),
  props: z.record(z.string().min(1), z.string().min(1)),
  values: z.record(z.string().min(1), z.string().min(1)),
})

export const ScreenEntrySchema = z.object({
  name: z.string().min(1),
  figmaNode: FigmaNodeSchema,
  source: z.string().min(1),
})

export const SectionEntrySchema = z.object({
  screen: z.string().min(1),
  section: z.string().min(1),
  figmaNode: FigmaNodeSchema,
  source: z.string().min(1),
})

export const RegistrySchema = z.object({
  version: z.literal(1),
  components: z.array(ComponentEntrySchema).min(1),
  screens: z.array(ScreenEntrySchema),
  sections: z.array(SectionEntrySchema),
})

export type ComponentEntry = z.infer<typeof ComponentEntrySchema>
export type ScreenEntry = z.infer<typeof ScreenEntrySchema>
export type SectionEntry = z.infer<typeof SectionEntrySchema>
export type Registry = z.infer<typeof RegistrySchema>

export interface RegistryProblem {
  readonly entry: string
  readonly message: string
}

export const DEFAULT_REGISTRY_PATH = fileURLToPath(new URL('./figma/registry.json', import.meta.url))

export const parseRegistryText = (text: string): Registry => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`registry_parse_failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
  const result = RegistrySchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`registry_schema_invalid: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`)
  }
  return result.data
}

const missingSource = (entry: string, source: string): RegistryProblem => ({
  entry,
  message: `registry_source_missing: ${entry} → ${source}`,
})

const dictionary = (entry: ComponentEntry | ScreenEntry | SectionEntry): Record<string, string> =>
  'props' in entry ? entry.props : {}

export const canonicalDescription = (entry: ComponentEntry | ScreenEntry | SectionEntry): string => {
  const parts = [`CODE: ${entry.source}`]
  const props = Object.entries(dictionary(entry))
  if (props.length > 0) parts.push(`props: ${props.map(([figma, code]) => `${figma}→${code}`).join(', ')}`)
  if ('values' in entry) {
    const values = Object.entries(entry.values)
    if (values.length > 0) parts.push(`values: ${values.map(([figma, code]) => `${figma}→${code}`).join(', ')}`)
  }
  if ('section' in entry) parts.push(`section: ${entry.section}`)
  return parts.join(' | ')
}

export const checkRegistry = (
  registry: Registry,
  sourceExists: (path: string) => boolean = (path) => existsSync(path),
): readonly RegistryProblem[] => {
  const problems: RegistryProblem[] = []
  for (const entry of registry.components) {
    if (!sourceExists(entry.source)) problems.push(missingSource(entry.name, entry.source))
  }
  for (const entry of registry.screens) {
    if (!sourceExists(entry.source)) problems.push(missingSource(entry.name, entry.source))
  }
  const screenNames = new Set(registry.screens.map((screen) => screen.name))
  for (const entry of registry.sections) {
    if (!sourceExists(entry.source)) problems.push(missingSource(`${entry.screen} · ${entry.section}`, entry.source))
    if (!screenNames.has(entry.screen)) {
      problems.push({ entry: entry.section, message: `registry_unknown_screen: ${entry.screen}` })
    }
  }
  for (const name of BASE_KIT_COMPONENTS) {
    if (!registry.components.some((entry) => entry.name === name)) {
      problems.push({ entry: name, message: `registry_base_kit_missing: ${name}` })
    }
  }
  return problems
}

export interface LoadRegistryDeps {
  readonly path?: string
  readonly read?: (path: string) => string
  readonly exists?: (path: string) => boolean
}

export const loadRegistry = (deps: LoadRegistryDeps = {}): Registry => {
  const path = deps.path ?? DEFAULT_REGISTRY_PATH
  const read = deps.read ?? ((target: string): string => readFileSync(target, 'utf8'))
  const exists = deps.exists ?? ((target: string): boolean => existsSync(target))
  const registry = parseRegistryText(read(path))
  const problems = checkRegistry(registry, exists)
  if (problems.length > 0) {
    throw new Error(problems.map((problem) => problem.message).join('; '))
  }
  return registry
}

export interface DescriptionPayload {
  readonly name: string
  readonly figmaNode: string
  readonly description: string
}

export const planPayloads = (registry: Registry): readonly DescriptionPayload[] => [
  ...registry.components.map((entry) => ({
    name: entry.name,
    figmaNode: entry.figmaNode,
    description: canonicalDescription(entry),
  })),
  ...registry.screens.map((entry) => ({
    name: entry.name,
    figmaNode: entry.figmaNode,
    description: canonicalDescription(entry),
  })),
  ...registry.sections.map((entry) => ({
    name: entry.section,
    figmaNode: entry.figmaNode,
    description: canonicalDescription(entry),
  })),
]

export const DEFAULT_COMPARE_THRESHOLD = 0.1

export interface CompareOptions {
  readonly storyPng?: Uint8Array
  readonly figmaPng?: Uint8Array
  readonly threshold?: number
  readonly artifactPath: string
}

export interface CompareOutcome {
  readonly status: 'pass' | 'fail' | 'skip'
  readonly threshold: number
  readonly diffPixels?: number
  readonly totalPixels?: number
  readonly ratio?: number
  readonly artifactPath?: string
  readonly missingSide?: 'story' | 'figma'
  readonly reason?: string
}

const decode = (bytes: Uint8Array): { readonly data: Uint8Array; readonly width: number; readonly height: number } => {
  const png = PNG.sync.read(Buffer.from(bytes))
  return { data: new Uint8Array(png.data), width: png.width, height: png.height }
}

const resample = (src: Uint8Array, sw: number, sh: number, tw: number, th: number): Uint8Array => {
  const out = new Uint8Array(tw * th * 4)
  for (let ty = 0; ty < th; ty += 1) {
    const gy = th === 1 ? 0 : (ty * (sh - 1)) / (th - 1)
    const y0 = Math.floor(gy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = gy - y0
    for (let tx = 0; tx < tw; tx += 1) {
      const gx = tw === 1 ? 0 : (tx * (sw - 1)) / (tw - 1)
      const x0 = Math.floor(gx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = gx - x0
      for (let channel = 0; channel < 4; channel += 1) {
        const p00 = src[(y0 * sw + x0) * 4 + channel] ?? 0
        const p10 = src[(y0 * sw + x1) * 4 + channel] ?? 0
        const p01 = src[(y1 * sw + x0) * 4 + channel] ?? 0
        const p11 = src[(y1 * sw + x1) * 4 + channel] ?? 0
        out[(ty * tw + tx) * 4 + channel] = Math.round(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy,
        )
      }
    }
  }
  return out
}

const skipOutcome = (missingSide: 'story' | 'figma', threshold: number): CompareOutcome => ({
  status: 'skip',
  threshold,
  missingSide,
  reason: `missing_${missingSide}_render`,
})

export const compareRenders = (options: CompareOptions): CompareOutcome => {
  const threshold = options.threshold ?? DEFAULT_COMPARE_THRESHOLD
  if (options.storyPng === undefined) return skipOutcome('story', threshold)
  if (options.figmaPng === undefined) return skipOutcome('figma', threshold)

  const story = decode(options.storyPng)
  const figma = decode(options.figmaPng)
  const width = Math.min(story.width, figma.width)
  const height = Math.min(story.height, figma.height)
  const storyData =
    story.width === width && story.height === height
      ? story.data
      : resample(story.data, story.width, story.height, width, height)
  const figmaData =
    figma.width === width && figma.height === height
      ? figma.data
      : resample(figma.data, figma.width, figma.height, width, height)

  const diff = new Uint8Array(width * height * 4)
  const diffPixels = pixelmatch(storyData, figmaData, diff, width, height)
  const totalPixels = width * height
  const ratio = diffPixels / totalPixels
  if (ratio <= threshold) {
    return { status: 'pass', threshold, diffPixels, totalPixels, ratio }
  }
  const diffPng = new PNG({ width, height })
  diffPng.data = Buffer.from(diff)
  writeFileSync(options.artifactPath, PNG.sync.write(diffPng))
  return { status: 'fail', threshold, diffPixels, totalPixels, ratio, artifactPath: options.artifactPath }
}
