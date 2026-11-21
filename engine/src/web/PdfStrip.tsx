import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { Decision, Mark, Rect, Strip, TextGlyph } from "../types.ts";
import { language as viewerLanguage, t, type Language } from "./i18n.ts";

type UnitMark = Mark & { unit: string };

/** Merge adjacent same-line marks belonging to the same unit so hover/click hit
 *  targets and focus outlines stay continuous across word spaces. */
export function mergeUnitMarks(marks: readonly UnitMark[]): UnitMark[] {
  const groups = new Map<string, UnitMark[]>();
  for (const mark of marks) {
    const key = `${mark.unit}:${mark.kind}`;
    const list = groups.get(key);
    if (list) list.push(mark);
    else groups.set(key, [mark]);
  }
  const merged: UnitMark[] = [];
  for (const list of groups.values()) {
    // Bucket vertical bands by midpoint (matching backend mergeRects) so words
    // on the same line with taller/shorter ascenders still sort left-to-right.
    const sorted = [...list].sort(
      (a, b) =>
        Math.round((a.rect[1] + a.rect[3]) / 4) - Math.round((b.rect[1] + b.rect[3]) / 4) ||
        a.rect[0] - b.rect[0],
    );
    const out: UnitMark[] = [];
    for (const mark of sorted) {
      const [x0, y0, x1, y1] = mark.rect;
      const height = Math.max(y1 - y0, 1);
      const prev = out.findLast((item) => {
        const [px0, py0, px1, py1] = item.rect;
        const overlap = Math.min(py1, y1) - Math.max(py0, y0);
        const minH = Math.max(Math.min(py1 - py0, height), 1);
        const gap = Math.max(x0 - px1, px0 - x1);
        return overlap >= minH * 0.5 && gap <= height * 0.9;
      });
      if (prev) {
        prev.rect = [
          Math.min(prev.rect[0], x0),
          Math.min(prev.rect[1], y0),
          Math.max(prev.rect[2], x1),
          Math.max(prev.rect[3], y1),
        ] as Rect;
      } else {
        out.push({ ...mark, rect: [...mark.rect] as Rect });
      }
    }
    merged.push(...out);
  }
  return merged;
}
let context: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();
// Advance of `text` in the overlay font, in ems; marks that take no room give 0.
function advance(text: string) {
  if (widths.has(text)) return widths.get(text)!;
  context ??= document.createElement("canvas").getContext("2d");
  if (!context) return 0;
  context.font = '100px "Times New Roman", serif';
  const measured = context.measureText(text).width / 100;
  widths.set(text, measured);
  return measured;
}
const width = (text: string) => advance(text) || 1;
const cqw = (length: number, image: Strip) => `${(100 * length) / image.width}cqw`;
function style(glyph: TextGlyph, image: Strip): CSSProperties {
  const [x0, y0, x1, y1] = glyph.rect,
    height = Math.max(y1 - y0, 0.1),
    scaleX = (x1 - x0) / (height * width(glyph.text));
  return {
    left: `${(100 * x0) / image.width}%`,
    top: `${(100 * y0) / image.height}%`,
    fontSize: `${(100 * height) / image.width}cqw`,
    transform: `scaleX(${scaleX})`,
  };
}
// Pointer selection needs each line to be one block: Chromium often refuses to
// start or extend a drag across neighbouring positioned boxes on one line, and
// a word split into such boxes cannot be double-clicked. So a line is a single
// positioned box whose glyphs are inline, each widened by letter-spacing to
// reach the next glyph's place on the image. The box also reaches out to the
// neighbouring lines and the text edges, so a drag over the blank space
// between lines or past a line's end stays on that line instead of jumping.
type Tile = { left: number; right: number; top: number; bottom: number };
// Each box grows over blank space only, never over another line: down to the
// next line below it, sideways to its neighbours within that band or the strip
// edge, and up to the strip edge for the topmost lines.
function tiles(lines: { rect: TextGlyph["rect"] }[], image: Strip): Tile[] {
  const first = Math.min(...lines.map(({ rect }) => rect[1]));
  return lines.map(({ rect: [x0, y0, x1, y1] }, i) => {
    let below = image.height, left = 0, right = image.width;
    lines.forEach(({ rect: [u0, v0, u1] }, j) => {
      if (j !== i && u0 < x1 && x0 < u1 && v0 >= y1) below = Math.min(below, v0);
    });
    const above = y0 === first ? 0 : y0;
    lines.forEach(({ rect: [u0, v0, u1, v1] }, j) => {
      if (j === i || v0 >= below || v1 <= above) return;
      if (u1 <= x0) left = Math.max(left, u1);
      else if (u0 >= x1) right = Math.min(right, u0);
    });
    // A glyph box can overhang a tightly cropped strip, so nothing grows by a negative amount.
    return { left: Math.max(0, x0 - left), right: Math.max(0, right - x1), top: Math.max(0, y0 - above), bottom: Math.max(0, below - y1) };
  });
}
function lineStyle(line: { rect: TextGlyph["rect"]; chars: TextGlyph[] }, tile: Tile, image: Strip): CSSProperties {
  const start = line.chars[0]?.rect[0] ?? line.rect[0],
    [, y0, , y1] = line.rect;
  return {
    left: `${(100 * (start - tile.left)) / image.width}%`,
    top: `${(100 * (y0 - tile.top)) / image.height}%`,
    fontSize: cqw(Math.max(y1 - y0, 0.1), image),
    padding: `${cqw(tile.top, image)} ${cqw(tile.right, image)} ${cqw(tile.bottom, image)} ${cqw(tile.left, image)}`,
  };
}
// The room after a glyph up to the next one, spread over its characters.
function spacing(glyph: TextGlyph, next: TextGlyph | undefined, size: number, image: Strip) {
  const room = (next ? next.rect[0] : glyph.rect[2]) - glyph.rect[0] - advance(glyph.text) * size;
  return cqw(room / Math.max([...glyph.text].length, 1), image);
}
// Glyph boxes are hundreds of positioned spans per strip. Building or dropping
// them as strips cross the viewport stalled every scroll for 0.1–0.5 s, so
// they change only once the scroll has settled, one strip per idle moment.
const SETTLE = 200;
let scrolled = 0, pumping = false;
const settling = new Set<() => void>();
if (typeof document !== "undefined")
  document.addEventListener("scroll", () => { scrolled = performance.now(); }, { capture: true, passive: true });
