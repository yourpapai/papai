<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import SettingsApp from './SettingsApp.svelte'

  const { Story } = defineMeta({
    title: 'settings/SettingsApp',
    component: SettingsApp,
  })
</script>

<!-- Personal, non-admin, Advanced collapsed: sidebar + top bar + the always-on sections. -->
<Story name="Personal ready" parameters={{ fixtures: 'settings-shell-ready', settingsReady: true }} />

<!-- Group, non-admin, Advanced collapsed: sidebar + group-only sections (Members, Group provider, Guest mode, Session identity, My Kaneo access). -->
<Story name="Group ready" parameters={{ fixtures: 'settings-shell-group-ready', settingsReady: 'group' }} />

<!-- Personal context with both admin flags: full Admin zone (bot-admin + super-admin sections). -->
<Story name="Admin ready" parameters={{ fixtures: 'settings-shell-admin-ready', settingsReady: 'admin' }} />
