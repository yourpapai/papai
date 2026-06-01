<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchGroupTaskInstance, patchGroupTaskInstance } from '../fetchers.js'
  import type { GroupTaskInstanceResponse } from '../fetcher-schemas.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let data: GroupTaskInstanceResponse | null = $state(null)
  let selected = $state('')
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  async function load(id: string): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const result = await fetchGroupTaskInstance(id)
      data = result
      const currentId = result.taskInstanceId
      selected =
        currentId !== null && result.available.some((a) => a.id === currentId)
          ? currentId
          : (result.available[0]?.id ?? '')
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function save(): Promise<void> {
    error = null
    status = null
    if (selected === '') return
    try {
      await patchGroupTaskInstance({ taskInstanceId: selected, contextId })
      await load(contextId)
      status = 'Task instance updated.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="group-provider" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Group</p>
      <h2>Group task provider</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if data !== null}
    {#if data.available.length === 0}
      <p>No active task instances are available for this group.</p>
    {:else}
      <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void save() }}>
        <label>
          <span>Task instance</span>
          <select data-testid="group-task-instance" value={selected} onchange={(e) => (selected = (e.target as HTMLSelectElement).value)}>
            {#each data.available as option (option.id)}
              <option value={option.id}>{option.id} ({option.type} · {option.status})</option>
            {/each}
          </select>
        </label>
        <button type="submit" data-testid="group-task-instance-save">Save</button>
      </form>
    {/if}
  {/if}
</section>
