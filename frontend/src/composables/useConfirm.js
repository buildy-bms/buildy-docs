import { ref } from 'vue'

const state = ref(null)
let resolver = null

export function useConfirm() {
  return {
    state,
    /**
     * Affiche une modale de confirmation Buildy et resout avec true/false.
     *
     * @param {string|object} opts — string court OU objet {title, message, confirmLabel, cancelLabel, danger}
     */
    confirm(opts) {
      const cfg = typeof opts === 'string' ? { message: opts } : (opts || {})
      state.value = {
        title: cfg.title || 'Confirmer',
        message: cfg.message || '',
        confirmLabel: cfg.confirmLabel || 'Confirmer',
        cancelLabel: cfg.cancelLabel || 'Annuler',
        danger: cfg.danger ?? false,
      }
      return new Promise((resolve) => {
        resolver = resolve
      })
    },
    resolve(ok) {
      state.value = null
      if (resolver) {
        resolver(ok)
        resolver = null
      }
    },
  }
}
