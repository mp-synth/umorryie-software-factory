import type {
  AppSettings,
  BrowseResult,
  EnvironmentSuggestion,
  Health,
  Initiative,
  InitiativeDetail,
  InitiativeSettings,
  InitiativeSummary,
  Project,
  Run,
  RunEvent,
  Ticket,
} from '@factory/shared';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  const data = await res.json().catch(() => null);
  return new ApiError(data?.error ?? `${res.status} ${res.statusText}`, res.status);
}

async function send(method: string, url: string, body?: unknown): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await errorFrom(res);
  return res;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const text = await (await send(method, url, body)).text();
  return (text ? JSON.parse(text) : null) as T;
}

const get = <T,>(url: string) => request<T>('GET', url);
const post = <T,>(url: string, body: unknown = {}) => request<T>('POST', url, body);
const patch = <T,>(url: string, body: unknown) => request<T>('PATCH', url, body);
const del = <T,>(url: string) => request<T>('DELETE', url);

export interface InspectResult {
  ok: boolean;
  path: string;
  error?: string;
  name?: string;
  defaultBranch?: string;
  remoteUrl?: string | null;
  github?: boolean;
  branches?: string[];
  suggestion?: EnvironmentSuggestion;
}

export type BulkAction = 'run-ready' | 'review-all' | 'fix-all' | 'sync-prs';
export type TicketAction = 'run' | 'check' | 'review' | 'fix' | 'reset' | 'mark-approved' | 'mark-merged' | 'mark-todo';

export const api = {
  health: () => get<Health>('/api/health'),
  settings: () => get<AppSettings>('/api/settings'),
  updateSettings: (p: Partial<AppSettings>) => patch<AppSettings>('/api/settings', p),
  defaults: () => get<{ initiativeSettings: InitiativeSettings }>('/api/defaults'),

  projects: () => get<Project[]>('/api/projects'),
  inspect: (path: string) => get<InspectResult>(`/api/fs/inspect?path=${encodeURIComponent(path)}`),
  browse: (path?: string) => get<BrowseResult>(`/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  discover: (path: string, force = false) => post<EnvironmentSuggestion>('/api/fs/discover', { path, force }),
  createProject: (p: Partial<Project>) => post<Project>('/api/projects', p),
  updateProject: (id: string, p: Partial<Project>) => patch<Project>(`/api/projects/${id}`, p),
  deleteProject: (id: string) => del<{ ok: true }>(`/api/projects/${id}`),
  branches: (id: string) => get<{ branches: string[]; defaultBranch: string }>(`/api/projects/${id}/branches`),

  initiatives: () => get<InitiativeSummary[]>('/api/initiatives'),
  initiative: (id: string) => get<InitiativeDetail>(`/api/initiatives/${id}`),
  createInitiative: (body: {
    projectId: string;
    title: string;
    brief: string;
    baseBranch?: string;
    settings?: Partial<InitiativeSettings>;
    start?: boolean;
  }) => post<Initiative>('/api/initiatives', body),
  updateInitiative: (id: string, p: { title?: string; brief?: string; status?: 'archived' | 'draft'; settings?: Partial<InitiativeSettings> }) =>
    patch<Initiative>(`/api/initiatives/${id}`, p),
  deleteInitiative: (id: string) => del<{ ok: true }>(`/api/initiatives/${id}`),
  plan: (id: string, feedback?: string) => post(`/api/initiatives/${id}/plan`, feedback ? { feedback } : {}),
  planReview: (id: string) => post(`/api/initiatives/${id}/plan-review`),
  approve: (id: string, note?: string) => post(`/api/initiatives/${id}/approve`, { note }),
  resetInitiative: (id: string) => post(`/api/initiatives/${id}/reset`),
  reportMarkdown: (id: string) => send('GET', `/api/initiatives/${id}/report`).then((res) => res.text()),
  bulk: (id: string, action: BulkAction) => post<{ ok: true; count: number }>(`/api/initiatives/${id}/actions/${action}`),
  message: (id: string, body: { body: string; kind: 'comment' | 'feedback' | 'question'; ticketId?: string | null; act?: boolean }) =>
    post<{ ok: true; runId?: string }>(`/api/initiatives/${id}/messages`, body),

  updateTicket: (id: string, p: Partial<Ticket>) => patch<Ticket>(`/api/tickets/${id}`, p),
  ticketAction: (id: string, action: TicketAction) => post(`/api/tickets/${id}/${action}`),

  runs: (q: { active?: boolean; initiativeId?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (q.active) params.set('active', 'true');
    if (q.initiativeId) params.set('initiativeId', q.initiativeId);
    if (q.limit) params.set('limit', String(q.limit));
    return get<Run[]>(`/api/runs?${params}`);
  },
  run: (id: string) => get<Run>(`/api/runs/${id}`),
  runEvents: (id: string) => get<RunEvent[]>(`/api/runs/${id}/events`),
  cancelRun: (id: string) => post(`/api/runs/${id}/cancel`),
};
