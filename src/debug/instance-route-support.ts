// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { configFingerprint, errorMessage } from '../chat/router-helpers.js'
import type { ChatRouter } from '../chat/router.js'
import { listPlatformInstances, listPlatformInstancesSafe } from '../instances/platform-store.js'
import type { InstanceDecodeFailure, InstanceDecodeResult, PlatformInstance } from '../instances/types.js'
import { getRuntimeChatRouter } from './chat-router-runtime.js'
import { jsonResponse } from './json-response.js'

export type InstanceApiDeps = {
  readonly getRuntimeChatRouter: () => ChatRouter | null
  readonly listPlatformInstances: () => PlatformInstance[]
  readonly listPlatformInstancesSafe?: () => InstanceDecodeResult<PlatformInstance>
}

const INSTANCE_APPLY_CONCURRENCY = 4
const instanceApplyLock = pLimit(1)

type ApplyFailureAction = 'remove' | 'recreate' | 'start'

type ApplyFailure = Readonly<{
  id: string
  action: ApplyFailureAction
  error: string
}>

type RemovedDetail = Readonly<{
  id: string
  desiredStatus: 'pending' | 'stopped' | null
}>

type ApplyResultPatch = Readonly<{
  started?: readonly string[]
  stopped?: readonly string[]
  removed?: readonly string[]
  removedDetails?: readonly RemovedDetail[]
  recreated?: readonly string[]
  unchanged?: readonly string[]
  failed?: readonly ApplyFailure[]
}>

export type ApplyInstancesResult = Readonly<{
  applied: number
  started: readonly string[]
  stopped: readonly string[]
  removed: readonly string[]
  removedDetails: readonly RemovedDetail[]
  recreated: readonly string[]
  unchanged: readonly string[]
  failed: readonly ApplyFailure[]
  unreadable: readonly InstanceDecodeFailure[]
}>

const listDesiredPlatformInstances = (deps: InstanceApiDeps): InstanceDecodeResult<PlatformInstance> => {
  if (deps.listPlatformInstancesSafe !== undefined) return deps.listPlatformInstancesSafe()
  return { instances: deps.listPlatformInstances(), failures: [] }
}

const failedPatch = (id: string, action: ApplyFailureAction, error: unknown): ApplyResultPatch => ({
  failed: [{ id, action, error: errorMessage(error) }],
})

const notActiveAfterStartError = (id: string): Error => new Error(`chat instance did not become active: ${id}`)

const mergeApplyResult = (applied: number, patches: readonly ApplyResultPatch[]): ApplyInstancesResult => ({
  applied,
  started: patches.flatMap((patch) => patch.started ?? []),
  stopped: patches.flatMap((patch) => patch.stopped ?? []),
  removed: patches.flatMap((patch) => patch.removed ?? []),
  removedDetails: patches.flatMap((patch) => patch.removedDetails ?? []),
  recreated: patches.flatMap((patch) => patch.recreated ?? []),
  unchanged: patches.flatMap((patch) => patch.unchanged ?? []),
  failed: patches.flatMap((patch) => patch.failed ?? []),
  unreadable: [],
})

const removeRuntimeInstance = async (
  router: ChatRouter,
  id: string,
  desiredStatus: RemovedDetail['desiredStatus'],
): Promise<ApplyResultPatch> => {
  try {
    await router.removeInstance(id)
    return { stopped: [id], removed: [id], removedDetails: [{ id, desiredStatus }] }
  } catch (error) {
    return failedPatch(id, 'remove', error)
  }
}

const startedPatch = (router: ChatRouter, id: string, action: ApplyFailureAction): ApplyResultPatch => {
  const runtimeInstance = router.getInstance(id)
  if (runtimeInstance !== null && runtimeInstance.status === 'active') return { started: [id] }
  return failedPatch(id, action, notActiveAfterStartError(id))
}

