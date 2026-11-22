import * as THREE from 'three';
import type {
  FactoryPipelineSnapshot,
  FactoryStationId,
  StickyNoteItem,
} from '../lib/factoryPipelineState';

export interface DynamicCanvasSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

export function createDynamicCanvasSurface(
  width: number,
  height: number,
  maxAnisotropy: number
): DynamicCanvasSurface {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { canvas, ctx, texture };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/**
 * Architectural 3D Station Nameplate Plaque
 */
export function createSignageTexture(
  stationId: FactoryStationId,
  title: string,
  operatorName: string,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const { ctx, texture } = createDynamicCanvasSurface(640, 128, maxAnisotropy);
  ctx.fillStyle = '#FFFFFF';
  drawRoundedRect(ctx, 4, 4, 632, 120, 20);
  ctx.fill();
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Left dark industrial station badge
  ctx.fillStyle = '#0F172A';
  drawRoundedRect(ctx, 20, 22, 152, 84, 14);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 38px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(stationId, 40, 65);

  // Title + operator
  ctx.fillStyle = '#0F172A';
  ctx.font = '700 38px Inter, system-ui, sans-serif';
  ctx.fillText(title, 194, 52);

  ctx.fillStyle = '#475569';
  ctx.font = '600 24px Inter, system-ui, sans-serif';
  ctx.fillText(`负责人 · ${operatorName}`, 196, 92);

  texture.needsUpdate = true;
  return texture;
}

/**
 * ST-00 Wall Live Telemetry Screen (7-Day Success Rate Line + Token Bars)
 */
export function paintSt00WallScreen(
  surface: DynamicCanvasSurface,
  snapshot: FactoryPipelineSnapshot
): void {
  const { ctx, canvas, texture } = surface;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Subtle top bar
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, W, 68);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 68);
  ctx.lineTo(W, 68);
  ctx.stroke();

  ctx.fillStyle = '#0F172A';
  ctx.font = '700 28px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('ST-00 全局遥测大屏 · 近 7 日产线趋势', 30, 35);

  ctx.fillStyle = snapshot.mode === 'demo' ? '#2563EB' : '#059669';
  ctx.font = '700 20px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText(
    snapshot.mode === 'demo' ? 'DEMO SIMULATION' : 'LIVE TELEMETRY',
    W - 230,
    35
  );

  // 4 KPI tiles
  const kpis = [
    {
      label: '7日任务成功率',
      value:
        snapshot.st00.successRatePct !== null
          ? `${Math.round(snapshot.st00.successRatePct)}%`
          : '--',
      accent: '#059669',
    },
    {
      label: '7日 Token 消耗',
      value: formatCompactTokens(snapshot.st00.totalTokens),
      accent: '#2563EB',
    },
    {
      label: '已归档交付',
      value: `${snapshot.st00.deliveredCount} 项`,
      accent: '#0F172A',
    },
    {
      label: '活跃并行任务',
      value: `${snapshot.st00.runningCount} 路`,
      accent: snapshot.st00.runningCount > 0 ? '#2563EB' : '#64748B',
    },
  ];

  const cardW = (W - 60 - 42) / 4;
  kpis.forEach((k, i) => {
    const x = 30 + i * (cardW + 14);
    const y = 86;
    ctx.fillStyle = '#F8FAFC';
    drawRoundedRect(ctx, x, y, cardW, 96, 12);
    ctx.fill();
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#64748B';
    ctx.font = '600 18px Inter, system-ui, sans-serif';
    ctx.fillText(k.label, x + 16, y + 30);

    ctx.fillStyle = k.accent;
    ctx.font = '700 34px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(k.value, x + 16, y + 68);
  });

  // Chart Box
  const chartX = 30;
  const chartY = 204;
  const chartW = W - 60;
  const chartH = H - 234;
  ctx.fillStyle = '#F8FAFC';
  drawRoundedRect(ctx, chartX, chartY, chartW, chartH, 14);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Horizontal guide lines
  for (let i = 1; i <= 3; i += 1) {
    const gy = chartY + (chartH - 42) * (i / 4) + 12;
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(chartX + 24, gy);
    ctx.lineTo(chartX + chartW - 24, gy);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const series = snapshot.st00.dailySeries;
  const maxTokens = Math.max(100, ...series.map((d) => d.tokensK));
  const innerX = chartX + 46;
  const innerW = chartW - 92;
  const innerTop = chartY + 30;
  const innerH = chartH - 76;

  // Token Bars (soft blue)
  const stepX = series.length > 1 ? innerW / (series.length - 1) : innerW;
  series.forEach((d, idx) => {
    const cx = innerX + idx * stepX;
    const barW = 36;
    const barH = Math.max(8, (d.tokensK / maxTokens) * (innerH * 0.72));
    ctx.fillStyle = 'rgba(37, 99, 235, 0.22)';
    drawRoundedRect(ctx, cx - barW / 2, innerTop + innerH - barH, barW, barH, 6);
    ctx.fill();

    // X labels
    ctx.fillStyle = '#64748B';
    ctx.font = '600 17px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(d.label, cx, chartY + chartH - 18);
  });

  // Success Rate Line (Emerald)
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 4.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  series.forEach((d, idx) => {
    const cx = innerX + idx * stepX;
    const cy = innerTop + innerH - (Math.min(100, Math.max(0, d.successRate)) / 100) * innerH;
    if (idx === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  });
  ctx.stroke();

  series.forEach((d, idx) => {
    const cx = innerX + idx * stepX;
    const cy = innerTop + innerH - (Math.min(100, Math.max(0, d.successRate)) / 100) * innerH;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 3.5;
    ctx.stroke();
  });

  ctx.textAlign = 'left';
  texture.needsUpdate = true;
}

/**
 * ST-01 Dual Monitor Animated DAG Architecture Graph
 */
export function paintSt01DagScreen(
  surface: DynamicCanvasSurface,
  snapshot: FactoryPipelineSnapshot,
  scanProgress: number
): void {
  const { ctx, canvas, texture } = surface;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Blueprint micro-grid
  ctx.strokeStyle = '#EFF4FA';
  ctx.lineWidth = 1.5;
  for (let x = 0; x < W; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Header
  ctx.fillStyle = '#0F172A';
  ctx.font = '700 26px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('PRD-TO-SPEC · DAG 架构编排器', 28, 38);

  ctx.fillStyle = '#2563EB';
  ctx.font = '700 20px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText(
    `TASKS: ${snapshot.st01.taskCount || 4}  |  P0: ${snapshot.st01.p0Count}`,
    W - 260,
    38
  );

  // DAG Nodes in 2x2 connected graph
  const nodes = snapshot.st01.dagNodes.slice(0, 4);
  const coords = [
    { x: 110, y: 155 },
    { x: 430, y: 120 },
    { x: 430, y: 270 },
    { x: 740, y: 195 },
  ];

  // Edges
  const edges = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
  ];
  edges.forEach(([a, b], idx) => {
    const p1 = coords[a];
    const p2 = coords[b];
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p1.x + 110, p1.y);
    ctx.lineTo(p2.x - 110, p2.y);
    ctx.stroke();

    // Animated signal pulse dot along edge
    const t = (scanProgress + idx * 0.25) % 1;
    const sx = p1.x + 110 + (p2.x - 110 - (p1.x + 110)) * t;
    const sy = p1.y + (p2.y - p1.y) * t;
    ctx.fillStyle = '#2563EB';
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fill();
  });

  nodes.forEach((node, idx) => {
    const c = coords[idx] ?? coords[0];
    const bw = 220;
    const bh = 88;
    const x = c.x - bw / 2;
    const y = c.y - bh / 2;

    const borderColor = node.active ? '#2563EB' : node.done ? '#059669' : '#CBD5E1';
    const bgColor = node.active ? '#EFF6FF' : node.done ? '#ECFDF5' : '#FFFFFF';
    ctx.fillStyle = bgColor;
    drawRoundedRect(ctx, x, y, bw, bh, 14);
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.fillStyle = borderColor;
    ctx.font = '700 18px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(node.id, x + 16, y + 28);

    ctx.fillStyle = '#0F172A';
    ctx.font = '700 22px Inter, system-ui, sans-serif';
    ctx.fillText(node.label.slice(0, 10), x + 16, y + 60);
  });

  // Subtle scan sweep line
  const sweepX = ((scanProgress * 0.65) % 1) * W;
  const grad = ctx.createLinearGradient(sweepX - 50, 0, sweepX + 10, 0);
  grad.addColorStop(0, 'rgba(37, 99, 235, 0)');
  grad.addColorStop(1, 'rgba(37, 99, 235, 0.14)');
  ctx.fillStyle = grad;
  ctx.fillRect(sweepX - 50, 65, 60, H - 65);

  texture.needsUpdate = true;
}

