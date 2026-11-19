import type { GroupInstructions, NoteGroup } from './note-groups.ts';
import type { SkillIcon } from './skill-icons.ts';
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
export interface PendingReview { route: string; body: Record<string, unknown>; previousStatus: TaskStatus; previousError?: string | null }
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
export interface Task {
  // A fresh session replaying another task's original request. Provider sessions are never reused.
  restart?: { taskId: string; draftAttachments?: Attachment[] };
  permissions?: TaskPermissions;
  mode?: 'edit' | 'review';
  aiReview?: { key: string; notes?: number; revision?: number };
  // Accepted changes remain isolated until the author applies them.
  reconciliation?: TaskReconciliation | null;
  deferred?: boolean;
  delivery?: { mode: 'workspace' | 'commit' | 'branch'; accepted: string; branch?: string; commit?: string; pending?: boolean } | null;
  id: string; projectId: string; name: string; title: string; instructions: string;
  titleSource?: 'prompt' | 'generated' | 'manual'; titleRevision?: number; titleGeneration?: 'pending' | 'failed' | null;
  /** How full the agent's context window was after its latest reply. */
  context?: ContextUsage | null;
  worktree: string; /** The root document the task compiles, as the review engine recorded it. */ document?: string; threadId: string | null; turnId: string | null; agent?: AgentId; model: string | null; effort?: string | null; serviceTier?: string;
  // The agent's thread was started with Papilot's view_pdf tool.
  viewPdf?: boolean;
  status: TaskStatus; createdAt: number; updatedAt: number; feedbackCursor: number;
  archivedAt?: number | null;
  error: string | null; review: ReviewSummary | null;
  pauseVersion?: number; pendingRunId?: string | null;
  pendingReview?: PendingReview | null;
  // Persist before submission so reconnects resume the same build and run links.
  pendingBuild?: PendingBuild | null;
  // Present until the task's manuscript copy exists (see TaskPreparation).
  preparation?: TaskPreparation | null;
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
// or the published round. Older runs omit it.
export interface Run { workflowAudit?: { fingerprint: string; report: string; files: string[] }; id: string; taskId: string; requestKey: string; prompt: string; attachments?: Attachment[]; feedbackCursor?: number; status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'uncertain'; createdAt: number; finishedAt: number | null; reviewRound?: number | null; noteRounds?: Record<number, number>; noteOptionsRequested?: boolean; noteOptions?: PreparedNoteOptions[] }
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
export interface NoteResult { key: string; itemId: string; index: number; note: NoteSummary; round: number | null; state: 'waiting' | 'unmatched' | 'matched'; changes: NoteChange[] }
export interface NoteOption { id: string; label: string; reason?: string; previewError?: string; edits: { unit: string; text: string }[] }
export const NOTE_ALTERNATIVE_RANGES = { few: [1, 2], balanced: [2, 3], many: [3, 5] } as const;
export type NoteAlternativeRange = keyof typeof NOTE_ALTERNATIVE_RANGES;
export const noteAlternativeRange = (value: unknown): NoteAlternativeRange => typeof value === 'string' && Object.hasOwn(NOTE_ALTERNATIVE_RANGES, value) ? value as NoteAlternativeRange : 'few';
// The requested range is guidance. Keep useful responses outside it bounded.
export const MAX_NOTE_ALTERNATIVES = 6;
// Prepared by the editing agent in the same turn, before review-unit IDs exist.
export interface PreparedNoteOptions { note: number; current: { label: string; reason: string }; options: { label: string; reason: string; edits: { file: string; find: string; replace: string }[] }[] }
export interface NoteOptions { before?: Record<string, string>; round: number; key: string; options: NoteOption[]; selected?: string; locked?: string; comparisonKey?: string }
// request: the author's own overall request sent with notes, which the prompt otherwise only embeds.
export interface MessageMeta { attachments?: Attachment[]; skill?: { id: string; name: string; icon?: SkillIcon }; notes?: NoteSummary[]; request?: string; groupInstructions?: GroupInstructions; feedback?: FeedbackSummary; sendsFeedback?: boolean; build?: BuildFailure; author?: Author }
// Historical attribution on messages and notes from older shared workspaces.
export interface Author { id: string; name: string }
// A failed review build as the engine reports it; log is the compiler log's path.
export interface BuildFailure { error: string; details: string[]; log?: string }
export interface FeedbackSummary { round: number | null; accepted: number; rejected: number; undone: number; comments: { where: string; text: string }[]; buildError?: boolean }
export interface Skill { output?: 'annotations'; id: string; name: string; description: string; hint: string; icon?: SkillIcon; source: 'builtin' | 'user' | 'paper' }
export interface PendingRequest { id: string; taskId: string; method: string; params: Record<string, any>; createdAt: number }
export type AgentId = 'papilot' | 'pi' | 'codex' | 'claude' | 'antigravity' | 'kimi' | 'cursor' | 'copilot' | 'grok' | 'opencode' | 'qwen' | 'glm' | 'deepseek' | 'qoder' | 'codebuddy' | 'workbuddy' | 'collaboration';
// Every agent Papilot can drive, in menu order. Only the ones found on the host are offered.
export const AGENT_IDS: AgentId[] = ['papilot', 'pi', 'codex', 'claude', 'cursor', 'copilot', 'grok', 'antigravity', 'kimi', 'glm', 'deepseek', 'qwen', 'opencode', 'qoder', 'codebuddy', 'workbuddy', 'collaboration'];
export const AGENT_NAMES: Record<AgentId, string> = { papilot: 'Papilot Writer', pi: 'Pi', codex: 'Codex', claude: 'Claude', cursor: 'Cursor', copilot: 'Copilot', grok: 'Grok', antigravity: 'Antigravity', kimi: 'Kimi', glm: 'GLM', deepseek: 'DeepSeek', qwen: 'Qwen', opencode: 'OpenCode', qoder: 'Qoder', codebuddy: 'CodeBuddy', workbuddy: 'WorkBuddy', collaboration: 'Collaboration mode' };
export const usesCodex = (id: AgentId) => id === 'codex' || id === 'collaboration';
// Collaboration mode: the coordinator sends each piece of work to the worker
// configured for its role. A Codex worker without a model uses the task's.
export type CollaborationRole = 'quick' | 'polish' | 'rigorous';
export const COLLABORATION_ROLES: CollaborationRole[] = ['quick', 'polish', 'rigorous'];
export type CollaborationWorkerAgent = 'codex' | 'antigravity' | 'opencode';
export const COLLABORATION_WORKERS: CollaborationWorkerAgent[] = ['codex', 'antigravity', 'opencode'];
export interface CollaborationRoute { agent: CollaborationWorkerAgent; model: string | null; effort: string | null }
export type CollaborationRoutes = Record<CollaborationRole, CollaborationRoute>;
export interface CollaborationSettings { enabled: boolean; routes: CollaborationRoutes }
export const DEFAULT_COLLABORATION_ROUTE: CollaborationRoute = { agent: 'codex', model: null, effort: null };
// A route update from a client: every role, a known worker, optional strings.
export function validRoutes(value: unknown): value is CollaborationRoutes {
  if (!value || typeof value !== 'object') return false;
  const optional = (field: unknown) => field === null || typeof field === 'string';
  return COLLABORATION_ROLES.every(role => {
    const route = (value as Record<string, any>)[role];
    return route && COLLABORATION_WORKERS.includes(route.agent) && optional(route.model) && optional(route.effort);
  });
}
// Saved routes are validated field by field; anything else uses the default.
export function collaborationRoutes(value: unknown): CollaborationRoutes {
  const saved = value && typeof value === 'object' ? value as Record<string, any> : {};
  return Object.fromEntries(COLLABORATION_ROLES.map(role => {
    const route = saved[role];
    if (!route || !COLLABORATION_WORKERS.includes(route.agent)) return [role, DEFAULT_COLLABORATION_ROUTE];
    const text = (field: unknown) => typeof field === 'string' && field.trim() ? field.trim() : null;
    const model = text(route.model);
    // Without a model, a Codex worker also uses the task's reasoning effort.
    return [role, { agent: route.agent, model, effort: route.agent === 'codex' && !model ? null : text(route.effort) }];
  })) as CollaborationRoutes;
}
// Papilot Writer's providers: subscriptions it signs in to, and API keys
// stored by Papilot or read from the environment.
export interface WriterProvider { id: string; name: string; kind: 'login' | 'key'; env?: string; configured: boolean; source: 'stored' | 'environment' | null }
export interface WriterLogin { id: string; provider: string; name: string; status: 'waiting' | 'done' | 'failed' | 'cancelled'; url: string | null; instructions: string | null; error: string | null; startedAt: number }
export interface WriterAuth { providers: WriterProvider[]; logins: WriterLogin[] }
export const isAgentId = (value: unknown): value is AgentId => AGENT_IDS.includes(value as AgentId);
/** source: where an agent with several model providers gets this model, such as a subscription. */
export interface AgentModel { id: string; name: string; source?: string; isDefault: boolean; efforts: string[]; defaultEffort: string | null; fastMode?: { serviceTier: string; description: string } }
// The account's included usage: rolling windows (minutes long, reset time in ms) and credits.
export interface UsageWindow { usedPercent: number; minutes: number | null; resetsAt: number | null }
export interface Usage { plan: string | null; windows: UsageWindow[]; credits: { unlimited: boolean; balance: number | null } | null; reached: boolean }
// installed is false when the agent was not found on the host (no CLI, SDK
// credentials or key); such agents are not offered. Older servers omit it.
export interface RuntimeStatus { hidden?: boolean; permissionOptions?: TaskPermissionOption[]; connected: boolean; authenticated: boolean; account: string | null; error: string | null; models: AgentModel[]; usage?: Usage | null; installed?: boolean }
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
export interface Snapshot { projects: Project[]; tasks: Task[]; requests: PendingRequest[]; runtime: RuntimeStatus; runtimes?: Partial<Record<AgentId, RuntimeStatus>>; version: string; gitAvailable?: boolean; overleaf?: OverleafState }
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
export interface GitStatus { branch: string | null; upstream: string | null; ahead: number; behind: number; files: GitFile[]; head: { hash: string; subject: string; date: number } | null; remote?: boolean; merging?: { message: string; conflicts: string[] } | null }
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
export interface Annotation { context?: string[]; /** The root document whose PDF it is on; absent on notes from before a paper could compile several. */ document?: string; aiReview?: { taskId: string; agent: AgentId; sourceId?: string; copiedTo?: string }; group?: NoteGroup; kind?: MarkKind; stamp?: string; id: string; projectId: string; key: string; page: number; rect: [number, number, number, number]; rects?: [number, number, number, number][]; comment: string; quote: string; source: { file: string; lines: [number, number]; excerpt?: string } | null; createdAt: number; taskId?: string; author?: Author; deletedAt?: number }
// Review findings stay with their task; only explicit copies belong to the manuscript.
export const isTaskReviewNote = (note: Annotation) => Boolean(note.aiReview && !note.aiReview.sourceId);
export interface NoteSection { id: string; title: string; level: number; notes: string[] }
// The repository's files, as Git sees them, with the TeX files that are root
// documents, and the one the paper compiles (null when none is chosen yet).
export interface RepositoryFile { path: string; root?: true }
export interface RepositoryFiles { document: string | null; files: RepositoryFile[] }
export interface Manuscript { git: GitStatus; build: ManuscriptBuild; annotations: Annotation[]; noteSections?: NoteSection[]; unplacedSectionNotes?: number }
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
export interface SourceFile { file: string; revision: string; text: string; base: string | null; passage: [number, number]; focus: [number, number]; drifted: boolean; round?: number; before?: string | null; reviewed?: boolean; reverted?: string[]; authors?: SourceAuthor[] }
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

/** A saved SSH folder. OpenSSH obtains credentials on the Papilot host. */
export interface SshFolder {
  id: string; host: string; user?: string; port?: number; identity?: string; root: string;
}
export interface SshEntry { name: string; folder: boolean }
export interface SshFolderPreview { root: string; entries: SshEntry[]; page: number; pages: number }
export interface SshDocument { text: string; revision: string }
