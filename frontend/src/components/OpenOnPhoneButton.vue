<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { DevicePhoneMobileIcon, ClipboardIcon, EnvelopeIcon, XMarkIcon, CheckIcon } from '@heroicons/vue/24/outline'
import QRCode from 'qrcode'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  // Libellé court à inclure dans l'objet du mail (nom du site / audit).
  contextLabel: { type: String, default: '' },
})

const { success, error } = useNotification()
const open = ref(false)
const copied = ref(false)
const qrDataUrl = ref('')

const url = computed(() => {
  if (typeof window === 'undefined') return ''
  return window.location.href
})

const mailto = computed(() => {
  const subject = encodeURIComponent(`Audit Buildy${props.contextLabel ? ' — ' + props.contextLabel : ''}`)
  const body = encodeURIComponent(`Lien direct vers l'audit :\n${url.value}\n\n(Connexion PocketID requise)`)
  return `mailto:?subject=${subject}&body=${body}`
})

const sms = computed(() => {
  const body = encodeURIComponent(`Audit Buildy : ${url.value}`)
  return `sms:?&body=${body}`
})

async function regenerateQr() {
  try {
    qrDataUrl.value = await QRCode.toDataURL(url.value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 280,
      color: { dark: '#1b2842', light: '#ffffff' },
    })
  } catch {
    qrDataUrl.value = ''
  }
}

watch(open, async (v) => {
  if (v) {
    await nextTick()
    regenerateQr()
  }
})

async function copyLink() {
  try {
    await navigator.clipboard.writeText(url.value)
    copied.value = true
    success('Lien copié')
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    error('Impossible de copier le lien')
  }
}
</script>

<template>
  <div class="relative inline-block">
    <button
      type="button"
      @click="open = !open"
      class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 whitespace-nowrap"
      v-tooltip="'Ouvrir cet audit sur ton téléphone (QR code + lien)'"
    >
      <DevicePhoneMobileIcon class="w-3.5 h-3.5 shrink-0" />
      Sur téléphone
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        @click.self="open = false"
      >
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
          <header class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h3 class="text-base font-semibold text-gray-900 inline-flex items-center gap-2">
                <DevicePhoneMobileIcon class="w-5 h-5 text-emerald-600" />
                Continuer sur ton téléphone
              </h3>
              <p class="text-xs text-gray-500 mt-0.5">
                Scanne le QR code avec ton iPhone, ou copie le lien.
              </p>
            </div>
            <button @click="open = false" class="p-1 rounded hover:bg-gray-100 text-gray-500" aria-label="Fermer">
              <XMarkIcon class="w-5 h-5" />
            </button>
          </header>

          <div class="px-5 py-4 space-y-4">
            <div class="flex justify-center">
              <img
                v-if="qrDataUrl"
                :src="qrDataUrl"
                alt="QR code"
                class="w-64 h-64 border border-gray-200 rounded-lg"
              />
              <div v-else class="w-64 h-64 flex items-center justify-center text-xs text-gray-400 italic">
                Génération du QR…
              </div>
            </div>

            <div class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <p class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Lien direct</p>
              <p class="text-xs font-mono text-gray-700 break-all">{{ url }}</p>
            </div>

            <p class="text-[11px] text-gray-500 leading-relaxed">
              Connexion PocketID nécessaire au premier ouverture sur le téléphone.
            </p>
          </div>

          <footer class="px-5 py-3 border-t border-gray-200 flex items-center gap-2 bg-gray-50">
            <button
              @click="copyLink"
              class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition"
            >
              <CheckIcon v-if="copied" class="w-4 h-4" />
              <ClipboardIcon v-else class="w-4 h-4" />
              {{ copied ? 'Copié' : 'Copier' }}
            </button>
            <a
              :href="mailto"
              class="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition"
            >
              <EnvelopeIcon class="w-4 h-4" />
              Email
            </a>
            <a
              :href="sms"
              class="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition"
            >
              SMS
            </a>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>
