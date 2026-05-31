<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Caption from '../../shared/ui/Caption.svelte'

  export interface SidebarItem {
    id: string
    label: string
  }

  interface Props {
    items: readonly SidebarItem[]
    activeId: string
  }

  let { items, activeId }: Props = $props()
</script>

<aside class="settings-sidebar">
  <Caption>{#snippet children()}sections{/snippet}</Caption>
  <nav class="settings-sidebar__nav">
    {#each items as item (item.id)}
      <a
        class="settings-sidebar__link"
        class:settings-sidebar__link--active={activeId === item.id}
        href={`#${item.id}`}>
        {item.label}
      </a>
    {/each}
  </nav>
</aside>

<style>
  .settings-sidebar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    min-height: 100vh;
  }
  .settings-sidebar__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .settings-sidebar__link {
    color: var(--fg2);
    text-decoration: none;
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    border-left: 2px solid transparent;
  }
  .settings-sidebar__link:hover {
    color: var(--fg);
    background: var(--raised);
  }
  .settings-sidebar__link--active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: var(--raised);
  }
</style>
