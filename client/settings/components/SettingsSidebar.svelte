<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  export interface SidebarItem {
    id: string
    label: string
  }
  export interface SidebarGroup {
    kicker: string
    items: readonly SidebarItem[]
    danger?: boolean
  }

  interface Props {
    groups: readonly SidebarGroup[]
    activeId: string
  }

  let { groups, activeId }: Props = $props()
</script>

<aside class="settings-sidebar">
  {#each groups as group (group.kicker)}
    <div class="settings-sidebar__group" class:settings-sidebar__group--danger={group.danger === true}>
      <div class="t-kicker settings-sidebar__kicker">
        {group.kicker}{#if group.danger}<span class="settings-sidebar__badge">admin</span>{/if}
      </div>
      <nav class="settings-sidebar__nav">
        {#each group.items as item (item.id)}
          <a
            class="settings-sidebar__link"
            class:settings-sidebar__link--active={activeId === item.id}
            aria-current={activeId === item.id ? 'page' : undefined}
            href={`#${item.id}`}>
            {item.label}
          </a>
        {/each}
      </nav>
    </div>
  {/each}
</aside>

<style>
  .settings-sidebar {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 16px 12px;
    background: var(--surface-1);
    border-right: 1px solid var(--border);
    position: sticky;
    top: 0;
    align-self: start;
    max-height: 100vh;
    overflow-y: auto;
  }
  .settings-sidebar__group--danger {
    border-left: 2px solid var(--danger);
    padding-left: 10px;
    margin-left: -12px;
  }
  .settings-sidebar__kicker {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .settings-sidebar__badge {
    color: var(--danger);
    border: 1px solid var(--danger);
    border-radius: var(--radius-pill);
    padding: 0 6px;
    font-size: 9px;
    letter-spacing: 0.08em;
  }
  .settings-sidebar__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .settings-sidebar__link {
    color: var(--text-muted);
    text-decoration: none;
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    border-left: 2px solid transparent;
  }
  .settings-sidebar__link:hover {
    color: var(--text);
    background: var(--surface-hover);
  }
  .settings-sidebar__link--active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: var(--surface-2);
  }
  @media (max-width: 720px) {
    .settings-sidebar { display: none; }
  }
</style>