/**
 * ST-01 Pastel Macaron 3D Sticky Note Texture
 */
export function paintStickyNoteSurface(
  surface: DynamicCanvasSurface,
  note: StickyNoteItem
): void {
  const { ctx, canvas, texture } = surface;
  const W = canvas.width;
  const H = canvas.height;

  const palette =
    note.color === 'yellow'
      ? { bg: '#FEF9C3', border: '#FDE047', tagBg: '#FEF08A', tagText: '#854D0E' }
      : note.color === 'green'
        ? { bg: '#DCFCE7', border: '#86EFAC', tagBg: '#BBF7D0', tagText: '#166534' }
        : { bg: '#DBEAFE', border: '#93C5FD', tagBg: '#BFDBFE', tagText: '#1E40AF' };

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  // Tag chip
  ctx.fillStyle = palette.tagBg;
  drawRoundedRect(ctx, 20, 20, 128, 38, 8);
  ctx.fill();
  ctx.fillStyle = palette.tagText;
  ctx.font = '700 20px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(note.tag.slice(0, 8), 32, 40);

  // Wrapped text lines
  ctx.fillStyle = '#0F172A';
  ctx.font = '600 24px Inter, system-ui, sans-serif';
  const chars = Array.from(note.text);
  let line = '';
  let y = 92;
  for (let i = 0; i < chars.length; i += 1) {
    line += chars[i];
    if (line.length >= 9 || i === chars.length - 1) {
      ctx.fillText(line, 22, y);
      line = '';
      y += 34;
      if (y > H - 24) break;
    }
  }

  texture.needsUpdate = true;
}

