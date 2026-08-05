<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { requiredHarnessState } from './field-required-harness.svelte.js'
  import FieldHintFixture from './FieldHintFixture.svelte'
</script>

<FieldHintFixture required={requiredHarnessState.required} hint={requiredHarnessState.hint} />
