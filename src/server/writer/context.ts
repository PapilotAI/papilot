import type { AgentSession } from '@mariozechner/pi-coding-agent';
import type { ContextPart } from '../../shared.ts';

// What fills Papilot Writer's context window. The provider reports the total
// for the latest request; the parts are estimated from their text (Pi's own
// rule of about four characters a token, and 1,200 tokens an image) and then
// scaled so they add up to that total. The compaction reserve is the room Pi
// keeps free: when the context reaches it, earlier turns are summarized.

const tokens = (chars: number) => Math.ceil(chars / 4);
const IMAGE = 1200;
// Pi's default; Papilot Writer does not change it.
export const COMPACTION_RESERVE = 16384;

/** The paper map, or an update to it, opens the author's messages. */
const MAP = /<paper-map(?:-update)?>[\s\S]*?<\/paper-map(?:-update)?>/g;

type Block = { type: string; text?: string; thinking?: string; name?: string; arguments?: unknown };

export function contextBreakdown(session: Pick<AgentSession, 'systemPrompt' | 'messages' | 'getAllTools' | 'getActiveToolNames'>, total: number, window: number): ContextPart[] {
  const parts: Record<string, number> = { system: tokens(session.systemPrompt.length), tools: 0, map: 0, messages: 0, replies: 0, toolCalls: 0, toolResults: 0, summaries: 0 };
  const active = new Set(session.getActiveToolNames());
  for (const tool of session.getAllTools()) if (active.has(tool.name)) parts.tools += tokens(tool.name.length + (tool.description || '').length + JSON.stringify(tool.parameters || {}).length);
  for (const message of session.messages as any[]) {
    const blocks: Block[] = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : Array.isArray(message.content) ? message.content : [];
    if (message.role === 'user') for (const block of blocks) {
      if (block.type === 'image') { parts.messages += IMAGE; continue; }
      const text = block.text || '', maps = text.match(MAP)?.join('') || '';
      parts.map += tokens(maps.length); parts.messages += tokens(text.length - maps.length);
    } else if (message.role === 'assistant') for (const block of blocks) {
      if (block.type === 'toolCall') parts.toolCalls += tokens((block.name || '').length + JSON.stringify(block.arguments || {}).length);
      else parts.replies += tokens((block.text || block.thinking || '').length);
    } else if (message.role === 'toolResult') for (const block of blocks) parts.toolResults += block.type === 'image' ? IMAGE : tokens((block.text || '').length);
    else if (message.role === 'compactionSummary' || message.role === 'branchSummary') parts.summaries += tokens(String(message.summary || '').length);
  }
  // Scale the estimates to what the provider counted.
  const estimated = Object.values(parts).reduce((sum, value) => sum + value, 0);
  const scale = estimated > 0 && total > 0 ? total / estimated : 1;
  const used: ContextPart[] = Object.entries(parts).filter(([, value]) => value > 0).map(([id, value]) => ({ id, tokens: Math.round(value * scale) }));
  // Rounding may leave a few tokens over or under; the largest part absorbs it.
  const drift = total - used.reduce((sum, part) => sum + part.tokens, 0);
  if (used.length && total > 0) used.reduce((largest, part) => part.tokens > largest.tokens ? part : largest).tokens += drift;
  const reserve = Math.min(COMPACTION_RESERVE, Math.max(0, window - total));
  return [...used, ...(reserve ? [{ id: 'reserve', tokens: reserve }] : []), { id: 'free', tokens: Math.max(0, window - total - reserve) }];
}
