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
</script>

<section id="instances" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin · Runtime</p>
      <h2>Instances</h2>
    </div>
    <button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <h3>Platform instances</h3>
  <form
    class="settings-form"
    onsubmit={(event) => {
      event.preventDefault()
      void createPlatform()
    }}
  >
    <label
      ><span>ID</span><input
        data-testid="platform-id"
        value={platformId}
        oninput={(e) => (platformId = (e.target as HTMLInputElement).value)}
      /></label
    >
    <label>
      <span>Type</span>
      <select value={platformType} onchange={(e) => (platformType = (e.target as HTMLSelectElement).value)}>
        {#each platformTypes as t (t.type)}<option value={t.type}>{t.displayName}</option>{/each}
      </select>
    </label>
    {#each selectedPlatformType?.instanceConfigSchema ?? [] as field (field.key)}
      <label>
        <span>{field.label}{field.required ? ' *' : ''}</span>
        <input
          type={field.sensitive ? 'password' : 'text'}
          value={platformConfig[field.key] ?? ''}
          oninput={(e) => (platformConfig[field.key] = (e.target as HTMLInputElement).value)}
        />
      </label>
    {/each}
    <button type="submit">Create</button>
  </form>
  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        {#each platforms as row (row.id)}
          <tr>
            <td>{row.id}</td><td>{row.type}</td><td>{row.status}</td>
            <td>
              <button
                type="button"
                data-testid={`platform-status-${row.id}`}
                onclick={() => void toggleStatus(row)}>{row.status === 'active' ? 'Stop' : 'Start'}</button
              >
              <button
                type="button"
                data-testid={`platform-delete-${row.id}`}
                onclick={() => void deletePlatform(row.id)}>Delete</button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if platformUnreadable.length > 0}
    <p class="status-error" data-testid="platform-unreadable">
      Unreadable platform instances hidden: {platformUnreadable.map((failure) => failure.id).join(', ')}
    </p>
  {/if}

  <h3>Task instances</h3>
  <form
    class="settings-form"
    onsubmit={(event) => {
      event.preventDefault()
      void createTask()
    }}
  >
    <label
      ><span>ID</span><input
        data-testid="task-id"
        value={taskId}
        oninput={(e) => (taskId = (e.target as HTMLInputElement).value)}
      /></label
    >
    <label>
      <span>Type</span>
      <select value={taskType} onchange={(e) => (taskType = (e.target as HTMLSelectElement).value)}>
        {#each taskTypes as t (t.type)}<option value={t.type}>{t.displayName}</option>{/each}
      </select>
    </label>
    {#each selectedTaskType?.instanceConfigSchema ?? [] as field (field.key)}
      <label>
        <span>{field.label}{field.required ? ' *' : ''}</span>
        <input
          type={field.sensitive ? 'password' : 'text'}
          value={taskConfig[field.key] ?? ''}
          oninput={(e) => (taskConfig[field.key] = (e.target as HTMLInputElement).value)}
        />
      </label>
    {/each}
    <button type="submit">Create</button>
  </form>
  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        {#each tasks as row (row.id)}
          <tr>
            <td>{row.id}</td><td>{row.type}</td><td>{row.status}</td>
            <td>
              <button
                type="button"
                data-testid={`task-status-${row.id}`}
                onclick={() => void toggleTaskStatus(row)}>{row.status === 'active' ? 'Stop' : 'Start'}</button
              >
              <button
                type="button"
                data-testid={`task-delete-${row.id}`}
                onclick={() => void deleteTask(row.id)}>Delete</button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if taskUnreadable.length > 0}
    <p class="status-error" data-testid="task-unreadable">
      Unreadable task instances hidden: {taskUnreadable.map((failure) => failure.id).join(', ')}
    </p>
  {/if}
</section>
