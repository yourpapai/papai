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
  action: 'would-create' | 'would-update' | 'created' | 'updated' | 'skipped-no-repos'
}

export interface RunImportReport {
  projects: ImportedProjectReport[]
  guardrailsAction: 'would-set-default' | 'set-default' | 'left-existing' | 'no-op-dry-run-existing'
  /** One `/nerv bind <projectPath>` line per successfully-mapped project, for the operator to run. */
  bindCommands: string[]
}

interface ProcessedProject {
  report: ImportedProjectReport
  bindCommand: string | null
}

async function processProject(
  kissDoc: KissProjectDoc,
  ports: RunImportPorts,
  opts: RunImportOptions,
): Promise<ProcessedProject> {
  const label = kissProjectLabel(kissDoc)
  const { doc, warnings } = mapKissProjectToNervProject(kissDoc, { gitlabBaseUrl: opts.gitlabBaseUrl })
  if (doc.repositories.length === 0) {
    return { report: { label, primaryProjectPath: '', warnings, action: 'skipped-no-repos' }, bindCommand: null }
  }
  const primaryProjectPath = doc.repositories[0]!.projectPath
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
  const limiter = pLimit(IMPORT_CONCURRENCY)
  const processed = await Promise.all(
    kissProjects.map((kissDoc) => limiter(() => processProject(kissDoc, ports, opts))),
  )

  const projects = processed.map((p) => p.report)
  const bindCommands = processed.flatMap((p) => (p.bindCommand === null ? [] : [p.bindCommand]))

  const hasGuardrails = ports.guardrailsHas(opts.platformInstanceId)
  let guardrailsAction: RunImportReport['guardrailsAction']
  if (hasGuardrails) {
    guardrailsAction = opts.apply ? 'left-existing' : 'no-op-dry-run-existing'
  } else {
    guardrailsAction = opts.apply ? 'set-default' : 'would-set-default'
    if (opts.apply) ports.guardrailsSetDefault(opts.platformInstanceId)
  }

  return { projects, guardrailsAction, bindCommands }
}
