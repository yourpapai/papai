<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import TopBar from '../../shared/ui/TopBar.svelte'

  import { logout } from '../fetchers.js'
  import { setActiveContext, settingsSession } from '../session.svelte.js'

  async function signOut(): Promise<void> {
    await logout()
    window.location.href = '/settings'
  }
</script>

<TopBar page="settings">
  {#snippet statusRow()}
    <div class="settings-topbar__status">
      <Pill tone="accent" dot>{#snippet children()}{settingsSession.display}{/snippet}</Pill>
      <span class="settings-topbar__spacer"></span>
      <label class="settings-topbar__ctx">
        <span class="settings-topbar__lbl">context</span>
        <select
          data-testid="context-switcher"
          value={settingsSession.activeContextId}
          onchange={(event) => setActiveContext((event.target as HTMLSelectElement).value)}>
          {#each settingsSession.contexts as ctx (ctx.contextId)}
            <option value={ctx.contextId}>{ctx.label}</option>
          {/each}
        </select>
      </label>
      <Btn variant="ghost" size="sm" onClick={() => void signOut()}>
        {#snippet children()}sign out{/snippet}
      </Btn>
    </div>
  {/snippet}
</TopBar>

<style>
  .settings-topbar__status {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  }
  .settings-topbar__spacer {
    flex: 1;
  }
  .settings-topbar__ctx {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .settings-topbar__lbl {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .settings-topbar__ctx select {
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 2px;
  }
</style>
