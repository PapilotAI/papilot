export type TaskStatus = 'idle' | 'queued' | 'running' | 'waiting_input' | 'building' | 'reviewing' | 'interrupted' | 'failed' | 'uncertain' | 'deleting';
export interface Project { id: string; name: string; path: string; createdAt: number }
export interface ReviewSummary { state: string; round: number | null; counts: Record<string, number>; unsent?: number; next?: string; job?: { phase: string; status: string; error?: string; details?: string[] } | null }
export interface PendingReview { route: string; body: Record<string, unknown>; previousStatus: TaskStatus }
export interface Task {
  id: string; projectId: string; name: string; title: string; instructions: string;
  worktree: string; threadId: string | null; turnId: string | null; model: string | null;
  status: TaskStatus; createdAt: number; updatedAt: number; feedbackCursor: number;
  error: string | null; review: ReviewSummary | null;
  pauseVersion?: number; pendingRunId?: string | null;
  pendingReview?: PendingReview | null;
}
export interface Run { id: string; taskId: string; requestKey: string; prompt: string; feedbackCursor?: number; status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'uncertain'; createdAt: number; finishedAt: number | null }
export interface TimelineItem { id: string; taskId: string; type: string; text: string; detail?: string; status?: string; createdAt: number }
export interface PendingRequest { id: string; taskId: string; method: string; params: Record<string, any>; createdAt: number }
export interface RuntimeStatus { connected: boolean; authenticated: boolean; account: string | null; error: string | null; models: { id: string; name: string; isDefault: boolean }[] }
export interface Snapshot { projects: Project[]; tasks: Task[]; requests: PendingRequest[]; runtime: RuntimeStatus; version: string }
export interface GitFile { path: string; status: string; staged: boolean; lines?: [number, number] }
export interface GitStatus { branch: string | null; upstream: string | null; ahead: number; behind: number; files: GitFile[]; head: { hash: string; subject: string; date: number } | null }
export interface ManuscriptBuild { status: 'building' | 'ready' | 'failed'; key?: string; pages?: [number, number][]; builtAt?: number; error?: string; current: boolean }
export interface Manuscript { git: GitStatus; build: ManuscriptBuild }
