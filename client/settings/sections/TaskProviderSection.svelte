<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
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
</script>

<section id="task-provider" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Task provider</p>
      <h2>Task provider</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {:else if visible.length === 0}
    <p class="placeholder">No task-provider credentials for this context.</p>
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
    <button type="button" data-testid="provision-kaneo" disabled={provisioning} onclick={() => void provision()}>
      {provisioning ? 'Provisioning…' : 'Provision Kaneo'}
    </button>
    {#if provisionError !== null}
      <p class="status-error">{provisionError}</p>
    {/if}
    {#if provisioned !== null}
      <div class="settings-provision__reveal" data-testid="provision-result">
        <p class="status-success">Provisioned — copy these now, they will not be shown again:</p>
        <dl>
          <div><dt>Email</dt><dd>{provisioned.email}</dd></div>
          <div><dt>Password</dt><dd>{provisioned.password}</dd></div>
          <div><dt>Kaneo URL</dt><dd>{provisioned.kaneoUrl}</dd></div>
        </dl>
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
  .settings-provision button {
    justify-self: start;
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 8px 12px;
    border-radius: 2px;
  }
  .settings-provision__reveal dl {
    display: grid;
    gap: 6px;
  }
  .settings-provision__reveal div {
    display: flex;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-provision__reveal dt {
    color: var(--fg3);
    min-width: 80px;
  }
</style>
