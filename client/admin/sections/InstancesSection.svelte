<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type {
    AdminInstanceView,
    InstanceConfigView,
    PlatformInstanceView,
    TaskInstanceView,
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
    fetchTaskInstances,
    setPlatformInstanceStatus,
  } from '../fetchers.js'

  type FormStatus = { readonly kind: 'success' | 'error'; readonly message: string }
  type PlatformType = PlatformInstanceView['type']
  type TaskType = TaskInstanceView['type']

  let platformInstances: PlatformInstanceView[] = $state([])
  let taskInstances: TaskInstanceView[] = $state([])
  let admins: AdminInstanceView[] = $state([])
  let loading = $state(false)
  let status: FormStatus | null = $state(null)
  let platformDirty = $state(false)

  let platformId = $state('')
  let platformType: PlatformType = $state('telegram')
  let platformConfig = $state('{}')
  let taskId = $state('')
  let taskType: TaskType = $state('kaneo')
  let taskConfig = $state('{}')
  let adminUserId = $state('')
  let adminPlatformInstanceId = $state('')

  const configLabel = (config: InstanceConfigView): string => JSON.stringify(config)
  const setSuccess = (message: string): void => {
    status = { kind: 'success', message }
  }
  const setError = (err: unknown): void => {
    status = { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  }

  function parseConfig(raw: string): InstanceConfigView | null {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      const entries = Object.entries(parsed)
      if (entries.some(([, value]) => typeof value !== 'string')) return null
      return Object.fromEntries(entries) as InstanceConfigView
    } catch {
      return null
    }
  }

  function requireConfig(raw: string): InstanceConfigView {
    const parsed = parseConfig(raw)
    if (parsed === null) throw new Error('Config must be a JSON object with string values')
    return parsed
  }

  async function loadPlatformInstances(): Promise<void> {
    platformInstances = await fetchPlatformInstances()
  }

  async function loadTaskInstances(): Promise<void> {
    taskInstances = await fetchTaskInstances()
  }

  async function loadAdmins(): Promise<void> {
    admins = await fetchAdmins()
  }

  async function refreshAll(): Promise<void> {
    loading = true
    status = null
    try {
      await Promise.all([loadPlatformInstances(), loadTaskInstances(), loadAdmins()])
    } catch (err) {
      setError(err)
    } finally {
      loading = false
    }
  }

  async function createPlatform(): Promise<void> {
    try {
      await createPlatformInstance({ id: platformId.trim(), type: platformType, config: requireConfig(platformConfig) })
      platformId = ''
      platformConfig = '{}'
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
      await setPlatformInstanceStatus(instance.id, nextStatus)
      platformDirty = true
      await loadPlatformInstances()
      setSuccess(`Platform instance ${nextStatus}. Platform changes are unapplied.`)
    } catch (err) {
      setError(err)
    }
  }

  async function removePlatform(id: string): Promise<void> {
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
      await createTaskInstance({ id: taskId.trim(), type: taskType, config: requireConfig(taskConfig) })
      taskId = ''
      taskConfig = '{}'
      await loadTaskInstances()
      setSuccess('Task instance created.')
    } catch (err) {
      setError(err)
    }
  }

  async function removeTask(id: string): Promise<void> {
    try {
      await deleteTaskInstance(id)
      await loadTaskInstances()
      setSuccess('Task instance deleted.')
    } catch (err) {
      setError(err)
    }
  }

  async function addAdmin(): Promise<void> {
    try {
      await createAdmin({ userId: adminUserId.trim(), platformInstanceId: adminPlatformInstanceId.trim() })
      adminUserId = ''
      adminPlatformInstanceId = ''
      await loadAdmins()
      setSuccess('Admin added.')
    } catch (err) {
      setError(err)
    }
  }

  async function removeAdmin(userId: string, platformInstanceId: string): Promise<void> {
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
            <option value="telegram">Telegram</option>
            <option value="mattermost">Mattermost</option>
            <option value="discord">Discord</option>
          </select>
        </label>
        <label><span>Config JSON</span><input data-testid="platform-config-input" bind:value={platformConfig} /></label>
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
            <option value="kaneo">Kaneo</option>
            <option value="youtrack">YouTrack</option>
          </select>
        </label>
        <label><span>Config JSON</span><input data-testid="task-config-input" bind:value={taskConfig} /></label>
        <button type="submit" data-testid="task-create-button">Create</button>
      </form>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Config</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            {#each taskInstances as instance (instance.id)}
              <tr data-testid="task-instance-row">
                <td>{instance.id}</td><td>{instance.type}</td><td>{instance.status}</td><td>{configLabel(instance.config)}</td><td>{instance.createdAt}</td>
                <td><button type="button" data-testid={`task-delete-${instance.id}`} onclick={() => void removeTask(instance.id)}>Delete</button></td>
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

  @media (max-width: 720px) {
    .instances-subheader {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
