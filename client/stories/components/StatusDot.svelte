<script lang="ts">
  interface Props {
    connected: boolean
  }
  let { connected }: Props = $props()
</script>

<span class="status-dot {connected ? 'connected' : 'disconnected'}">
  ● {connected ? 'connected' : 'disconnected'}
</span>
