import { create } from 'zustand';

// 画面右上に出す通知(トースト)の置き場。画面遷移しても消えないよう、コンポーネントではなく
// アプリ全体で1つのストアにしている(送金は画面を離れた後も裏で進むため)。
export type NotificationSeverity = 'info' | 'success' | 'error';

export interface AppNotification {
  id: number;
  severity: NotificationSeverity;
  message: string;
  // 設定されていれば「取引を見る」リンクを出す。
  explorerUrl?: string | null;
  // 自動で消えるまでの時間(ms)。省略時は種類ごとの既定値。
  durationMs?: number;
}

interface NotificationState {
  items: AppNotification[];
  push: (n: Omit<AppNotification, 'id'>) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useNotificationStore = create<NotificationState>()((set) => ({
  items: [],
  push: (n) => {
    const id = nextId++;
    set((s) => ({ items: [...s.items, { ...n, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export function notify(n: Omit<AppNotification, 'id'>): number {
  return useNotificationStore.getState().push(n);
}
