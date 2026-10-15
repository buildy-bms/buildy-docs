<script setup>
/**
 * Bloc d'une étape de l'audit, selon la mise en page :
 *  - actuelle : la div d'origine, mêmes id et classes (`cls`), contenu inchangé ;
 *  - nouvelle : une rubrique repliable, comme la fiche équipement de l'étape Systèmes (en-tête
 *    DeviceSectionHeader : icône, titre, état, ce qui manque ou le résumé des réponses).
 * Le contenu (slot) est le même dans les deux : une correction vaut pour les deux mises en page.
 */
import DeviceSectionHeader from '@/components/audit/DeviceSectionHeader.vue'

defineProps({
  guided: { type: Boolean, default: false },
  id: { type: String, required: true },          // ancre du bloc (sommaire, liens « Corriger »)
  cls: { type: [String, Array, Object], default: '' }, // classes de la div d'origine (mise en page actuelle)
  title: { type: String, default: '' },
  icon: { type: String, default: 'circle' },
  open: { type: Boolean, default: true },
  missing: { type: Array, default: () => [] },
  unanswered: { type: Array, default: () => [] },
  checks: { type: Array, default: () => [] },
  summary: { type: String, default: '' },
  muted: { type: Boolean, default: false },      // rubrique facultative (ex. GTB hors service)
  bodyCls: { type: [String, Array, Object], default: '' }, // classes du contenu (mise en page nouvelle)
})
const emit = defineEmits(['toggle'])
</script>

<template>
  <div v-if="!guided" :id="id" :class="cls"><slot /></div>
  <section v-else :id="id" :data-rubric="id"
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
