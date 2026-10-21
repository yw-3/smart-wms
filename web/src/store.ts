import { create } from 'zustand';

export interface UserInfo {
  id: number;
  username: string;
  realName: string;
  role: string;
  mustChangePwd: boolean;
}

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  setAuth: (token: string, user: UserInfo) => void;
  setUser: (user: UserInfo) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: localStorage.getItem('wms_token'),
  user: JSON.parse(localStorage.getItem('wms_user') || 'null'),
  setAuth: (token, user) => {
    localStorage.setItem('wms_token', token);
    localStorage.setItem('wms_user', JSON.stringify(user));
    set({ token, user });
  },
  setUser: (user) => {
    localStorage.setItem('wms_user', JSON.stringify(user));
    set({ user });
  },
  logout: () => {
    localStorage.removeItem('wms_token');
    localStorage.removeItem('wms_user');
    set({ token: null, user: null });
  },
}));