/**
 * ST-02 Dark-Glass Code Diff Terminal Screen
 */
export function paintSt02DiffScreen(
  surface: DynamicCanvasSurface,
  snapshot: FactoryPipelineSnapshot,
  scrollTick: number
): void {
  const { ctx, canvas, texture } = surface;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, W, H);

  // Top chrome bar
  ctx.fillStyle = '#1E293B';
  ctx.fillRect(0, 0, W, 50);
  ctx.fillStyle = '#38BDF8';
  ctx.font = '700 20px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(`AGY DIFF · ${snapshot.st02.branchName.slice(0, 32)}`, 22, 26);

  ctx.fillStyle = snapshot.st02.isSparking ? '#F59E0B' : '#10B981';
  ctx.fillText(
    snapshot.st02.isSparking ? `● CODING R${snapshot.st02.repairRound || 1}` : '● STANDBY',
    W - 180,
    26
  );

  const lines = snapshot.st02.diffLines;
  const shift = snapshot.st02.isSparking ? Math.floor(scrollTick * 1.4) % Math.max(1, lines.length) : 0;

  ctx.font = '500 20px "JetBrains Mono", ui-monospace, monospace';
  for (let i = 0; i < 8; i += 1) {
    const item = lines[(i + shift) % lines.length];
    if (!item) continue;
    const y = 78 + i * 42;
    if (item.type === 'add') {
      ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
      ctx.fillRect(14, y - 16, W - 28, 34);
      ctx.fillStyle = '#6EE7B7';
    } else if (item.type === 'del') {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
      ctx.fillRect(14, y - 16, W - 28, 34);
      ctx.fillStyle = '#FCA5A5';
    } else {
      ctx.fillStyle = '#94A3B8';
    }
    ctx.fillText(item.text.slice(0, 52), 24, y);
  }

  texture.needsUpdate = true;
}

/**
 * ST-02 Portrait Build & Smoke Test Log Terminal
 */
export function paintSt02SmokeScreen(
  surface: DynamicCanvasSurface,
  snapshot: FactoryPipelineSnapshot
): void {
  const { ctx, canvas, texture } = surface;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#0B1220';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#1E293B';
  ctx.fillRect(0, 0, W, 56);
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '700 22px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText('SMOKE & BUILD SANDBOX', 20, 28);

  ctx.font = '500 19px "JetBrains Mono", ui-monospace, monospace';
  snapshot.st02.smokeLogs.forEach((line, idx) => {
    const y = 92 + idx * 54;
    ctx.fillStyle = line.includes('OK') || line.includes('passed') || line.includes('verified')
      ? '#34D399'
      : line.includes('agy')
        ? '#60A5FA'
        : '#CBD5E1';
    ctx.fillText(line.slice(0, 34), 20, y);
    if (line.length > 34) {
      ctx.fillText(line.slice(34, 68), 32, y + 24);
    }
  });

  // Model badge footer
  ctx.fillStyle = '#1E293B';
  drawRoundedRect(ctx, 20, H - 72, W - 40, 48, 10);
  ctx.fill();
  ctx.fillStyle = '#38BDF8';
  ctx.font = '700 19px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText(snapshot.st02.modelName, 36, H - 48);

  texture.needsUpdate = true;
}

