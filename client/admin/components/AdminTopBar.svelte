<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import Seg from '../../shared/ui/Seg.svelte'
  import TopBar from '../../shared/ui/TopBar.svelte'

  import { adminState, refreshAll, setWindow } from '../admin.svelte.js'
  import { adminGlobals } from '../global-stats.svelte.js'
  import type { StatsWindow } from '../global-stats.svelte.js'

  const refreshedLabel = $derived.by(() => {
    if (adminState.lastRefreshedAt === null) return 'never'
    const seconds = Math.max(0, Math.floor((Date.now() - adminState.lastRefreshedAt) / 1000))
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ago`
  })
</script>

<TopBar page="admin">
  {#snippet statusRow()}
    <div class="admin-topbar__status">
      <Pill tone="accent" dot>{#snippet children()}configured{/snippet}</Pill>
      <span class="admin-topbar__sep"></span>
      <a class="admin-topbar__back" href="/debug">← /debug</a>
    </div>
  {/snippet}
  {#snippet secondaryRow()}
    <div class="admin-topbar__secondary">
      <span class="admin-topbar__lbl">window</span>
      <Seg
        options={['24h', '7d', '30d', 'all']}
        value={adminGlobals.window}
        onChange={(v) => setWindow(v as StatsWindow)} />
      <span class="admin-topbar__spacer"></span>
      <span class="admin-topbar__lbl">last refreshed</span>
      <span class="admin-topbar__stat">{refreshedLabel}</span>
      <Btn variant="ghost" size="sm" onClick={() => void refreshAll()}>
        {#snippet children()}refresh all{/snippet}
      </Btn>
    </div>
  {/snippet}
</TopBar>

<style>
  .admin-topbar__status,
  .admin-topbar__secondary {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  }
  .admin-topbar__sep {
    width: 1px;
    height: 14px;
    background: var(--border);
  }
  .admin-topbar__back {
    color: var(--fg2);
    text-decoration: none;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .admin-topbar__back:hover {
    color: var(--accent);
  }
  .admin-topbar__lbl {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .admin-topbar__stat {
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .admin-topbar__spacer {
    flex: 1;
  }
</style>
