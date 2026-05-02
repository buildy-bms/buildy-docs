# buildy-docs / frontend

Vue 3.5 + Vite 7 + Tailwind 4 + Pinia. Documentation complète à la racine : [`../README.md`](../README.md).

## Scripts

```bash
npm run dev        # Vite dev server :5173 (proxy /api → :3100)
npm run build      # Build prod → dist/
npm run preview    # Preview du build
```

## Structure

```
src/
├── views/                # Vues principales (1 par route)
│   ├── AfsListView.vue
│   ├── AfDetailView.vue
│   ├── BacsAuditDetailView.vue   # couvre bacs_audit + site_audit
│   ├── BacsAuditActionItemsView.vue
│   ├── SitesListView.vue
│   └── ...
├── components/           # Composants réutilisables
│   ├── audit/            # Sous-composants fiche audit (extraits)
│   ├── editor/           # Tiptap + autosave + tree
│   ├── CollapsibleSection.vue
│   ├── BaseModal.vue
│   ├── R175Tooltip.vue
│   └── ...
├── stores/               # Pinia (audit.js — af.js et brochure.js à venir)
├── composables/          # useNotification, useConfirm, ...
├── api.js                # Client Axios + intercepteurs
├── router.js             # Vue Router
├── main.js               # Bootstrap Vue + Pinia
└── assets/main.css       # @layer components Tailwind (.btn-primary, .card, .pill, .input-base, .sev-*, .tone-*)
```

## Conventions

- Composition API + `<script setup>`
- Classes utilitaires Tailwind 4 + classes sémantiques `@apply` (`@layer components` dans `main.css`) : `.btn-primary`, `.btn-secondary`, `.card`, `.input-base`, `.pill`, `.sev-blocking`, `.sev-major`, `.sev-minor`, `.tone-info`, `.tone-success`, `.tone-recco`, `.tone-muted`
- Sanitization HTML via `SafeHtml.vue` (DOMPurify) — jamais `v-html` brut sur du contenu user-generated
- Modals via `BaseModal.vue` (auto-width selon contenu, cf. mémoire `feedback_modals_auto_width.md`)
- Pinia store par domaine — pas de refs locales pour les données partagées entre plusieurs sous-composants
- Accents français systématiques dans tous les textes UI

## Build & déploiement

Le build (`dist/`) est servi par le backend Fastify en prod via `@fastify/static`. Après déploiement, **toujours redémarrer PM2** (`pm2 restart buildy-docs`) pour que `fastify-static` re-scanne les nouveaux chunks (cf. mémoire `feedback_deploy_static_restart.md`).

## Aliases

- `@/` → `src/`

## Composants partagés à privilégier

| Besoin | Composant à utiliser |
|---|---|
| Modal | [`BaseModal.vue`](src/components/BaseModal.vue) |
| Section dépliable | [`CollapsibleSection.vue`](src/components/CollapsibleSection.vue) |
| Header section audit | [`audit/SectionHeader.vue`](src/components/audit/SectionHeader.vue) |
| Tooltip survol simple | [`Tooltip.vue`](src/components/Tooltip.vue) |
| Tooltip article R175 | [`R175Tooltip.vue`](src/components/R175Tooltip.vue) (Teleport vers body, pas de clipping) |
| Multi-select (protocoles) | [`ProtocolMultiPicker.vue`](src/components/ProtocolMultiPicker.vue) (Teleport, position calculée) |
| Validation d'étape | [`StepValidateBadge.vue`](src/components/StepValidateBadge.vue) |
| Stepper vertical (sidebar) | [`VerticalStepper.vue`](src/components/VerticalStepper.vue) |
| Notification toast | `useNotification` composable |
| Confirmation modale | `useConfirm` composable |
