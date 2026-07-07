<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import SummaryList from '../../shared/ui/SummaryList.svelte'
  import { formatFetchError } from '../../shared/format-error.js'
  import ConfigFieldRow from '../components/ConfigFieldRow.svelte'
  import type { ConfigField, ContextTaskInstanceResponse, ProvisionResult } from '../fetcher-schemas.js'
  import { fetchConfig, fetchContextTaskInstance, patchContextTaskInstance, provisionKaneo } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let fields: ConfigField[] = $state([])
  let error: unknown = $state(null)
  let loading = $state(false)
  let provisioning = $state(false)
  let provisionError: unknown = $state(null)
  let provisioned: ProvisionResult | null = $state(null)

  let instanceData: ContextTaskInstanceResponse | null = $state(null)
  let selectedInstanceId = $state('')
  let bindError: unknown = $state(null)
  let bindStatus: string | null = $state(null)
  let binding = $state(false)

  const visible = $derived(fields.filter((field) => field.kind === 'provider-context'))

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      const [config, instance] = await Promise.all([fetchConfig(id), fetchContextTaskInstance(id)])
      if (id !== contextId) return
      fields = config.fields
      instanceData = instance
      const currentId = instance.taskInstanceId
      selectedInstanceId =
        currentId !== null && instance.available.some((a) => a.id === currentId)
          ? currentId
          : (instance.available[0]?.id ?? '')
    } catch (err) {
      if (id === contextId) error = err
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function bindInstance(): Promise<void> {
    bindError = null
    bindStatus = null
    if (selectedInstanceId === '') return
    binding = true
    try {
      await patchContextTaskInstance({ taskInstanceId: selectedInstanceId, contextId })
      bindStatus = 'Task instance bound.'
      await load(contextId)
    } catch (err) {
      bindError = err
    } finally {
      binding = false
    }
  }

  async function provision(): Promise<void> {
    provisionError = null
    provisioning = true
    provisioned = null
    try {
      provisioned = await provisionKaneo(contextId)
      await load(contextId)
    } catch (err) {
      provisionError = err
    } finally {
      provisioning = false
    }
  }

  $effect(() => {
    void load(contextId)
  })

  $effect(() => {
    void contextId // track context changes
    untrack(() => {
      provisioned = null
      provisionError = null
    })
  })
</script>

<section id="task-provider" class="settings-section">
  <PageHeader eyebrow="Personal" title="Task provider">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="task-provider-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null && instanceData === null}
    <ErrorState message={formatFetchError(error)} onRetry={() => void load(contextId)} />
  {:else if loading && instanceData === null}
    <p class="placeholder">Loading…</p>
  {:else}
    {#if error !== null}<p class="status-error" role="alert">{formatFetchError(error)}</p>{/if}
    {#if instanceData !== null}
      <div class="settings-task-instance">
        {#if bindError !== null}<p class="status-error">{formatFetchError(bindError)}</p>{/if}
        {#if bindStatus !== null}<p class="status-success">{bindStatus}</p>{/if}
        {#if instanceData.available.length === 0}
          <p class="placeholder">No active task instances available. Ask an admin to create one.</p>
        {:else}
          <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void bindInstance() }}>
            <Field label="Task instance">
              <Select
                value={selectedInstanceId}
                options={instanceData.available.map((o) => ({ value: o.id, label: `${o.name ?? o.id} (${o.type} · ${o.status})` }))}
                onChange={(v) => (selectedInstanceId = v)}
                disabled={binding}
                testid="context-task-instance" />
            </Field>
            <Btn variant="primary" type="submit" disabled={binding} testid="context-task-instance-save">
              {#snippet children()}{binding ? 'Binding…' : 'Bind'}{/snippet}
            </Btn>
          </form>
        {/if}
      </div>
    {/if}

    {#if visible.length > 0}
      <div class="settings-field-list">
        {#each visible as field (field.key)}
          <ConfigFieldRow {contextId} {field} onSaved={() => void load(contextId)} />
        {/each}
      </div>
    {:else if instanceData?.taskInstanceId == null}
      <p class="placeholder">Bind a task instance above to configure its credentials.</p>
    {/if}
  {/if}

  {#if instanceData?.canProvision === true}
    <div class="settings-provision">
      <h3>Kaneo auto-provision</h3>
      <p class="placeholder">Creates a Kaneo account and stores its API key for this context. Credentials are shown once.</p>
      <div class="provision-actions">
        <Btn variant="primary" testid="provision-kaneo" disabled={provisioning} onClick={() => void provision()}>
          {#snippet children()}{provisioning ? 'Provisioning…' : 'Provision Kaneo'}{/snippet}
        </Btn>
      </div>
      {#if provisionError !== null}
        <p class="status-error">{formatFetchError(provisionError)}</p>
      {/if}
      {#if provisioned !== null}
        <div class="settings-provision__reveal" data-testid="provision-result">
          <p class="status-success">Provisioned — copy these now, they will not be shown again:</p>
          <SummaryList items={[
            { k: 'Email', v: provisioned.email },
            { k: 'Kaneo URL', v: provisioned.kaneoUrl },
          ]} />
          <div class="settings-provision__secret">
            <span class="settings-provision__secret-label">Password</span>
            <Secret value={provisioned.password} hint="shown once — copy now" />
          </div>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .settings-field-list {
    display: grid;
    gap: var(--gap-inline);
    margin-bottom: 16px;
  }
  .settings-provision {
    display: grid;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .provision-actions { display: flex; }
  .settings-provision__secret {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-provision__secret-label {
    color: var(--fg3);
    min-width: 80px;
  }
</style>
