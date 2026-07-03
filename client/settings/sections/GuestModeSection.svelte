<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { formatFetchError } from '../../shared/format-error.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import { fetchGroupGuestMode, patchGroupGuestMode } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let enabled = $state<boolean | null>(null)
  let loading = $state(false)
  let mutating = $state(false)
  let error = $state<unknown>(null)
  let toggleError = $state<unknown>(null)

  async function load(id: string): Promise<void> {
    error = null
    toggleError = null
    loading = true
    try {
      const result = await fetchGroupGuestMode(id)
      if (id !== contextId) return
      enabled = result.enabled
    } catch (err) {
      if (id === contextId) error = err
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function toggle(): Promise<void> {
    if (enabled === null) return
    toggleError = null
    mutating = true
    try {
      await patchGroupGuestMode({ contextId, enabled: !enabled })
      await load(contextId)
    } catch (err) {
      toggleError = err
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
      {#if enabled !== null}
        <Pill tone={enabled ? 'warn' : 'mute'} dot={enabled}>{enabled ? 'On' : 'Off'}</Pill>
        <Btn
          variant="secondary"
          size="sm"
          busy={mutating}
          disabled={loading || mutating}
          testid="guest-mode-toggle"
          onClick={() => void toggle()}>
          {#snippet children()}
            {mutating
              ? enabled
                ? 'Disabling…'
                : 'Enabling…'
              : enabled
                ? 'Disable guest mode'
                : 'Enable guest mode'}
          {/snippet}
        </Btn>
      {/if}
    {/snippet}
  </PageHeader>

  {#if toggleError !== null}
    <p class="status-error" data-testid="guest-mode-error">{formatFetchError(toggleError)}</p>
  {/if}

  {#if error !== null}
    <ErrorState message={formatFetchError(error)} onRetry={() => void load(contextId)} />
  {:else if loading && enabled === null}
    <p class="placeholder">Loading…</p>
  {:else}
    <p class="t-help">
      When on, anyone in this chat can use the bot, read-only. Members and admins are unaffected.
    </p>
  {/if}
</section>
