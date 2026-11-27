import type { ReactNode } from 'react';
import {
  AGENT_NAMES,
  BUILTIN_COLLABORATION_LANES,
  COLLABORATION_WORKERS,
  DEFAULT_COLLABORATION_LANE_DEFS,
  type BuiltinCollaborationLaneId,
  type CollaborationDispatchEntry,
  type CollaborationDispatchMeta,
  type CollaborationDispatchWorker,
  type CollaborationWorkerAgent,
  type TimelineItem,
} from '../shared.ts';
import { BrandIcon } from './brand-icon.tsx';
import { Icon } from './icons.tsx';
import { t, useLanguage } from './i18n.ts';
import { useNoteResults } from './note-results.tsx';
import { workflowKind } from './tool-calls.ts';

type ItemState = 'running' | 'done' | 'failed' | 'stopped' | 'queued';

const stateOf = (item?: TimelineItem): ItemState => {
  if (!item) return 'queued';
  if (item.status === 'inProgress') return 'running';
  if (item.status === 'interrupted') return 'stopped';
  if (item.status === 'completed') return 'done';
  if (item.status) return 'failed';
  return 'queued';
};

function agentFromLabel(name: string): CollaborationWorkerAgent | null {
  const normalized = name.trim().toLowerCase();
  for (const id of COLLABORATION_WORKERS) {
    if (AGENT_NAMES[id].toLowerCase() === normalized || id === normalized) return id;
  }
  return null;
}

