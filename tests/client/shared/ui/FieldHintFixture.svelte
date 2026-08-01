<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Field from '../../../../client/shared/ui/Field.svelte'
  import Input from '../../../../client/shared/ui/Input.svelte'

  interface Props {
    hint?: string
    error?: string
    required?: boolean
  }

  let { hint, error, required = false }: Props = $props()
</script>

<Field label="Kaneo URL" {hint} {error} {required}>
  <Input value="" testid="hint-input" />
</Field>
