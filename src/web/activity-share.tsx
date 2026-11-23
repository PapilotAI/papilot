import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { mix } from './appearance.ts';
import { errorText, t } from './i18n.ts';
import { Icon } from './icons.tsx';

// A big number with its unit, such as "162" and "days", in the language's order.
export interface ShareFigure { before: string; value: string; after: string; label: string }

export interface ShareCard {
  period: string;
  date: string;
  hero: ShareFigure;
  figures: ShareFigure[];
  streaks: ShareFigure[];
  weekdays: string[];
  months: { column: number; label: string }[];
  /** Shade levels by week column, then weekday row; null after today. */
  weeks: (number | null)[][];
  less: string;
  more: string;
  alt: string;
  fileName: string;
}

const WIDTH = 1080, PAD = 72;

type Palette = ReturnType<typeof palette>;

// The image follows the app's theme and accent. Theme colours are hex values,
// so they mix the same way the appearance settings do.
function palette(source: Element) {
  const css = getComputedStyle(source);
  const dark = document.documentElement.dataset.theme === 'dark';
  const read = (name: string, fallback: string) => {
    const value = css.getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  };
  const text = read('--text', dark ? '#f0f0f0' : '#1e1e1e');
  const card = read('--raised', dark ? '#333333' : '#ffffff');
  const accent = read('--accent', dark ? '#3aa6ff' : '#0b8af0');
  return {
    dark,
    font: css.fontFamily || 'system-ui, sans-serif',
    background: read('--canvas', dark ? '#1e1e1e' : '#f5f5f5'),
    card,
    text,
    secondary: read('--text-2', dark ? '#b3b3b3' : '#5e5e5e'),
    faint: read('--text-3', dark ? '#8c8c8c' : '#8f8f8f'),
    heat: [mix(card, text, 0.08), mix(card, accent, 0.26), mix(card, accent, 0.55), accent, dark ? mix(accent, '#ffffff', 0.18) : mix(accent, '#000000', 0.32)],
    markTop: dark ? '#d8e2f9' : '#223575',
  };
}

// The capsules of PapilotMark, drawn the same way: laid along the line, then
// turned 45 degrees inside a 64-unit square.
const MARK: readonly [number, number, number, number, 'top' | 'line' | 'bottom'][] = [
  [-174, -229, 236, 68, 'top'], [-124, -127, 336, 68, 'top'], [-323, -24, 634, 48, 'line'],
  [-124, 59, 336, 68, 'bottom'], [-174, 161, 236, 68, 'bottom'],
];

function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colors: Palette) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 64, size / 64);
  ctx.translate(34.4715, 29.5285);
  ctx.scale(0.1125, 0.1125);
  ctx.rotate(-Math.PI / 4);
  for (const [left, top, width, height, part] of MARK) {
    ctx.fillStyle = part === 'top' ? colors.markTop : part === 'line' ? '#ff6a64' : '#4d93f8';
    ctx.beginPath();
    ctx.roundRect(left, top, width, height, height / 2);
    ctx.fill();
  }
  ctx.restore();
}

// Draws a figure on one baseline: the number large, its unit small beside it.
function drawFigure(ctx: CanvasRenderingContext2D, figure: ShareFigure, x: number, baseline: number, size: number, colors: Palette) {
  const unit = Math.round(size * 0.4);
  let cursor = x;
  const run = (text: string, font: string, color: string) => {
    if (!text) return;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(text, cursor, baseline);
    cursor += ctx.measureText(text).width + unit * 0.3;
  };
  run(figure.before, `500 ${unit}px ${colors.font}`, colors.secondary);
  run(figure.value, `650 ${size}px ${colors.font}`, colors.text);
  run(figure.after, `500 ${unit}px ${colors.font}`, colors.secondary);
}

function drawCard(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, colors: Palette) {
  ctx.save();
  if (!colors.dark) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.07)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 6;
  }
  ctx.fillStyle = colors.card;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 36);
  ctx.fill();
  ctx.restore();
}

