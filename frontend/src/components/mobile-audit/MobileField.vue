<script setup>
defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  required: { type: Boolean, default: false },
})
</script>

<template>
  <div class="space-y-1.5">
    <label v-if="label" class="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
      {{ label }}
      <span v-if="required" class="text-red-500">*</span>
    </label>
    <slot />
    <p v-if="hint" class="text-sm text-gray-500 leading-relaxed">{{ hint }}</p>
  </div>
</template>
