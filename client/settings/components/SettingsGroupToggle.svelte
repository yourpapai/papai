<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    label: string
    hint: string
    collapsed: boolean
    /** id of the element this button shows and hides. */
    controls: string
    testid: string
    onToggle: () => void
  }

  let { label, hint, collapsed, controls, testid, onToggle }: Props = $props()
</script>

<button
  type="button"
  class="settings-group-toggle"
  aria-expanded={!collapsed}
  aria-controls={controls}
  data-testid={testid}
  onclick={onToggle}>
  <span class="settings-group-toggle__chevron">{collapsed ? '▸' : '▾'}</span>
  <span class="settings-group-toggle__label">{label}</span>
  <span class="settings-group-toggle__hint">{hint}</span>
</button>

<style>
  /* A resting box, not a rule: the previous toggle drew only a border-bottom and had
     no hover rule at all, which made it read as a divider rather than a control. */
  .settings-group-toggle {
    display: flex;
    align-items: center;
    gap: var(--gap-tight);
    width: 100%;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 13px;
    text-align: left;
    padding: var(--s3);
    cursor: pointer;
  }
  .settings-group-toggle:hover {
    background: var(--surface-hover);
    border-color: var(--strong);
  }
  .settings-group-toggle:active {
    background: var(--surface-2);
  }
  .settings-group-toggle__hint {
    color: var(--text-muted);
    font-size: 11px;
    margin-left: auto;
    text-align: right;
  }
</style>
