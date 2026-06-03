<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Btn from '../../shared/ui/Btn.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import SummaryList from '../../shared/ui/SummaryList.svelte'
  import ConfigFieldRow from '../components/ConfigFieldRow.svelte'
  import type { ConfigField, ProvisionResult } from '../fetcher-schemas.js'
  import { fetchConfig, provisionKaneo } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let fields: ConfigField[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let provisioning = $state(false)
  let provisionError: string | null = $state(null)
  let provisioned: ProvisionResult | null = $state(null)

  const visible = $derived(fields.filter((field) => field.kind === 'provider-context'))

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      fields = (await fetchConfig(id)).fields
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
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
      provisionError = err instanceof Error ? err.message : String(err)
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
  <PageHeader title="Task provider">
    {#snippet action()}
      <Btn variant="ghost" size="sm" onClick={() => void load(contextId)}>
        {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
      </Btn>
    {/snippet}
  </PageHeader>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {:else if visible.length === 0}
    <EmptyState title="No task-provider credentials" hint="No task-provider credentials for this context." />
  {:else}
    <div class="settings-field-list">
      {#each visible as field (field.key)}
        <ConfigFieldRow {contextId} {field} onSaved={() => void load(contextId)} />
      {/each}
    </div>
  {/if}

  <div class="settings-provision">
    <h3>Kaneo auto-provision</h3>
    <p class="placeholder">Creates a Kaneo account and stores its API key for this context. Credentials are shown once.</p>
    <Btn variant="primary" testid="provision-kaneo" disabled={provisioning} onClick={() => void provision()}>
      {#snippet children()}{provisioning ? 'Provisioning…' : 'Provision Kaneo'}{/snippet}
    </Btn>
    {#if provisionError !== null}
      <p class="status-error">{provisionError}</p>
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
</section>

<style>
  .settings-field-list {
    display: grid;
    gap: 12px;
    margin-bottom: 16px;
  }
  .settings-provision {
    display: grid;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
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
