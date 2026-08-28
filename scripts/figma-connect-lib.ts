// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
