<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Field from '../../../../client/shared/ui/Field.svelte'
  import Select from '../../../../client/shared/ui/Select.svelte'
</script>

<Field label="Task instance">
  <Select value="a" options={[{ value: 'a', label: 'A' }]} testid="fixture-select" />
</Field>
