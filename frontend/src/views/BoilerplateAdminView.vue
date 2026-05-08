<script setup>
/**
 * Vue legacy de l'admin des annexes PDF (méthodologie + disclaimers).
 * La logique est maintenant centralisée dans `<BoilerplateAdmin>` pour
 * être réutilisée comme onglet de la page « Paramètres BACS »
 * (/admin/bacs-parameters?tab=pdf). Cette route reste accessible pour
 * les bookmarks existants.
 */
import BoilerplateAdmin from '@/components/admin/BoilerplateAdmin.vue'
</script>

<template>
  <div class="max-w-5xl mx-auto px-5 lg:px-6 py-6">
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-900">Textes standards des rapports d'audit BACS</h1>
      <p class="text-sm text-gray-500 mt-1">
        Édite la <strong>méthodologie</strong> (Annexe B) et les
        <strong>disclaimers légaux</strong> (Annexe D) du rapport PDF
        sans redéployer le code. Les modifications s'appliquent
        immédiatement aux prochains exports — les PDFs déjà générés
        ne sont pas affectés (fichiers figés sur disque).
      </p>
    </header>
    <BoilerplateAdmin />
  </div>
</template>
