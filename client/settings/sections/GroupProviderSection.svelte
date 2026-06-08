<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Select from '../../shared/ui/Select.svelte'
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
  <PageHeader eyebrow="Group" title="Group task provider">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="group-provider-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if data !== null}
    {#if data.available.length === 0}
      <p>No active task instances are available for this group.</p>
    {:else}
      <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void save() }}>
        <Field label="Task instance">
          <Select
            value={selected}
            options={data.available.map((o) => ({ value: o.id, label: `${o.id} (${o.type} · ${o.status})` }))}
            onChange={(v) => (selected = v)}
            testid="group-task-instance" />
        </Field>
        <Btn variant="primary" type="submit" testid="group-task-instance-save">{#snippet children()}Save{/snippet}</Btn>
      </form>
    {/if}
  {/if}
</section>
