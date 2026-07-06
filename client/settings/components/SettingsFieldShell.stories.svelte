<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Btn from '../../shared/ui/Btn.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import SettingsFieldShell from './SettingsFieldShell.svelte'

  const { Story } = defineMeta({
    title: 'settings/components/SettingsFieldShell',
    component: SettingsFieldShell,
  })
</script>

<Story name="Editor open, required" asChild>
  <SettingsFieldShell label="Anthropic API Key" required editorOpen={true}>
    {#snippet editor()}
      <Input type="password" value="" placeholder="enter a new value" />
      <Btn variant="primary" size="sm">{#snippet children()}Save{/snippet}</Btn>
    {/snippet}
  </SettingsFieldShell>
</Story>

<Story name="Masked resting" asChild>
  <SettingsFieldShell label="Anthropic API Key" required editorOpen={false}>
    {#snippet head()}
      <Secret value="••••WvfQ" />
      <Btn variant="secondary" size="sm">{#snippet children()}Replace{/snippet}</Btn>
    {/snippet}
  </SettingsFieldShell>
</Story>

<Story name="Optional with footer hint" asChild>
  <SettingsFieldShell label="Model" editorOpen={true}>
    {#snippet editor()}
      <Input value="claude-opus-4-5" />
      <Btn variant="primary" size="sm">{#snippet children()}Save{/snippet}</Btn>
    {/snippet}
    {#snippet footer()}
      <p class="settings-field__hint">Leave blank for the agent default.</p>
    {/snippet}
  </SettingsFieldShell>
</Story>
