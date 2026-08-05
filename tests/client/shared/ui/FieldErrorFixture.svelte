<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Combobox from '../../../../client/shared/ui/Combobox.svelte'
  import Field from '../../../../client/shared/ui/Field.svelte'
  import Select from '../../../../client/shared/ui/Select.svelte'

  interface Props {
    error?: string
  }

  let { error }: Props = $props()
</script>

<Field label="Model provider" {error}>
  <Select value="a" options={[{ value: 'a', label: 'A' }]} testid="err-select" />
  <Combobox value="" testid="err-combobox" />
</Field>
