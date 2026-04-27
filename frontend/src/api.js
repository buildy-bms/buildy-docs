import axios from 'axios'
import router, { resetAuth } from '@/router'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

const PUBLIC_PATHS = ['/login']

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const onPublicPage = PUBLIC_PATHS.some((p) => window.location.pathname.startsWith(p))
    if (err.response?.status === 401 && !onPublicPage) {
      resetAuth()
      router.push('/login')
    }
    return Promise.reject(err)
  }
)

export default api
