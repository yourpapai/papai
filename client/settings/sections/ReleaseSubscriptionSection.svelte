<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import {
    fetchGroupReleaseSubscription,
    fetchReleaseSubscription,
    patchGroupReleaseSubscription,
    patchReleaseSubscription,
  } from '../release-fetchers.js'

  interface Props {
    scope: 'personal' | 'group'
    contextId: string
  }

  let { scope, contextId }: Props = $props()

  let enabled = $state<boolean | null>(null)
  let mutating = $state(false)
  let loadError: string | null = $state(null)
  let actionError: string | null = $state(null)

  function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function load(id: string): Promise<void> {
    loadError = null
    try {
      const result = scope === 'group' ? await fetchGroupReleaseSubscription(id) : await fetchReleaseSubscription()
      if (scope === 'group' && id !== contextId) return
      enabled = result.enabled
    } catch (err) {
      if (id === contextId) loadError = messageFrom(err)
    }
  }

  async function toggle(): Promise<void> {
    if (enabled === null) return
    actionError = null
    mutating = true
    try {
      if (scope === 'group') await patchGroupReleaseSubscription({ contextId, enabled: !enabled })
      else await patchReleaseSubscription({ enabled: !enabled })
      await load(contextId)
    } catch (err) {
      actionError = messageFrom(err)
    } finally {
      mutating = false
    }
  }

  const idleLabel = $derived(enabled ? 'Unsubscribe' : 'Subscribe')
  const busyLabel = $derived(enabled ? 'Unsubscribing…' : 'Subscribing…')

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="release-announcements-{scope}" class="settings-section">
  <PageHeader eyebrow={scope === 'group' ? 'Group' : 'Personal'} title="Release announcements">
    {#snippet action()}
      {#if enabled !== null && loadError === null}
        <Btn
          variant={enabled ? 'outline' : 'primary'}
          size="sm"
          busy={mutating}
          testid="release-subscription-toggle"
          onClick={() => void toggle()}>
          {#snippet children()}{mutating ? busyLabel : idleLabel}{/snippet}
        </Btn>
      {/if}
    {/snippet}
  </PageHeader>

  {#if loadError !== null}
    <ErrorState title="Couldn't load subscription" message={loadError} onRetry={() => void load(contextId)} />
  {:else if enabled === null}
    <p class="placeholder">Loading…</p>
  {:else}
    <p class="settings-section__caption">
      {#if scope === 'group'}
        When on, this group receives a message whenever a new bot version ships. Only future releases — past ones are
        not re-sent.
      {:else}
        When on, you receive a DM whenever a new bot version ships. Only future releases — past ones are not re-sent.
      {/if}
    </p>
    {#if actionError !== null}
      <p class="settings-section__action-error status-error" role="alert" data-testid="release-subscription-error">
        {actionError}
      </p>
    {/if}
  {/if}
</section>

<style>
  .settings-section__caption {
    margin: 0;
    font-size: 12px;
    color: var(--fg3);
    line-height: 1.45;
  }
  .settings-section__action-error {
    margin: var(--gap-inline) 0 0;
    font-size: 12px;
  }
</style>
