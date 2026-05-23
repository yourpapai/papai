<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    dashed?: boolean
  }

  let { dashed = false }: Props = $props()
</script>

<div
  class="ui-hr"
  style:border-top-width="1px"
  style:border-top-style={dashed ? 'dashed' : 'solid'}
  style:border-top-color="var(--hair)"
></div>

<style>
  .ui-hr {
    width: 100%;
  }
</style>
