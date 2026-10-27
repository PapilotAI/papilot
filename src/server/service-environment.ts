import path from 'node:path';

/** launchd has no login shell. Keep the tool choices made by the installer. */
export function serviceEnvironment(
  root: string, home: string, executable: string,
  inherited: NodeJS.ProcessEnv, previous: NodeJS.ProcessEnv = {},
): Record<string, string> {
  // An explicit empty value clears a previously saved override.
  const toolPath = inherited.PAPILOT_SERVICE_PATH ?? previous.PAPILOT_SERVICE_PATH ?? '';
  const directories = [
    ...toolPath.split(path.delimiter),
    path.dirname(executable), path.join(root, 'node_modules/.bin'),
    ...(inherited.PATH || '').split(path.delimiter),
    '/Library/TeX/texbin', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ].filter(directory => path.isAbsolute(directory));
  const env: Record<string, string> = {
    PATH: [...new Set(directories)].join(path.delimiter), HOME: home, NODE_ENV: 'production',
  };
  for (const [key, value] of Object.entries(inherited)) if (key.startsWith('PAPILOT_') && value) env[key] = value;
  if (toolPath) env.PAPILOT_SERVICE_PATH = toolPath;
  return env;
}
