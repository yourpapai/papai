<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { AdminInstanceDecodeFailure, AdminInstanceRow, ProviderType } from '../../fetcher-schemas.js'
  import {
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
  import Btn from '../../../shared/ui/Btn.svelte'
  import DataTable from '../../../shared/ui/DataTable.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import Select from '../../../shared/ui/Select.svelte'
  import StatusPill from '../../../shared/ui/StatusPill.svelte'

  let platforms: AdminInstanceRow[] = $state([])
  let tasks: AdminInstanceRow[] = $state([])
  let platformUnreadable: AdminInstanceDecodeFailure[] = $state([])
  let taskUnreadable: AdminInstanceDecodeFailure[] = $state([])
  let platformTypes: ProviderType[] = $state([])
  let taskTypes: ProviderType[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  let platformId = $state('')
  let platformType = $state('')
  let platformConfig: Record<string, string> = $state({})
  let taskId = $state('')
  let taskType = $state('')
  let taskConfig: Record<string, string> = $state({})

  const selectedPlatformType = $derived(platformTypes.find((t) => t.type === platformType))
  const selectedTaskType = $derived(taskTypes.find((t) => t.type === taskType))

  const setErr = (err: unknown): void => {
    error = err instanceof Error ? err.message : String(err)
  }

  const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  async function load(): Promise<void> {
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
      const loadErrors: string[] = []

      if (p.status === 'fulfilled') {
        platforms = p.value.instances
        platformUnreadable = p.value.unreadable ?? []
      } else {
        platforms = []
        loadErrors.push(errorMessage(p.reason))
      }

      if (t.status === 'fulfilled') {
        tasks = t.value.instances
        taskUnreadable = t.value.unreadable ?? []
      } else {
        tasks = []
        loadErrors.push(errorMessage(t.reason))
      }

      if (pt.status === 'fulfilled') {
        platformTypes = pt.value.providerTypes
        if (platformType === '' && platformTypes.length > 0) platformType = platformTypes[0]!.type
      } else {
        platformTypes = []
        loadErrors.push(errorMessage(pt.reason))
      }

      if (tt.status === 'fulfilled') {
        taskTypes = tt.value.providerTypes
        if (taskType === '' && taskTypes.length > 0) taskType = taskTypes[0]!.type
      } else {
        taskTypes = []
        loadErrors.push(errorMessage(tt.reason))
      }

      if (loadErrors.length > 0) error = loadErrors.join('; ')
    } finally {
      loading = false
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
    error = null
    status = null
    try {
      const config = collectConfig(selectedPlatformType?.instanceConfigSchema ?? [], platformConfig)
      await createAdminPlatformInstance({ id: platformId.trim(), type: platformType, config })
      platformId = ''
      platformConfig = {}
      await load()
      status = 'Platform instance created.'
    } catch (err) {
      setErr(err)
    }
  }

  async function createTask(): Promise<void> {
    error = null
    status = null
    try {
      const config = collectConfig(selectedTaskType?.instanceConfigSchema ?? [], taskConfig)
      await createAdminTaskInstance({ id: taskId.trim(), type: taskType, config })
      taskId = ''
      taskConfig = {}
      await load()
      status = 'Task instance created.'
    } catch (err) {
      setErr(err)
    }
  }

  async function toggleStatus(row: AdminInstanceRow): Promise<void> {
    error = null
    status = null
    try {
      await updateAdminPlatformInstance(row.id, { status: row.status === 'active' ? 'stopped' : 'active' })
      await load()
    } catch (err) {
      setErr(err)
    }
  }

  async function toggleTaskStatus(row: AdminInstanceRow): Promise<void> {
    error = null
    status = null
    try {
      await updateAdminTaskInstance(row.id, { status: row.status === 'active' ? 'stopped' : 'active' })
      await load()
    } catch (err) {
      setErr(err)
    }
  }

  async function deletePlatform(id: string): Promise<void> {
    if (!window.confirm(`Delete platform instance ${id}?`)) return
    error = null
    status = null
    try {
      await deleteAdminPlatformInstance(id)
      await load()
    } catch (err) {
      setErr(err)
    }
  }

  async function deleteTask(id: string): Promise<void> {
    if (!window.confirm(`Delete task instance ${id}?`)) return
    error = null
    status = null
    try {
      await deleteAdminTaskInstance(id)
      await load()
    } catch (err) {
      setErr(err)
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
    { key: 'id' as const, label: 'ID' },
    { key: 'type' as const, label: 'Type' },
    { key: 'status' as const, label: 'Status' },
    { key: 'actions' as const, label: '', align: 'right' as const },
  ]
</script>

<section id="instances" class="settings-section">
  <PageHeader eyebrow="Admin · Runtime" title="Instances">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="instances-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <h3>Platform instances</h3>
  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void createPlatform() }}>
    <Field label="ID">
      {#snippet children()}
        <Input value={platformId} onInput={(v) => (platformId = v)} testid="platform-id" />
      {/snippet}
    </Field>
    <Field label="Type">
      {#snippet children()}
        <Select value={platformType} options={platformTypes.map((t) => ({ value: t.type, label: t.displayName }))} onChange={(v) => (platformType = v)} />
      {/snippet}
    </Field>
    {#each selectedPlatformType?.instanceConfigSchema ?? [] as field (field.key)}
      <Field label={`${field.label}${field.required ? ' *' : ''}`}>
        {#snippet children()}
          <Input type={field.sensitive ? 'password' : 'text'} value={platformConfig[field.key] ?? ''} onInput={(v) => (platformConfig[field.key] = v)} />
        {/snippet}
      </Field>
    {/each}
    <Btn variant="primary" type="submit">
      {#snippet children()}Create{/snippet}
    </Btn>
  </form>
  <div class="settings-table-wrap">
    {#snippet platformCell(row: InstanceRow, col: { key: string; label: string })}
      {#if col.key === 'status'}
        <StatusPill status={row.status} />
      {:else if col.key === 'actions'}
        <Btn variant="outline" size="sm" testid={`platform-status-${row.id}`} onClick={() => void toggleStatus(platforms.find((p) => p.id === row.id)!)}>
          {#snippet children()}{row.status === 'active' ? 'Stop' : 'Start'}{/snippet}
        </Btn>
        <Btn variant="danger" size="sm" testid={`platform-delete-${row.id}`} onClick={() => void deletePlatform(row.id)}>
          {#snippet children()}Delete{/snippet}
        </Btn>
      {:else}
        {String(row[col.key as keyof InstanceRow] ?? '')}
      {/if}
    {/snippet}
    <DataTable columns={instanceColumns} rows={platformRows} cell={platformCell} rowKey="id">
      {#snippet empty()}No platform instances{/snippet}
    </DataTable>
  </div>
  {#if platformUnreadable.length > 0}
    <p class="status-error" data-testid="platform-unreadable">
      Unreadable platform instances hidden: {platformUnreadable.map((failure) => failure.id).join(', ')}
    </p>
  {/if}

  <h3>Task instances</h3>
  <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void createTask() }}>
    <Field label="ID">
      {#snippet children()}
        <Input value={taskId} onInput={(v) => (taskId = v)} testid="task-id" />
      {/snippet}
    </Field>
    <Field label="Type">
      {#snippet children()}
        <Select value={taskType} options={taskTypes.map((t) => ({ value: t.type, label: t.displayName }))} onChange={(v) => (taskType = v)} />
      {/snippet}
    </Field>
    {#each selectedTaskType?.instanceConfigSchema ?? [] as field (field.key)}
      <Field label={`${field.label}${field.required ? ' *' : ''}`}>
        {#snippet children()}
          <Input type={field.sensitive ? 'password' : 'text'} value={taskConfig[field.key] ?? ''} onInput={(v) => (taskConfig[field.key] = v)} />
        {/snippet}
      </Field>
    {/each}
    <Btn variant="primary" type="submit">
      {#snippet children()}Create{/snippet}
    </Btn>
  </form>
  <div class="settings-table-wrap">
    {#snippet taskCell(row: InstanceRow, col: { key: string; label: string })}
      {#if col.key === 'status'}
        <StatusPill status={row.status} />
      {:else if col.key === 'actions'}
        <Btn variant="outline" size="sm" testid={`task-status-${row.id}`} onClick={() => void toggleTaskStatus(tasks.find((t) => t.id === row.id)!)}>
          {#snippet children()}{row.status === 'active' ? 'Stop' : 'Start'}{/snippet}
        </Btn>
        <Btn variant="danger" size="sm" testid={`task-delete-${row.id}`} onClick={() => void deleteTask(row.id)}>
          {#snippet children()}Delete{/snippet}
        </Btn>
      {:else}
        {String(row[col.key as keyof InstanceRow] ?? '')}
      {/if}
    {/snippet}
    <DataTable columns={instanceColumns} rows={taskRows} cell={taskCell} rowKey="id">
      {#snippet empty()}No task instances{/snippet}
    </DataTable>
  </div>
  {#if taskUnreadable.length > 0}
    <p class="status-error" data-testid="task-unreadable">
      Unreadable task instances hidden: {taskUnreadable.map((failure) => failure.id).join(', ')}
    </p>
  {/if}
</section>
