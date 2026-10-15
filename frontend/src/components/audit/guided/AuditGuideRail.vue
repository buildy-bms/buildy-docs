<script setup>
/**
 * Guide de gauche d'une étape (mise en page « Nouvelle ») : titre, progression, rubriques groupées
 * avec leur état, et « Reprendre » qui mène au prochain point. Même dessin que le guide des usages
 * de l'étape Systèmes (SystemsGuideRail) ; contenu fourni par l'étape.
 *
 * groups : [{ key, label, items: [{ key, title, icon, mark, status: { text, tone } }] }]
 *   mark : contenu de la pastille d'état (✓, nombre) ; tone : 'green' | 'amber' | 'rose' | 'slate' | 'muted'
 */
import { computed } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faRoute } from '@fortawesome/free-solid-svg-icons'

library.add(faRoute)

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  progress: { type: Object, default: null },     // { done, total, label }
  groups: { type: Array, default: () => [] },
  activeKey: { type: String, default: null },
  resumeLabel: { type: String, default: '' },    // vide : rien à reprendre
  resumeTip: { type: [String, Object], default: null },
  doneText: { type: String, default: '' },
  ariaLabel: { type: String, default: 'Guide de l’étape' },
})
const emit = defineEmits(['select', 'resume'])

// Pastille d'état à droite de la rubrique (mêmes couleurs que les en-têtes de rubrique).
const MARK_TONE = {
  amber: 'bg-amber-100 text-amber-800',
  rose: 'bg-rose-100 text-rose-700',
  slate: 'bg-white text-slate-600 border border-dashed border-slate-400',
  green: 'bg-emerald-50 text-emerald-600',
  muted: 'text-slate-400',
}
const pct = computed(() => (props.progress?.total ? Math.round(props.progress.done / props.progress.total * 100) : 0))
function itemClass(selected) {
  return ['w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left transition outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
    selected ? 'bg-slate-100 shadow-[inset_3px_0_0_var(--color-indigo-600)]' : 'hover:bg-slate-50']
}
</script>

<template>
  <nav :aria-label="ariaLabel" class="flex flex-col gap-2.5 p-3">
    <div class="px-1">
      <div class="flex items-baseline gap-1.5 min-w-0">
        <span class="text-[15px] font-semibold text-indigo-600 truncate" v-tooltip.overflow>{{ title }}</span>
        <span v-if="subtitle" class="text-xs text-slate-500 truncate shrink-0" v-tooltip.overflow>{{ subtitle }}</span>
      </div>
      <template v-if="progress">
        <p class="text-xs text-slate-600 mt-0.5">{{ progress.label }}</p>
        <div role="progressbar" :aria-label="progress.label" :aria-valuenow="progress.done" aria-valuemin="0" :aria-valuemax="progress.total"
             class="h-1.5 rounded-full bg-slate-200 mt-2 overflow-hidden">
          <div class="h-full rounded-full bg-[#00cd92] transition-[width] duration-300" :style="{ width: `${pct}%` }"></div>
        </div>
      </template>
    </div>
    <div v-for="g in groups" :key="g.key" class="flex flex-col gap-0.5">
      <p v-if="g.label" class="px-2 pt-1 pb-0.5 text-[11px] font-medium text-slate-500">{{ g.label }}</p>
      <ul class="flex flex-col gap-0.5">
        <!-- Une ligne par rubrique : icône, titre, état en pastille (le détail au survol). -->
        <li v-for="x in g.items" :key="x.key">
          <button type="button" :data-guide-rubric="x.key"
                  :aria-current="x.key === activeKey ? 'true' : undefined"
                  @click="emit('select', x.key)"
                  v-tooltip.right="x.status?.text ? `${x.title} : ${x.status.text.charAt(0).toLowerCase()}${x.status.text.slice(1)}` : null"
                  :class="itemClass(x.key === activeKey)">
            <span class="w-6 h-6 shrink-0 rounded-md inline-flex items-center justify-center bg-slate-100 text-indigo-600">
              <FontAwesomeIcon :icon="['fas', x.icon]" class="w-3 h-3" />
            </span>
            <span :class="['flex-1 min-w-0 text-[13px] text-indigo-600 truncate', x.key === activeKey ? 'font-semibold' : 'font-medium']">{{ x.title }}</span>
            <span :class="['shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full text-[10px] font-semibold', MARK_TONE[x.status?.tone] || MARK_TONE.slate]"
                  aria-hidden="true">{{ x.mark }}</span>
            <span class="sr-only">{{ x.status?.text }}</span>
          </button>
        </li>
      </ul>
    </div>
    <button v-if="resumeLabel" type="button" @click="emit('resume')" v-tooltip="resumeTip"
            class="mt-1 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-left text-[13px] font-medium text-white hover:bg-indigo-700 transition outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-600">
      <FontAwesomeIcon :icon="['fas', 'route']" class="w-3.5 h-3.5 shrink-0" />
      {{ resumeLabel }}
    </button>
    <p v-else-if="doneText" class="px-1 text-xs text-emerald-700">✓ {{ doneText }}</p>
  </nav>
</template>
