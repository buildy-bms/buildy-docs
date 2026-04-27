<script setup>
import { currentUser } from '@/router'
import { DocumentPlusIcon } from '@heroicons/vue/24/outline'
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold text-gray-800">Mes Analyses Fonctionnelles</h1>
        <p class="text-sm text-gray-500 mt-1">
          Bienvenue {{ currentUser?.display_name || currentUser?.email }} —
          aucune AF pour le moment.
        </p>
      </div>
      <button
        disabled
        class="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg opacity-50 cursor-not-allowed"
        title="Disponible au Lot 2"
      >
        <DocumentPlusIcon class="w-4 h-4" />
        Nouvelle AF
      </button>
    </div>

    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
      <DocumentPlusIcon class="w-16 h-16 mx-auto text-gray-300" />
      <h2 class="mt-4 text-base font-medium text-gray-800">Squelette en place</h2>
      <p class="mt-2 text-sm text-gray-500 max-w-md mx-auto">
        Lot 1 livre : authentification PocketID, charte Buildy, layout principal.
        La gestion des AFs arrive au Lot 2 (modele de donnees + bibliotheque d'equipements + wizard de creation).
      </p>
    </div>
  </div>
</template>
