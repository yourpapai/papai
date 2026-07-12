#!/usr/bin/env bun
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Standalone kiss→nerv/papai config importer.
 *
 * Usage:
 *   KISS_MONGO_URI=... NERV_MONGO_URI=... KISS_GITLAB_BASE_URL=... PAPAI_PLATFORM_INSTANCE_ID=... \
 *     bun run tools/import-kiss-projects.ts [--apply]
 *
 * Default is --dry-run (no writes): prints the full nerv Project docs + guardrails decision it
 * would write, and the `/nerv bind` commands the operator will need afterward. Pass --apply to
 * perform the writes. Mongo I/O here is intentionally thin and NOT unit-tested — the pure mapping
 * (tools/import-kiss-projects-mapping.ts) and orchestration (tools/import-kiss-projects-run.ts)
 * modules carry the test coverage; verify this file by running --dry-run against a real staging
 * KISS_MONGO_URI/NERV_MONGO_URI pair and reviewing the printed manifest before ever passing
 * --apply (see docs/deployment/kiss-to-papai-shadow-migration.md).
 */

import { MongoClient, type Document, type WithId } from 'mongodb'

import { guardrailsSchema, hasCodingGuardrails, setCodingGuardrails } from '../src/coding-credentials/guardrails.js'
import type { KissProjectDoc, NervProjectDoc } from './import-kiss-projects-mapping.js'
import { toKissProjectDoc } from './import-kiss-projects-mapping.js'
import type { RunImportPorts } from './import-kiss-projects-run.js'
import { runImport } from './import-kiss-projects-run.js'

function parseArgs(argv: readonly string[]): { apply: boolean } {
  const args = argv.slice(2)
  return { apply: args.includes('--apply') }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return value
}

/**
 * Cross-process backstop for the in-run dedupe in `runImport` (`tools/import-kiss-projects-run.ts`):
 * even with intra-run duplicates eliminated, a unique index is the only thing that prevents two
 * *separate* importer runs (or an importer run racing hand-authored nerv config) from creating two
 * Project docs for the same repo. Only created under --apply — index creation is a schema write,
 * and --dry-run must make no writes at all.
 */
async function ensureNervProjectPathIndex(nervCol: import('mongodb').Collection<Document>): Promise<void> {
  await nervCol.createIndex({ 'repositories.projectPath': 1 }, { unique: true, sparse: true })
}

function makeNervPorts(
  nervCol: import('mongodb').Collection<Document>,
): Pick<RunImportPorts, 'nervFindByRepoPath' | 'nervUpsert'> {
  return {
    async nervFindByRepoPath(projectPath: string): Promise<{ notifyContextId?: string } | null> {
      const existing = await nervCol.findOne({ 'repositories.projectPath': projectPath })
      if (existing === null) return null
      const notifyContextId = typeof existing['notifyContextId'] === 'string' ? existing['notifyContextId'] : undefined
      return { ...(notifyContextId === undefined ? {} : { notifyContextId }) }
    },
    // Single atomic upsert (no find-then-write) so concurrent calls for distinct projectPaths can't
    // race into a duplicate-insert TOCTOU window. $set never includes notifyContextId (not part of
    // NervProjectDoc) so an existing channel binding survives re-imports; createdAt only applies on
    // insert via $setOnInsert.
    async nervUpsert(projectPath: string, doc: NervProjectDoc): Promise<void> {
      const now = new Date()
      await nervCol.updateOne(
        { 'repositories.projectPath': projectPath },
        { $set: { ...doc, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true },
      )
    },
  }
}

function makeGuardrailsPorts(): Pick<RunImportPorts, 'guardrailsHas' | 'guardrailsSetDefault'> {
  return {
    guardrailsHas: (platformInstanceId: string): boolean => hasCodingGuardrails(platformInstanceId),
    guardrailsSetDefault: (platformInstanceId: string): void => {
      setCodingGuardrails(platformInstanceId, guardrailsSchema.parse({}))
    },
  }
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv)
  const kissUri = requiredEnv('KISS_MONGO_URI')
  const nervUri = requiredEnv('NERV_MONGO_URI')
  const gitlabBaseUrl = requiredEnv('KISS_GITLAB_BASE_URL')
  const platformInstanceId = requiredEnv('PAPAI_PLATFORM_INSTANCE_ID')

  console.log(apply ? 'Running in APPLY mode (writes will be made).' : 'Running in DRY-RUN mode (no writes).')

  const kissClient = new MongoClient(kissUri)
  const nervClient = new MongoClient(nervUri)
  await kissClient.connect()
  await nervClient.connect()
  try {
    const rawKissDocs: WithId<Document>[] = await kissClient.db().collection('projects').find().toArray()
    const kissProjects: KissProjectDoc[] = rawKissDocs.map((raw) => toKissProjectDoc(raw))
    const nervCol = nervClient.db().collection('projects')
    if (apply) await ensureNervProjectPathIndex(nervCol)

    const ports: RunImportPorts = { ...makeNervPorts(nervCol), ...makeGuardrailsPorts() }
    const report = await runImport(kissProjects, ports, { apply, platformInstanceId, gitlabBaseUrl })

    console.log(`\n${report.projects.length} kiss project(s) processed:\n`)
    for (const p of report.projects) {
      console.log(`  [${p.action}] ${p.label} (${p.primaryProjectPath || 'no repos'})`)
      for (const w of p.warnings) console.log(`    ! ${w}`)
    }
    console.log(`\nGuardrails: ${report.guardrailsAction}`)
    console.log('\nAfter this run, bind each project to its chat channel by running (in that channel):\n')
    for (const cmd of report.bindCommands) console.log(`  ${cmd}`)
  } finally {
    await kissClient.close()
    await nervClient.close()
  }
}

await main()
