// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * DI'd orchestration for the kiss→nerv/papai project importer. Takes async "ports" so this
 * module is fully unit-testable against in-memory fakes — no real Mongo connection needed.
 * `tools/import-kiss-projects.ts` wires these ports to real `mongodb` collections + papai's
 * guardrails store.
 */

import pLimit from 'p-limit'

import type { KissProjectDoc, NervProjectDoc } from './import-kiss-projects-mapping.js'
import { kissProjectLabel, mapKissProjectToNervProject } from './import-kiss-projects-mapping.js'

/** Bounded concurrency for per-project Mongo lookups/upserts (kiss project lists are small, but never unbounded). */
const IMPORT_CONCURRENCY = 4

export interface RunImportOptions {
  apply: boolean
  platformInstanceId: string
  gitlabBaseUrl: string
}

export interface RunImportPorts {
  /** Returns a non-null marker if a nerv project already has a repo at this path. */
  nervFindByRepoPath(projectPath: string): Promise<{ notifyContextId?: string } | null>
  /** Upserts a nerv Project doc, identified by one of its repo paths. Must not touch notifyContextId. */
  nervUpsert(projectPath: string, doc: NervProjectDoc): Promise<void>
  guardrailsHas(platformInstanceId: string): boolean
  guardrailsSetDefault(platformInstanceId: string): void
}

export interface ImportedProjectReport {
  label: string
  primaryProjectPath: string
  warnings: string[]
  action: 'would-create' | 'would-update' | 'created' | 'updated' | 'skipped-no-repos' | 'skipped-duplicate-path'
}

export interface RunImportReport {
  projects: ImportedProjectReport[]
  guardrailsAction: 'would-set-default' | 'set-default' | 'left-existing' | 'no-op-dry-run-existing'
  /** One `/nerv bind <projectPath>` line per successfully-mapped project, for the operator to run. */
  bindCommands: string[]
}

interface MappedProject {
  label: string
  doc: NervProjectDoc
  warnings: string[]
  primaryProjectPath: string
}

function mapAll(kissProjects: KissProjectDoc[], opts: RunImportOptions): MappedProject[] {
  return kissProjects.map((kissDoc) => {
    const label = kissProjectLabel(kissDoc)
    const { doc, warnings } = mapKissProjectToNervProject(kissDoc, { gitlabBaseUrl: opts.gitlabBaseUrl })
    return { label, doc, warnings, primaryProjectPath: doc.repositories[0]?.projectPath ?? '' }
  })
}

interface ProcessedProject {
  report: ImportedProjectReport
  bindCommand: string
}

async function processProject(
  mp: MappedProject,
  ports: RunImportPorts,
  opts: RunImportOptions,
): Promise<ProcessedProject> {
  const { label, doc, warnings, primaryProjectPath } = mp
  const existing = await ports.nervFindByRepoPath(primaryProjectPath)
  const action: ImportedProjectReport['action'] = opts.apply
    ? existing === null
      ? 'created'
      : 'updated'
    : existing === null
      ? 'would-create'
      : 'would-update'
  if (opts.apply) await ports.nervUpsert(primaryProjectPath, doc)
  return {
    report: { label, primaryProjectPath, warnings, action },
    bindCommand: `/nerv bind ${primaryProjectPath}`,
  }
}

interface ImportPlanEntry {
  index: number
  mp: MappedProject
}

interface ImportPlan {
  /** Final report entries for projects resolved synchronously (no repos, or a duplicate path). */
  resolved: Map<number, ImportedProjectReport>
  /** Projects that need the async find/upsert path, one per distinct primary `projectPath`. */
  toProcess: ImportPlanEntry[]
}

/**
 * Dedupes mapped kiss projects by primary `projectPath` before any Mongo I/O happens. kiss allows
 * the same repo to appear as the primary repository of more than one Project; running the real,
 * non-atomic find-then-write `nervUpsert` concurrently on the same path would otherwise race and
 * create two nerv Projects for one repo. Duplicates are reported, not silently dropped.
 */
function planImport(mapped: MappedProject[]): ImportPlan {
  const seenPaths = new Set<string>()
  const resolved = new Map<number, ImportedProjectReport>()
  const toProcess: ImportPlanEntry[] = []

  mapped.forEach((mp, index) => {
    if (mp.primaryProjectPath === '') {
      resolved.set(index, {
        label: mp.label,
        primaryProjectPath: '',
        warnings: mp.warnings,
        action: 'skipped-no-repos',
      })
      return
    }
    if (seenPaths.has(mp.primaryProjectPath)) {
      resolved.set(index, {
        label: mp.label,
        primaryProjectPath: mp.primaryProjectPath,
        warnings: [
          ...mp.warnings,
          `duplicate projectPath "${mp.primaryProjectPath}" across kiss projects — importing once`,
        ],
        action: 'skipped-duplicate-path',
      })
      return
    }
    seenPaths.add(mp.primaryProjectPath)
    toProcess.push({ index, mp })
  })

  return { resolved, toProcess }
}

function resolveGuardrailsAction(ports: RunImportPorts, opts: RunImportOptions): RunImportReport['guardrailsAction'] {
  const hasGuardrails = ports.guardrailsHas(opts.platformInstanceId)
  if (hasGuardrails) return opts.apply ? 'left-existing' : 'no-op-dry-run-existing'
  if (opts.apply) ports.guardrailsSetDefault(opts.platformInstanceId)
  return opts.apply ? 'set-default' : 'would-set-default'
}

/**
 * Imports kiss Project docs into nerv + a default papai `coding_guardrails`. Idempotent under
 * `apply: true` — a project already present in nerv (matched by its primary repo's projectPath)
 * is updated, not duplicated; an existing `coding_guardrails` is never overwritten.
 */
export async function runImport(
  kissProjects: KissProjectDoc[],
  ports: RunImportPorts,
  opts: RunImportOptions,
): Promise<RunImportReport> {
  const { resolved, toProcess } = planImport(mapAll(kissProjects, opts))

  const limiter = pLimit(IMPORT_CONCURRENCY)
  const processed = await Promise.all(
    toProcess.map(({ index, mp }) => limiter(async () => ({ index, ...(await processProject(mp, ports, opts)) }))),
  )
  for (const p of processed) resolved.set(p.index, p.report)

  const projects = kissProjects
    .map((_, index) => resolved.get(index))
    .filter((r): r is ImportedProjectReport => r !== undefined)
  const bindCommands = processed.map((p) => p.bindCommand)

  const guardrailsAction = resolveGuardrailsAction(ports, opts)

  return { projects, guardrailsAction, bindCommands }
}
