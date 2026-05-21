<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { AdminSectionId } from '../admin.svelte.js'
  import { adminSections } from '../admin.svelte.js'

  interface Props {
    readonly currentSection: AdminSectionId
  }

  const { currentSection }: Props = $props()
</script>

<nav class="admin-sidebar" aria-label="Admin sections">
  {#each adminSections as section}
    <a
      class:active={section.id === currentSection}
      aria-current={section.id === currentSection ? 'page' : undefined}
      data-testid="admin-nav-item"
      href={`#${section.id}`}
    >
      {section.label}
    </a>
  {/each}
</nav>
