<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Caption from '../../shared/ui/Caption.svelte'
  import HR from '../../shared/ui/HR.svelte'
  import KV from '../../shared/ui/KV.svelte'

  import { adminGlobals } from '../global-stats.svelte.js'

  interface SidebarItem {
    id: string
    label: string
  }

  const items: readonly SidebarItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'billing', label: 'Billing' },
    { id: 'stats', label: 'Stats' },
    { id: 'memos', label: 'Memos' },
    { id: 'reminders', label: 'Reminders' },
    { id: 'identities', label: 'Identities' },
  ]

  interface Props {
    activeId: string
  }

  let { activeId }: Props = $props()
</script>

<aside class="admin-sidebar">
  <Caption>{#snippet children()}sections{/snippet}</Caption>
  <nav class="admin-sidebar__nav">
    {#each items as item (item.id)}
      <a
        class="admin-sidebar__link"
        class:admin-sidebar__link--active={activeId === item.id}
        href={`#${item.id}`}>
        {item.label}
      </a>
    {/each}
  </nav>
  <HR />
  <Caption>{#snippet children()}quick stats{/snippet}</Caption>
  <div class="admin-sidebar__kvs">
    <KV k="DM" v={adminGlobals.data?.subjects?.dmTotal ?? '—'} />
    <KV k="active" v={adminGlobals.data?.active?.activeIn30d ?? '—'} />
    <KV k="tools" v="—" />
  </div>
</aside>

<style>
  .admin-sidebar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    min-height: 100vh;
  }
  .admin-sidebar__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .admin-sidebar__link {
    color: var(--fg2);
    text-decoration: none;
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    border-left: 2px solid transparent;
  }
  .admin-sidebar__link:hover {
    color: var(--fg);
    background: var(--raised);
  }
  .admin-sidebar__link--active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: var(--raised);
  }
  .admin-sidebar__kvs {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
