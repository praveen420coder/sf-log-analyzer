/*
 * Canvas timeline (flame chart) for the Log Analyzer.
 *
 * Ported from the BSD-3-Clause "Apex Log Analyzer" by Certinia Inc.
 * (Copyright (c) 2020 Certinia Inc. All rights reserved.) — based on the
 * legacy vanilla-canvas renderer at
 * log-viewer/src/features/timeline/services/Timeline.ts, with an added
 * overview/minimap strip and in-bar labels (matching the newer renderer).
 * Lit / find / goToRow deps dropped; styled inline. See THIRD-PARTY-LICENSES.txt.
 */

import type { ApexLog, LogEvent } from '../apex-log-parser/index';

export interface TimelineOptions {
  colors: Record<string, string>; // category -> fill colour
  isDark: boolean;
  onSelect?: (eventIndex: number) => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  node: LogEvent;
}

const scaleY = -15; // main flame lane height (drawn upward)
const OVERVIEW_HEIGHT = 100;

function round(n: number, p: number) {
  return Math.round(n * p) / p;
}
function formatDuration(ns: number): string {
  if (!ns) return '0 ms';
  const msv = ns / 1e6;
  if (msv < 1000) {
    const precision = msv < 1 ? 1000 : msv < 10 ? 100 : msv < 100 ? 10 : 1;
    return `${round(msv, precision)} ms`;
  }
  const s = msv / 1000;
  const precision = s < 10 ? 100 : s < 100 ? 10 : 1;
  return `${round(s, precision)} s`;
}
function debounce<T extends unknown[]>(cb: (...a: T) => unknown) {
  let id = 0;
  return (...args: T) => {
    if (id) cancelAnimationFrame(id);
    id = requestAnimationFrame(() => cb(...args));
  };
}

const truncationColors = new Map<string, string>([
  ['error', 'rgba(255, 128, 128, 0.2)'],
  ['skip', 'rgba(30, 128, 255, 0.2)'],
  ['unexpected', 'rgba(128, 128, 255, 0.2)'],
]);

