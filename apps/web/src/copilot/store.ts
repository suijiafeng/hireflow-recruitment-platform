import { create } from 'zustand';

export interface CopilotContextRef {
  type: 'candidate' | 'job';
  id: string;
}

interface CopilotUiState {
  open: boolean;
  /** 显式指定的上下文（如候选人抽屉里的「问 Copilot」）；为空时按当前网址推断 */
  pinned: CopilotContextRef | null;
  /** 打开时自动填入输入框的问题 */
  draft: string | null;
  openPanel: (opts?: { context?: CopilotContextRef | null; prompt?: string }) => void;
  close: () => void;
  toggle: () => void;
  consumeDraft: () => string | null;
}

export const useCopilotUi = create<CopilotUiState>()((set, get) => ({
  open: false,
  pinned: null,
  draft: null,
  openPanel: (opts) => set({ open: true, pinned: opts?.context ?? null, draft: opts?.prompt ?? null }),
  close: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open, pinned: s.open ? s.pinned : null })),
  consumeDraft: () => {
    const d = get().draft;
    if (d) set({ draft: null });
    return d;
  },
}));

/** 从网址推断页面上下文：候选人抽屉（?candidate=）优先，其次招聘看板的职位（/pipeline?jobId=） */
export function contextFromLocation(pathname: string, search: string): CopilotContextRef | null {
  const params = new URLSearchParams(search);
  const candidate = params.get('candidate');
  if (candidate) return { type: 'candidate', id: candidate };
  const jobId = params.get('jobId');
  if (jobId && pathname.startsWith('/pipeline')) return { type: 'job', id: jobId };
  return null;
}
