<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { AdminInstanceDecodeFailure, AdminInstanceRow, ProviderType } from '../../fetcher-schemas-admin.js'
  import {
    applyAdminPlatformInstances,
    createAdminPlatformInstance,
    createAdminTaskInstance,
    deleteAdminPlatformInstance,
    deleteAdminTaskInstance,
    fetchAdminPlatformInstances,
    fetchAdminPlatformProviderTypes,
    fetchAdminTaskInstances,
    fetchAdminTaskProviderTypes,
    updateAdminPlatformInstance,
    updateAdminTaskInstance,
  } from '../../admin-fetchers.js'
  import Confirm from '../../../shared/Confirm.svelte'
  import Btn from '../../../shared/ui/Btn.svelte'
  import DataTable from '../../../shared/ui/DataTable.svelte'
  import EmptyState from '../../../shared/ui/EmptyState.svelte'
  import ErrorState from '../../../shared/ui/ErrorState.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import Select from '../../../shared/ui/Select.svelte'
  import StatusPill from '../../../shared/ui/StatusPill.svelte'
  import { markTouched, shownError } from '../../../shared/ui/field-touched.js'
  import IdCell from '../../components/IdCell.svelte'
  import { DUPLICATE_ID_MESSAGE, validateInstanceCreate } from './instance-create.js'

  let platforms: AdminInstanceRow[] = $state([])
  let tasks: AdminInstanceRow[] = $state([])
  let platformUnreadable: AdminInstanceDecodeFailure[] = $state([])
  let taskUnreadable: AdminInstanceDecodeFailure[] = $state([])
  let platformTypes: ProviderType[] = $state([])
  let taskTypes: ProviderType[] = $state([])
  let error: string | null = $state(null)
  let loadError: string | null = $state(null)
  let initialLoad = $state(true)
  let status: string | null = $state(null)
  let loading = $state(false)

  let platformId = $state('')
  let platformType = $state('')
  let platformConfig: Record<string, string> = $state({})
  let taskId = $state('')
  let taskType = $state('')
  let taskConfig: Record<string, string> = $state({})

  type PendingDelete = { kind: 'platform' | 'task'; id: string } | null
  let pendingDelete: PendingDelete = $state(null)
  let deleting = $state(false)
  let deleteError: string | null = $state(null)

  type PendingStop = { kind: 'platform' | 'task'; row: AdminInstanceRow } | null
  let pendingStop: PendingStop = $state(null)
  let stopping = $state(false)
  let stopError: string | null = $state(null)

  let creatingPlatform = $state(false)
  let creatingTask = $state(false)
  let togglingId: string | null = $state(null)

  const selectedPlatformType = $derived(platformTypes.find((t) => t.type === platformType))
  const selectedTaskType = $derived(taskTypes.find((t) => t.type === taskType))

  let platformTouched: string[] = $state([])
  let taskTouched: string[] = $state([])

  const platformErrors = $derived(
    validateInstanceCreate({ id: platformId, type: platformType, existingIds: platforms.map((p) => p.id) }),
  )
  const taskErrors = $derived(
    validateInstanceCreate({ id: taskId, type: taskType, existingIds: tasks.map((t) => t.id) }),
  )

  const setErr = (err: unknown): void => {
    error = err instanceof Error ? err.message : String(err)
  }

  const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  async function load(): Promise<void> {
    loadError = null
    error = null
    loading = true
    platformUnreadable = []
    taskUnreadable = []
    try {
      const [p, t, pt, tt] = await Promise.allSettled([
        fetchAdminPlatformInstances(),
        fetchAdminTaskInstances(),
        fetchAdminPlatformProviderTypes(),
        fetchAdminTaskProviderTypes(),
      ])
      // Instance-list failures are fatal (they replace the whole region with an ErrorState);
      // provider-type failures are not (the tables stay visible and the affected Type select
      // just has no options), so the two kinds are tracked and surfaced separately.
      const instanceErrors: string[] = []
      const typeErrors: string[] = []

      if (p.status === 'fulfilled') {
        platforms = p.value.instances
        platformUnreadable = p.value.unreadable ?? []
      } else {
        platforms = []
        instanceErrors.push(errorMessage(p.reason))
      }

      if (t.status === 'fulfilled') {
        tasks = t.value.instances
        taskUnreadable = t.value.unreadable ?? []
      } else {
        tasks = []
        instanceErrors.push(errorMessage(t.reason))
      }

      if (pt.status === 'fulfilled') {
        platformTypes = pt.value.providerTypes
        if (platformType === '' && platformTypes.length > 0) platformType = platformTypes[0]!.type
      } else {
        platformTypes = []
        typeErrors.push(errorMessage(pt.reason))
      }

      if (tt.status === 'fulfilled') {
        taskTypes = tt.value.providerTypes
        if (taskType === '' && taskTypes.length > 0) taskType = taskTypes[0]!.type
      } else {
        taskTypes = []
        typeErrors.push(errorMessage(tt.reason))
      }

      // When both kinds fail the ErrorState replaces the region, so the inline line would
      // render above a panel that already reports the failure. loadError wins alone.
      if (instanceErrors.length > 0) loadError = instanceErrors.join('; ')
      else if (typeErrors.length > 0) error = typeErrors.join('; ')
    } finally {
      loading = false
      initialLoad = false
    }
  }

  function collectConfig(
    schema: ProviderType['instanceConfigSchema'],
    fields: Record<string, string>,
  ): Record<string, string> {
    const config: Record<string, string> = {}
    for (const field of schema) {
      const value = (fields[field.key] ?? '').trim()
      if (field.required && value === '') throw new Error(`${field.label} is required`)
      if (value !== '') config[field.storageKey ?? field.key] = value
    }
    return config
  }

  async function createPlatform(): Promise<void> {
    if (creatingPlatform) return
    if (Object.keys(platformErrors).length > 0) return
    error = null
    status = null
    creatingPlatform = true
    try {
      const config = collectConfig(selectedPlatformType?.instanceConfigSchema ?? [], platformConfig)
      await createAdminPlatformInstance({ id: platformId.trim(), type: platformType, config })
      platformId = ''
      platformConfig = {}
      platformTouched = []
      await load()
      status = 'Platform instance created.'
    } catch (err) {
      setErr(err)
    } finally {
      creatingPlatform = false
    }
  }

  async function createTask(): Promise<void> {
    if (creatingTask) return
    if (Object.keys(taskErrors).length > 0) return
    error = null
    status = null
    creatingTask = true
    try {
      const config = collectConfig(selectedTaskType?.instanceConfigSchema ?? [], taskConfig)
      await createAdminTaskInstance({ id: taskId.trim(), type: taskType, config })
      taskId = ''
      taskConfig = {}
      taskTouched = []
      await load()
      status = 'Task instance created.'
    } catch (err) {
      setErr(err)
    } finally {
      creatingTask = false
    }
  }

  async function toggleStatus(row: AdminInstanceRow): Promise<void> {
    if (togglingId !== null) return
    error = null
    status = null
    togglingId = row.id
    try {
      await updateAdminPlatformInstance(row.id, { status: row.status === 'active' ? 'stopped' : 'active' })
      await load()
    } catch (err) {
      setErr(err)
    } finally {
      togglingId = null
    }
  }

  async function toggleTaskStatus(row: AdminInstanceRow): Promise<void> {
    if (togglingId !== null) return
    error = null
    status = null
    togglingId = row.id
    try {
      await updateAdminTaskInstance(row.id, { status: row.status === 'active' ? 'stopped' : 'active' })
      await load()
    } catch (err) {
      setErr(err)
    } finally {
      togglingId = null
    }
  }

  async function confirmDelete(): Promise<void> {
    const p = pendingDelete
    if (p === null || deleting) return
    deleteError = null
    error = null
    status = null
    deleting = true
    let ok = false
    try {
      if (p.kind === 'platform') {
        await deleteAdminPlatformInstance(p.id)
      } else {
        await deleteAdminTaskInstance(p.id)
      }
      ok = true
    } catch (err) {
      deleteError = err instanceof Error ? err.message : String(err)
    } finally {
      deleting = false
    }
    if (ok) {
      pendingDelete = null
      await load()
    }
  }

  function requestStop(kind: 'platform' | 'task', row: AdminInstanceRow): void {
    stopError = null
    pendingStop = { kind, row }
  }

  async function confirmStop(): Promise<void> {
    const p = pendingStop
    if (p === null || stopping) return
    stopError = null
    error = null
    status = null
    stopping = true
    let ok = false
    try {
      if (p.kind === 'platform') {
        await updateAdminPlatformInstance(p.row.id, { status: 'stopped' })
      } else {
        await updateAdminTaskInstance(p.row.id, { status: 'stopped' })
      }
      ok = true
    } catch (err) {
      stopError = err instanceof Error ? err.message : String(err)
    } finally {
      stopping = false
    }
    if (ok) {
      pendingStop = null
      await load()
    }
  }

  async function applyPlatforms(): Promise<void> {
    loading = true
    error = null
    status = null
    try {
      const result = await applyAdminPlatformInstances()
      const applyError =
        result.failed.length > 0
          ? `Apply completed with failures: ${result.failed.map((f) => `${f.id} ${f.action}: ${f.error}`).join('; ')}`
          : null
      await load()
      if (applyError !== null) error = applyError
      else status = `Applied ${result.applied} platform change${result.applied === 1 ? '' : 's'}.`
    } catch (err) {
      setErr(err)
    } finally {
      loading = false
    }
  }

  $effect(() => {
    void load()
  })

  interface InstanceRow {
    id: string
    type: string
    status: string
  }

  const platformRows = $derived<InstanceRow[]>(platforms.map((r) => ({ id: r.id, type: r.type, status: r.status })))
  const taskRows = $derived<InstanceRow[]>(tasks.map((r) => ({ id: r.id, type: r.type, status: r.status })))
  const instanceColumns = [
    { key: 'id' as const, label: 'ID', width: '40%', sortable: true },
    { key: 'type' as const, label: 'Type', width: '20%' },
    { key: 'status' as const, label: 'Status', width: '15%', sortable: true },
    { key: 'actions' as const, label: '', align: 'right' as const, width: '25%' },
  ]

  const pendingDeleteLabel = $derived(
    pendingDelete !== null ? `${pendingDelete.kind} instance ${pendingDelete.id}` : '',
  )

  // A platform instance serves a chat connection; a task instance backs the trackers
  // contexts are assigned to. Naming the wrong one understates the cost of the other.
  const pendingDeleteConsequence = $derived(
    pendingDelete?.kind === 'task'
      ? 'Any context assigned to it loses its task tracker'
      : 'Its platform stops being served',
  )

  const pendingStopId = $derived(pendingStop?.row.id ?? '')
