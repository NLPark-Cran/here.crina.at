import { create } from 'zustand'
import { authApi } from '../api/client'
import type { User } from '../api/types'

interface AuthState {
  /** undefined = 还没拉取过；null = 未登录 */
  user: User | null | undefined
  fetchMe: () => Promise<void>
  logout: () => Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  user: undefined,
  fetchMe: async () => {
    try {
      const { user } = await authApi.meOptional()
      set({ user })
    } catch {
      set({ user: null })
    }
  },
  logout: async () => {
    try {
      await authApi.logout()
    } finally {
      set({ user: null })
    }
  },
}))