function parseAgentModelLine(line?: string): { agent: CollaborationWorkerAgent; model: string } | null {
  if (!line) return null;
  const trimmed = line.trim();
  const sep = trimmed.indexOf('·');
  if (sep > 0) {
    const agent = agentFromLabel(trimmed.slice(0, sep));
    if (agent) return { agent, model: trimmed.slice(sep + 1).trim() || AGENT_NAMES[agent] };
  }
  const paren = trimmed.match(/^([^(]+)\(([^,)]+)/);
  if (paren) {
    const agent = agentFromLabel(paren[1]);
    if (agent) return { agent, model: paren[2].trim() };
  }
  return null;
}

function inferLaneId(laneName: string): string {
  const lower = laneName.trim().toLowerCase();
  for (const id of BUILTIN_COLLABORATION_LANES) {
    if (lower === id || lower === DEFAULT_COLLABORATION_LANE_DEFS[id].name.toLowerCase()) return id;
  }
  return lower === 'answer' ? 'answer' : 'custom';
}

function laneVisual(laneId: string, laneName: string, laneIcon?: string) {
  if (laneId === 'answer') return { icon: 'chat', tone: 'answer', label: t('Answer') };
  if ((BUILTIN_COLLABORATION_LANES as string[]).includes(laneId)) {
    const id = laneId as BuiltinCollaborationLaneId;
    const def = DEFAULT_COLLABORATION_LANE_DEFS[id];
    const localized = id === 'quick' ? t('Simple edits')
      : id === 'polish' ? t('Prose & polish')
      : id === 'rigorous' ? t('Math & rigorous')
      : t('Layout & LaTeX');
    const icon = id === 'quick' ? 'bolt' : id === 'polish' ? 'sparkles' : id === 'rigorous' ? 'scale' : 'layers';
    const useLocalized = !laneName || laneName === def.name || laneName === id;
    return { icon, tone: id, label: useLocalized ? localized : laneName };
  }
  return { icon: laneIcon || 'tag', tone: 'custom', label: laneName || t('Custom lane') };
}

function noteNumsKey(notes: number[]) {
  return notes.join(',');
}

function parseItemNotes(item: TimelineItem): number[] {
  const fromDetail = item.detail?.match(/^Notes:[ \t]*([0-9,\t ]+)/m)?.[1];
  const fromTitle = item.text.match(/Notes[ \t]+([0-9,\t ]+)/)?.[1];
  const raw = fromDetail || fromTitle || '';
  return raw.split(',').map(part => Number(part.trim())).filter(n => Number.isFinite(n) && n > 0);
}

// Reconstruct dispatch info for older tasks saved before structured `meta.dispatch`.
function parseFallbackDispatch(
  routeItem: TimelineItem,
  items: TimelineItem[],
  steps: Map<string, TimelineItem[]>,
): CollaborationDispatchMeta {
  const lines = (routeItem.detail || '').split('\n').map(l => l.trim()).filter(Boolean);
  const parsedRouter = parseAgentModelLine(lines[0]);
  const router = parsedRouter || { agent: 'papilot' as CollaborationWorkerAgent, model: lines[0] || t('Router') };

  const itemsByNotes = new Map<string, TimelineItem[]>();
  for (const item of items) {
    if (item.id === routeItem.id) continue;
    const nums = parseItemNotes(item);
    if (!nums.length) continue;
    const key = noteNumsKey(nums);
    const list = itemsByNotes.get(key);
    if (list) list.push(item); else itemsByNotes.set(key, [item]);
  }

  const entries: CollaborationDispatchEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const match = lines[i].match(/^#([\d,\s#]+)\s+\(([^)]+)\):\s*(.+)$/);
    if (!match) continue;
    const notes = match[1].split(',').map(part => Number(part.replace('#', '').trim())).filter(n => Number.isFinite(n) && n > 0);
    const file = match[2].trim();
    const body = match[3].trim();
    const matchedItems = itemsByNotes.get(noteNumsKey(notes)) || [];

    if (body === 'answer') {
      const answerItem = matchedItems.find(it => it.text.includes('answer')) || matchedItems[0];
      const info = parseAgentModelLine(answerItem?.detail?.split('\n')[0]);
      entries.push({
        clusterId: `fallback-${i}`, notes, file, laneId: 'answer', laneName: 'Answer', mode: 'answer',
        itemId: answerItem?.id || `${routeItem.id}:answer:${i}`,
        workers: [{ itemId: answerItem?.id || `${routeItem.id}:answer:${i}`, agent: info?.agent || router.agent, model: info?.model || router.model }],
      });
      continue;
    }

    const raceMatch = body.match(/^(.+?)\s*·\s*race\s*\((.+)\)$/);
    if (raceMatch) {
      const laneName = raceMatch[1].trim();
      const raceItem = matchedItems.find(it => workflowKind(it) === 'workflow_race') || matchedItems[0];
      const children = raceItem ? (steps.get(raceItem.id) || []) : [];
      const racerItems = children.filter(c => workflowKind(c) === 'workflow_racer');
      const judgeItem = children.find(c => workflowKind(c) === 'workflow_judge');
      const workers: CollaborationDispatchWorker[] = racerItems.length
        ? racerItems.map(r => {
          const info = parseAgentModelLine(r.detail?.split('\n')[0]);
          const fallbackName = r.text.replace(/^workflow_racer\s*·\s*/, '').trim();
          return { itemId: r.id, agent: info?.agent || router.agent, model: info?.model || fallbackName };
        })
        : raceMatch[2].split(/\s+vs\s+/i).map((model, idx) => ({
          itemId: `${raceItem?.id || routeItem.id}:r${idx}`,
          agent: router.agent,
          model: model.trim(),
        }));
      const judgeInfo = judgeItem ? parseAgentModelLine(judgeItem.detail?.split('\n')[0]) : null;
      const judgeModel = judgeItem?.text.replace(/^workflow_judge\s*·\s*/, '').trim();
      entries.push({
        clusterId: `fallback-${i}`, notes, file, laneId: inferLaneId(laneName), laneName, mode: 'race',
        itemId: raceItem?.id || `${routeItem.id}:race:${i}`,
        workers,
        ...(judgeItem ? { judge: { itemId: judgeItem.id, agent: judgeInfo?.agent || router.agent, model: judgeInfo?.model || judgeModel || t('Judge') } } : {}),
      });
      continue;
    }

    const assignMatch = body.match(/^(.+?)\s*→\s*(.+)$/);
    if (assignMatch) {
      const laneName = assignMatch[1].trim();
      const modelName = assignMatch[2].trim();
      const delegateItem = matchedItems.find(it => workflowKind(it) === 'workflow_delegate') || matchedItems[0];
      const info = parseAgentModelLine(delegateItem?.detail?.split('\n')[0]);
      entries.push({
        clusterId: `fallback-${i}`, notes, file, laneId: inferLaneId(laneName), laneName, mode: 'assign',
        itemId: delegateItem?.id || `${routeItem.id}:assign:${i}`,
        workers: [{ itemId: delegateItem?.id || `${routeItem.id}:assign:${i}`, agent: info?.agent || router.agent, model: info?.model || modelName }],
      });
    }
  }
  return { strategy: 'balanced', router, entries };
}

function shortFile(file: string) {
  const normalized = file.replaceAll('\\', '/');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function StateGlyph({ state, winner }: { state: ItemState; winner?: boolean }) {
  if (state === 'running') return <span className="spinner collab-chip-spinner" aria-hidden="true"/>;
  if (winner) return <Icon name="star" size={11}/>;
  if (state === 'done') return <Icon name="check" size={11}/>;
  if (state === 'failed') return <Icon name="alert" size={11}/>;
  if (state === 'stopped') return <Icon name="pause" size={10}/>;
  return <span className="collab-chip-dot" aria-hidden="true"/>;
}

function AgentChip({
  agent,
  model,
  state,
  winner,
  roleLabel,
  title,
}: {
  agent: CollaborationWorkerAgent;
  model: string;
  state: ItemState;
  winner?: boolean;
  roleLabel?: string;
  title?: string;
}) {
  const statusText = state === 'running' ? t('Running')
    : winner ? t('Selected')
    : state === 'done' ? t('Done')
    : state === 'failed' ? t('Failed')
    : state === 'stopped' ? t('Stopped')
    : t('Queued');
  const fullTitle = title || `${AGENT_NAMES[agent]} · ${model} (${statusText})`;
  return (
    <span
      className={'collab-agent-chip' + (winner ? ' is-winner' : '')}
      data-state={state}
      title={fullTitle}
    >
      <BrandIcon name={agent} size={13}/>
      {roleLabel && <span className="collab-agent-role">{roleLabel}</span>}
      <span className="collab-agent-name">{model}</span>
      <span className="collab-agent-state" aria-hidden="true">
        <StateGlyph state={state} winner={winner}/>
      </span>
      <span className="sr-only">{statusText}</span>
    </span>
  );
}

export function CollaborationDispatchCard({
  items,
  steps,
  turnUserId,
  renderItem,
}: {
  items: TimelineItem[];
  steps: Map<string, TimelineItem[]>;
  turnUserId?: string;
  renderItem: (item: TimelineItem) => ReactNode;
}) {
  useLanguage();
  const noteResults = useNoteResults();
  const routeItem = items.find(item => workflowKind(item) === 'workflow_route')!;
  const dispatch = routeItem.meta?.dispatch ?? parseFallbackDispatch(routeItem, items, steps);

  // Only walk items belonging to THIS turn and their nested descendants so
  // concurrent/later turns in the same task never leak into an older card.
  const byId = new Map<string, TimelineItem>();
  const queue: TimelineItem[] = [...items];
  while (queue.length) {
    const current = queue.shift()!;
    if (byId.has(current.id)) continue;
    byId.set(current.id, current);
    const children = steps.get(current.id);
    if (children) queue.push(...children);
  }

  const routeState = stateOf(routeItem);
  const runningWorkers = [...byId.values()].filter(item => item.id !== routeItem.id && stateOf(item) === 'running' && (
    workflowKind(item) === 'workflow_delegate' || workflowKind(item) === 'workflow_racer' || workflowKind(item) === 'workflow_judge'
  )).length;
  const anyTopRunning = items.some(item => item.id !== routeItem.id && stateOf(item) === 'running');
  const activeCount = runningWorkers || (anyTopRunning ? items.filter(item => item.id !== routeItem.id && stateOf(item) === 'running').length : 0);
  const failedCount = items.filter(item => stateOf(item) === 'failed').length;
  const hasQueued = routeState === 'done' && dispatch.entries.some(entry => entry.workers.some(w => stateOf(byId.get(w.itemId)) === 'queued'));
  const stoppedOnly = routeState === 'stopped' || (activeCount === 0 && failedCount === 0 && items.some(item => stateOf(item) === 'stopped') && !items.some(item => item.id !== routeItem.id && stateOf(item) === 'done'));

  const headerStatus = routeState === 'running'
    ? <span className="collab-dispatch-status" data-state="running"><span className="spinner collab-chip-spinner" aria-hidden="true"/><span>{t('Routing…')}</span></span>
    : activeCount > 0
      ? <span className="collab-dispatch-status" data-state="running"><span className="spinner collab-chip-spinner" aria-hidden="true"/><span>{t('{n} running', { n: activeCount })}</span></span>
      : stoppedOnly
        ? <span className="collab-dispatch-status" data-state="stopped"><span>{t('Stopped')}</span></span>
        : failedCount > 0
          ? <span className="collab-dispatch-status" data-state="failed"><Icon name="alert" size={12}/><span>{t('{n} failed', { n: failedCount })}</span></span>
          : hasQueued
            ? <span className="collab-dispatch-status" data-state="running"><span className="spinner collab-chip-spinner" aria-hidden="true"/><span>{t('Queued')}</span></span>
            : <span className="collab-dispatch-status" data-state="done"><Icon name="check" size={12}/><span>{t('Done')}</span></span>;

  // Map turn prefix to detect optional rigorous fallback items for assign entries.
  const routePrefix = routeItem.id.endsWith(':route') ? routeItem.id.slice(0, -':route'.length) : '';

  const renderNotePill = (noteNum: number) => {
    const key = turnUserId ? `${turnUserId}:${noteNum - 1}` : '';
    const linked = key && noteResults?.notes.some(n => n.key === key);
    if (linked && noteResults) {
      return (
        <button
          key={noteNum}
          type="button"
          className="collab-note-pill is-linked"
          onClick={() => noteResults.focusNote(key)}
          title={t('Show note #{n}', { n: noteNum })}
        >
          #{noteNum}
        </button>
      );
    }
    return <span key={noteNum} className="collab-note-pill">#{noteNum}</span>;
  };

  return (
    <section className="collab-dispatch-card" aria-label={t('Routing & dispatch')}>
      <header className="collab-dispatch-head">
        <div className="collab-dispatch-title">
          <span className="collab-dispatch-icon" aria-hidden="true"><Icon name="workflow" size={16}/></span>
          <span>{t('Routing & dispatch')}</span>
        </div>
        <div className="collab-dispatch-meta">
          <span className="collab-router-pill" title={`${t('Router')}: ${AGENT_NAMES[dispatch.router.agent]} · ${dispatch.router.model}`}>
            <span className="collab-router-label">{t('Router')}</span>
            <BrandIcon name={dispatch.router.agent} size={15}/>
            <span className="collab-router-model">{dispatch.router.model}</span>
          </span>
          {headerStatus}
        </div>
      </header>

      {dispatch.entries.length === 0 ? (
        <div className="collab-dispatch-empty">
          {routeState === 'running'
            ? t('Classifying annotations and assigning agents…')
            : routeState === 'stopped'
              ? t('Routing stopped before assigning workers.')
              : t('No annotation assignments.')}
        </div>
      ) : (
        <ul className="collab-dispatch-list">
          {dispatch.entries.map(entry => {
            const lane = laneVisual(entry.laneId, entry.laneName, entry.laneIcon);
            const raceItem = entry.mode === 'race' ? byId.get(entry.itemId) : undefined;
            const raceResult = raceItem?.meta?.raceResult;
            const fallbackWinnerLabel = !raceResult && raceItem?.status === 'completed'
              ? raceItem.detail?.match(/^Selected:\s*(.+)$/m)?.[1]?.trim()
              : undefined;
            const isWinner = (worker: CollaborationDispatchWorker) => {
              if (entry.mode !== 'race' || raceItem?.status !== 'completed') return false;
              if (raceResult) return raceResult.winnerItemIds.includes(worker.itemId);
              if (!fallbackWinnerLabel) return false;
              if (fallbackWinnerLabel === worker.model) return true;
              if (fallbackWinnerLabel.startsWith('Consensus:') && fallbackWinnerLabel.includes(worker.model)) return true;
              return false;
            };
            const judgeItem = entry.judge ? byId.get(entry.judge.itemId) : undefined;
            const showJudge = Boolean(entry.judge && (judgeItem || raceItem?.status !== 'completed'));
            const judgeSynthesized = Boolean(raceResult?.synthesized || fallbackWinnerLabel?.startsWith('Synthesized'));

            const fallbackItem = entry.mode === 'assign' && routePrefix
              ? byId.get(`${routePrefix}:fallback:${entry.clusterId}`)
              : undefined;
            const fallbackInfo = fallbackItem ? parseAgentModelLine(fallbackItem.detail?.split('\n')[0]) : null;

            return (
              <li key={`${entry.clusterId}:${entry.itemId}`} className="collab-dispatch-row" data-mode={entry.mode}>
                <div className="collab-dispatch-row-top">
                  <div className="collab-dispatch-target">
                    <span className="collab-note-pills">{entry.notes.map(renderNotePill)}</span>
                    <span className="collab-dispatch-file" title={entry.file}>{shortFile(entry.file)}</span>
                  </div>
                  <span className="collab-dispatch-lane" data-tone={lane.tone}>
                    <Icon name={lane.icon} size={11}/>
                    <span>{lane.label}</span>
                  </span>
                </div>
                <div className="collab-dispatch-agents">
                  {entry.mode === 'race' && <span className="collab-dispatch-race">{t('Race')}</span>}
                  {entry.workers.map((worker, idx) => {
                    const item = byId.get(worker.itemId);
                    const state = stateOf(item);
                    return (
                      <span key={worker.itemId} className="collab-agent-slot">
                        {idx > 0 && <span className="collab-dispatch-vs" aria-hidden="true">vs</span>}
                        <AgentChip
                          agent={worker.agent}
                          model={worker.model}
                          state={state}
                          winner={isWinner(worker)}
                        />
                      </span>
                    );
                  })}
                  {fallbackItem && fallbackInfo && (
                    <span className="collab-agent-slot">
                      <span className="collab-arrow" aria-hidden="true">→</span>
                      <AgentChip
                        agent={fallbackInfo.agent}
                        model={fallbackInfo.model}
                        state={stateOf(fallbackItem)}
                      />
                    </span>
                  )}
                  {showJudge && entry.judge && (
                    <span className="collab-agent-slot">
                      <span className="collab-arrow" aria-hidden="true">→</span>
                      <AgentChip
                        agent={entry.judge.agent}
                        model={entry.judge.model}
                        state={stateOf(judgeItem)}
                        winner={judgeSynthesized && raceItem?.status === 'completed'}
                        roleLabel={t('Judge')}
                      />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <details className="collab-dispatch-details">
        <summary>
          <Icon name="chevronRight" size={12}/>
          <span>{t('Details & steps')}</span>
          <span className="collab-dispatch-count">{items.length}</span>
        </summary>
        <div className="tool-group-items">
          {items.map(renderItem)}
        </div>
      </details>
    </section>
  );
}
