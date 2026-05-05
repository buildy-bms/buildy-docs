<script setup>
defineProps({
  withSafeArea: { type: Boolean, default: true },
})
</script>

<template>
  <div
    class="fixed inset-x-0 bottom-0 z-40 bg-white border-t border-gray-200 lg:hidden"
    :style="withSafeArea ? { paddingBottom: 'env(safe-area-inset-bottom)' } : null"
  >
    <div class="flex items-center justify-between gap-2 px-3 h-14">
      <div class="flex items-center gap-2 min-w-0">
        <slot name="left" />
      </div>
      <div class="flex-1 min-w-0 flex items-center justify-center">
        <slot name="center" />
      </div>
      <div class="flex items-center gap-2 min-w-0 justify-end">
        <slot name="right" />
      </div>
    </div>
  </div>
</template>
