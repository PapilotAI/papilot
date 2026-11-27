export const OPEN_RESOURCE_COMMAND = 'papilot.openResource';

/** Only the conversation can act on the selected task; paper controls stay paper-scoped. */
export function allowedCommand(kind: 'chat' | 'paper' | 'review' | 'taskPdf', command: string, taskId?: string, selectedTask?: string) {
  if (command === 'papilot.git') return true;
  if (kind === 'paper') return ['papilot.newTask', 'papilot.build', 'papilot.log', 'papilot.changes'].includes(command);
  if (kind !== 'chat') return false;
  if (command === 'papilot.newTask') return true;
  return ['papilot.review', 'papilot.apply'].includes(command) && Boolean(taskId) && taskId === selectedTask;
}
