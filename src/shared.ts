export type TaskStatus = 'idle' | 'queued' | 'running' | 'waiting_input' | 'building' | 'reviewing' | 'interrupted' | 'failed' | 'uncertain' | 'deleting';
export interface Project { id: string; name: string; path: string; createdAt: number }
// unsent counts review updates the agent has not received; comments are the
// ones that ask for a revision. files are the manuscript files this task's
// accepted changes touched, relative to the repository root.
export interface ReviewSummary { state: string; round: number | null; counts: Record<string, number>; unsent?: number; comments?: number; files?: string[]; next?: string; job?: { phase: string; status: string; error?: string; details?: string[] } | null }
export interface PendingReview { route: string; body: Record<string, unknown>; previousStatus: TaskStatus }
export interface Task {
  id: string; projectId: string; name: string; title: string; instructions: string;
  worktree: string; threadId: string | null; turnId: string | null; agent?: AgentId; model: string | null; effort?: string | null;
  status: TaskStatus; createdAt: number; updatedAt: number; feedbackCursor: number;
  error: string | null; review: ReviewSummary | null;
  pauseVersion?: number; pendingRunId?: string | null;
  pendingReview?: PendingReview | null;
}
export interface Run { id: string; taskId: string; requestKey: string; prompt: string; feedbackCursor?: number; status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'uncertain'; createdAt: number; finishedAt: number | null }
export interface TimelineItem { id: string; taskId: string; type: string; text: string; detail?: string; status?: string; createdAt: number; meta?: MessageMeta }
// A user message can run a skill or carry review feedback; the chat shows
// those as what they are rather than as the prompt the agent receives.
// Papilot itself sends the agent a build its own edits broke.
export interface MessageMeta { skill?: { id: string; name: string }; feedback?: FeedbackSummary; sendsFeedback?: boolean; build?: BuildFailure }
// A failed review build as the engine reports it; log is the compiler log's path.
export interface BuildFailure { error: string; details: string[]; log?: string }
export interface FeedbackSummary { round: number | null; accepted: number; rejected: number; undone: number; comments: { where: string; text: string }[]; buildError?: boolean }
export interface Skill { id: string; name: string; description: string; hint: string; source: 'builtin' | 'user' | 'paper' }
export interface PendingRequest { id: string; taskId: string; method: string; params: Record<string, any>; createdAt: number }
export type AgentId = 'codex' | 'claude' | 'antigravity';
export interface AgentModel { id: string; name: string; isDefault: boolean; efforts: string[]; defaultEffort: string | null }
// The account's included usage: rolling windows (minutes long, reset time in ms) and credits.
export interface UsageWindow { usedPercent: number; minutes: number | null; resetsAt: number | null }
export interface Usage { plan: string | null; windows: UsageWindow[]; credits: { unlimited: boolean; balance: number | null } | null; reached: boolean }
export interface RuntimeStatus { connected: boolean; authenticated: boolean; account: string | null; error: string | null; models: AgentModel[]; usage?: Usage | null }
export interface Snapshot { projects: Project[]; tasks: Task[]; requests: PendingRequest[]; runtime: RuntimeStatus; runtimes?: Partial<Record<AgentId, RuntimeStatus>>; version: string }
export interface GitFile { path: string; status: string; staged: boolean; lines?: [number, number]; from?: string }
export interface GitStatus { branch: string | null; upstream: string | null; ahead: number; behind: number; files: GitFile[]; head: { hash: string; subject: string; date: number } | null; remote?: boolean }
export interface GitDiff { path: string; diff: string; truncated: boolean }
export interface ManuscriptBuild { status: 'building' | 'ready' | 'failed'; key?: string; pages?: [number, number][]; builtAt?: number; error?: string; current: boolean }
export interface Annotation { id: string; projectId: string; key: string; page: number; rect: [number, number, number, number]; rects?: [number, number, number, number][]; comment: string; quote: string; source: { file: string; lines: [number, number]; excerpt?: string } | null; createdAt: number; taskId?: string }
export interface Manuscript { git: GitStatus; build: ManuscriptBuild; annotations: Annotation[] }
