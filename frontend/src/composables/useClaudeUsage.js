import { ref, onMounted } from 'vue'
import { getClaudeUsage } from '@/api'

// Composable partage : un seul fetch lors du premier mount, refresh
// manuel possible via refresh(). Cache la reponse 5 minutes.
const usage = ref(null)
const loading = ref(false)
let lastFetch = 0

async function refresh() {
  if (loading.value) return
  loading.value = true
  try {
    const { data } = await getClaudeUsage()
    usage.value = data
    lastFetch = Date.now()
  } finally {
    loading.value = false
  }
}

export function useClaudeUsage() {
  onMounted(() => {
    if (!usage.value || Date.now() - lastFetch > 5 * 60_000) refresh()
  })
  return { usage, loading, refresh }
}

export function formatUsageTooltip(u) {
  if (!u) return 'Coût Claude : chargement…'
  const avg = (u.avg_cost_eur || 0).toFixed(3)
  const total = (u.cost_eur || 0).toFixed(2)
  const lines = [
    `Coût moyen ≈ ${avg} € par requête`,
    `Cumul 30 j : ${total} € sur ${u.requests || 0} requête${u.requests > 1 ? 's' : ''}`,
  ]
  if (u.month_cost_eur != null) {
    lines.push(`Mois en cours : ${(u.month_cost_eur || 0).toFixed(2)} €`)
  }
  if (u.monthly_budget_eur && u.remaining_eur != null) {
    lines.push(`Budget local : ${u.monthly_budget_eur.toFixed(2)} € → ${u.remaining_eur.toFixed(2)} € restants`)
  }
  return lines.join(' · ')
}
