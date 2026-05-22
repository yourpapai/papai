<script lang="ts">
  import Modal from '../../../client/shared/Modal.svelte'

  interface Props {
    open: boolean
    title: string
    onClose: () => void
  }

  let { open, title, onClose }: Props = $props()
</script>

<Modal {open} {title} {onClose}>
  {#snippet body()}
    <div>Modal Content</div>
  {/snippet}
</Modal>
