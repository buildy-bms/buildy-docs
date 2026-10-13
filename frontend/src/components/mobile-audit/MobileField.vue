<script setup>
import HelpTip from '@/components/HelpTip.vue'

defineProps({
  label: { type: String, default: '' },
  hint: { type: String, default: '' },
  required: { type: Boolean, default: false },
  // Carte d'aide (v-tooltip) : petite icône ⓘ à côté du libellé, qui s'ouvre aussi au doigt.
  tip: { type: [Object, Function], default: null },
})
</script>

<template>
  <div class="space-y-1.5">
    <div v-if="label && tip" class="flex items-center gap-1 mb-1">
      <label class="pwa-label mb-0">
        {{ label }}
        <span v-if="required" class="text-red-500">*</span>
      </label>
      <HelpTip :tip="tip" class="p-1.5 -my-1.5" />
    </div>
    <label v-else-if="label" class="pwa-label">
      {{ label }}
      <span v-if="required" class="text-red-500">*</span>
    </label>
    <slot />
    <p v-if="hint" class="pwa-body">{{ hint }}</p>
  </div>
</template>
