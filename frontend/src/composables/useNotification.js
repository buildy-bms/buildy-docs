import { ref } from 'vue'

const notifications = ref([])
let nextId = 1

// Notifications affichees en bandeau haut (cf NotificationToast.vue).
// Couleurs imposees Buildy : #00cd92 success / #f5c259 warning / #e95369 error.
// `info` conserve pour retro-compat — utilise le navy Buildy (#1b2842) neutre.
function notify(message, type = 'info', duration = null) {
  const id = nextId++
  const d = duration ?? (type === 'error' ? 6000 : 4000)
  notifications.value.push({ id, message, type })
  if (d > 0) {
    setTimeout(() => dismiss(id), d)
  }
  return id
}

function dismiss(id) {
  const idx = notifications.value.findIndex((n) => n.id === id)
  if (idx !== -1) notifications.value.splice(idx, 1)
}

export function useNotification() {
  return {
    notifications,
    notify,
    dismiss,
    success: (msg, dur) => notify(msg, 'success', dur),
    warning: (msg, dur) => notify(msg, 'warning', dur),
    error: (msg, dur) => notify(msg, 'error', dur),
    info: (msg, dur) => notify(msg, 'info', dur),
  }
}