/**
 * ST-03 RSI Self-Evolution Distilled Rules Terminal
 */
export function paintSt03RsiScreen(
  surface: DynamicCanvasSurface,
  snapshot: FactoryPipelineSnapshot
): void {
  const { ctx, canvas, texture } = surface;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, W, 62);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 23px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText('RSI SELF-EVOLUTION RULES', 22, 32);

  // Pass Rate Banner
  const isRework = snapshot.stationStates['ST-03'].led === 'rework';
  ctx.fillStyle = isRework ? '#FEF2F2' : '#ECFDF5';
  drawRoundedRect(ctx, 20, 80, W - 40, 68, 12);
  ctx.fill();
  ctx.strokeStyle = isRework ? '#FCA5A5' : '#6EE7B7';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = isRework ? '#DC2626' : '#059669';
  ctx.font = '700 26px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText(`QA PASS RATE: ${snapshot.st03.passRateText}`, 36, 114);

  // Rules List
  snapshot.st03.rsiRules.slice(0, 4).forEach((rule, idx) => {
    const y = 172 + idx * 82;
    ctx.fillStyle = rule.isNew ? '#EFF6FF' : '#F8FAFC';
    drawRoundedRect(ctx, 20, y, W - 40, 68, 10);
    ctx.fill();
    ctx.strokeStyle = rule.isNew ? '#3B82F6' : '#E2E8F0';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = rule.isNew ? '#2563EB' : '#475569';
    ctx.font = '700 18px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(rule.code + (rule.isNew ? '  [NEW]' : ''), 34, y + 22);

    ctx.fillStyle = '#0F172A';
    ctx.font = '600 20px Inter, system-ui, sans-serif';
    ctx.fillText(rule.title.slice(0, 22), 34, y + 50);
  });

  texture.needsUpdate = true;
}

/**
 * ST-04 Live Cloudflare Preview Display Screen
 */
