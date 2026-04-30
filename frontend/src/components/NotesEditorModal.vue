<script setup>
import { ref, computed, watch } from 'vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import RichTextEditor from './RichTextEditor.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: 'Notes' },
  contextLabel: { type: String, default: '' },
  modelValue: { type: String, default: '' },
  // Contexte transmis a Claude pour la reformulation. Doit contenir
  // au minimum { kind: 'bacs_audit_notes', title }. Optionnel : parent_path,
  // category_label.
  assistContext: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue', 'close', 'save'])

const localHtml = ref(props.modelValue || '')

watch(() => props.open, (open) => {
  if (open) localHtml.value = props.modelValue || ''
})

const placeholder = computed(() => {
  return 'Notes terrain : marque, reference, etat, defaut constate, position GTB...'
})

function handleSave() {
  emit('update:modelValue', localHtml.value)
  emit('save', localHtml.value)
  emit('close')
}

function handleCancel() {
  emit('close')
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
       @click.self="handleCancel">
    <div class="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
      <header class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 class="text-base font-semibold text-gray-900">{{ title }}</h3>
          <p v-if="contextLabel" class="text-xs text-gray-500 mt-0.5">{{ contextLabel }}</p>
        </div>
        <button @click="handleCancel" class="p-1 rounded hover:bg-gray-100 text-gray-500" title="Fermer">
          <XMarkIcon class="w-5 h-5" />
        </button>
      </header>

      <div class="flex-1 overflow-y-auto p-5">
        <RichTextEditor
          v-model="localHtml"
          :placeholder="placeholder"
          min-height="280px"
          :assist-context="assistContext"
        />
        <p class="mt-3 text-[11px] text-gray-500 italic">
          Astuce : redige tes observations brutes puis clique sur ✨ <strong>Reformuler avec Claude</strong>
          pour les transformer en note professionnelle.
        </p>
      </div>

      <footer class="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2 bg-gray-50">
        <button
          @click="handleCancel"
          class="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition"
        >
          Annuler
        </button>
        <button
          @click="handleSave"
          class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition shadow-sm"
        >
          Enregistrer
        </button>
      </footer>
    </div>
  </div>
</template>
