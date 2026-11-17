import { spawnCommand } from '../../bin/agent-paths.mjs';
import type { AcpProfile } from './acp.ts';
import { SessionAcpAgent } from './codebuddy.ts';

// WorkBuddy's desktop runtime is not the public CodeBuddy CLI. Its bundled
// entry point and launch requirements vary by desktop release, so use an
// explicitly configured launcher that owns the WorkBuddy configuration and
// authentication. Never fall back to a different product's saved login.
export const WORKBUDDY_PROFILE: AcpProfile = {
  id: 'workbuddy', name: 'WorkBuddy', bin: 'workbuddy', binEnv: 'PAPILOT_WORKBUDDY_BIN',
  args: ['--acp', '--permission-mode', 'default'], modes: ['default'], readOnly: false,
  env: () => ({ ...process.env, CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS: '1' }),
  permissionModes: {
    default: { label: 'Default', detail: 'Ask before tools' },
    acceptEdits: { label: 'Accept edits', detail: 'Approve edits; ask before commands' },
    plan: { label: 'Plan', detail: 'Plan changes; may write planning files' },
    bypassPermissions: { value: 'full', label: 'Bypass permissions', detail: 'Bypass tool approvals' },
  },
  setup: 'Set PAPILOT_WORKBUDDY_BIN to a WorkBuddy ACP launcher that forwards command-line arguments and preserves the working directory. Sign in with that launcher before reconnecting. A desktop installation alone does not guarantee a usable ACP login; do not substitute the CodeBuddy CLI.',
};

export class WorkBuddyAgent extends SessionAcpAgent {
  private readonly configured: boolean;
  constructor(binary = process.env.PAPILOT_WORKBUDDY_BIN, launch: typeof spawnCommand = spawnCommand) {
    const selected = binary?.trim();
    super(WORKBUDDY_PROFILE, selected, launch);
    this.configured = Boolean(selected);
  }
  detect() { return this.configured && super.detect(); }
  start(): Promise<void> {
    if (!this.configured) return Promise.reject(new Error(WORKBUDDY_PROFILE.setup));
    return super.start();
  }
  request(method: string, params: any = {}): Promise<any> {
    if (!this.configured && (method === 'thread/start' || method === 'thread/resume')) {
      return Promise.reject(new Error(WORKBUDDY_PROFILE.setup));
    }
    return super.request(method, params);
  }
}
