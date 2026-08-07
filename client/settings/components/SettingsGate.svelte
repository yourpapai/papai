<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import { retryBootstrap, settingsSession } from '../session.svelte.js'

  let retrying = $state(false)

  async function retry(): Promise<void> {
    retrying = true
    await retryBootstrap()
    retrying = false
  }
</script>

<main class="settings-gate">
  <p class="t-kicker settings-gate__brand">papai · settings</p>
  {#if settingsSession.status === 'loading'}
    <p role="status" data-testid="gate-loading">Loading your settings…</p>
  {:else if settingsSession.status === 'unauthenticated'}
    <h1 class="t-section">Session expired or missing</h1>
    <p>Request a new settings link by sending <code>/config</code> to the bot.</p>
  {:else}
    <h1 class="t-section">Could not load your settings</h1>
    <p class="status-error" data-testid="gate-reason">{settingsSession.failureMessage}</p>
    <p>The link is still valid — this was a problem reaching the server.</p>
    <Btn variant="primary" busy={retrying} testid="gate-retry" onClick={() => void retry()}>
      {#snippet children()}{retrying ? 'Retrying…' : 'Try again'}{/snippet}
    </Btn>
  {/if}
</main>

<style>
  .settings-gate__brand {
    margin: 0 0 var(--gap-inline);
  }
</style>
