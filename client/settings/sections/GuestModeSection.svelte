<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import { fetchGroupGuestMode, patchGroupGuestMode } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

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
      const result = await fetchGroupGuestMode(id)
      if (id !== contextId) return
      enabled = result.enabled
    } catch (err) {
      if (id === contextId) {
        error = messageFrom(err)
      }
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function toggle(): Promise<void> {
    if (enabled === null) return
    error = null
    mutating = true
    try {
      await patchGroupGuestMode({ contextId, enabled: !enabled })
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

<section id="guest-mode" class="settings-section">
  <PageHeader eyebrow="Group" title="Guest mode">
    {#snippet action()}
      <Btn
        variant={enabled ? 'outline' : 'primary'}
        size="sm"
        disabled={enabled === null || loading || mutating}
        testid="guest-mode-toggle"
        onClick={() => void toggle()}>
        {#snippet children()}{enabled ? 'Disable guest mode' : 'Enable guest mode'}{/snippet}
      </Btn>
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error" data-testid="guest-mode-error">{error}</p>{/if}

  <p class="settings-section__caption">When on, anyone in this chat can use the bot, read-only. Members and admins are unaffected.</p>
</section>

<style>
  .settings-section__caption {
    margin: 0;
    font-size: 12px;
    color: var(--fg3);
    line-height: 1.45;
  }
</style>
