<script setup>
defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  required: { type: Boolean, default: false },
})
</script>

<template>
  <div class="space-y-1.5">
    <label v-if="label" class="pwa-label">
      {{ label }}
      <span v-if="required" class="text-red-500">*</span>
    </label>
    <slot />
    <p v-if="hint" class="pwa-body">{{ hint }}</p>
  </div>
</template>
