<script setup>
/**
 * Bloc d'une étape de l'audit : une rubrique repliable, comme la fiche équipement de l'étape
 * Systèmes (en-tête DeviceSectionHeader : icône, titre, état, ce qui manque ou le résumé des
 * réponses).
 */
import DeviceSectionHeader from '@/components/audit/DeviceSectionHeader.vue'

defineProps({
  id: { type: String, required: true },          // ancre du bloc (sommaire, liens « Corriger »)
  title: { type: String, default: '' },
  icon: { type: String, default: 'circle' },
  open: { type: Boolean, default: true },
  missing: { type: Array, default: () => [] },
  unanswered: { type: Array, default: () => [] },
  checks: { type: Array, default: () => [] },
  summary: { type: String, default: '' },
  muted: { type: Boolean, default: false },      // rubrique facultative (ex. GTB hors service)
  bodyCls: { type: [String, Array, Object], default: '' }, // classes du contenu
})
const emit = defineEmits(['toggle'])
</script>

<template>
  <section :id="id" :data-rubric="id"
           :class="['rounded-xl overflow-hidden bg-white ring-1 transition scroll-mt-40',
                    open ? 'ring-indigo-600/30' : 'ring-slate-200', muted && !open ? 'opacity-75' : '']">
    <DeviceSectionHeader :title="title" rubrics :open="open" :icon="icon"
                         :missing="missing" :unanswered="unanswered" :checks="checks" :summary="summary"
                         :body-id="`${id}-body`" @toggle="emit('toggle')" />
    <div v-show="open" :id="`${id}-body`" :class="['rubric-body p-4', bodyCls]">
      <slot />
    </div>
  </section>
</template>

<style scoped>
/* Questions Oui / Non (.qa-grid, main.css) : sur un écran étroit, la question se replie au lieu de
   pousser ses boutons hors de la rubrique. */
.rubric-body :deep(.qa-grid) { grid-template-columns: minmax(0, max-content) max-content; }
</style>
