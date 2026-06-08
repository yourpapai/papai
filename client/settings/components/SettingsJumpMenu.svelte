<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { SidebarGroup } from './SettingsSidebar.svelte'

  interface Props {
    groups: readonly SidebarGroup[]
    activeId: string
  }

  let { groups, activeId }: Props = $props()

  let selectEl: HTMLSelectElement | undefined = $state()

  $effect(() => {
    if (selectEl === undefined) return
    function onChange(event: Event): void {
      const id = (event.target as HTMLSelectElement).value
      window.location.hash = `#${id}`
    }
    selectEl.addEventListener('change', onChange)
    return () => {
      selectEl?.removeEventListener('change', onChange)
    }
  })
</script>

<div class="settings-jump">
  <label class="t-label" for="settings-jump-select">Jump to</label>
  <select id="settings-jump-select" value={activeId} bind:this={selectEl}>
    {#each groups as group (group.kicker)}
      <optgroup label={group.kicker}>
        {#each group.items as item (item.id)}
          <option value={item.id}>{item.label}</option>
        {/each}
      </optgroup>
    {/each}
  </select>
</div>

<style>
  .settings-jump {
    display: none;
    flex-direction: column;
    gap: 6px;
    padding: 12px var(--gap-section) 0;
  }
  .settings-jump select {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 14px;
    height: var(--row-h);
    padding: 0 10px;
  }
  @media (max-width: 720px) {
    .settings-jump { display: flex; }
  }
</style>
