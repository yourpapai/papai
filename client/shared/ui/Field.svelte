<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    children: Snippet
    required?: boolean
    hint?: string
  }

  let { label, children, required = false, hint }: Props = $props()
</script>

<div class="ui-field">
  <span class="ui-field__label">
    {label}{#if required}<span class="ui-field__req">*</span>{/if}
  </span>
  {@render children()}
  {#if hint}<span class="ui-field__hint">{hint}</span>{/if}
</div>

<style>
  .ui-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .ui-field__label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg3);
  }
  .ui-field__req {
    color: var(--accent);
    margin-left: 5px;
  }
  .ui-field__hint {
    font-size: 10px;
    color: var(--fg4);
  }
</style>
