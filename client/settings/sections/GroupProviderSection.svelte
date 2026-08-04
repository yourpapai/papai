<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import { formatFetchError } from '../../shared/format-error.js'
  import { fetchGroupTaskInstance, patchGroupTaskInstance } from '../fetchers.js'
  import type { GroupTaskInstanceResponse } from '../fetcher-schemas.js'
  import { formatTaskInstanceOption } from '../lib/task-instance-label.js'
  import { resolveTaskInstanceSelection } from '../lib/task-instance-selection.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let data: GroupTaskInstanceResponse | null = $state(null)
  let selected = $state('')
  let selectPlaceholder = $state('')
  let loadError: unknown = $state(null)
  let saveError: unknown = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let saving = $state(false)

  async function load(id: string): Promise<void> {
    loadError = null
    saveError = null
    status = null
    loading = true
    try {
      const result = await fetchGroupTaskInstance(id)
      if (id !== contextId) return
      data = result
      const selection = resolveTaskInstanceSelection(result.taskInstanceId, result.available)
      selected = selection.selected
      selectPlaceholder = selection.placeholder
    } catch (err) {
      if (id === contextId) loadError = err
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function save(): Promise<void> {
    saveError = null
    status = null
    if (selected === '') return
    saving = true
    try {
      await patchGroupTaskInstance({ taskInstanceId: selected, contextId })
      await load(contextId)
      status = 'Task instance updated.'
    } catch (err) {
      saveError = err
    } finally {
      saving = false
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

  {#if loadError !== null && data === null}
    <ErrorState message={formatFetchError(loadError)} onRetry={() => void load(contextId)} />
  {:else if loading && data === null}
    <p class="placeholder">Loading…</p>
  {:else if data !== null}
    {#if loadError !== null}
      <p class="status-error" role="alert" data-testid="group-provider-load-error">{formatFetchError(loadError)}</p>
    {/if}
    {#if status !== null}<p class="status-success">{status}</p>{/if}
    {#if saveError !== null}<p class="status-error">{formatFetchError(saveError)}</p>{/if}
    {#if data.available.length === 0}
      <p class="placeholder">No active task instances available. Ask an admin to create one.</p>
    {:else}
      <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void save() }}>
        <Field label="Task instance">
          <Select
            value={selected}
            options={data.available.map(formatTaskInstanceOption)}
            placeholder={selectPlaceholder}
            onChange={(v) => (selected = v)}
            disabled={saving}
            testid="group-task-instance" />
        </Field>
        <Btn variant="primary" type="submit" disabled={saving} busy={saving} testid="group-task-instance-save">
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
      </form>
    {/if}
  {/if}
</section>
