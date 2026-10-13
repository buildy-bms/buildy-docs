<script setup>
// Infobulle CARTE d'explication, sur fond navy comme toutes les infobulles : liseré et icône de la
// couleur de l'état ou du métier (accent : flamme rouge du chauffage, éclair ambre de
// l'électricité…), titre, texte aéré (paragraphes et listes), lignes « clé → valeur », encadré
// « À faire », pied discret (source, article du décret). 300 à 540 px de large : peu de retours
// à la ligne. Rendue par TooltipHost, ou telle quelle dans /style-guide.
import { computed } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { TIP_TONES, ACCENTS, formatKeys } from '@/lib/tooltip-content'

const props = defineProps({
  tip: { type: Object, required: true }, // contenu normalisé (normalizeTip, kind 'card')
  maxHeight: { type: Number, default: null }, // place disponible : le contenu est limité au-delà
})

const tone = computed(() => TIP_TONES[props.tip.tone] || TIP_TONES.info)
// L'accent métier colore le liseré et la pastille du titre ; l'encadré « À faire » garde le ton.
const look = computed(() => (props.tip.accent && ACCENTS[props.tip.accent]) || tone.value)
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const keys = computed(() => formatKeys(props.tip.keys, isMac))
</script>

<template>
  <div
    class="relative w-max min-w-[min(300px,calc(100vw-16px))] overflow-hidden rounded-xl bg-primary text-white shadow-2xl shadow-primary/30 ring-1 ring-white/10"
    :class="tip.wide ? 'max-w-[min(600px,calc(100vw-16px))]' : 'max-w-[min(540px,calc(100vw-16px))]'"
  >
    <span class="absolute inset-y-0 left-0 w-1" :class="look.bar" />
    <div class="py-3 pl-4 pr-4" :class="maxHeight ? 'overflow-hidden' : ''" :style="maxHeight ? { maxHeight: `${maxHeight}px` } : null">
      <!-- En-tête : icône (état ou métier) + titre (+ raccourci) -->
      <div class="flex items-start gap-2.5">
        <span
          v-if="tip.icon"
          class="mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-lg ring-1"
          :class="look.chip"
        >
          <FontAwesomeIcon :icon="['fas', tip.icon]" class="size-3.5" />
        </span>
        <p class="min-w-0 flex-1 pt-px text-[13px] font-medium leading-snug text-white text-pretty">{{ tip.title }}</p>
        <span v-if="keys.length" class="ml-auto inline-flex shrink-0 gap-0.5 pt-0.5">
          <kbd
            v-for="k in keys"
            :key="k"
            class="inline-flex h-[1.6em] min-w-[1.6em] items-center justify-center rounded-md border border-white/20 bg-white/10 px-1 font-sans text-2xs font-medium text-white/85"
            >{{ k }}</kbd
          >
        </span>
      </div>

      <!-- Texte : paragraphes et listes -->
      <div v-if="tip.blocks.length" class="mt-2 space-y-1.5 text-sm leading-relaxed text-white/80 text-pretty">
        <template v-for="(b, i) in tip.blocks" :key="i">
          <p v-if="b.type === 'p'">{{ b.text }}</p>
          <ul v-else class="list-disc space-y-0.5 pl-4 marker:text-white/35">
            <li v-for="(it, j) in b.items" :key="j">{{ it }}</li>
          </ul>
        </template>
      </div>

      <!-- Lignes « clé → valeur » -->
      <div
        v-if="tip.rows.length"
        class="mt-3 rounded-lg bg-white/6 px-3 py-2 text-[11.5px] ring-1 ring-white/5"
        :class="tip.rows.some((r) => r.layout === 'stacked') ? 'space-y-2.5' : 'space-y-1.5'"
      >
        <div v-for="(r, i) in tip.rows" :key="i" :class="r.layout === 'inline' ? 'flex items-start gap-3' : ''">
          <div class="flex items-start gap-2" :class="r.layout === 'inline' ? 'min-w-0 flex-1' : ''">
            <FontAwesomeIcon
              v-if="r.icon"
              :icon="['fas', r.icon]"
              class="mt-0.5 size-3 shrink-0"
              :class="r.iconClass || 'text-white/50'"
            />
            <span :class="r.layout === 'stacked' ? 'font-medium text-white/85' : 'text-white/65'">{{ r.label }}</span>
          </div>
          <span
            v-if="r.value"
            :class="
              r.layout === 'inline'
                ? 'ml-auto shrink-0 text-right font-medium text-white tabular-nums'
                : 'mt-0.5 block text-white/75 text-pretty ' + (r.icon ? 'pl-5' : '')
            "
            >{{ r.value }}</span
          >
        </div>
      </div>

      <!-- À faire -->
      <div v-if="tip.todo" class="mt-3 rounded-lg px-3 py-2 ring-1" :class="tone.todo">
        <p class="flex items-center gap-1.5 text-[11.5px] font-medium">
          <FontAwesomeIcon :icon="['fas', 'list-check']" class="size-3 shrink-0" />
          {{ tip.todo.title }}
        </p>
        <ul class="mt-1 space-y-0.5 text-[11.5px] leading-relaxed">
          <li v-for="(it, i) in tip.todo.items" :key="i" :class="tip.todo.items.length > 1 ? 'flex gap-1.5' : ''">
            <span v-if="tip.todo.items.length > 1" class="opacity-60">→</span>
            <span class="text-pretty">{{ it }}</span>
          </li>
        </ul>
      </div>

      <!-- Pied : source, article du décret, information secondaire -->
      <p v-if="tip.meta" data-tip-meta class="mt-3 border-t border-white/10 pt-2 text-2xs text-white/60 tabular-nums text-pretty">
        {{ tip.meta }}
      </p>
    </div>
  </div>
</template>
