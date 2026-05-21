<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    open: boolean
    title: string
    onClose: () => void
    body: Snippet
  }

  let { open, title, onClose, body }: Props = $props()

  function onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) onClose()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open) onClose()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="modal" onclick={onBackdropClick} role="presentation">
    <div class="modal-content">
      <div class="modal-header">
        <h3>{title}</h3>
        <button class="modal-close" aria-label="Close" onclick={onClose}>×</button>
      </div>
      <div class="modal-body">
        {@render body()}
      </div>
    </div>
  </div>
{/if}
