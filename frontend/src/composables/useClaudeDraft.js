import { ref } from 'vue'

/**
 * Stream une redaction Claude pour une section. Utilise fetch + ReadableStream
 * (pas EventSource car POST + cookies sont indispensables).
 *
 * Callbacks : onText(chunk), onDone(meta), onError(msg).
 */
export function useClaudeDraft() {
  const streaming = ref(false)
  const error = ref(null)
  let controller = null

  async function start(sectionId, { instruction, onText, onDone, onError }) {
    streaming.value = true
    error.value = null
    controller = new AbortController()
    try {
      const res = await fetch(`/api/sections/${sectionId}/claude/draft`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: instruction || null }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
        throw new Error(detail.detail || `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx).trim()
          buf = buf.slice(idx + 2)
          if (!raw.startsWith('data:')) continue
          try {
            const obj = JSON.parse(raw.slice(5).trim())
            if (obj.error) { onError?.(obj.error); error.value = obj.error }
            else if (obj.done) { onDone?.(obj) }
            else if (obj.text) { onText?.(obj.text) }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        error.value = e.message
        onError?.(e.message)
      }
    } finally {
      streaming.value = false
      controller = null
    }
  }

  function abort() {
    controller?.abort()
    streaming.value = false
  }

  return { streaming, error, start, abort }
}
