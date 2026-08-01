<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import SettingsFieldShell from '../../../../client/settings/components/SettingsFieldShell.svelte'
  import Input from '../../../../client/shared/ui/Input.svelte'

  interface Props {
    error?: string
  }

  let { error }: Props = $props()
</script>

<SettingsFieldShell label="Instance URL" {error}>
  {#snippet editor()}
    <Input value="" testid="fixture-input" />
  {/snippet}
</SettingsFieldShell>
