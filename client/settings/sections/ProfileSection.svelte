<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import ConfigFieldRow from '../components/ConfigFieldRow.svelte'
  import type { ConfigField } from '../fetcher-schemas.js'
  import { fetchConfig } from '../fetchers.js'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let fields: ConfigField[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)

  const visible = $derived(
    fields.filter((field) => field.kind === 'preference' && field.storageKey !== 'mcp_endpoints'),
  )

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

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="profile" class="settings-section">
  <PageHeader
    eyebrow="Personal"
    title="Profile"
    sub="Personal preferences for how the bot addresses and responds to you."
  >
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="profile-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if loading && visible.length === 0}
    <p class="placeholder">Loading…</p>
  {:else if visible.length === 0}
    <EmptyState
      title="No profile settings"
      hint="Personal preferences will appear here once this context has editable settings."
    >
      {#snippet action()}
        <a class="settings-empty-link" href="#task-provider">Configure task provider →</a>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="settings-field-list">
      {#each visible as field (field.key)}
        <ConfigFieldRow {contextId} {field} onSaved={() => void load(contextId)} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .settings-field-list {
    display: grid;
    gap: var(--gap-inline);
  }

  .settings-empty-link {
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 12px;
    text-decoration: none;
  }
  .settings-empty-link:hover {
    text-decoration: underline;
  }
</style>