</script>

<section id="instances" class="settings-section">
  <PageHeader
    eyebrow="Admin · Runtime"
    title="Instances"
    sub="Apply starts and stops platform connections so the running bot matches the table below.">
    {#snippet action()}
      <Btn variant="outline" size="sm" testid="admin-instances-apply" disabled={loading} onClick={() => void applyPlatforms()}>
        {#snippet children()}Apply platform changes{/snippet}
      </Btn>
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="instances-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if loadError !== null}
    <ErrorState
      message="Could not load the platform and task instances."
      detail={loadError}
      onRetry={() => void load()} />
  {:else if loading && initialLoad}
    <p class="placeholder">Loading…</p>
  {:else}
  <div class="instance-create" data-testid="platform-create-card">
    <h3 class="t-subhead">Add platform instance</h3>
    <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void createPlatform() }}>
      <Field
        label="ID"
        required
        error={shownError(platformErrors, platformTouched, 'id', (m) => m === DUPLICATE_ID_MESSAGE)}
      >
        {#snippet children()}
          <Input
            value={platformId}
            onInput={(v) => (platformId = v)}
            onBlur={() => (platformTouched = markTouched(platformTouched, 'id'))}
            testid="platform-id" />
        {/snippet}
      </Field>
      <!-- Not touch-gated like the id field above: the select auto-picks its first option, so
           a type error means the option list is empty and there's nothing to touch. -->
      <Field label="Type" required error={platformErrors.type}>
        {#snippet children()}
          <Select
            value={platformType}
            options={platformTypes.map((t) => ({ value: t.type, label: t.displayName }))}
            onChange={(v) => (platformType = v)}
            disabled={creatingPlatform} />
        {/snippet}
      </Field>
      {#each selectedPlatformType?.instanceConfigSchema ?? [] as field (field.key)}
        <Field label={field.label} required={field.required}>
          {#snippet children()}
            <Input type={field.sensitive ? 'password' : 'text'} value={platformConfig[field.key] ?? ''} onInput={(v) => (platformConfig[field.key] = v)} />
          {/snippet}
        </Field>
      {/each}
      <Btn
        variant="primary"
        type="submit"
        disabled={creatingPlatform || Object.keys(platformErrors).length > 0}
        busy={creatingPlatform}
        testid="platform-create">
        {#snippet children()}+ Create{/snippet}
      </Btn>
    </form>
  </div>

  <h3 class="t-subhead">Platform instances</h3>
  <div class="settings-table-wrap">
    {#snippet platformCell(row: InstanceRow, col: { key: string; label: string })}
      {#if col.key === 'id'}
        <IdCell value={row.id} />
      {:else if col.key === 'status'}
        <StatusPill status={row.status} />
      {:else if col.key === 'actions'}
        <Btn
          variant="outline"
          size="sm"
          testid={`platform-status-${row.id}`}
          busy={togglingId === row.id}
          disabled={togglingId !== null}
          onClick={() => (row.status === 'active' ? requestStop('platform', platforms.find((p) => p.id === row.id)!) : void toggleStatus(platforms.find((p) => p.id === row.id)!))}>
          {#snippet children()}{row.status === 'active' ? 'Stop' : 'Start'}{/snippet}
        </Btn>
        <Btn variant="danger" size="sm" testid={`platform-delete-${row.id}`} onClick={() => { deleteError = null; pendingDelete = { kind: 'platform', id: row.id } }}>
          {#snippet children()}Delete{/snippet}
        </Btn>
      {:else}
        {String(row[col.key as keyof InstanceRow] ?? '')}
      {/if}
    {/snippet}
    <DataTable columns={instanceColumns} rows={platformRows} cell={platformCell} rowKey="id">
      {#snippet empty()}
        <EmptyState
          title="No platform instances"
          hint="Create one above to connect the bot to a chat platform." />
      {/snippet}
    </DataTable>
  </div>
  {#if platformUnreadable.length > 0}
    <p class="status-error" data-testid="platform-unreadable">
      Unreadable platform instances hidden: {platformUnreadable.map((failure) => failure.id).join(', ')}
    </p>
  {/if}

  <div class="instance-create" data-testid="task-create-card">
    <h3 class="t-subhead">Add task instance</h3>
    <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void createTask() }}>
      <Field
        label="ID"
        required
        error={shownError(taskErrors, taskTouched, 'id', (m) => m === DUPLICATE_ID_MESSAGE)}
      >
        {#snippet children()}
          <Input
            value={taskId}
            onInput={(v) => (taskId = v)}
            onBlur={() => (taskTouched = markTouched(taskTouched, 'id'))}
            testid="task-id" />
        {/snippet}
      </Field>
      <!-- Not touch-gated; see the platform Type field above for why. -->
      <Field label="Type" required error={taskErrors.type}>
        {#snippet children()}
          <Select
            value={taskType}
            options={taskTypes.map((t) => ({ value: t.type, label: t.displayName }))}
            onChange={(v) => (taskType = v)}
            disabled={creatingTask} />
        {/snippet}
      </Field>
      {#each selectedTaskType?.instanceConfigSchema ?? [] as field (field.key)}
        <Field label={field.label} required={field.required}>
          {#snippet children()}
            <Input type={field.sensitive ? 'password' : 'text'} value={taskConfig[field.key] ?? ''} onInput={(v) => (taskConfig[field.key] = v)} />
          {/snippet}
        </Field>
      {/each}
      <Btn
        variant="primary"
        type="submit"
        disabled={creatingTask || Object.keys(taskErrors).length > 0}
        busy={creatingTask}
        testid="task-create">
        {#snippet children()}+ Create{/snippet}
      </Btn>
    </form>
  </div>

  <h3 class="t-subhead">Task instances</h3>
  <div class="settings-table-wrap">
    {#snippet taskCell(row: InstanceRow, col: { key: string; label: string })}
      {#if col.key === 'id'}
        <IdCell value={row.id} />
      {:else if col.key === 'status'}
        <StatusPill status={row.status} />
      {:else if col.key === 'actions'}
        <Btn
          variant="outline"
          size="sm"
          testid={`task-status-${row.id}`}
          busy={togglingId === row.id}
          disabled={togglingId !== null}
          onClick={() => (row.status === 'active' ? requestStop('task', tasks.find((t) => t.id === row.id)!) : void toggleTaskStatus(tasks.find((t) => t.id === row.id)!))}>
          {#snippet children()}{row.status === 'active' ? 'Stop' : 'Start'}{/snippet}
        </Btn>
        <Btn variant="danger" size="sm" testid={`task-delete-${row.id}`} onClick={() => { deleteError = null; pendingDelete = { kind: 'task', id: row.id } }}>
          {#snippet children()}Delete{/snippet}
        </Btn>
      {:else}
        {String(row[col.key as keyof InstanceRow] ?? '')}
      {/if}
    {/snippet}
    <DataTable columns={instanceColumns} rows={taskRows} cell={taskCell} rowKey="id">
      {#snippet empty()}
        <EmptyState title="No task instances" hint="Create one above to connect a task tracker." />
      {/snippet}
    </DataTable>
  </div>
  {#if taskUnreadable.length > 0}
    <p class="status-error" data-testid="task-unreadable">
      Unreadable task instances hidden: {taskUnreadable.map((failure) => failure.id).join(', ')}
    </p>
  {/if}
  {/if}

  <Confirm
    open={pendingDelete !== null}
    title="Delete instance"
    danger
    confirmLabel="Delete"
    busy={deleting}
    onCancel={() => (pendingDelete = null)}
    onConfirm={() => void confirmDelete()}>
    {#snippet body()}
      <p>
        Delete {pendingDeleteLabel}? {pendingDeleteConsequence} and its stored credentials are
        removed. This cannot be undone.
      </p>
      {#if deleteError !== null}<p class="status-error">{deleteError}</p>{/if}
    {/snippet}
  </Confirm>

  <Confirm
    open={pendingStop !== null}
    title="Stop instance"
    danger
    confirmLabel="Stop"
    busy={stopping}
    onCancel={() => (pendingStop = null)}
    onConfirm={() => void confirmStop()}>
    {#snippet body()}
      <p>Stop instance {pendingStopId}? Active conversations on it will be interrupted.</p>
      {#if stopError !== null}<p class="status-error">{stopError}</p>{/if}
    {/snippet}
  </Confirm>
</section>

<style>
  .instance-create {
    border: 1px solid var(--border);
    background: var(--surface-1);
    border-radius: var(--radius);
    padding: var(--s4);
    margin-bottom: var(--gap-field);
  }
</style>