export function paintSt04PreviewScreen(
  surface: DynamicCanvasSurface,
  snapshot: FactoryPipelineSnapshot
): void {
  const { ctx, canvas, texture } = surface;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Browser URL Chrome
  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(0, 0, W, 62);
  const dotColors = ['#F87171', '#FBBF24', '#34D399'];
  dotColors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(28 + i * 24, 31, 7, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#FFFFFF';
  drawRoundedRect(ctx, 114, 14, W - 260, 34, 8);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.font = '500 17px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  const urlText = snapshot.st04.previewUrl || 'https://preview.atd-v1.pages.dev';
  ctx.fillText(urlText.slice(0, 44), 130, 32);

  // PR tag
  ctx.fillStyle = snapshot.st04.isApprovedStamped ? '#059669' : '#D97706';
  drawRoundedRect(ctx, W - 134, 14, 114, 34, 8);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 17px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText(
    snapshot.st04.prNumber ? `PR #${snapshot.st04.prNumber}` : 'PREVIEW',
    W - 118,
    32
  );

  // Live App Preview Mock Surface
  ctx.fillStyle = '#F8FAFC';
  drawRoundedRect(ctx, 28, 82, W - 56, H - 110, 14);
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#0F172A';
  ctx.font = '700 32px Inter, system-ui, sans-serif';
  ctx.fillText(snapshot.st04.previewTitle.slice(0, 22), 54, 134);

  ctx.fillStyle = '#64748B';
  ctx.font = '500 19px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText(`Branch: ${snapshot.st04.previewSubtitle.slice(0, 36)}`, 54, 174);

  // Interactive preview UI cards
  const metrics = [
    { label: '验收清单核对', val: `${snapshot.st04.criteriaChecked} / ${snapshot.st04.criteriaTotal || 4}`, col: '#2563EB' },
    { label: '冒烟与盲测门禁', val: 'PASS 100%', col: '#059669' },
    { label: '签批门禁状态', val: snapshot.st04.isApprovedStamped ? 'APPROVED' : 'PENDING', col: snapshot.st04.isApprovedStamped ? '#059669' : '#D97706' },
  ];
  metrics.forEach((m, i) => {
    const mx = 54 + i * 252;
    ctx.fillStyle = '#FFFFFF';
    drawRoundedRect(ctx, mx, 214, 232, 112, 12);
    ctx.fill();
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#64748B';
    ctx.font = '600 17px Inter, system-ui, sans-serif';
    ctx.fillText(m.label, mx + 18, 248);

    ctx.fillStyle = m.col;
    ctx.font = '700 28px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText(m.val, mx + 18, 294);
  });

  // Preview wireframe footer bars
  ctx.fillStyle = '#E2E8F0';
  drawRoundedRect(ctx, 54, 352, W - 108, 24, 6);
  ctx.fill();
  ctx.fillStyle = '#DBEAFE';
  drawRoundedRect(ctx, 54, 392, (W - 108) * 0.68, 24, 6);
  ctx.fill();

  // Stamp overlay on screen when approved
  if (snapshot.st04.isApprovedStamped) {
    ctx.save();
    ctx.translate(W - 210, H - 115);
    ctx.rotate(-0.14);
    ctx.fillStyle = 'rgba(236, 253, 245, 0.92)';
    drawRoundedRect(ctx, -145, -42, 290, 84, 12);
    ctx.fill();
    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = '#059669';
    ctx.font = '800 34px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('APPROVED ✓', 0, 2);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  texture.needsUpdate = true;
}

/**
 * ST-04 3D Floating Stamp Texture
 */
export function createApprovedStampTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const { ctx, canvas, texture } = createDynamicCanvasSurface(512, 192, maxAnisotropy);
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ECFDF5';
  drawRoundedRect(ctx, 12, 12, W - 24, H - 24, 24);
  ctx.fill();
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 12;
  ctx.stroke();

  ctx.fillStyle = '#059669';
  ctx.font = '900 58px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('APPROVED', W / 2, H / 2 - 18);

  ctx.font = '700 26px Inter, system-ui, sans-serif';
  ctx.fillText('沈岚签批 · 准予合并上线', W / 2, H / 2 + 44);
  ctx.textAlign = 'left';
  texture.needsUpdate = true;
  return texture;
}

/**
 * ST-05 Hardcover Delivery Report Cover Texture
 */
export function paintSt05ReportCover(
  surface: DynamicCanvasSurface,
  snapshot: FactoryPipelineSnapshot
): void {
  const { ctx, canvas, texture } = surface;
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Emerald top accent stripe
  ctx.fillStyle = '#059669';
  ctx.fillRect(0, 0, W, 24);

  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  ctx.fillStyle = '#059669';
  ctx.font = '700 22px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText('AUTODEV DELIVERY REPORT', 36, 70);

  ctx.fillStyle = '#0F172A';
  ctx.font = '700 32px Inter, system-ui, sans-serif';
  const title = snapshot.st05.latestTitle;
  ctx.fillText(title.slice(0, 11), 36, 134);
  if (title.length > 11) {
    ctx.fillText(title.slice(11, 22), 36, 178);
  }

  // Divider
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(36, 224, W - 72, 3);

  // Stats
  const rows = [
    ['归档总数', `${snapshot.st05.deliveredCount} 项交付`],
    ['盲测通过率', snapshot.st05.latestPassRateText],
    ['平均交付耗时', snapshot.st05.latestDurationText],
    ['自动修复轮次', `${snapshot.st05.latestRepairRounds} 轮`],
  ];
  rows.forEach(([k, v], i) => {
    const ry = 266 + i * 54;
    ctx.fillStyle = '#64748B';
    ctx.font = '600 22px Inter, system-ui, sans-serif';
    ctx.fillText(k, 36, ry);

    ctx.fillStyle = '#0F172A';
    ctx.font = '700 24px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(v, W - 36, ry);
    ctx.textAlign = 'left';
  });

  // Bottom seal
  ctx.fillStyle = '#ECFDF5';
  drawRoundedRect(ctx, 36, H - 94, W - 72, 58, 12);
  ctx.fill();
  ctx.fillStyle = '#059669';
  ctx.font = '700 22px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ARCHIVED · 陆瑶归档', W / 2, H - 65);
  ctx.textAlign = 'left';

  texture.needsUpdate = true;
}
