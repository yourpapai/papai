<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from './Btn.svelte'

  interface Props {
    message: string
    title?: string
    icon?: string
    /** Raw diagnostic text (e.g. an exception message) demoted to a collapsed disclosure. */
    detail?: string
    onRetry?: () => void
    retryLabel?: string
  }

  let { message, title = 'Something went wrong', icon = '⚠', detail, onRetry, retryLabel = 'Try again' }: Props =
    $props()
</script>

<div class="ui-error" role="alert">
  <div class="ui-error__icon">{icon}</div>
  <div class="ui-error__title">{title}</div>
  <div class="ui-error__message">{message}</div>
  {#if detail}
    <details class="ui-error__detail">
      <summary>Technical details</summary>
      <pre class="ui-error__detail-text">{detail}</pre>
    </details>
  {/if}
  {#if onRetry}
    <div class="ui-error__action">
      <Btn variant="outline" size="sm" onClick={onRetry} testid="error-retry">
        {#snippet children()}{retryLabel}{/snippet}
      </Btn>
    </div>
  {/if}
</div>

<style>
  .ui-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--gap-tight);
    padding: 36px 24px;
    text-align: center;
    min-height: 120px;
  }
  .ui-error__icon {
    font-size: 22px;
    color: var(--danger);
    line-height: 1;
  }
  .ui-error__title {
    font-size: 13px;
    color: var(--text-muted);
  }
  .ui-error__message {
    font-size: 11px;
    color: var(--danger);
    max-width: 320px;
    word-break: break-word;
  }
  .ui-error__action {
    margin-top: 6px;
  }
  .ui-error__detail {
    font-size: 11px;
    color: var(--text-muted);
    max-width: 320px;
    text-align: left;
  }
  .ui-error__detail summary {
    cursor: pointer;
  }
  .ui-error__detail-text {
    margin: var(--gap-tight) 0 0;
    font-family: var(--font-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
