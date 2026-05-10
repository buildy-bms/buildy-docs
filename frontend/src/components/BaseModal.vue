<script setup>
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import { useFocusTrap } from '@/composables/useFocusTrap'

const props = defineProps({
  title: { type: String, required: true },
  size: { type: String, default: 'md' }, // 'sm' | 'md' | 'lg' | 'xl' | 'full'
  // Par defaut un clic sur le backdrop ferme. Pour les modales d'edition
  // avec saisie utilisateur (formulaires longs), passer `:dismiss-on-backdrop="false"`
  // pour eviter une perte accidentelle (clic a cote = pas de fermeture).
  // L'ESC reste actif et le bouton X aussi.
  dismissOnBackdrop: { type: Boolean, default: true },
})

const emit = defineEmits(['close'])

// Sur mobile (< sm = 640px), `min-w-0` evite le debordement horizontal :
// le conteneur respecte juste `max-w-[min(92vw, X)]`. Au-dessus de 640px,
// `sm:min-w-[Xrem]` reprend pour ne pas avoir une modale trop etroite sur
// des formulaires larges. max-w utilise min(92vw, X) pour cap aussi sur
// grand ecran sans neutraliser la cap par taille.
const sizeClass = {
  sm: 'min-w-0 sm:min-w-[18rem] max-w-[min(92vw,28rem)]',
  md: 'min-w-0 sm:min-w-[24rem] max-w-[min(92vw,36rem)]',
  lg: 'min-w-0 sm:min-w-[28rem] max-w-[min(92vw,48rem)]',
  xl: 'min-w-0 sm:min-w-[36rem] max-w-[min(92vw,64rem)]',
  // 'full' : pas de cap (en plus du max-w-[92vw] du conteneur de base).
  // La modale s'elargit jusqu'a 92vw pour absorber les tableaux larges.
  full: 'min-w-0 sm:min-w-[36rem]',
}[props.size] || 'min-w-0 sm:min-w-[24rem] max-w-[min(92vw,36rem)]'

const dialogRef = ref(null)
const titleId = computed(() => `modal-title-${Math.random().toString(36).slice(2, 9)}`)
useFocusTrap(dialogRef)

function onEsc(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => document.addEventListener('keydown', onEsc))
onUnmounted(() => document.removeEventListener('keydown', onEsc))
</script>

<template>
  <Teleport to="body">
    <!-- z-[110] : doit passer au-dessus de tout (MobileSheet z-50/60,
         lightbox z-50, popover SearchableSelect z-100). Sans ça, les
         modales de confirmation de suppression apparaissaient sous le
         sheet mobile en cours → l'utilisateur voyait rien se passer. -->
    <div class="fixed inset-0 z-110 bg-black/50 flex items-center justify-center px-4 py-6"
         @click.self="dismissOnBackdrop && emit('close')">
      <div ref="dialogRef"
           role="dialog" aria-modal="true" :aria-labelledby="titleId"
           tabindex="-1"
           :class="['bg-white rounded-xl shadow-xl w-fit max-w-[92vw] flex flex-col max-h-[92vh] overflow-hidden focus:outline-none', sizeClass]">
        <div class="flex items-center justify-between px-5 pt-3 pb-2 border-b border-gray-100 shrink-0">
          <h2 :id="titleId" class="text-base font-semibold text-gray-800">{{ title }}</h2>
          <button @click="emit('close')" aria-label="Fermer la fenêtre"
                  class="text-gray-400 hover:text-gray-700 p-1 -mr-1">
            <XMarkIcon class="w-5 h-5" />
          </button>
        </div>
        <div class="px-5 py-3 overflow-y-auto flex-1 min-h-0">
          <slot />
        </div>
        <div v-if="$slots.footer" class="px-5 py-2.5 bg-gray-50 flex items-center justify-end gap-2 shrink-0 border-t border-gray-100">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
