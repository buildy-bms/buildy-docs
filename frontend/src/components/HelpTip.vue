<script setup>
// Petite icône ⓘ autonome : au survol, au focus clavier ou au doigt, carte d'aide navy
// (v-tooltip) qui explique un champ, une colonne ou une notion. Les lignes « • » du texte
// deviennent une liste.
//   <HelpTip title="Compteur requis" text="…" />
//   <HelpTip :tip="{ title, text, rows, todo, article, accent }" />
import { computed } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { library } from '@fortawesome/fontawesome-svg-core'
import { faCircleInfo } from '@fortawesome/free-solid-svg-icons'

library.add(faCircleInfo)

const props = defineProps({
  title: { type: String, default: '' }, // titre de la carte
  text: { type: [String, Array], default: '' }, // explication
  tip: { type: [Object, Function], default: null }, // carte complète (prioritaire)
  size: { type: String, default: 'sm' }, // 'xs' (12 px) | 'sm' (14 px)
})

const tipValue = computed(() => props.tip || (props.text ? { title: props.title || 'Aide', text: props.text, tone: 'info' } : null))
const label = computed(() => {
  const v = typeof props.tip === 'function' ? props.tip() : props.tip
  const t = v?.title || props.title
  return t ? `Aide : ${t}` : 'Aide'
})
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    v-tooltip.keep.touch="tipValue"
    class="inline-flex items-center justify-center shrink-0 align-middle rounded text-gray-400 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition-colors cursor-help"
    @click.prevent.stop
  >
    <FontAwesomeIcon :icon="['fas', 'circle-info']" :class="size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'" />
  </button>
</template>
