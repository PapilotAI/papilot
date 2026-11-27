import { AGENT_IDS, type AgentId, type AgentModel, type RuntimeStatus, type TaskPermissionOption } from '../../shared.ts';

// Static examples for the shared picker, not a live provider catalog. Agents
// without example models still expose their configured default, like the app.
const model = (id: string, name: string, efforts: string[] = [], defaultEffort: string | null = null, isDefault = false): AgentModel => ({ id, name, efforts, defaultEffort, isDefault });
const codexEfforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const claudeEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const catalog: Partial<Record<AgentId, AgentModel[]>> = {
  papilot: [{ ...model('openai-codex/gpt-6-astra', 'GPT-6 Astra', codexEfforts, 'medium', true), source: 'ChatGPT Plus or Pro' }],
  codex: [
    model('gpt-6-astra', 'GPT-6 Astra', codexEfforts, 'xhigh', true),
    model('gpt-6.1-sol', 'GPT-6.1 Sol', codexEfforts, 'high'),
    model('gpt-6.1-terra', 'GPT-6.1 Terra', codexEfforts, 'high'),
    model('gpt-6-luna', 'GPT-6 Luna', ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'),
  ].map(model => ({ ...model, serviceTiers: ['priority'] })),
  claude: [
    model('fable', 'Fable', claudeEfforts, 'high', true),
    model('opus', 'Opus', claudeEfforts, 'high'),
    model('sonnet', 'Sonnet', claudeEfforts, 'high'),
    model('haiku', 'Haiku'),
  ],
  antigravity: [model('gemini-4-argon', 'Gemini 4 Argon', [], null, true), model('gemini-3.8-flash', 'Gemini 3.8 Flash')],
  glm: [model('glm-5.3', 'GLM-5.3', [], null, true), model('glm-5.3-flash', 'GLM-5.3 Flash'), model('glm-5-turbo', 'GLM-5 Turbo'), model('glm-4.7', 'GLM-4.7')],
  deepseek: [model('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', [], null, true)],
};
const permissions: Partial<Record<AgentId, TaskPermissionOption[]>> = {
  papilot: [
    { value: 'workspace', label: 'Paper edits', detail: 'Read, edit LaTeX and BibTeX, compile, view pages and add verified references without asking. Ask before other files change, files are moved or deleted, and before chore mode runs shell commands.' },
    { value: 'full', label: 'Full access', detail: 'Never ask: every edit, deletion and chore-mode command runs without approval, still only inside the task worktree.' },
  ],
  codex: [
    { value: 'workspace', label: 'Workspace access', detail: 'Write within the workspace and configured writable roots, with network access. Ask before exceeding sandbox restrictions.' },
    { value: 'full', label: 'Full access', detail: 'Disable the sandbox and run tools without approval, subject to managed settings.' },
  ],
  claude: [
    { value: 'workspace', label: 'Sandboxed edits', detail: 'Automatically approve edits and sandboxed commands. Ask before other actions.' },
    { value: 'full', label: 'Bypass permissions', detail: 'Disable the command sandbox and bypass tool approvals, subject to managed settings.' },
  ],
};
export const demoRuntimes = Object.fromEntries(AGENT_IDS.map(id => [id, {
  permissionOptions: permissions[id] || [],
  ...(id === 'zcode' || id === 'chatgpt' ? { supportsReadOnlyTasks: false } : {}),
  ...(id === 'chatgpt' ? { hidden: true } : {}),
  installed: true, connected: true, authenticated: true, account: null, error: null, models: catalog[id] || [],
}])) as Record<AgentId, RuntimeStatus>;