export async function renderShareImage(card: ShareCard, source: Element): Promise<Blob> {
  await document.fonts?.ready;
  const colors = palette(source);
  const inner = WIDTH - PAD * 2;
  const header = PAD, hero = header + 132, cards = hero + 278, cardHeight = 190, gap = 24;
  const calendar = cards + cardHeight * 2 + gap * 2, calendarPad = 44;
  const columns = card.weeks.length, labelWidth = 44;
  const pitch = (inner - calendarPad * 2 - labelWidth) / columns, cell = pitch - Math.max(4, pitch * 0.18);
  const gridTop = calendar + 228, calendarHeight = 228 + pitch * 7 + 96;
  const footer = calendar + calendarHeight + 56;
  const height = Math.round(footer + 28 + PAD);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not draw the image.');
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, WIDTH, height);

  drawMark(ctx, PAD - 4, header - 2, 64, colors);
  ctx.font = `650 44px ${colors.font}`;
  ctx.fillStyle = colors.text;
  ctx.fillText('Papilot', PAD + 72, header + 44);
  ctx.textAlign = 'right';
  ctx.font = `500 30px ${colors.font}`;
  ctx.fillStyle = colors.secondary;
  ctx.fillText(card.period, WIDTH - PAD, header + 26);
  ctx.font = `400 26px ${colors.font}`;
  ctx.fillStyle = colors.faint;
  ctx.fillText(card.date, WIDTH - PAD, header + 62);
  ctx.textAlign = 'left';

  drawFigure(ctx, card.hero, PAD, hero + 150, 156, colors);
  ctx.font = `500 36px ${colors.font}`;
  ctx.fillStyle = colors.secondary;
  ctx.fillText(card.hero.label, PAD, hero + 212);

  const cardWidth = (inner - gap) / 2;
  card.figures.slice(0, 4).forEach((figure, index) => {
    const x = PAD + (index % 2) * (cardWidth + gap), y = cards + Math.floor(index / 2) * (cardHeight + gap);
    drawCard(ctx, x, y, cardWidth, cardHeight, colors);
    drawFigure(ctx, figure, x + 40, y + 98, 72, colors);
    ctx.font = `500 30px ${colors.font}`;
    ctx.fillStyle = colors.secondary;
    ctx.fillText(figure.label, x + 40, y + 150);
  });

  drawCard(ctx, PAD, calendar, inner, calendarHeight, colors);
  const left = PAD + calendarPad, statWidth = (inner - calendarPad * 2) / Math.max(1, card.streaks.length);
  card.streaks.forEach((figure, index) => {
    const x = left + index * statWidth;
    drawFigure(ctx, figure, x, calendar + 104, 60, colors);
    ctx.font = `500 28px ${colors.font}`;
    ctx.fillStyle = colors.secondary;
    ctx.fillText(figure.label, x, calendar + 148);
  });
  ctx.font = `400 24px ${colors.font}`;
  ctx.fillStyle = colors.faint;
  for (const month of card.months) ctx.fillText(month.label, left + labelWidth + month.column * pitch, gridTop - 16);
  card.weekdays.forEach((label, row) => ctx.fillText(label, left, gridTop + row * pitch + cell * 0.78));
  card.weeks.forEach((column, index) => column.forEach((level, row) => {
    if (level === null) return;
    ctx.fillStyle = colors.heat[level];
    ctx.beginPath();
    ctx.roundRect(left + labelWidth + index * pitch, gridTop + row * pitch, cell, cell, cell * 0.22);
    ctx.fill();
  }));
  const legend = gridTop + pitch * 7 + 52;
  ctx.font = `400 24px ${colors.font}`;
  ctx.fillStyle = colors.faint;
  ctx.fillText(card.less, left, legend);
  let cursor = left + ctx.measureText(card.less).width + 14;
  for (const shade of colors.heat) {
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.roundRect(cursor, legend - 22, 24, 24, 6);
    ctx.fill();
    cursor += 32;
  }
  ctx.fillStyle = colors.faint;
  ctx.fillText(card.more, cursor + 6, legend);

  drawMark(ctx, PAD - 2, footer - 26, 34, colors);
  ctx.font = `500 28px ${colors.font}`;
  ctx.fillStyle = colors.faint;
  ctx.fillText('papilot.ai', PAD + 40, footer);

  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not draw the image.')), 'image/png'));
}

// Copy and share need a secure context (the app over HTTPS or on this
// computer); saving the file works everywhere, and the preview can be
// long-pressed on phones.
export function ShareDialog({ card, source, onClose }: { card: ShareCard; source: HTMLElement; onClose: () => void }) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [failure, setFailure] = useState('');
  const [status, setStatus] = useState('');

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    let live = true, url = '';
    renderShareImage(card, source).then(blob => {
      if (!live) return;
      url = URL.createObjectURL(blob);
      setImage({ blob, url });
    }, error => { if (live) setFailure(errorText(error instanceof Error ? error.message : String(error))); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [card, source]);

  const file = image ? new File([image.blob], card.fileName, { type: 'image/png' }) : null;
  const canCopy = window.isSecureContext && typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  async function copy() {
    if (!image) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': image.blob })]);
      setStatus(t('Copied'));
    } catch {
      setStatus(t('Could not copy the image.'));
    }
  }

  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file] });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus(errorText(error instanceof Error ? error.message : String(error)));
    }
  }

  return <dialog ref={dialog} className="modal-backdrop activity-share-backdrop" aria-labelledby={id} closedby="any"
    // The settings dialog around it keeps Tab inside itself; this modal does that on its own.
    onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onClose={onClose}
    onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal activity-share-dialog">
      <h2 id={id}>{t('Share')}</h2>
      <div className="activity-share-preview">
        {image ? <img src={image.url} alt={card.alt}/> : failure ? <p role="alert">{failure}</p> : <progress aria-label={t('Preparing image…')}/>}
      </div>
      <div className="button-row">
        <span className="activity-share-status" role="status">{status}</span>
        <button type="button" className="button secondary" onClick={onClose}>{t('Close')}</button>
        {canShare && <button type="button" className="button secondary" onClick={() => void share()}><Icon name="share" size={14}/>{t('Share…')}</button>}
        {canCopy && <button type="button" className="button secondary" disabled={!image} onClick={() => void copy()}><Icon name="copy" size={14}/>{t('Copy image')}</button>}
        {image
          ? <a className="button primary" href={image.url} download={card.fileName} autoFocus><Icon name="download" size={14}/>{t('Save image')}</a>
          : <button type="button" className="button primary" disabled><Icon name="download" size={14}/>{t('Save image')}</button>}
      </div>
    </section>
  </dialog>;
}
