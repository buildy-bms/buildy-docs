import { ref } from 'vue'

const notifications = ref([])
let nextId = 1

function notify(message, type = 'info', duration = 4000) {
  const id = nextId++
  notifications.value.push({ id, message, type })
  if (duration > 0) {
    setTimeout(() => {
      const idx = notifications.value.findIndex((n) => n.id === id)
      if (idx !== -1) notifications.value.splice(idx, 1)
    }, duration)
  }
}

export function useNotification() {
  return {
    notifications,
    notify,
    success: (msg, dur) => notify(msg, 'success', dur),
    error: (msg, dur) => notify(msg, 'error', dur ?? 6000),
    info: (msg, dur) => notify(msg, 'info', dur),
  }
}
