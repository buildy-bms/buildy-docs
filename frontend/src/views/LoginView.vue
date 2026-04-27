<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api'

const route = useRoute()
const error = ref('')
const oidcEnabled = ref(false)
const devBypass = ref(false)

onMounted(async () => {
  try {
    const { data } = await api.get('/auth/oidc/config')
    oidcEnabled.value = !!data.oidcEnabled
    devBypass.value = !!data.devBypass
  } catch { /* ignore */ }

  const oidcError = route.query.oidc_error
  if (oidcError) {
    error.value = oidcError
    window.history.replaceState({}, '', '/login')
  }
})

function loginOidc() {
  window.location.href = '/api/auth/oidc/login'
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-indigo-600 px-4">
    <div class="bg-white rounded-lg shadow-xl p-10 w-full max-w-md">
      <div class="flex flex-col items-center mb-8">
        <img src="/logo-buildy.svg" alt="Buildy" class="h-12 mb-4" />
        <h1 class="text-xl font-semibold text-gray-800">Buildy AF</h1>
        <p class="text-sm text-gray-500 mt-1">Analyses fonctionnelles GTB</p>
      </div>

      <p v-if="error" class="text-red-600 text-sm mb-4 text-center">{{ error }}</p>

      <div v-if="devBypass" class="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
        <strong>Mode dev :</strong> l'authentification est contournee. Vous etes connecte comme utilisateur fictif.
        <router-link to="/" class="block mt-2 text-amber-900 underline">Acceder a l'app →</router-link>
      </div>

      <button
        v-else-if="oidcEnabled"
        @click="loginOidc"
        class="w-full py-3 bg-[#00cd92] text-white text-sm font-semibold rounded-lg hover:bg-[#00b884] transition-colors flex items-center justify-center gap-2"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
        Se connecter avec Buildy ID
      </button>

      <div v-else class="text-center text-sm text-gray-500">
        <p>Authentification PocketID non configuree.</p>
        <p class="mt-2 text-xs">
          Activez OIDC dans <code class="bg-gray-100 px-1.5 py-0.5 rounded">.env</code> ou
          DEV_BYPASS_AUTH=1 pour le dev.
        </p>
      </div>
    </div>
  </div>
</template>
