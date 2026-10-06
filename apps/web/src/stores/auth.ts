import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  department: { id: string; name: string } | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  /** 用服务端最新的角色 / 权限刷新本地缓存（管理员改了角色后，菜单与按钮随之变化） */
  setUser: (user: AuthUser) => void;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
      hasPermission: (permission) => get().user?.permissions.includes(permission) ?? false,
    }),
    { name: 'hireflow-auth' },
  ),
);
