<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type {
    AdminInstanceView,
    InstanceConfigView,
    PlatformInstanceView,
    PlatformProviderTypeView,
    TaskInstanceView,
    TaskProviderTypeView,
  } from '../../shared/api-types.js'
  import {
    applyPlatformInstances,
    createAdmin,
    createPlatformInstance,
    createTaskInstance,
    deleteAdmin,
    deletePlatformInstance,
    deleteTaskInstance,
    fetchAdmins,
    fetchPlatformInstances,
    fetchPlatformProviderTypes,
    fetchTaskInstances,
    fetchTaskProviderTypes,
    updatePlatformInstance,
  } from '../fetchers.js'

  type FormStatus = { readonly kind: 'success' | 'error'; readonly message: string }
  type PlatformType = PlatformInstanceView['type']

  let platformInstances: PlatformInstanceView[] = $state([])
  let taskInstances: TaskInstanceView[] = $state([])
  let admins: AdminInstanceView[] = $state([])
  let platformProviderTypes: PlatformProviderTypeView[] = $state([])
  let taskProviderTypes: TaskProviderTypeView[] = $state([])
  let loading = $state(false)
  let status: FormStatus | null = $state(null)
  let platformDirty = $state(false)

  let platformId = $state('')
  let platformType: PlatformType = $state('telegram')
  let platformConfigFields: Record<string, string> = $state({})
  let taskId = $state('')
  let taskType = $state('')
  let taskConfigFields: Record<string, string> = $state({})
  let adminUserId = $state('')
  let adminPlatformInstanceId = $state('')

  const selectedPlatformType = $derived(platformProviderTypes.find((descriptor) => descriptor.type === platformType))
  const selectedTaskType = $derived(taskProviderTypes.find((descriptor) => descriptor.type === taskType))

  const configLabel = (config: InstanceConfigView): string => JSON.stringify(config)
  const setSuccess = (message: string): void => {
    status = { kind: 'success', message }
  }
  const setError = (err: unknown): void => {
    status = { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  }

  function confirmDestructive(message: string): boolean {
    return window.confirm(message)
  }

  async function loadPlatformInstances(): Promise<void> {
    platformInstances = await fetchPlatformInstances()
  }

  async function loadTaskInstances(): Promise<void> {
    taskInstances = await fetchTaskInstances()
  }

  async function loadPlatformProviderTypes(): Promise<void> {
    platformProviderTypes = await fetchPlatformProviderTypes()
    if (!platformProviderTypes.some((descriptor) => descriptor.type === platformType) && platformProviderTypes.length > 0) {
      platformType = platformProviderTypes[0]!.type
    }
  }

  async function loadAdmins(): Promise<void> {
    admins = await fetchAdmins()
  }

  async function loadTaskProviderTypes(): Promise<void> {
    taskProviderTypes = await fetchTaskProviderTypes()
    if (taskType === '' && taskProviderTypes.length > 0) taskType = taskProviderTypes[0]!.type
  }

  async function refreshAll(): Promise<void> {
    loading = true
    status = null
    try {
      await Promise.all([
        loadPlatformInstances(),
        loadTaskInstances(),
        loadAdmins(),
        loadTaskProviderTypes(),
        loadPlatformProviderTypes(),
      ])
    } catch (err) {
      setError(err)
    } finally {
      loading = false
    }
  }

  $effect(() => {
    const schema = selectedPlatformType === undefined ? [] : selectedPlatformType.instanceConfigSchema
    const prev = untrack(() => platformConfigFields)
    const next: Record<string, string> = {}
    for (const field of schema) {
      const value = prev[field.key]
      next[field.key] = value === undefined ? '' : value
    }
    platformConfigFields = next
  })

  $effect(() => {
    const schema = selectedTaskType === undefined ? [] : selectedTaskType.instanceConfigSchema
    const prev = untrack(() => taskConfigFields)
    const next: Record<string, string> = {}
    for (const field of schema) {
      const value = prev[field.key]
      next[field.key] = value === undefined ? '' : value
    }
    taskConfigFields = next
  })

  async function createPlatform(): Promise<void> {
    try {
      const schema = selectedPlatformType === undefined ? [] : selectedPlatformType.instanceConfigSchema
      const config: Record<string, string> = {}
      for (const field of schema) {
        const rawValue = platformConfigFields[field.key]
        const value = (rawValue === undefined ? '' : rawValue).trim()
        if (field.required && value === '') throw new Error(`${field.label} is required`)
        if (value !== '') config[field.key] = value
      }
      await createPlatformInstance({ id: platformId.trim(), type: platformType, config })
      platformId = ''
      platformConfigFields = {}
      platformDirty = true
      await loadPlatformInstances()
      setSuccess('Platform instance created. Platform changes are unapplied.')
    } catch (err) {
      setError(err)
    }
  }

  async function updatePlatformStatus(instance: PlatformInstanceView): Promise<void> {
    try {
      const nextStatus = instance.status === 'active' ? 'stopped' : 'active'
      await updatePlatformInstance(instance.id, { status: nextStatus })
      platformDirty = true
      await loadPlatformInstances()
      setSuccess(`Platform instance ${nextStatus}. Platform changes are unapplied.`)
    } catch (err) {
      setError(err)
    }
  }

  async function removePlatform(id: string): Promise<void> {
    if (!confirmDestructive(`Delete platform instance ${id}?`)) return
    try {
      await deletePlatformInstance(id)
      platformDirty = true
      await loadPlatformInstances()
      setSuccess('Platform instance deleted. Platform changes are unapplied.')
    } catch (err) {
      setError(err)
    }
  }

  async function applyPlatforms(): Promise<void> {
    try {
      const result = await applyPlatformInstances()
      platformDirty = false
      await loadPlatformInstances()
      setSuccess(`Applied ${result.applied} platform ${result.applied === 1 ? 'change' : 'changes'}.`)
    } catch (err) {
      setError(err)
    }
  }

  async function createTask(): Promise<void> {
    try {
      const schema = selectedTaskType === undefined ? [] : selectedTaskType.instanceConfigSchema
      const config: Record<string, string> = {}
      for (const field of schema) {
        const rawValue = taskConfigFields[field.key]
        const value = (rawValue === undefined ? '' : rawValue).trim()
        if (field.required && value === '') throw new Error(`${field.label} is required`)
        if (value !== '') config[field.key] = value
      }
      await createTaskInstance({ id: taskId.trim(), type: taskType, config })
      taskId = ''
      taskConfigFields = {}
      await loadTaskInstances()
      setSuccess('Task instance created.')
    } catch (err) {
      setError(err)
    }
  }

  function taskDeleteConfirmation(instance: TaskInstanceView): string {
    const contextIds = instance.referencingContextIds === undefined ? [] : instance.referencingContextIds
    const contextCount = instance.referencingContextCount === undefined ? contextIds.length : instance.referencingContextCount
    if (contextCount === 0) return `Delete task instance ${instance.id}?`
    const contextList = contextIds.length === 0 ? `${contextCount} context settings` : contextIds.join(', ')
    return `Delete task instance ${instance.id}? This will delete ${contextCount} context settings: ${contextList}.`
  }

  async function removeTask(instance: TaskInstanceView): Promise<void> {
    if (!confirmDestructive(taskDeleteConfirmation(instance))) return
    try {
      await deleteTaskInstance(instance.id)
      await loadTaskInstances()
      setSuccess('Task instance deleted.')
    } catch (err) {
      setError(err)
    }
  }

  async function addAdmin(): Promise<void> {
    try {
      const userId = adminUserId.trim()
      const platformInstanceId = adminPlatformInstanceId.trim()
      if (platformInstanceId === '') {
        await createAdmin({ userId })
      } else {
        await createAdmin({ userId, platformInstanceId })
      }
      adminUserId = ''
      adminPlatformInstanceId = ''
      await loadAdmins()
      setSuccess('Admin added.')
    } catch (err) {
      setError(err)
    }
  }

  async function removeAdmin(userId: string, platformInstanceId: string): Promise<void> {
    if (!confirmDestructive(`Remove admin ${userId}?`)) return
    try {
      await deleteAdmin(userId, platformInstanceId)
      await loadAdmins()
      setSuccess('Admin removed.')
    } catch (err) {
      setError(err)
    }
  }

  $effect(() => {
    void refreshAll()
  })
</script>

<section id="instances" class="panel admin-data-section admin-section">
  <header class="admin-section-header">
    <div>
      <p class="eyebrow">Runtime</p>
      <h2 data-testid="admin-section-title">Instances</h2>
    </div>
    <button type="button" onclick={() => void refreshAll()}>{loading ? 'Refreshing...' : 'Refresh'}</button>
  </header>

  {#if status !== null}
    <p class={status.kind === 'error' ? 'status-error' : 'status-success'}>{status.message}</p>
  {/if}

  <div class="admin-subsection-grid instances-grid">
    <section>
      <div class="instances-subheader">
        <h3>Platform Instances</h3>
        <button type="button" data-testid="platform-apply-button" onclick={() => void applyPlatforms()}>Apply changes</button>
      </div>
      {#if platformDirty}
        <p class="placeholder" data-testid="platform-unapplied-indicator">Platform changes are unapplied</p>
      {/if}
      <form class="admin-filter-form" data-testid="platform-create-form" onsubmit={(event) => { event.preventDefault(); void createPlatform() }}>
        <label><span>ID</span><input data-testid="platform-id-input" bind:value={platformId} /></label>
        <label>
          <span>Type</span>
          <select data-testid="platform-type-input" bind:value={platformType}>
            {#each platformProviderTypes as descriptor (descriptor.type)}
              <option value={descriptor.type}>{descriptor.displayName}</option>
            {/each}
          </select>
        </label>
        {#each selectedPlatformType?.instanceConfigSchema ?? [] as field (field.key)}
          <label>
            <span>{field.label}{field.required ? ' *' : ''}</span>
            <input
              data-testid={`platform-config-${field.key}`}
              type={field.sensitive ? 'password' : 'text'}
              bind:value={platformConfigFields[field.key]}
            />
          </label>
        {/each}
        <button type="submit" data-testid="platform-create-button">Create</button>
      </form>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Config</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            {#each platformInstances as instance (instance.id)}
              <tr data-testid="platform-instance-row">
                <td>{instance.id}</td><td>{instance.type}</td><td>{instance.status}</td><td>{configLabel(instance.config)}</td><td>{instance.createdAt}</td>
                <td>
                  <button type="button" data-testid={`platform-status-${instance.id}`} onclick={() => void updatePlatformStatus(instance)}>{instance.status === 'active' ? 'Stop' : 'Start'}</button>
                  <button type="button" data-testid={`platform-delete-${instance.id}`} onclick={() => void removePlatform(instance.id)}>Delete</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h3>Task Instances</h3>
      <form class="admin-filter-form" data-testid="task-create-form" onsubmit={(event) => { event.preventDefault(); void createTask() }}>
        <label><span>ID</span><input data-testid="task-id-input" bind:value={taskId} /></label>
        <label>
          <span>Type</span>
          <select data-testid="task-type-input" bind:value={taskType}>
            {#each taskProviderTypes as descriptor (descriptor.type)}
              <option value={descriptor.type}>{descriptor.displayName}</option>
            {/each}
          </select>
        </label>
        {#each selectedTaskType?.instanceConfigSchema ?? [] as field (field.key)}
          <label>
            <span>{field.label}{field.required ? ' *' : ''}</span>
            {#if field.sensitive}
              <input data-testid={`task-config-${field.key}`} type="password" bind:value={taskConfigFields[field.key]} />
            {:else}
              <input data-testid={`task-config-${field.key}`} bind:value={taskConfigFields[field.key]} />
            {/if}
          </label>
        {/each}
        <button type="submit" data-testid="task-create-button">Create</button>
      </form>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Config</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            {#each taskInstances as instance (instance.id)}
              <tr data-testid="task-instance-row">
                <td>{instance.id}</td><td>{instance.type}</td><td>{instance.status}</td><td>{configLabel(instance.config)}</td><td>{instance.createdAt}</td>
                <td>
                  {#if instance.unresolvedReason}
                    <span data-testid={`task-instance-unresolved-${instance.id}`} class="unresolved-label">{instance.unresolvedReason}</span>
                  {/if}
                  <button type="button" data-testid={`task-delete-${instance.id}`} onclick={() => void removeTask(instance)}>Delete</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h3>Admins</h3>
      <form class="admin-filter-form" data-testid="admin-create-form" onsubmit={(event) => { event.preventDefault(); void addAdmin() }}>
        <label><span>User ID</span><input data-testid="admin-user-id-input" bind:value={adminUserId} /></label>
        <label><span>Platform Instance ID</span><input data-testid="admin-platform-id-input" bind:value={adminPlatformInstanceId} /></label>
        <button type="submit" data-testid="admin-create-button">Create</button>
      </form>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>User ID</th><th>Platform Instance</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            {#each admins as admin (`${admin.userId}:${admin.platformInstanceId}`)}
              <tr data-testid="admin-instance-row">
                <td>{admin.userId}</td><td>{admin.platformInstanceId}</td><td>{admin.createdAt ?? 'n/a'}</td>
                <td><button type="button" data-testid={`admin-remove-${admin.userId}`} onclick={() => void removeAdmin(admin.userId, admin.platformInstanceId)}>Remove</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  </div>
</section>

<style>
  .instances-grid section {
    display: grid;
    gap: 12px;
  }

  .instances-subheader {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  }

  .instances-subheader button,
  .admin-table button {
    padding: 8px 10px;
    border: 1px solid var(--strong);
    border-radius: 2px;
    background: var(--bg);
    color: var(--fg);
  }

  .status-success {
    color: var(--success);
  }

  .unresolved-label {
    display: inline-block;
    margin-bottom: 4px;
    padding: 2px 6px;
    border: 1px solid var(--warn, #b45309);
    border-radius: 2px;
    background: transparent;
    color: var(--warn, #b45309);
    font-size: 0.8em;
  }

  @media (max-width: 720px) {
    .instances-subheader {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