export function initTimeline(container: HTMLElement, root: ApexLog, opts: TimelineOptions): () => void {
  const strokeColor = opts.isDark ? 'rgba(0,0,0,0.35)' : '#D3D3D3';
  const axisText = opts.isDark ? '#94a3b8' : '#808080';
  const axisGrid = opts.isDark ? 'rgba(148,163,184,0.15)' : '#E0E0E0';
  const labelColor = '#10202e';
  const viewportStroke = opts.isDark ? 'rgba(226,232,240,0.8)' : 'rgba(31,41,55,0.7)';
  const viewportFill = opts.isDark ? 'rgba(148,163,184,0.12)' : 'rgba(31,41,55,0.08)';

  Object.assign(container.style, { position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' });

  // overview (minimap) strip
  const overviewHost = document.createElement('div');
  Object.assign(overviewHost.style, { position: 'relative', height: `${OVERVIEW_HEIGHT}px`, flexShrink: '0', borderBottom: `1px solid ${opts.isDark ? 'rgba(148,163,184,0.18)' : 'rgba(0,0,0,0.08)'}`, cursor: 'pointer' });
  container.appendChild(overviewHost);
  const ovCanvas = document.createElement('canvas');
  Object.assign(ovCanvas.style, { width: '100%', height: '100%', display: 'block' });
  overviewHost.appendChild(ovCanvas);
  const octx = ovCanvas.getContext('2d');

  // main flame chart
  const mainHost = document.createElement('div');
  Object.assign(mainHost.style, { position: 'relative', flex: '1', minHeight: '0' });
  container.appendChild(mainHost);
  const canvas = document.createElement('canvas');
  canvas.id = 'timeline';
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', cursor: 'default' });
  mainHost.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const tooltip = document.createElement('div');
  Object.assign(tooltip.style, { display: 'none', position: 'absolute', maxWidth: '75%', minWidth: '150px', zIndex: '1000', pointerEvents: 'none' });
  mainHost.appendChild(tooltip);

  const dpr = window.devicePixelRatio || 1;
  let displayWidth = 0;
  let displayHeight = 0;
  let ovWidth = 0;
  let ovHeight = 0;
  let zoom = 0;
  let defaultZoom = 0;
  let offsetX = 0;
  let offsetY = 0;
  let maxY = 0;
  let realHeight = 0;
  let scaleFont = 'normal 12px sans-serif';
  let lastMouseX = 0;
  let lastMouseY = 0;
  let dragging = false;
  let mouseDownPosition = { x: 0, y: 0 };
  let redrawQueued = true;
  let rafId = 0;
  let destroyed = false;

  const rectRenderQueue = new Map<string, Rect[]>();

  const requestRedraw = () => {
    if (!redrawQueued && !destroyed) {
      redrawQueued = true;
      rafId = requestAnimationFrame(draw);
    }
  };

  function getMaxDepth(nodes: LogEvent[]): number {
    let maxDepth = 0;
    let level = nodes.filter((n) => n.children.length);
    while (level.length) {
      maxDepth++;
      const next: LogEvent[] = [];
      for (const node of level) for (const c of node.children) if (c.children.length) next.push(c);
      level = next;
    }
    return maxDepth;
  }

  function nodesToRectangles(rootNodes: LogEvent[]) {
    rectRenderQueue.clear();
    let depth = 0;
    let level = rootNodes.filter((n) => n.duration);
    while (level.length) {
      const next: LogEvent[] = [];
      for (const node of level) {
        if (node.duration && node.category) addToRectQueue(node, depth);
        for (const c of node.children) if (c.duration) next.push(c);
      }
      depth++;
      level = next;
    }
  }
  function addToRectQueue(node: LogEvent, y: number) {
    const cat = node.category;
    const rect: Rect = { x: node.timestamp, y, w: node.duration.total, node };
    let list = rectRenderQueue.get(cat);
    if (!list) rectRenderQueue.set(cat, (list = []));
    list.push(rect);
  }

  const drawRect = (rect: Rect) => {
    if (!ctx) return;
    let w = rect.w * zoom;
    if (w >= 0.05) {
      let x = rect.x * zoom - offsetX;
      const y = rect.y * scaleY - offsetY;
      if (x < displayWidth && x + w > 0 && y > -displayHeight && y + scaleY < 0) {
        if (x < 0) {
          w = w + x;
          x = 0;
        }
        const off = x + w - displayWidth;
        if (off > 0) w = w - off;
        ctx.rect(x, y, w, scaleY);
      }
    }
  };

  function renderRectangles(c: CanvasRenderingContext2D) {
    c.lineWidth = 1;
    c.strokeStyle = strokeColor;
    c.globalAlpha = 1;
    for (const [cat, items] of rectRenderQueue) {
      const fill = opts.colors[cat];
      if (!fill) continue;
      c.beginPath();
      c.fillStyle = fill;
      items.forEach(drawRect);
      c.fill();
      c.stroke();
      c.closePath();
    }
  }

  // labels inside the bars (clipped to each rect)
  function drawLabels(c: CanvasRenderingContext2D) {
    c.save();
    c.font = 'normal 11px sans-serif';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillStyle = labelColor;
    for (const [cat, items] of rectRenderQueue) {
      if (!opts.colors[cat]) continue;
      for (const it of items) {
        let w = it.w * zoom;
        if (w < 28) continue;
        let x = it.x * zoom - offsetX;
        const y = it.y * scaleY - offsetY;
        if (x >= displayWidth || x + w <= 0 || y <= -displayHeight || y + scaleY >= 0) continue;
        const textX = Math.max(x, 0) + 4;
        let cx = x;
        let cw = w;
        if (cx < 0) {
          cw += cx;
          cx = 0;
        }
        const off = cx + cw - displayWidth;
        if (off > 0) cw -= off;
        if (cw < 28) continue;
        c.save();
        c.beginPath();
        c.rect(cx, y + scaleY, cw, -scaleY);
        c.clip();
        c.fillText(it.node.text + (it.node.suffix ?? ''), textX, y + scaleY / 2);
        c.restore();
      }
    }
    c.restore();
  }

  function drawScale(c: CanvasRenderingContext2D) {
    c.lineWidth = 1;
    c.font = scaleFont;
    c.textBaseline = 'top';
    c.textAlign = 'left';
    const textHeight = -displayHeight + 2;
    const nanoSeconds = 1000000000;
    const nsWidth = nanoSeconds * zoom;
    const startTimeInNs = offsetX / zoom;
    const endTimeInNs = startTimeInNs + displayWidth / zoom;
    const endTimeInS = Math.ceil(endTimeInNs / 1000000000);
    const startTimeInS = Math.floor(startTimeInNs / 1000000000);

    c.strokeStyle = '#F88962';
    c.fillStyle = '#F88962';
    c.beginPath();
    for (let i = startTimeInS; i <= endTimeInS; i++) {
      const xPos = nsWidth * i - offsetX;
      c.moveTo(xPos, -displayHeight);
      c.lineTo(xPos, 0);
      c.fillText(`${i.toFixed(1)}s`, xPos + 2, textHeight);
    }
    c.stroke();

    const microSecPixelGap = 150 / (1000 * zoom);
    const microSecsToShow = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
    const closestIncrement = microSecsToShow.reduce((prev, curr) => (Math.abs(curr - microSecPixelGap) < Math.abs(prev - microSecPixelGap) ? curr : prev));

    c.strokeStyle = axisGrid;
    c.fillStyle = axisText;
    c.beginPath();
    const microSecWidth = 1000 * zoom;
    const endTimeInMicroSecs = endTimeInNs / 1000;
    const startTimeInMicroSecs = startTimeInNs / 1000;
    let i = Math.floor(startTimeInMicroSecs / 1000000) * 1000000;
    while (i < endTimeInMicroSecs) {
      i = i + closestIncrement;
      const wholeNumber = i % 1000000 === 0;
      if (!wholeNumber && i >= startTimeInMicroSecs) {
        const xPos = microSecWidth * i - offsetX;
        c.moveTo(xPos, -displayHeight);
        c.lineTo(xPos, 0);
        c.fillText(`${i / 1000} ms`, xPos + 2, textHeight);
      }
    }
    c.stroke();
  }

  function drawTruncation(c: CanvasRenderingContext2D) {
    const issues = root.logIssues;
    const len = issues.length;
    if (!len) return;
    let i = 0;
    c.strokeStyle = '#808080';
    c.beginPath();
    while (i < len) {
      const thisEntry = issues[i++];
      const nextEntry = issues[i];
      if (thisEntry?.startTime) {
        const startTime = thisEntry.startTime;
        const endTime = nextEntry?.startTime ?? root.exitStamp ?? 0;
        let x = startTime * zoom - offsetX;
        let w = (endTime - startTime) * zoom;
        if (x < 0) {
          w = w + x;
          x = 0;
        }
        const off = x + w - displayWidth;
        if (off > 0) w = w - off;
        c.fillStyle = truncationColors.get(thisEntry.type) || '';
        c.fillRect(x, -displayHeight, w, displayHeight);
      }
    }
    c.stroke();
  }

  // ── overview / minimap ──
  function niceStep(target: number): number {
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const candidates = [1, 2, 5, 10].map((m) => m * pow);
    return candidates.reduce((p, c) => (Math.abs(c - target) < Math.abs(p - target) ? c : p));
  }
  function drawOverview() {
    if (!octx || !ovWidth || !ovHeight) return;
    octx.clearRect(0, -ovHeight, ovWidth, ovHeight);
    const total = root.exitStamp || 1;
    const ovZoom = ovWidth / total;
    const laneH = Math.max(2, Math.min(14, Math.floor((ovHeight - 16) / Math.max(1, maxY + 1))));
    const ovScaleY = -laneH;

    // axis labels (ms) along the top
    octx.font = 'normal 11px sans-serif';
    octx.textBaseline = 'top';
    octx.fillStyle = axisText;
    octx.strokeStyle = axisGrid;
    octx.lineWidth = 1;
    const totalMs = total / 1e6;
    const stepMs = niceStep(totalMs / 9) || 1;
    octx.beginPath();
    for (let m = stepMs; m < totalMs; m += stepMs) {
      const xPos = m * 1e6 * ovZoom;
      octx.moveTo(xPos, -ovHeight);
      octx.lineTo(xPos, 0);
      octx.fillText(`${m}ms`, xPos + 2, -ovHeight + 2);
    }
    octx.stroke();

    // flame (all depths, compressed)
    octx.globalAlpha = 1;
    for (const [cat, items] of rectRenderQueue) {
      const fill = opts.colors[cat];
      if (!fill) continue;
      octx.beginPath();
      octx.fillStyle = fill;
      for (const it of items) {
        const w = it.w * ovZoom;
        if (w < 0.3) continue;
        octx.rect(it.x * ovZoom, it.y * ovScaleY, w, ovScaleY);
      }
      octx.fill();
      octx.closePath();
    }

    // viewport indicator
    if (zoom) {
      const visStartNs = offsetX / zoom;
      const visWidthNs = displayWidth / zoom;
      const vx = visStartNs * ovZoom;
      const vw = visWidthNs * ovZoom;
      octx.fillStyle = viewportFill;
      octx.fillRect(vx, -ovHeight, vw, ovHeight);
      octx.strokeStyle = viewportStroke;
      octx.lineWidth = 1.5;
      octx.strokeRect(vx, -ovHeight + 1, vw, ovHeight - 2);
    }
  }

  function resizeFont() {
    scaleFont = zoom > 0.0000004 ? 'normal 13px sans-serif' : 'normal 9px sans-serif';
  }
  function resize() {
    if (!container || !ctx || !octx) return;
    const mainRect = mainHost.getBoundingClientRect();
    const ovRect = overviewHost.getBoundingClientRect();
    if (ovRect.width && ovRect.height && (ovRect.width !== ovWidth || ovRect.height !== ovHeight)) {
      ovCanvas.width = ovRect.width * dpr;
      ovCanvas.height = ovRect.height * dpr;
      ovWidth = ovRect.width;
      ovHeight = ovRect.height;
      octx.setTransform(1, 0, 0, 1, 0, ovCanvas.height);
      octx.scale(dpr, dpr);
    }
    const newWidth = mainRect.width;
    const newHeight = mainRect.height;
    if (newWidth && newHeight && (newWidth !== displayWidth || newHeight !== displayHeight)) {
      canvas.width = newWidth * dpr;
      canvas.height = newHeight * dpr;
      displayWidth = newWidth;
      displayHeight = newHeight;
      ctx.setTransform(1, 0, 0, 1, 0, canvas.height);
      ctx.scale(dpr, dpr);
      const newDefaultZoom = displayWidth / (root.exitStamp || 1);
      if (!defaultZoom) {
        zoom = zoom || newDefaultZoom;
        defaultZoom = zoom;
      }
      const newScaleX = zoom - (defaultZoom - newDefaultZoom);
      zoom = Math.min(newScaleX, 0.3);
      defaultZoom = newDefaultZoom;
    }
    resizeFont();
  }

  function draw() {
    if (ctx && !destroyed) {
      resize();
      ctx.clearRect(0, -displayHeight, displayWidth, displayHeight);
      drawTruncation(ctx);
      drawScale(ctx);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      renderRectangles(ctx);
      drawLabels(ctx);
      drawOverview();
    }
    redrawQueued = false;
  }

  // ── hit testing ──
  function findByPosition(nodes: LogEvent[], depth: number, x: number, targetDepth: number): LogEvent | null {
    if (!nodes) return null;
    let start = 0;
    let end = nodes.length - 1;
    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      const node = nodes[mid];
      if (!node) break;
      const starttime = node.timestamp * zoom - offsetX;
      const width = node.duration.total * zoom;
      const endtime = starttime + width;
      const isInRange = width >= 0.05 && starttime <= x && endtime >= x;
      const isMatchingDepth = depth === targetDepth;
      if (isInRange && isMatchingDepth && node.duration.total) return node;
      else if (isInRange && !isMatchingDepth && node.duration.total) return findByPosition(node.children, depth + 1, x, targetDepth);
      else if (x > endtime) start = mid + 1;
      else if (x < starttime) end = mid - 1;
      else return null;
    }
    return null;
  }
  const getDepth = (y: number) => ~~(((displayHeight - y - offsetY) / realHeight) * maxY);

  // ── tooltip ──
  function createTooltip(title: string, rows: { label: string; value: string }[], color: string) {
    const body = document.createElement('div');
    Object.assign(body.style, {
      position: 'relative', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: '7px 9px', borderRadius: '4px',
      borderLeft: `4px solid ${color || 'transparent'}`, background: opts.isDark ? '#0b1220' : '#ffffff',
      color: opts.isDark ? '#e2e8f0' : '#1f2937', fontFamily: 'monospace', fontSize: '12px', pointerEvents: 'none',
      border: `1px solid ${opts.isDark ? 'rgba(148,163,184,0.25)' : 'rgba(0,0,0,0.12)'}`,
    });
    const header = document.createElement('div');
    Object.assign(header.style, { fontWeight: '600', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '420px' });
    header.textContent = title;
    body.appendChild(header);
    rows.forEach(({ label, value }) => {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', gap: '18px', padding: '2px 0' });
      const l = document.createElement('span'); l.textContent = label; l.style.opacity = '0.7';
      const v = document.createElement('span'); v.textContent = value; v.style.fontWeight = '600';
      row.appendChild(l); row.appendChild(v);
      body.appendChild(row);
    });
    return body;
  }
  function formatLimit(val: number, self: number, total = 0) {
    const outOf = total > 0 ? `/${total}` : '';
    return `${val}${outOf} (self ${self})`;
  }
  function buildEventTooltip(target: LogEvent): HTMLDivElement | null {
    if (!target.isParent) {
      canvas.style.cursor = 'default';
      return null;
    }
    canvas.style.cursor = 'pointer';
    const rows: { label: string; value: string }[] = [];
    if (target.type) rows.push({ label: 'type:', value: String(target.type) });
    if (target.exitStamp) {
      if (target.duration.total) {
        let val = formatDuration(target.duration.total);
        if (target.cpuType === 'free') val += ' (free)';
        else if (target.duration.self) val += ` (self ${formatDuration(target.duration.self)})`;
        rows.push({ label: 'total:', value: val });
      }
      const g = root.governorLimits;
      if (target.dmlCount.total) rows.push({ label: 'DML:', value: formatLimit(target.dmlCount.total, target.dmlCount.self, g.dmlStatements.limit) });
      if (target.dmlRowCount.total) rows.push({ label: 'DML rows:', value: formatLimit(target.dmlRowCount.total, target.dmlRowCount.self, g.dmlRows.limit) });
      if (target.soqlCount.total) rows.push({ label: 'SOQL:', value: formatLimit(target.soqlCount.total, target.soqlCount.self, g.soqlQueries.limit) });
      if (target.soqlRowCount.total) rows.push({ label: 'SOQL rows:', value: formatLimit(target.soqlRowCount.total, target.soqlRowCount.self, g.queryRows.limit) });
    }
    return createTooltip(target.text + (target.suffix ?? ''), rows, opts.colors[target.category] || '');
  }
  function showTooltip(x: number, y: number) {
    if (dragging || !tooltip) return;
    const depth = getDepth(y);
    const target = findByPosition(root.children, 0, x, depth);
    const node = target ? buildEventTooltip(target) : null;
    if (!target) canvas.style.cursor = 'default';
    if (node) {
      let posLeft = x + 12;
      let posTop = y + 4;
      tooltip.innerHTML = '';
      tooltip.appendChild(node);
      tooltip.style.cssText = `left:${posLeft}px;top:${posTop}px;display:block;position:absolute;max-width:75%;z-index:1000;pointer-events:none;`;
      const xDelta = tooltip.offsetWidth - mainHost.offsetWidth + posLeft;
      if (xDelta > 0) posLeft -= xDelta - 4;
      const yDelta = tooltip.offsetHeight - mainHost.offsetHeight + posTop;
      if (yDelta > 0) posTop -= tooltip.offsetHeight + 8;
      if (posTop < 0) posTop = 4;
      tooltip.style.left = `${posLeft}px`;
      tooltip.style.top = `${posTop}px`;
    } else {
      tooltip.style.display = 'none';
    }
  }
  const debouncedTooltip = debounce(showTooltip);

  // ── main interaction ──
  const onMainMove = (evt: MouseEvent) => {
    const { left, top } = canvas.getBoundingClientRect();
    lastMouseX = evt.clientX - left;
    lastMouseY = evt.clientY - top;
    debouncedTooltip(lastMouseX, lastMouseY);
  };
  const onLeave = () => { dragging = false; canvas.style.cursor = 'default'; tooltip.style.display = 'none'; };
  const onDown = () => { dragging = true; canvas.style.cursor = 'grabbing'; tooltip.style.display = 'none'; mouseDownPosition = { x: lastMouseX, y: lastMouseY }; };
  const onUp = () => { dragging = false; canvas.style.cursor = 'default'; debouncedTooltip(lastMouseX, lastMouseY); };
  const onMove = (evt: MouseEvent) => {
    if (dragging) {
      const maxWidth = zoom * (root.exitStamp || 0) - displayWidth;
      offsetX = Math.max(0, Math.min(maxWidth, offsetX - evt.movementX));
      const maxVertOffset = realHeight - displayHeight + displayHeight / 4;
      offsetY = Math.min(0, Math.max(-maxVertOffset, offsetY - evt.movementY));
      requestRedraw();
    }
  };
  const onClick = () => {
    const isClick = mouseDownPosition.x === lastMouseX && mouseDownPosition.y === lastMouseY;
    if (!dragging && isClick && opts.onSelect) {
      const depth = getDepth(lastMouseY);
      const target = findByPosition(root.children, 0, lastMouseX, depth);
      if (target?.eventIndex !== undefined) opts.onSelect(target.eventIndex);
    }
  };
  const onWheel = (evt: WheelEvent) => {
    if (dragging) return;
    const { deltaY, deltaX } = evt;
    const oldZoom = zoom;
    let zoomDelta = (deltaY / 1000) * zoom;
    const updated = zoom - zoomDelta;
    zoomDelta = updated >= defaultZoom ? zoomDelta : zoom - defaultZoom;
    zoomDelta = zoom - zoomDelta <= 0.3 ? zoomDelta : zoom - 0.3;
    if (zoomDelta !== 0) {
      zoom = zoom - zoomDelta;
      if (zoom !== oldZoom) {
        const timePosBefore = (lastMouseX + offsetX) / oldZoom;
        const newOffset = timePosBefore * zoom - lastMouseX;
        const maxWidth = zoom * (root.exitStamp || 0) - displayWidth;
        offsetX = Math.max(0, Math.min(maxWidth, newOffset));
      }
    } else {
      const maxWidth = zoom * (root.exitStamp || 0) - displayWidth;
      offsetX = Math.max(0, Math.min(maxWidth, offsetX + deltaX));
    }
    requestRedraw();
    debouncedTooltip(lastMouseX, lastMouseY);
  };

  // ── overview interaction (click / drag to navigate) ──
  let ovDragging = false;
  const ovNavigate = (clientX: number) => {
    const r = ovCanvas.getBoundingClientRect();
    const total = root.exitStamp || 1;
    const ovZoom = ovWidth / total;
    const centerNs = (clientX - r.left) / ovZoom;
    const maxWidth = zoom * total - displayWidth;
    offsetX = Math.max(0, Math.min(maxWidth, centerNs * zoom - displayWidth / 2));
    requestRedraw();
  };
  const ovDown = (e: MouseEvent) => { ovDragging = true; ovNavigate(e.clientX); };
  const ovMove = (e: MouseEvent) => { if (ovDragging) ovNavigate(e.clientX); };
  const ovUp = () => { ovDragging = false; };

  canvas.addEventListener('mouseout', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: true });
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mouseup', onUp);
  canvas.addEventListener('mousemove', onMove, { passive: true });
  canvas.addEventListener('mousemove', onMainMove, { passive: true });
  canvas.addEventListener('click', onClick);
  ovCanvas.addEventListener('mousedown', ovDown);
  window.addEventListener('mousemove', ovMove, { passive: true });
  window.addEventListener('mouseup', ovUp);
  const ro = new ResizeObserver(() => requestRedraw());
  ro.observe(mainHost);
  ro.observe(overviewHost);

  // init
  maxY = getMaxDepth(root.children);
  resize();
  realHeight = -scaleY * maxY;
  offsetX = 0;
  offsetY = 0;
  nodesToRectangles(root.children);
  rafId = requestAnimationFrame(draw);

  return () => {
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    ro.disconnect();
    canvas.removeEventListener('mouseout', onLeave);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('mousedown', onDown);
    canvas.removeEventListener('mouseup', onUp);
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mousemove', onMainMove);
    canvas.removeEventListener('click', onClick);
    ovCanvas.removeEventListener('mousedown', ovDown);
    window.removeEventListener('mousemove', ovMove);
    window.removeEventListener('mouseup', ovUp);
    overviewHost.remove();
    mainHost.remove();
  };
}
