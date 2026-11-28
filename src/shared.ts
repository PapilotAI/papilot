import type { GroupInstructions, NoteGroup } from './note-groups.ts';
import { isSkillIcon, type SkillIcon } from './skill-icons.ts';
export type TaskStatus = 'preparing' | 'idle' | 'queued' | 'running' | 'waiting_input' | 'building' | 'reviewing' | 'interrupted' | 'failed' | 'uncertain' | 'deleting';
export interface Project { id: string; name: string; path: string; createdAt: number }
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL = 100 * 1024 * 1024;
export interface Attachment { id: string; projectId: string; name: string; size: number; mime: string }
export type UpdateChannel = 'stable' | 'dev';
export interface UpdateStatus {
  // Present when the installation pins its own version (PAPILOT_INSTALL_METHOD).
  packageManager?: 'nix' | 'managed';
  // Present when the update must be downloaded as a new desktop app.
  downloadUrl?: string;
  channel?: UpdateChannel;
  currentVersion: string; latestVersion: string | null;
  phase: 'idle' | 'checking' | 'available' | 'installing' | 'waiting' | 'restarting' | 'updated' | 'failed';
  checkedAt: number | null; error: string | null; canUpdate: boolean;
}
// unsent counts review updates the agent has not received; comments are the
// ones that ask for a revision. files are the manuscript files this task's
// accepted changes touched since its last commit, relative to the repository root.
export interface ReviewJob { id?: string; phase: string; status: string; error?: string; details?: string[]; createdAt?: number; options?: { completed: number; total: number }; progress?: Partial<Record<'baseline' | 'revised', Omit<BuildProgress, 'startedAt'>>> }
export interface ReviewSummary { ready?: number; state: string; round: number | null; counts: Record<string, number>; unsent?: number; comments?: number; files?: string[]; next?: string; job?: ReviewJob | null }
export interface PendingBuild { requestId: string; job?: string; runs: string[]; sendBack: boolean; restarts: number }
// previousStatus and previousError are where Check status returns the task
// once the engine confirms the action.
export interface PendingReview { returnNote?: Annotation; returnNotes?: Annotation[]; route: string; body: Record<string, unknown>; previousStatus: TaskStatus; previousError?: string | null }
// A task is saved with its first message queued before its manuscript copy
// exists, and prepared in the background: the review engine checks out the
// copy, and an AI review also compiles its PDF. A failed preparation keeps
// this record for Retry. submitted is saved before the engine is asked, so a
// task it never saw is deleted without it.
export interface TaskPreparation { submitted?: boolean }
export interface TaskCommitReview { token: string; files: string[]; diff: string }
export interface TaskReconciliation {
  id: string; round: number; files: string[];
  sourceBase: string; sourceAccepted: string; base: string; ready: boolean;
  intent?: { mode: 'workspace' | 'commit'; message: string };
}
// Adapter-owned IDs; workspace is the backwards-compatible default.
export type TaskPermissions = string;
export interface TaskPermissionOption { value: TaskPermissions; label: string; detail: string }
/** An agent chosen for a helper step, such as resolving conflicts. */
export interface HelperChoice { agent: AgentId; model?: string; effort?: string; serviceTier?: string }
/** A manual relay turn (ChatGPT Pro web): waits for a pasted reply, then hands off to a local agent in the same task. */
export interface ManualTurn {
  runId: string;
  status: 'awaiting_reply' | 'implementing';
  executor?: { agent: AgentId; model: string | null; effort?: string | null };
}
export interface ManualGithubRemote { name: string; repository: string; url: string }
export interface ManualGithubSynced { remote: string; repository: string; branch: string; commit: string; url: string; reusedRemote: boolean }
export interface ManualGithubContext { remotes: ManualGithubRemote[]; synced: ManualGithubSynced | null; syncing: boolean; autoSync: boolean; syncError?: string | null }
export interface ChatgptProSettings { enabled: boolean; executor: HelperChoice | null; autoSyncGithub: boolean }
export interface Task {
  /** Active manual relay turn for ChatGPT Pro (web). */
  manualTurn?: ManualTurn | null;
  /** The local agent that last ran an implementation turn on this manual task's thread. */
  manualExecutor?: { agent: AgentId; model: string | null; effort?: string | null } | null;
  // Papilot 0.13 and earlier switched agents by replaying a task's original
  // request in a new task; such a task links to the one it replaced.
  restart?: { taskId: string; draftAttachments?: Attachment[] };
  // The agent's session has not seen the task's earlier conversation, as
  // after switching agents; its next turn is given it.
  handoff?: boolean;
  permissions?: TaskPermissions;
  mode?: 'edit' | 'review' | 'citations';
  // A citation check: its progress, and whether the paper's PDF shows its findings.
  citationCheck?: { show: boolean; state?: CitationCheckState | null };
  aiReview?: { key: string; notes?: number; revision?: number };
  // Accepted changes remain isolated until the author applies them.
  reconciliation?: TaskReconciliation | null;
  /** The conflict-resolution agent the author chose when applying: it
   *  prepares the merge suggestion if the manuscript changed in overlapping
   *  passages. Absent, the task's own agent does. */
  mergeAgent?: HelperChoice | null;
  /** The agent the task goes back to once the merge suggestion that the
   *  conflict-resolution agent prepared is resolved. */
  mergeReturn?: { agent: AgentId; model: string | null; effort?: string | null; serviceTier?: string; permissions?: TaskPermissions } | null;
  deferred?: boolean;
  delivery?: { mode: 'workspace' | 'commit' | 'branch'; accepted: string; branch?: string; commit?: string; pending?: boolean } | null;
  id: string; projectId: string; name: string; title: string; instructions: string;
  titleSource?: 'prompt' | 'generated' | 'manual'; titleRevision?: number; titleGeneration?: 'pending' | 'failed' | null;
  /** How full the agent's context window was after its latest reply. */
  context?: ContextUsage | null;
  worktree: string; /** The root document the task compiles, as the review engine recorded it. */ document?: string; threadId: string | null; turnId: string | null; agent?: AgentId; model: string | null; effort?: string | null; serviceTier?: string;
  // The agent's thread was started with Papilot's view_pdf tool.
  viewPdf?: boolean;
  /** The writing memory the agent's conversation last received (memoryDigest), '' or absent for none. */
  memoryDigest?: string;
  /** Preferences Papilot noticed after this task's review, offered beside its save step. */
  memory?: MemorySuggestion[];
  status: TaskStatus; createdAt: number; updatedAt: number; feedbackCursor: number;
  archivedAt?: number | null;
  error: string | null; review: ReviewSummary | null;
  pauseVersion?: number; pendingRunId?: string | null;
  pendingReview?: PendingReview | null;
  // Persist before submission so reconnects resume the same build and run links.
  pendingBuild?: PendingBuild | null;
  // Present until the task's manuscript copy exists (see TaskPreparation).
  preparation?: TaskPreparation | null;
  /** True when the latest turn failed and can be retried via POST /api/tasks/:id/retry. */
  canRetry?: boolean;
  /** Effective agent for retrying a failed turn. */
  retryAgent?: AgentId;
  /** The run ID that produced the current failed status, or null when another operation failed. */
  failedRunId?: string | null;
}
// A task the author is through with, so the saved result can offer archiving:
// every change of its last result is decided, no comment or rejection
// waits to go back to the agent, and what was accepted has left the task
// (applied or committed). An answer without manuscript changes is finished too.
export function taskFinished(task: Task) {
  const review = task.review;
  if (task.status !== 'reviewing' || !review || task.reconciliation || task.pendingReview || task.delivery?.pending || review.counts?.pending || review.state === 'build_failed') return false;
  const unsent = review.unsent ?? ['accepted', 'rejected', 'commented'].reduce((count, kind) => count + (review.counts?.[kind] || 0), 0);
  if ((review.comments ?? unsent) > 0 || (unsent > 0 && !review.counts?.accepted)) return false;
  if (review.round === null) return true;
  return review.state === 'done' && review.files?.length === 0 && task.delivery?.mode !== 'branch';
}
// reviewRound is 0 while awaiting a result, null when no changes were produced,
// or the published round. Older runs omit it. model is the one the turn started
// with; usage records keep it when the task's model changes during the turn.
// startedAt: when Papilot sent the run to its agent; a run cancelled while queued has none.
export interface Run { workflowAudit?: { fingerprint: string; report: string; files: string[] }; id: string; attemptId?: string; taskId: string; requestKey: string; prompt: string; model?: string | null; attachments?: Attachment[]; feedbackCursor?: number; status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'uncertain'; createdAt: number; startedAt?: number; finishedAt: number | null; reviewRound?: number | null; noteRounds?: Record<number, number>; noteOptionsRequested?: boolean; noteOptions?: PreparedNoteOptions[] }
/** One part of what fills the context window; ids are named in the web app. */
export interface ContextPart { id: string; tokens: number }
/** breakdown: the parts, when the agent can tell them apart, adding up to the window. */
export interface ContextUsage { tokens: number; window: number; breakdown?: ContextPart[] }
/** What a tool call did, when the agent says so: the chat words, groups and marks it by kind. */
export interface ToolCallInfo { kind: string; target?: string; lines?: string; place?: ToolPlace }
/** Where a read was in the paper: the sections it covered and the PDF pages they print on. */
export interface ToolPlace { sections: { number: string; title: string }[]; more?: number; partial?: boolean; pages?: number[] }
// parent: in Collaboration mode, the delegation whose worker took this step.
export interface TimelineItem { id: string; taskId: string; type: string; text: string; rawText?: string; detail?: string; status?: string; createdAt: number; meta?: MessageMeta; tool?: ToolCallInfo; pages?: PageView[]; changes?: FileEdit[]; parent?: string }
// Writing memory: lasting preferences agents follow in later tasks. personal
// is ~/.papilot/memory.md, paper the checkout-only .papilot/memory.local.md,
// shared the repository's .papilot/memory.md that coauthors receive with Git.
export type MemoryScope = 'personal' | 'paper' | 'shared';
export interface MemoryFile { scope: MemoryScope; rules: string[]; revision: string; path: string }
/** language: the language suggested preferences are written in, a language ID or 'auto'. */
export interface MemoryCatalog { files: MemoryFile[]; shareable: boolean; learning: boolean; language: string }
// A preference Papilot noticed in the author's reviews, with the examples
// it is based on. replaces names a rule the suggestion refines; scope starts
// where that rule is. saved records what Remember did, so Undo reverses
// exactly that: existing when the rule was already there, replaced and its
// scope when one went away.
/** What prompted a suggestion, copied from a task's evidence: the author's words, or a change they rejected (the agent's text and the text they kept). */
export interface MemoryExample { task: string; title?: string; said?: string; rejected?: string; kept?: string }
export interface MemorySuggestion { id: string; text: string; scope: MemoryScope; examples: MemoryExample[]; replaces?: string; status: 'pending' | 'saved' | 'dismissed'; saved?: { scope: MemoryScope; text: string; existing?: true; replaced?: string; replacedScope?: MemoryScope } }
/** A file an agent changed: its diff, and where in the paper the changes are. */
export interface FileEdit { path: string; diff?: string; added: number; removed: number; places?: EditPlace[] }
/** Changes within one part of the paper: its sections (innermost last), the page it starts on, and the lines changed. */
export interface EditPlace { sections: { number: string; title: string }[]; page?: string; lines: string; added: number; removed: number }
/** A page an agent looked at, kept by Papilot so the chat can show it. */
export interface PageView { index: number; label: string | null; file: string }
// A user message can run a skill or carry review feedback; the chat shows
// those as what they are rather than as the prompt the agent receives.
// Papilot itself sends the agent a build its own edits broke.
export interface NoteAnchor { sources: { file: string; lines: [number, number] }[]; round?: number }
// paper: where a note made in the task's PDF reader was, so its page can be
// shown to the agent; context: what the agent is told beyond its location.
export interface NoteSummary { group?: NoteGroup; kind?: MarkKind; stamp?: string; where: string; quote: string; comment: string; id?: string; anchor?: NoteAnchor; context?: string[]; paper?: { page: number; rects: [number, number, number, number][]; round?: number; key?: string; build?: string } }
export interface NoteChange { round: number; stop: number; units: string[]; state: 'pending' | 'accepted' | 'rejected' | 'commented' | 'mixed'; match: 'source' | 'quote' }
export interface NoteReturnState { returned: boolean; undoReturnAt?: number }
export interface RemovedNoteReturn { id: string; projectId: string; createdAt: number; originalId: string }
export interface NoteReturnReceipt extends NoteReturnState { key: string; annotation?: Annotation; removed?: RemovedNoteReturn; moved?: boolean }
export interface NoteResult extends Partial<NoteReturnState> { key: string; itemId: string; index: number; note: NoteSummary; round: number | null; state: 'waiting' | 'unmatched' | 'matched'; changes: NoteChange[] }
export interface NoteOptionEdit { unit: string; text: string; before?: number; after?: number }
export interface NoteOptionMeta {
  recommended?: boolean;
  rigor?: 'pass' | 'warn' | 'fail';
  lineDelta?: number;
  consensus?: string[];
  model?: string;
  synthesized?: boolean;
}
export interface NoteOption { id: string; label: string; reason?: string; meta?: NoteOptionMeta; previewError?: string; edits: NoteOptionEdit[] }
export const NOTE_ALTERNATIVE_RANGES = { few: [1, 2], balanced: [2, 3], many: [3, 5] } as const;
export type NoteAlternativeRange = keyof typeof NOTE_ALTERNATIVE_RANGES;
export const noteAlternativeRange = (value: unknown): NoteAlternativeRange => typeof value === 'string' && Object.hasOwn(NOTE_ALTERNATIVE_RANGES, value) ? value as NoteAlternativeRange : 'few';
// The requested range is guidance. Keep useful responses outside it bounded.
export const MAX_NOTE_ALTERNATIVES = 6;
// Prepared by the editing agent or collaboration race in the same turn, before review-unit IDs exist.
export interface PreparedNoteOptions { note: number; current: { label: string; reason: string; meta?: NoteOptionMeta }; options: { label: string; reason: string; meta?: NoteOptionMeta; edits: { file: string; find: string; replace: string }[] }[] }
export interface NoteOptions { noteReturn?: NoteReturnState & { annotation?: Annotation; moved?: boolean }; before?: Record<string, string>; round: number; key: string; options: NoteOption[]; selected?: string; locked?: string; comparisonKey?: string }
export interface CollaborationDispatchWorker {
  itemId: string;
  agent: CollaborationWorkerAgent;
  model: string;
}
export interface CollaborationDispatchEntry {
  clusterId: string;
  notes: number[];
  file: string;
  laneId: string;
  laneName: string;
  laneIcon?: SkillIcon;
  mode: 'assign' | 'race' | 'answer';
  itemId: string;
  workers: CollaborationDispatchWorker[];
  judge?: CollaborationDispatchWorker;
}
export interface CollaborationDispatchMeta {
  strategy: CollaborationStrategy;
  router: { agent: CollaborationWorkerAgent; model: string };
  entries: CollaborationDispatchEntry[];
  reason?: string;
}
export interface CollaborationRaceResultMeta {
  winnerModel: string;
  winnerItemIds: string[];
  synthesized?: boolean;
}
// request: the author's own overall request sent with notes, which the prompt otherwise only embeds.
export interface MessageMeta { attachments?: Attachment[]; skill?: { id: string; name: string; icon?: SkillIcon }; notes?: NoteSummary[]; request?: string; groupInstructions?: GroupInstructions; feedback?: FeedbackSummary; sendsFeedback?: boolean; build?: BuildFailure; author?: Author; advisor?: string; dispatch?: CollaborationDispatchMeta; raceResult?: CollaborationRaceResultMeta }
// Historical attribution on messages and notes from older shared workspaces.
export interface Author { id: string; name: string }
// A failed review build as the engine reports it; log is the compiler log's path.
export interface BuildFailure { error: string; details: string[]; log?: string }
export interface FeedbackSummary { round: number | null; accepted: number; rejected: number; undone: number; comments: { where: string; text: string }[]; buildError?: boolean }
export interface Skill { output?: 'annotations'; id: string; name: string; description: string; hint: string; icon?: SkillIcon; source: 'builtin' | 'user' | 'paper' }
export interface PendingRequest { id: string; taskId: string; method: string; params: Record<string, any>; createdAt: number }
export type AgentId = 'papilot' | 'pi' | 'codex' | 'claude' | 'antigravity' | 'kimi' | 'cursor' | 'copilot' | 'grok' | 'opencode' | 'qwen' | 'glm' | 'zcode' | 'deepseek' | 'qoder' | 'codebuddy' | 'workbuddy' | 'collaboration' | 'chatgpt';
// Every agent Papilot can drive, in menu order. Only the ones found on the host are offered.
export const AGENT_IDS: AgentId[] = ['papilot', 'pi', 'codex', 'claude', 'cursor', 'copilot', 'grok', 'antigravity', 'kimi', 'glm', 'zcode', 'deepseek', 'qwen', 'opencode', 'qoder', 'codebuddy', 'workbuddy', 'collaboration', 'chatgpt'];
export const AGENT_NAMES: Record<AgentId, string> = { papilot: 'Papilot Writer', pi: 'Pi', codex: 'Codex', claude: 'Claude', cursor: 'Cursor', copilot: 'Copilot', grok: 'Grok', antigravity: 'Antigravity', kimi: 'Kimi', glm: 'GLM', zcode: 'ZCode', deepseek: 'DeepSeek', qwen: 'Qwen', opencode: 'OpenCode', qoder: 'Qoder', codebuddy: 'CodeBuddy', workbuddy: 'WorkBuddy', collaboration: 'Collaboration mode', chatgpt: 'ChatGPT Pro (web)' };
export const usesCodex = (id: AgentId) => id === 'codex';
export const isManualAgent = (id: AgentId | undefined) => id === 'chatgpt';
// Collaboration mode: a fast router assigns annotations to per-task lanes
// (single-model direct execution or 2–4 model parallel racing), with a
// rigorous judge selecting the default proposal and exposing alternatives inline.
export type CollaborationStrategy = 'balanced' | 'fast' | 'thorough';
export const COLLABORATION_STRATEGIES: CollaborationStrategy[] = ['balanced', 'fast', 'thorough'];
export const isCollaborationStrategy = (value: unknown): value is CollaborationStrategy => typeof value === 'string' && COLLABORATION_STRATEGIES.includes(value as CollaborationStrategy);
export type CollaborationRole = 'quick' | 'polish' | 'rigorous';
export const COLLABORATION_ROLES: CollaborationRole[] = ['quick', 'polish', 'rigorous'];
export type BuiltinCollaborationLaneId = 'quick' | 'polish' | 'rigorous' | 'layout';
export const BUILTIN_COLLABORATION_LANES: BuiltinCollaborationLaneId[] = ['quick', 'polish', 'rigorous', 'layout'];
export const MAX_COLLABORATION_LANES = 8;
export type CollaborationSlot = 'router' | CollaborationRole | 'judge';
export type CollaborationWorkerAgent = Exclude<AgentId, 'collaboration' | 'chatgpt'>;
export const COLLABORATION_WORKERS: CollaborationWorkerAgent[] = AGENT_IDS.filter((id): id is CollaborationWorkerAgent => id !== 'collaboration' && id !== 'chatgpt');
export interface CollaborationRoute { agent: CollaborationWorkerAgent; model: string | null; effort: string | null; serviceTier?: string | null }
export type CollaborationRoutes = Record<CollaborationRole, CollaborationRoute | null>;
export interface CollaborationLane {
  id: string;
  name: string;
  description: string;
  models: CollaborationRoute[];
  icon?: SkillIcon;
  custom?: boolean;
}
export const DEFAULT_COLLABORATION_LANE_DEFS: Record<BuiltinCollaborationLaneId, { name: string; description: string }> = {
  quick: { name: 'Simple edits', description: 'Typos, punctuation, word swaps, and minor mechanical fixes' },
  polish: { name: 'Prose & polish', description: 'Clarity, flow, conciseness, phrasing, and academic tone' },
  rigorous: { name: 'Math & rigorous', description: 'Proofs, lemmas, typing rules, claims, citations, and technical correctness' },
  layout: { name: 'Layout & LaTeX', description: 'Tables, figures, spacing, macros, formatting, and visual layout' },
};
export interface CollaborationResolved {
  router: CollaborationRoute | null;
  judge: CollaborationRoute | null;
  routes: CollaborationRoutes;
  racers: CollaborationRoute[];
  lanes: CollaborationLane[];
}
export interface CollaborationConfig {
  router: CollaborationRoute | null;
  judge: CollaborationRoute | null;
  routes: CollaborationRoutes;
  racers: CollaborationRoute[];
  lanes?: CollaborationLane[];
}
export interface CollaborationSettings extends CollaborationConfig {
  enabled: boolean;
  resolved?: CollaborationResolved;
  readOnlyAgents?: Partial<Record<CollaborationWorkerAgent, boolean>>;
}
export const MAX_COLLABORATION_RACERS = 4;
export const DEFAULT_COLLABORATION_CONFIG: CollaborationConfig = {
  router: null,
  judge: null,
  routes: { quick: null, polish: null, rigorous: null },
  racers: [],
  lanes: [],
};
export function validRoute(value: unknown): value is CollaborationRoute {
  if (!value || typeof value !== 'object') return false;
  const route = value as Record<string, unknown>;
  const optional = (field: unknown) => field === undefined || field === null || (typeof field === 'string' && field.length <= 300 && !field.includes('\0'));
  return typeof route.agent === 'string' && COLLABORATION_WORKERS.includes(route.agent as CollaborationWorkerAgent)
    && optional(route.model) && optional(route.effort) && optional(route.serviceTier);
}
export function normalizeRoute(value: unknown): CollaborationRoute | null {
  if (!validRoute(value)) return null;
  const text = (field: unknown) => typeof field === 'string' && field.trim() ? field.trim() : null;
  const model = text(value.model), effort = text(value.effort), serviceTier = text(value.serviceTier);
  return { agent: value.agent, model, effort, ...(value.agent === 'codex' && serviceTier && serviceTier !== 'default' ? { serviceTier } : {}) };
}
function dedupeRoutes(list: unknown[]): CollaborationRoute[] {
  const seen = new Set<string>();
  const out: CollaborationRoute[] = [];
  for (const entry of list) {
    const normalized = normalizeRoute(entry);
    if (!normalized) continue;
    const key = `${normalized.agent}\0${normalized.model || ''}\0${normalized.effort || ''}\0${normalized.serviceTier || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= MAX_COLLABORATION_RACERS) break;
  }
  return out;
}
// A route update from a client: every role may be null (auto) or a valid route.
export function validRoutes(value: unknown): value is CollaborationRoutes {
  if (!value || typeof value !== 'object') return false;
  return COLLABORATION_ROLES.every(role => {
    const route = (value as Record<string, unknown>)[role];
    return route === null || validRoute(route);
  });
}
export function validRacers(value: unknown): value is CollaborationRoute[] {
  return Array.isArray(value) && value.length <= MAX_COLLABORATION_RACERS && value.every(validRoute);
}
export const MAX_CUSTOM_COLLABORATION_LANES = MAX_COLLABORATION_LANES - BUILTIN_COLLABORATION_LANES.length;
export function validLanes(value: unknown): value is CollaborationLane[] {
  if (!Array.isArray(value) || value.length > MAX_COLLABORATION_LANES) return false;
  const ids = new Set<string>();
  let customCount = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return false;
    const lane = entry as Record<string, unknown>;
    if (typeof lane.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(lane.id) || ids.has(lane.id)) return false;
    ids.add(lane.id);
    if (!(BUILTIN_COLLABORATION_LANES as string[]).includes(lane.id) && ++customCount > MAX_CUSTOM_COLLABORATION_LANES) return false;
    if (typeof lane.name !== 'string' || !lane.name.trim() || lane.name.length > 60 || lane.name.includes('\0')) return false;
    if (typeof lane.description !== 'string' || lane.description.length > 260 || lane.description.includes('\0')) return false;
    if (lane.icon !== undefined && !isSkillIcon(lane.icon)) return false;
    if (!validRacers(lane.models)) return false;
  }
  return true;
}
export function normalizeLanes(value: unknown): CollaborationLane[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CollaborationLane[] = [];
  let customCount = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const lane = entry as Record<string, unknown>;
    const rawId = typeof lane.id === 'string' ? lane.id.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(rawId) || seen.has(rawId)) continue;
    const builtin = (BUILTIN_COLLABORATION_LANES as string[]).includes(rawId);
    if (!builtin && customCount >= MAX_CUSTOM_COLLABORATION_LANES) continue;
    seen.add(rawId);
    if (!builtin) customCount++;
    const def = builtin ? DEFAULT_COLLABORATION_LANE_DEFS[rawId as BuiltinCollaborationLaneId] : null;
    const name = typeof lane.name === 'string' && lane.name.trim() ? lane.name.trim().slice(0, 60) : (def?.name || rawId);
    const description = typeof lane.description === 'string' ? lane.description.trim().slice(0, 260) : (def?.description || '');
    const models = Array.isArray(lane.models) ? dedupeRoutes(lane.models) : [];
    const icon = !builtin && isSkillIcon(lane.icon) ? lane.icon : undefined;
    out.push({ id: rawId, name, description, models, ...(icon ? { icon } : {}), ...(!builtin ? { custom: true } : {}) });
    if (out.length >= MAX_COLLABORATION_LANES) break;
  }
  return out;
}
// Saved routes are validated field by field; anything else falls back to auto (null).
export function collaborationRoutes(value: unknown, legacy = false): CollaborationRoutes {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(COLLABORATION_ROLES.map(role => {
    const normalized = normalizeRoute(saved[role]);
    // Legacy v1 stored `{ agent: 'codex', model: null, effort: null }` as its
    // untouched default. Treat that as Auto so v1 users are not locked to Codex.
    if (legacy && normalized && normalized.agent === 'codex' && !normalized.model && !normalized.effort && !normalized.serviceTier) return [role, null];
    return [role, normalized];
  })) as CollaborationRoutes;
}
export function collaborationConfig(value: unknown, legacyRoutes?: unknown): CollaborationConfig {
  if (value && typeof value === 'object') {
    const saved = value as Record<string, unknown>;
    const racers = Array.isArray(saved.racers) ? dedupeRoutes(saved.racers) : [];
    const lanes = normalizeLanes(saved.lanes);
    return {
      router: normalizeRoute(saved.router),
      judge: normalizeRoute(saved.judge),
      routes: collaborationRoutes(saved.routes),
      racers,
      lanes,
    };
  }
  if (legacyRoutes && typeof legacyRoutes === 'object') {
    return { ...DEFAULT_COLLABORATION_CONFIG, routes: collaborationRoutes(legacyRoutes, true), lanes: [] };
  }
  return { ...DEFAULT_COLLABORATION_CONFIG, routes: { ...DEFAULT_COLLABORATION_CONFIG.routes }, racers: [], lanes: [] };
}
// Papilot Writer's providers: subscriptions it signs in to, and API keys
// stored by Papilot or read from the environment.
export interface WriterProvider { id: string; name: string; kind: 'login' | 'key' | 'custom' | 'gateway'; env?: string; configured: boolean; source: 'stored' | 'environment' | null }
export interface WriterCustomApi { baseUrl: string; model: string }
export interface WriterLogin { id: string; provider: string; name: string; status: 'waiting' | 'done' | 'failed' | 'cancelled'; url: string | null; instructions: string | null; error: string | null; startedAt: number }
export interface WriterAuth { providers: WriterProvider[]; logins: WriterLogin[]; customApi?: WriterCustomApi; gatewayOnly?: boolean }
export const isAgentId = (value: unknown): value is AgentId => AGENT_IDS.includes(value as AgentId);
/** source: where an agent with several model providers gets this model, such as a subscription. */
export interface AgentModel { id: string; name: string; source?: string; isDefault: boolean; efforts: string[]; defaultEffort: string | null; serviceTiers?: string[] }

export function modelServiceTier(model: AgentModel | undefined, tier?: string) {
  return tier && model?.serviceTiers?.includes(tier) ? tier : 'default';
}

// Use a known catalog to resolve saved speeds. Omitted speeds inherit the host default.
export function effectiveServiceTier(model: AgentModel | undefined, tier?: string) {
  return tier && model ? modelServiceTier(model, tier) : tier;
}
// The account's included usage: rolling windows (minutes long, reset time in ms) and credits.
export interface UsageWindow { usedPercent: number; minutes: number | null; resetsAt: number | null; scope?: string; label?: string }
export interface Usage { plan: string | null; windows: UsageWindow[]; credits: { unlimited: boolean; balance: number | null } | null; reached: boolean }
// installed is false when the agent was not found on the host (no CLI, SDK
// credentials or key); such agents are not offered. Older servers omit it.
// hidden: collaboration mode is not enabled, or the author turned the agent
// off in Settings → Agents. hiddenModels: models left out of the pickers.
export interface RuntimeStatus { hidden?: boolean; hiddenModels?: string[]; permissionOptions?: TaskPermissionOption[]; supportsReadOnlyTasks?: false; canRefresh?: boolean; connected: boolean; authenticated: boolean; authenticationUnchecked?: true; account: string | null; error: string | null; models: AgentModel[]; usage?: Usage | null; installed?: boolean }
// A change in Settings → Agents: turn an agent on or off, choose which of its
// models the pickers offer, or turn every agent on and show every model.
export type AgentSettingsChange = { agent: AgentId; enabled?: boolean; hiddenModels?: string[] } | { reset: true };
export interface DiagnosticCheck { id: string; ok: boolean; severity: 'error' | 'warn' | 'info'; detail: string; fix: string | null }
// A compact summary of the host tools required to work on papers.
export interface SystemRequirements {
  platform: string;
  checks: { id: 'git' | 'latexmk' | 'synctex' | 'tex-engine'; ok: boolean; failureReason?: 'timeout' | 'failed' }[];
}
export interface LatexInstallation {
  distribution: 'MacTeX' | 'BasicTeX' | 'TeX Live' | 'MiKTeX' | null;
  version: string | null;
  path: string;
}
/** What compiles papers on this host: latexmk, or the experimental PhiTeX
 *  when installed (its version, else null). */
export interface CompilerChoice {
  compiler: 'latexmk' | 'phitex';
  phitex: string | null;
}
export interface DiagnosticReport {
  version: string; checkedAt: number; platform: string; arch: string; node: string;
  ok: boolean; checks: DiagnosticCheck[];
}
export interface HostUser {
  name?: string;
  email?: string;
  plan?: string;
  usagePercent?: number;
}
export interface HostChrome {
  name?: string;
  homeUrl?: string;
  accountUrl?: string;
  billingUrl?: string;
  logoutUrl?: string;
  user?: HostUser;
}
export interface Snapshot { projects: Project[]; manuscriptNoteCounts?: Record<string, number>; tasks: Task[]; pinnedTaskIds?: string[]; requests: PendingRequest[]; runtime: RuntimeStatus; runtimes?: Partial<Record<AgentId, RuntimeStatus>>; allowedAgents?: AgentId[]; singlePaper?: true; host?: HostChrome; version: string; gitAvailable?: boolean; overleaf?: OverleafState }
// Live synchronization of a paper folder with an Overleaf project. A conflict
// is a passage (or whole file) both sides changed while Papilot was away:
// Overleaf's version stayed, and the author's can be put back.
export interface OverleafConflict { id: string; path: string; kind: 'text' | 'file'; at: number; ours?: string; theirs?: string }
// An Overleaf account, by its id; a name left empty is someone not signed in.
export interface OverleafPerson { id: string; name: string; you?: boolean; file?: string }
// Where someone's cursor is on Overleaf: a file and a 0-based line and column.
export interface OverleafCursor extends OverleafPerson { client: string; file: string; line: number; column: number }
// Text a person wrote on Overleaf, [from, to) in a file's text, and when.
export interface SourceAuthor { from: number; to: number; id: string; name: string; you?: boolean; at: number }
export type OverleafSyncState = 'connecting' | 'syncing' | 'synced' | 'offline' | 'paused' | 'signed-out' | 'no-access';
export interface OverleafSync {
  projectId: string; origin: string; overleafId: string; name: string; url: string;
  state: OverleafSyncState; message?: string; readOnly: boolean;
  // Whether Overleaf records this author's edits as tracked changes.
  tracking: boolean;
  pending: number; syncedAt: number | null;
  /** Who has the project open on Overleaf, by account: the file they are
   *  in, and whether it is this account in a browser. */
  collaborators: OverleafPerson[];
  // Where their cursors are, by connection.
  cursors: OverleafCursor[];
  conflicts: OverleafConflict[];
  skipped: string[];
}
export interface OverleafAccount { origin: string; email: string }
/** A browser on the computer Papilot runs on, already signed in to Overleaf. */
export interface OverleafBrowserSession { id: string; browser: string; profile?: string }
export interface OverleafState { accounts: OverleafAccount[]; syncs: OverleafSync[] }
export interface OverleafProjectSummary { id: string; name: string; updatedAt: number | null; owner: string; access: string }
export interface OverleafComparison { name: string; same: number; overleaf: string[]; local: string[]; different: string[] }
// staged: the index has changes to this file; unstaged: the working tree has more.
// index is the staged status where it differs from status, which is the working tree's when it has changes.
export interface GitFile { path: string; status: string; staged: boolean; unstaged: boolean; lines?: [number, number]; from?: string; index?: string; incoming?: string }
// merging is a merge in progress, with the files whose conflict markers remain.
export interface GitStatus { branch: string | null; upstream: string | null; ahead: number; behind: number; files: GitFile[]; head: { hash: string; subject: string; date: number } | null; remote?: boolean; merging?: { head?: string; message: string; conflicts: string[] } | null }
export interface GitDiff { path: string; diff: string; truncated: boolean }
export type GitDiffScope = 'all' | 'staged' | 'unstaged';
export interface GitVersion { hash: string; message: string; author: string; date: number }
export interface GitHistory { versions: GitVersion[]; next: string | null }
export interface GitVersionDetail { version: GitVersion; files: { path: string; status: string; from?: string }[] }
export interface GitWorktree {
  path: string; branch: string | null; head: string | null; current: boolean; bare: boolean;
  locked?: string; prunable?: string; status: GitStatus | null; error?: string;
  taskId?: string;
}
// refs are local branches; remote branches and tags are listed apart, as an editor's graph shows them.
export interface GitGraphCommit { hash: string; parents: string[]; subject: string; author: string; date: number; refs: string[]; remotes?: string[]; tags?: string[] }
export interface GitOverview { worktrees: GitWorktree[]; commits: GitGraphCommit[]; truncated: boolean }
// A running compilation, from latexmk's output: its step, the TeX pass, and
// the pages typeset in that pass against the last known page count.
export interface BuildProgress { step: 'tex' | 'bibliography' | 'pdf'; pass: number; pages: number; total: number | null; startedAt: number }
export interface ManuscriptBuild { status: 'building' | 'ready' | 'failed'; key?: string; pages?: [number, number][]; builtAt?: number; error?: string; failureId?: string; current: boolean;
  /** The working tree this build compiles or compiled, failed or not. */
  tree?: string; problems?: BuildProblemCounts; progress?: BuildProgress;
  /** The root document whose PDF `key` is. */
  document?: string }
// What the last finished build reported. Errors can accompany a usable PDF; warnings are
// mistakes in the PDF (?? and missing citations); minor problems are
// typesetting (overfull lines) and package remarks, listed but never counted.
export type BuildProblemKind = 'error' | 'missing-file' | 'reference' | 'citation' | 'label' | 'glyph' | 'overfull' | 'other';
export interface BuildProblem {
  kind: BuildProblemKind; severity: 'error' | 'warning' | 'minor'; message: string;
  key?: string; file?: string; line?: number; end?: number; amount?: number; count?: number;
  page?: number; rect?: [number, number, number, number];
}
export interface BuildProblemCounts { errors: number; warnings: number; minor: number }
// A label defined twice is listed at each definition but counts as one problem.
export function countProblems(problems: Pick<BuildProblem, 'severity' | 'kind' | 'key'>[]): BuildProblemCounts {
  const counts = { errors: 0, warnings: 0, minor: 0 }, labels = new Set<string>();
  for (const problem of problems) {
    if (problem.kind === 'label' && problem.key) { if (labels.has(problem.key)) continue; labels.add(problem.key); }
    counts[problem.severity === 'error' ? 'errors' : problem.severity === 'warning' ? 'warnings' : 'minor']++;
  }
  return counts;
}
// `key` names the PDF whose pages the locations refer to.
export interface ManuscriptProblems { status: ManuscriptBuild['status']; key?: string; failureId?: string; problems: BuildProblem[]; log: boolean }
export interface BuildRepairResult { kind: 'settings' | 'source' | 'advice'; summary: string }
// A delete mark asks for the marked text to go, or to be replaced by its
// comment; a point marks a place rather than a passage. A stamp is the short
// name of a quick note the author picked; its comment holds the instruction.
export type MarkKind = 'delete' | 'point';
export const isMarkKind = (value: unknown): value is MarkKind => value === 'delete' || value === 'point';
// The magic pen's saved quick notes. A preset that is
// unchanged stores only its id, so its name and instruction follow the
// interface language; anything changed or added stores its own text.
export interface QuickNote { id: string; label?: string; instruction?: string; icon?: string }
export const QUICK_NOTE_LIMIT = 8;
export const PRESET_QUICK_NOTES = ['polish', 'tighten', 'runt', 'connect', 'verify'];
export interface Annotation { returnAction?: { taskId: string; id: string; key: string; originalId: string; undone?: boolean }; returnDecisions?: string[]; returnReplay?: string; returnReplays?: string[]; agentAnnotation?: { taskId: string; request: string }; context?: string[]; groupInstruction?: string; /** The root document whose PDF it is on; absent on notes from before a paper could compile several. */ document?: string; aiReview?: { taskId: string; agent: AgentId; sourceId?: string; copiedTo?: string }; group?: NoteGroup; kind?: MarkKind; stamp?: string; id: string; projectId: string; key: string; page: number; rect: [number, number, number, number]; rects?: [number, number, number, number][]; comment: string; quote: string; source: { file: string; lines: [number, number]; excerpt?: string } | null; createdAt: number; taskId?: string; author?: Author; deletedAt?: number; deletedBatch?: string }
// Review findings stay with their task; only explicit copies belong to the manuscript.
export const isTaskReviewNote = (note: Annotation) => Boolean(note.aiReview && !note.aiReview.sourceId);
export interface NoteSection { id: string; title: string; level: number; notes: string[] }
/** Normalized gutter and full-width bands on a page with two columns. */
export interface PageReadingLayout { gutter: number; spanning: [number, number][] }
// The repository's files, as Git sees them, with the TeX files that are root
// documents, and the one the paper compiles (null when none is chosen yet).
export interface RepositoryFile { path: string; root?: true }
export interface RepositoryFiles { document: string | null; files: RepositoryFile[] }
/** A display-only position; the task's original annotation stays unchanged. */
export interface InFlightMark { note: Annotation; taskId: string; title: string; status: TaskStatus; ready?: true }
export interface AnnotationGroupState { id: string; createdAt: number; group: NoteGroup | null; groupInstruction?: string }
export interface AnnotationGroupEdit extends AnnotationGroupState { from: Pick<AnnotationGroupState, 'group' | 'groupInstruction'> }
export interface AnnotationBatch { document: string | null; batch: string; ids: string[] }
export interface AnnotationBatchResult { changed: string[]; restoredIds?: string[]; failed: { id: string; error: string }[]; annotations: Annotation[] }
export interface Manuscript { git: GitStatus; build: ManuscriptBuild; document?: string; annotations: Annotation[]; inFlightMarks?: InFlightMark[]; noteSections?: NoteSection[]; unplacedSectionNotes?: number; notePageLayouts?: Record<number, PageReadingLayout> }
// A source file for manual editing, as it is on disk: `revision` names its
// bytes, so a save refuses when the file changed meanwhile, and `base` is the
// file at the last commit (null when it has none), to show what changed.
// Lines are 0-based, end excluded: `passage` is the paragraph a click on the
// PDF named and `focus` the lines it hit; `drifted` says the passage changed
// after the PDF it was found in was compiled. A task's file is in its
// worktree, `base` is the file before the task, and `round` names the
// review round that shows it, which a save continues; `reviewed` says that
// round shows this very text, but for the rejected changes in `reverted`
// whose text came back; its changes replaced parts of `before`.
export interface SourceFile { file: string; revision: string; text: string; base: string | null; passage: [number, number]; focus: [number, number]; drifted: boolean; round?: number; before?: string | null; reviewed?: boolean; reverted?: string[]; worded?: Record<string, string>; authors?: SourceAuthor[] }
// A task's saved file, and the review after the save.
export interface TaskSourceSave { source: SourceFile; state: unknown }
// A saved file, the lines that changed, the working tree whose build shows
// it, and when it was written, by the server's clock (as builds' `builtAt`).
export interface SourceSave { source: SourceFile; changed: [number, number]; tree: string; at: number }
// Where saved lines were printed in a PDF: a page (0-based) and a box as fractions of it.
export interface SourcePlace { page: number; rect: [number, number, number, number] }
/** A 1-based inclusive range in a durable source snapshot. */
export interface SourceAnchor { file: string; revision: string; lines: [number, number]; quote?: string }
// Folders on the computer running Papilot, for choosing a location from a browser.
export interface FolderListing { path: string; parent: string | null; folders: { name: string; path: string }[] }
export interface PaperImport {
  id: string; path: string; name: string; copied: boolean; candidates: string[]; main: string; engine: string;
  phase: 'choose' | 'building' | 'failed' | 'ready' | 'repairing';
  error?: string; summary?: string; versioned?: boolean;
  // While building: when it started, and the compilation's progress.
  startedAt?: number; progress?: BuildProgress;
  // The Overleaf project the paper keeps syncing with once added.
  overleaf?: string;
}
// The paper's bibliography as the References panel reads it: the review
// engine's report of every entry, with online checks and the entries the
// author checked by hand.
export interface ReferenceCitation { file: string; line: number; section: string | null }
export interface ReferenceRecord { source: 'doi' | 'crossref' | 'arxiv' | 'dblp'; title: string; authors: string[]; year: number | null; venue: string | null; doi: string | null; url: string }
export interface ReferenceCheck {
  status: 'verified' | 'mismatch' | 'unverified' | 'failed' | 'skipped';
  record?: ReferenceRecord; via: 'doi' | 'arxiv' | 'title' | null;
  differences: { field: 'title' | 'author' | 'year' | 'doi' | 'arxiv'; bib: string; record: string; minor?: boolean }[];
  reason?: 'doi-not-found' | 'arxiv-not-found' | 'no-match' | 'nothing-to-check'; unavailable: string[]; checked: number;
}
export interface BibliographyEntry { id: string; file: string; key: string; type: string; fields: { name: string; value: string; resolved?: string }[]; lines: [number, number]; cited: ReferenceCitation[]; error?: string }
export interface BibliographyReport {
  bibs: string[]; absent: string[]; entries: BibliographyEntry[];
  missing: (ReferenceCitation & { key: string })[]; duplicates: string[][]; similar: { ids: string[]; by: 'doi' | 'title' }[]; all_cited: boolean;
  checks: Record<string, ReferenceCheck>; pending: number; confirmed: Record<string, number>;
}

export type ActivityRange = '7d' | '30d' | '90d' | 'all';
export const ACTIVITY_RANGES: ActivityRange[] = ['7d', '30d', '90d', 'all'];
export type ActivityTurnRole = 'edit' | 'review' | 'worker' | 'helper';
export type ActivityCostSource = 'reported' | 'estimated' | 'mixed' | 'unknown';

export interface ActivityTokenTotals {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  total: number;
}

export interface ActivityMetrics {
  tokens: ActivityTokenTotals;
  costUsd: number | null;
  reportedCostUsd: number;
  estimatedCostUsd: number;
  pricedTokens: number;
  unpricedTokens: number;
  tasksStarted: number;
  editTasksStarted: number;
  reviewTasksStarted: number;
  turns: number;
  completedTurns: number;
  failedTurns: number;
  interruptedTurns: number;
  turnsByRole: Record<ActivityTurnRole, number>;
  /** Wall time of finished agent turns, from start to finish. */
  agentMs: number;
  accepted: number;
  rejected: number;
  commented: number;
  undone: number;
  tasksApplied: number;
  tasksCommitted: number;
  gitCommits: number;
  annotationsCreated: number;
  authorAnnotations: number;
  agentAnnotations: number;
  aiReviewAnnotations: number;
  annotationsSent: number;
}

export interface ActivityTotals extends ActivityMetrics {
  activeDays: number;
}

export interface ActivityDay extends ActivityMetrics {
  date: string;
  hours: number[];
  turnHours: number[];
  tokenHours: number[];
}

// An active day of the activity calendar, which covers every day whatever the
// selected range. actions counts what the active hours count: agent runs,
// review decisions, your annotations, saved tasks and commits.
export interface ActivityCalendarDay extends Pick<ActivityMetrics, 'costUsd' | 'reportedCostUsd' | 'estimatedCostUsd' | 'turns' | 'accepted' | 'rejected' | 'commented' | 'annotationsCreated'> {
  date: string;
  actions: number;
  tokens: number;
}

export interface ActivityAgentSummary {
  agent: AgentId;
  tasksStarted: number;
  turns: number;
  tokens: ActivityTokenTotals;
  costUsd: number | null;
  reportedCostUsd: number;
  estimatedCostUsd: number;
  unpricedTokens: number;
}

export interface ActivityModelSummary {
  agent: AgentId;
  model: string;
  turns: number;
  tokens: ActivityTokenTotals;
  costUsd: number | null;
  costSource: ActivityCostSource;
}

export interface ActivityProjectSummary {
  id: string;
  name: string;
  removed?: true;
  tasksStarted: number;
  turns: number;
  tokens: number;
  costUsd: number | null;
  accepted: number;
  rejected: number;
  annotationsCreated: number;
}

export interface ActivityReport {
  timezone: string;
  today: string;
  range: ActivityRange;
  generatedAt: number;
  projectId: string | null;
  projects: ActivityProjectSummary[];
  totals: ActivityTotals;
  hours: number[];
  turnHours: number[];
  tokenHours: number[];
  days: ActivityDay[];
  calendar: ActivityCalendarDay[];
  agents: ActivityAgentSummary[];
  models: ActivityModelSummary[];
}
// Where an entry's PDF came from, and why an entry has none yet: Papilot is
// still looking, the work has no open copy (the landing page is where the
// author can get one), no DOI or arXiv identifier says which work it is, a
// source could not be reached, the author took a wrong PDF away, or online
// lookups are off.
export type LibrarySource = 'zotero' | 'arxiv' | 'open-access' | 'author' | 'agent';
export interface LibraryPdf { hash: string; source: LibrarySource; pages: number | null; text: 'pending' | 'ready' | 'none'; url?: string }
export interface LibraryEntry { pdf: LibraryPdf | null; find: 'waiting' | 'searching' | 'paywalled' | 'unidentified' | 'unreachable' | 'removed' | 'off' | null; landing: string | null }
// What a cited work says about a sentence that cites it, as an agent found
// it in the work's PDF: a verdict, a note, and the PDF's own lines as
// evidence, cut out by Papilot from the anchors the agent gave. A finding
// made on another PDF of the work than the library now has is stale.
export type CitationVerdict = 'supported' | 'partial' | 'unsupported' | 'unclear';
export interface CitationEvidence { quote: string; page: number; marks: { page: number; rect: [number, number, number, number] }[] }
// by: the quick model that checked it; an agent's finding has none.
export interface CitationFinding { verdict: CitationVerdict; note: string; evidence: CitationEvidence[]; pdf: string; checkedAt: number; by?: string; task?: string; stale?: boolean }
// A checked citing sentence where it prints in the paper's PDF: its lines,
// and the findings for the works it cites, with each work's library PDF.
export interface EvidenceMark { id: string; page: number; rects: [number, number, number, number][]; sentence: string; file: string; line: number;
  findings: (CitationFinding & { key: string; entry: string; title: string; hash: string })[];
  // A sentence citing nothing: the library work it could cite.
  suggestion?: CitationSuggestion & { entry: string; title: string } }
// A sentence that cites nothing and a library work the quick model found to
// say what it claims, with that work's lines.
export interface CitationSuggestion { id: string; file: string; line: number; section: string | null; sentence: string; key: string; verdict: 'supported' | 'partial'; note: string; evidence: CitationEvidence[]; pdf: string; checkedAt: number; by?: string; task?: string }
// A paper's quick citation check: how far it got, the model doing it, and why it stopped early.
export interface CitationCheckState { phase?: 'citations' | 'sources'; output?: string; running: boolean; stopping?: boolean; done: number; total: number; failed: number; model: string | null; error: string | null; finishedAt: number | null }
/** A sentence of the paper that cites works, with what was found for each. */
export interface CitingSentence { id: string; keys: string[]; file: string; line: number; section: string | null; sentence: string; findings: Record<string, CitationFinding> }
export interface LibraryReport extends BibliographyReport {
  library: { entries: Record<string, LibraryEntry>; pending: number };
  citations: CitingSentence[];
  // Sentences citing nothing that a library work supports, and how many cite nothing.
  suggestions: CitationSuggestion[]; uncited: number;
}
// The Zotero libraries the Library takes PDFs from. On this host: none, one
// whose database cannot be read, or one with its counts. The account: its
// libraries (the user's own has no name) as last synced, and why the last
// sync did not finish. Whether works take PDFs from Zotero at all is the
// server's setting, for every paper and browser.
// chosen: the data directory the author chose, or null when Papilot finds it.
export type ZoteroLocal = ({ state: 'missing' } | { state: 'unreadable'; dataDir: string } | { state: 'ready'; dataDir: string; items: number; withPdf: number; citationKeys: number }) & { chosen: string | null };
export interface ZoteroAccountStatus { username: string; libraries: { name: string | null; items: number; withPdf: number; citationKeys: number }[]; syncing: boolean; synced: number | null; problem: 'revoked' | 'unreachable' | null }
export interface ZoteroStatus { local: ZoteroLocal; account: ZoteroAccountStatus | null; use: boolean }