const startMissingInstance = async (router: ChatRouter, instance: PlatformInstance): Promise<ApplyResultPatch> => {
  try {
    router.addInstance(instance.id, instance.type, instance.config)
    await router.startInstance(instance.id)
    return startedPatch(router, instance.id, 'start')
  } catch (error) {
    return failedPatch(instance.id, 'start', error)
  }
}

const recreateInstance = async (router: ChatRouter, instance: PlatformInstance): Promise<ApplyResultPatch> => {
  const removed = await removeRuntimeInstance(router, instance.id, null)
  if ((removed.failed ?? []).length > 0) return removed

  try {
    router.addInstance(instance.id, instance.type, instance.config)
    await router.startInstance(instance.id)
    const runtimeInstance = router.getInstance(instance.id)
    if (runtimeInstance !== null && runtimeInstance.status === 'active') {
      return {
        stopped: removed.stopped,
        removed: removed.removed,
        started: [instance.id],
        recreated: [instance.id],
      }
    }
    return {
      stopped: removed.stopped,
      removed: removed.removed,
      ...failedPatch(instance.id, 'recreate', notActiveAfterStartError(instance.id)),
    }
  } catch (error) {
    return { stopped: removed.stopped, removed: removed.removed, ...failedPatch(instance.id, 'recreate', error) }
  }
}

const startStoppedInstance = async (router: ChatRouter, instance: PlatformInstance): Promise<ApplyResultPatch> => {
  try {
    await router.startInstance(instance.id)
    return startedPatch(router, instance.id, 'start')
  } catch (error) {
    return failedPatch(instance.id, 'start', error)
  }
}

const reconcileActiveInstance = (router: ChatRouter, instance: PlatformInstance): Promise<ApplyResultPatch> => {
  const runtimeInstance = router.getInstance(instance.id)
  if (runtimeInstance === null) return startMissingInstance(router, instance)

  const desiredFingerprint = configFingerprint(instance.type, instance.config)
  if (runtimeInstance.type !== instance.type || runtimeInstance.configFingerprint !== desiredFingerprint) {
    return recreateInstance(router, instance)
  }
  if (runtimeInstance.status === 'stopped') return startStoppedInstance(router, instance)

  return Promise.resolve({ unchanged: [instance.id] })
}

const reconcilePlatformInstances = async (deps: InstanceApiDeps): Promise<Response> => {
  const router = deps.getRuntimeChatRouter()
  if (router === null) return jsonResponse({ error: 'router not initialised' }, { status: 503 })

  const desiredResult = listDesiredPlatformInstances(deps)
  const desiredInstances = desiredResult.instances
  const desiredById = new Map(desiredInstances.map((instance) => [instance.id, instance]))
  const activeInstances = desiredInstances.filter((instance) => instance.status === 'active')
  const activeIds = new Set(activeInstances.map((instance) => instance.id))
  const unreadableIds = new Set(desiredResult.failures.map((failure) => failure.id))
  const runtimeIdsToRemove = router
    .listInstances()
    .map((instance) => instance.id)
    .filter((id) => !activeIds.has(id) && !unreadableIds.has(id))
  const limit = pLimit(INSTANCE_APPLY_CONCURRENCY)
  const removePatches = runtimeIdsToRemove.map((id) => {
    const desired = desiredById.get(id)
    const desiredStatus = desired === undefined ? null : desired.status === 'active' ? null : desired.status
    return limit(removeRuntimeInstance, router, id, desiredStatus)
  })
  const activePatches = activeInstances.map((instance) => limit(reconcileActiveInstance, router, instance))
  const patches = await Promise.all([...removePatches, ...activePatches])

  return jsonResponse({ ...mergeApplyResult(activeInstances.length, patches), unreadable: desiredResult.failures })
}

export const applyPlatformInstances = (deps: InstanceApiDeps): Promise<Response> =>
  instanceApplyLock(reconcilePlatformInstances, deps)

/** Production deps shared by the settings-admin apply route. */
export const defaultInstanceApiDeps: InstanceApiDeps = {
  getRuntimeChatRouter,
  listPlatformInstances,
  listPlatformInstancesSafe,
}
