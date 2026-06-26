<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
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
  let loading = $state(false)
  let mutating = $state(false)
  let error: string | null = $state(null)

  function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      const result = scope === 'group' ? await fetchGroupReleaseSubscription(id) : await fetchReleaseSubscription()
      if (scope === 'group' && id !== contextId) return
      enabled = result.enabled
    } catch (err) {
      error = messageFrom(err)
    } finally {
      loading = false
    }
  }

  async function toggle(): Promise<void> {
    if (enabled === null) return
    error = null
    mutating = true
    try {
      if (scope === 'group') await patchGroupReleaseSubscription({ contextId, enabled: !enabled })
      else await patchReleaseSubscription({ enabled: !enabled })
      await load(contextId)
    } catch (err) {
      error = messageFrom(err)
    } finally {
      mutating = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="release-announcements" class="settings-section">
  <PageHeader eyebrow={scope === 'group' ? 'Group' : 'Personal'} title="Release announcements">
    {#snippet action()}
      <Btn
        variant={enabled ? 'outline' : 'primary'}
        size="sm"
        disabled={enabled === null || loading || mutating}
        testid="release-subscription-toggle"
        onClick={() => void toggle()}>
        {#snippet children()}{enabled ? 'Unsubscribe' : 'Subscribe'}{/snippet}
      </Btn>
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error" data-testid="release-subscription-error">{error}</p>{/if}

  <p class="settings-section__caption">
    {#if scope === 'group'}
      When on, this group receives a message whenever a new bot version ships. Only future releases — past ones are not re-sent.
    {:else}
      When on, you receive a DM whenever a new bot version ships. Only future releases — past ones are not re-sent.
    {/if}
  </p>
</section>

<style>
  .settings-section__caption {
    margin: 0;
    font-size: 12px;
    color: var(--fg3);
    line-height: 1.45;
  }
</style>