const idle = (run: () => void) =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout: 500 }) : setTimeout(run, 16);
function pump() {
  const wait = scrolled + SETTLE - performance.now();
  if (wait > 0) return void setTimeout(pump, wait);
  const [next] = settling;
  if (next) { settling.delete(next); next(); }
  if (settling.size) idle(pump);
  else pumping = false;
}
function whenSettled(run: () => void) {
  settling.add(run);
  if (!pumping) { pumping = true; setTimeout(pump, SETTLE); }
}
// A line wrapper survives changes between line and glyph text. Save selection
// endpoints relative to that wrapper so native Find can receive precise boxes
// without losing the selected text or the direction of the selection.
function selectionPoint(node: Node, offset: number): () => [Node, number] {
  const line = (
    node.nodeType === 1 ? (node as Element) : node.parentElement
  )?.closest(".pdf-text-line");
  if (!line) return () => [node, offset];
  // These stable element boundaries are not interchangeable with the final
  // newline text node: Chromium may include a neighboring, absolutely
  // positioned equation number when copying through that newline.
  if (node === line && offset === 0) return () => [line, 0];
  if (node === line && offset === line.childNodes.length)
    return () => [line, line.childNodes.length];
  const prefix = document.createRange();
  prefix.selectNodeContents(line);
  prefix.setEnd(node, offset);
  const length = prefix.toString().length;
  return () => {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let remaining = length,
      text: Node | null;
    while ((text = walker.nextNode())) {
      const size = text.textContent!.length;
      if (remaining <= size) return [text, remaining];
      remaining -= size;
    }
    return [line, line.childNodes.length];
  };
}
export const PdfStrip = memo(function PdfStrip({
  image,
  base,
  label,
  clean = false,
  focus,
  stopIndex,
  side,
  unitStates,
  activeUnit,
  hoveredUnit,
  selectableUnits,
  onHoverUnit,
  onSelectUnit,
  language = viewerLanguage(),
}: {
  image: Strip;
  base: string;
  label: string;
  clean?: boolean;
  focus?: string[];
  stopIndex?: number;
  side?: "before" | "after";
  unitStates?: Record<string, Decision>;
  activeUnit?: string | null;
  hoveredUnit?: string | null;
  selectableUnits?: ReadonlySet<string>;
  onHoverUnit?: (stop: number, unit: string | null) => void;
  onSelectUnit?: (stop: number, unit: string | null, side?: "before" | "after") => void;
  language?: Language;
}) {
  // Keep every line searchable. Only visible strips need the individual
  // glyph boxes used for accurate pointer selection over the PDF image.
  const box = useRef<HTMLDivElement>(null),
    pointerDown = useRef<{ x: number; y: number } | null>(null),
    [localHover, setLocalHover] = useState(false),
    [detailed, setDetailed] = useState(false);
  const rendered = useRef(detailed),
    restoreSelection = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    rendered.current = detailed;
    restoreSelection.current?.();
    restoreSelection.current = null;
  }, [detailed]);
  useEffect(() => {
    const element = box.current!;
    let nearby = false;
    const apply = () => {
      if (nearby === rendered.current) return;
      const selected = window.getSelection();
      if (
        selected && !selected.isCollapsed &&
        (element.contains(selected.anchorNode) || element.contains(selected.focusNode))
      ) {
        // Keep precise selected glyphs alive outside the viewport. A Find
        // result in a compact line must instead expand as it comes into view.
        if (rendered.current) return;
        const anchor = selectionPoint(selected.anchorNode!, selected.anchorOffset),
          focus = selectionPoint(selected.focusNode!, selected.focusOffset);
        restoreSelection.current = () => selected.setBaseAndExtent(...anchor(), ...focus());
      }
      setDetailed(nearby);
    };
    const update = () => {
      if (nearby === rendered.current) return;
      const selected = window.getSelection();
      if (selected && !selected.isCollapsed &&
        (element.contains(selected.anchorNode) || element.contains(selected.focusNode)))
        apply();
      // Recheck the selection when the queued update actually runs: it may
      // have changed while scrolling settled, before selectionchange fires.
      else whenSettled(apply);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        nearby = entries[0].isIntersecting;
        update();
      },
      { root: element.closest("#paper") },
    );
    observer.observe(element);
    document.addEventListener("selectionchange", update);
    return () => {
      settling.delete(apply);
      observer.disconnect();
      document.removeEventListener("selectionchange", update);
    };
  }, []);
  const lines = useMemo(
    () =>
      image.text?.map((line) => ({
        ...line,
        rect: line.chars.reduce(
          ([x0, y0, x1, y1], glyph) => [
            Math.min(x0, glyph.rect[0]),
            Math.min(y0, glyph.rect[1]),
            Math.max(x1, glyph.rect[2]),
            Math.max(y1, glyph.rect[3]),
          ],
          [image.width, image.height, 0, 0],
        ) as TextGlyph["rect"],
      })),
    [image],
  );
  const lineTiles = useMemo(() => (lines?.length ? tiles(lines, image) : []), [lines, image]);
  const edges = useMemo(
    () =>
      lines?.reduce(
        ([left, right], line) => [
          Math.min(left, line.rect[0] / image.width),
          Math.max(right, line.rect[2] / image.width),
        ],
        [1, 0],
      ),
    [lines, image.width],
  );
  const text = useMemo(
    () =>
      lines?.map((line, i) => (
        <span className="pdf-text-line" key={i}>
          {detailed ? (
            <span className="pdf-line-run" style={lineStyle(line, lineTiles[i], image)}>
              {line.chars.map((glyph, j) => (
                <span key={j} className="pdf-glyph" style={{ letterSpacing: spacing(glyph, line.chars[j + 1], line.rect[3] - line.rect[1], image) }}>
                  {glyph.text}
                </span>
              ))}
            </span>
          ) : (
            <span className="pdf-line-preview" style={style(line, image)}>
              {line.text}
            </span>
          )}
          {"\n"}
        </span>
      )),
    [image, lines, lineTiles, detailed],
  );
  const interactive = Boolean(
    !clean &&
      !focus &&
      stopIndex !== undefined &&
      selectableUnits &&
      selectableUnits.size > 1 &&
      image.marks?.length,
  );
  useEffect(() => {
    if (!interactive) setLocalHover(false);
  }, [interactive]);
  const mergedMarks = useMemo(
    () => (interactive && image.marks?.length ? mergeUnitMarks(image.marks) : []),
    [interactive, image.marks],
  );
  const selectableMarks = useMemo(
    () =>
      interactive && selectableUnits
        ? mergedMarks.filter((mark) => selectableUnits.has(mark.unit))
        : [],
    [interactive, mergedMarks, selectableUnits],
  );
  const hasPartialDecision = Boolean(
    interactive &&
      unitStates &&
      selectableUnits &&
      [...selectableUnits].some((id) => (unitStates[id] ?? "pending") !== "pending"),
  );
  // Swap to the clean image only when partial decisions or an active selection
  // need to dim/resolve individual units; hover alone draws a zero-flicker ring
  // directly over the baked strip image.
  const useCleanForUnits = interactive && (Boolean(activeUnit) || hasPartialDecision);
  const showUnitOverlay = interactive && (useCleanForUnits || Boolean(hoveredUnit));
  const hitUnit = (clientX: number, clientY: number): string | null => {
    const el = box.current;
    if (!el || !selectableMarks.length) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = ((clientX - rect.left) / rect.width) * image.width,
      py = ((clientY - rect.top) / rect.height) * image.height,
      pad = 2.5;
    let best: string | null = null,
      bestScore = Infinity;
    for (const mark of selectableMarks) {
      const [x0, y0, x1, y1] = mark.rect;
      if (px >= x0 - pad && px <= x1 + pad && py >= y0 - pad && py <= y1 + pad) {
        const inside = px >= x0 && px <= x1 && py >= y0 && py <= y1;
        const area = Math.max(1, (x1 - x0) * (y1 - y0));
        const score = (inside ? 0 : 1e6) + area;
        if (score < bestScore) {
          bestScore = score;
          best = mark.unit;
        }
      }
    }
    return best;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || !onHoverUnit || stopIndex === undefined) return;
    if (event.buttons !== 0 || event.pointerType === "touch") return;
    const hit = hitUnit(event.clientX, event.clientY);
    setLocalHover(Boolean(hit));
    if (hit !== hoveredUnit) onHoverUnit(stopIndex, hit);
  };
  const onPointerLeave = () => {
    if (!interactive || stopIndex === undefined) return;
    setLocalHover(false);
    if (hoveredUnit) onHoverUnit?.(stopIndex, null);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    pointerDown.current = { x: event.clientX, y: event.clientY };
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!interactive || !onSelectUnit || stopIndex === undefined) return;
    // Double-click word selection or drag selection must keep text selection
    // uninterrupted and dismiss any popover opened on the first click.
    if (event.detail > 1 || window.getSelection()?.toString().trim()) {
      if (activeUnit) onSelectUnit(stopIndex, null, side);
      return;
    }
    const down = pointerDown.current;
    pointerDown.current = null;
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    const hit = hitUnit(event.clientX, event.clientY);
    if (hit) {
      event.stopPropagation();
      onSelectUnit(stopIndex, hit === activeUnit ? null : hit, side);
    } else if (activeUnit) {
      onSelectUnit(stopIndex, null, side);
    }
  };
  return (
    <div
      ref={box}
      className="pdf-strip"
      data-page={image.label}
      data-text-left={edges?.[0]}
      data-text-right={edges?.[1]}
      data-unit-hover={localHover ? "true" : undefined}
      style={{ aspectRatio: `${image.width}/${image.height}` }}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerLeave={interactive ? onPointerLeave : undefined}
      onPointerDown={interactive ? onPointerDown : undefined}
      onClick={interactive ? onClick : undefined}
    >
      <img
        src={base + (clean || focus || useCleanForUnits ? image.clean : image.src)}
        alt={image.text?.length ? "" : label}
        width={image.width}
        height={image.height}
        loading="lazy"
        decoding="async"
        draggable={false}
        aria-hidden={Boolean(image.text?.length)}
      />
      {focus && !clean && <svg className="pdf-focus-marks" viewBox={`0 0 ${image.width} ${image.height}`} aria-hidden="true">
        {(image.marks || []).filter(mark => focus.includes(mark.unit)).map((mark, i) => {
          const [x, y, right, bottom] = mark.rect, color = mark.kind === "removed" ? "#c72938" : mark.kind === "moved" ? "#2563c9" : "#1f8c52";
          return <g key={i} data-unit={mark.unit}><rect x={x} y={y} width={right - x} height={bottom - y} fill={color} fillOpacity=".18"/>
            {mark.kind === "removed" && <path d={`M ${x} ${y + (bottom - y) * .55} H ${right}`} stroke={color} strokeWidth=".45"/>}</g>;
        })}
      </svg>}
      {showUnitOverlay && (
        <svg className="pdf-unit-marks" viewBox={`0 0 ${image.width} ${image.height}`} aria-hidden="true">
          {mergedMarks.map((mark, i) => {
            const [x, y, right, bottom] = mark.rect,
              w = Math.max(right - x, 0.5),
              h = Math.max(bottom - y, 0.5),
              state = unitStates?.[mark.unit] ?? "pending",
              isActive = mark.unit === activeUnit,
              isHovered = mark.unit === hoveredUnit,
              baseColor =
                mark.kind === "removed"
                  ? "#c72938"
                  : mark.kind === "moved"
                    ? "#2563c9"
                    : "#1f8c52";
            if (!useCleanForUnits) {
              if (!isHovered) return null;
              return (
                <g key={i} data-unit={mark.unit} data-state={state} data-hovered="true">
                  <rect
                    x={x - 1}
                    y={y - 0.8}
                    width={w + 2}
                    height={h + 1.6}
                    rx="1.5"
                    fill={baseColor}
                    fillOpacity=".10"
                    stroke={baseColor}
                    strokeWidth="1"
                    strokeOpacity=".75"
                  />
                </g>
              );
            }
            const isBeforeSide = mark.kind === "removed" || (mark.kind === "moved" && side === "before");
            const isAfterSide = mark.kind === "added" || (mark.kind === "moved" && side === "after");
            const isDecidedOut =
              (state === "accepted" && isBeforeSide) ||
              (state === "rejected" && isAfterSide);
            const isDecidedKept =
              (state === "accepted" && isAfterSide) ||
              (state === "rejected" && isBeforeSide);
            const color = state === "commented" ? "#0b8af0" : baseColor;
            const fillOpacity = isActive
              ? 0.24
              : isHovered
                ? 0.22
                : isDecidedOut
                  ? 0.05
                  : isDecidedKept
                    ? 0.10
                    : activeUnit
                      ? 0.09
                      : 0.18;
            const strike =
              (mark.kind === "removed" && !isDecidedKept) ||
              (state === "rejected" && isAfterSide);
            return (
              <g
                key={i}
                data-unit={mark.unit}
                data-state={state}
                data-active={isActive ? "true" : undefined}
                data-hovered={isHovered ? "true" : undefined}
              >
                <rect
                  x={isActive || isHovered ? x - 1 : x}
                  y={isActive || isHovered ? y - 0.8 : y}
                  width={isActive || isHovered ? w + 2 : w}
                  height={isActive || isHovered ? h + 1.6 : h}
                  rx={isActive || isHovered ? "1.5" : undefined}
                  fill={color}
                  fillOpacity={fillOpacity}
                  stroke={isActive || isHovered ? color : isDecidedKept ? color : undefined}
                  strokeWidth={isActive ? "1.2" : isHovered ? "0.95" : isDecidedKept ? "0.6" : undefined}
                  strokeOpacity={isActive ? ".95" : isHovered ? ".75" : isDecidedKept ? ".45" : undefined}
                  strokeDasharray={isDecidedKept && !isActive ? "2 1.5" : undefined}
                />
                {strike && (
                  <path
                    d={`M ${x} ${y + h * 0.55} H ${right}`}
                    stroke={color}
                    strokeWidth=".45"
                    strokeOpacity={isDecidedOut ? ".35" : activeUnit && !isActive && !isHovered ? ".45" : ".9"}
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {image.text?.length ? (
        <div
          className="pdf-text"
          role="region"
          aria-label={t("{label}, PDF page {page}", {
            label,
            page: image.label,
          }, language)}
        >
          {text}
        </div>
      ) : null}
    </div>
  );
});
