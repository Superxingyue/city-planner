/**
 * renderer.js — 画布渲染引擎
 * 多层套色道路、平涂用地、地块编号、选中态、绘制预览
 */
'use strict';

const Renderer = (function () {
  let canvas = null, ctx = null, dpr = 1;
  let previewProvider = null;
  let calibrateLine = null;
  let editModeRoadId = null;
  let guideLine = null;
  let boundaryVisible = false;
  let offscreenCanvas = null; // 性能缓存：离屏画布复用

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    dpr = window.devicePixelRatio || 1;
    resize();
  }

  function resize() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }

  function setPreview(fn) { previewProvider = fn; }
  function setCalibrateLine(line) { calibrateLine = line; }
  function setEditMode(roadId) { editModeRoadId = roadId; }
  function setGuideLine(gl) { guideLine = gl; }
  function setBoundaryVisible(v) { boundaryVisible = v; }

  /* ── 主渲染 ────────────────────────────────────── */
  function render() {
    if (!ctx || !canvas) return;
    const p = State.project;
    const { zoom, panX, panY } = p.view;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = canvas.clientWidth, h = canvas.clientHeight;

    // 白底（规划图标准）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // 底图
    if (State.isLayerVisible('basemap')) drawBasemap(ctx);

    // 渲染顺序：水系 → 用地(街区/片区) → 道路 → 标注
    if (State.isLayerVisible('water')) {
      for (const e of p.entities) if (e.type === 'water') drawWater(ctx, e);
    }
    if (State.isLayerVisible('landuse')) {
      for (const e of p.entities) if (e.type === 'block' || e.type === 'district') drawLandUse(ctx, e);
      // 地块编号（在道路下方）
      for (const e of p.entities) if (e.type === 'block') drawPlotNumber(ctx, e, zoom);
    }
    if (State.isLayerVisible('roads')) {
      const roads = p.entities.filter(e => e.type === 'road');
      // 离屏画布渲染：蓝边 → destination-out 挖空内部(透底图+路口融合) → 红中心线
      drawRoadsOffscreen(ctx, roads, zoom, panX, panY);
      drawIntersectionDots(ctx, zoom);
      for (const e of roads) drawRoadName(ctx, e);
    }
    // 街区边界线（仅在边界工具激活时显示）
    if (boundaryVisible && State.isLayerVisible('roads')) {
      for (const e of p.entities) if (e.type === 'boundary') drawBoundary(ctx, e, zoom);
    }
    if (State.isLayerVisible('annotations')) {
      for (const e of p.entities) if (e.type === 'annotation') drawAnnotation(ctx, e, zoom);
    }

    // 绘制预览
    if (previewProvider) previewProvider(ctx, zoom);
    if (calibrateLine) drawCalibrateLine(ctx, calibrateLine, zoom);
    if (guideLine) drawGuideLine(ctx, guideLine, zoom);

    ctx.restore();

    // 选中态（屏幕空间）
    const sel = State.getSelected();
    if (sel) drawSelection(ctx, sel, zoom, panX, panY);
  }

  /* ── 底图 ──────────────────────────────────────── */
  function drawBasemap(ctx) {
    const img = State.getBasemapImage();
    const bm = State.project.basemap;
    if (!img || !bm.dataUrl) return;
    ctx.save();
    ctx.globalAlpha = bm.opacity;
    if (bm.rotation) {
      ctx.translate(bm.x, bm.y);
      ctx.rotate(bm.rotation * Math.PI / 180);
      ctx.drawImage(img, 0, 0, img.width * bm.scale, img.height * bm.scale);
    } else {
      ctx.drawImage(img, bm.x, bm.y, img.width * bm.scale, img.height * bm.scale);
    }
    ctx.restore();
  }

  /* ── 离屏道路渲染：蓝边 → destination-out 挖空 → 红中心 ──
     内部透明透底图，路口处蓝线被交叉路的挖空层融合 */
  function drawRoadsOffscreen(ctx, roads, zoom, panX, panY) {
    if (roads.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    // 复用离屏画布，仅在尺寸变化时重建
    if (!offscreenCanvas || offscreenCanvas.width !== canvas.width || offscreenCanvas.height !== canvas.height) {
      offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = canvas.width;
      offscreenCanvas.height = canvas.height;
    }
    const off = offscreenCanvas;
    const octx = off.getContext('2d');
    // 必须先重置变换再清除，否则上一帧的变换会导致只清除局部区域
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, off.width, off.height);
    // 与主画布相同的变换链：DPR → 平移 → 缩放
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.translate(panX, panY);
    octx.scale(zoom, zoom);
    octx.lineCap = 'round';
    octx.lineJoin = 'round';

    // 通道1：所有蓝边
    for (const road of roads) {
      if (!road.points || road.points.length < 2) continue;
      const level = CONFIG.roadLevels[road.level] || CONFIG.roadLevels.local;
      if (!level.edgeColor) continue;
      const W = level.width / State.project.meterPerPixel;
      const pts = State.getRoadSamples(road);
      octx.strokeStyle = level.edgeColor;
      octx.lineWidth = W + level.edgeWidth * 2;
      octx.beginPath();
      octx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
      octx.stroke();
    }

    // 通道2：destination-out 挖空道路内部（同时挖掉路口交叉处的蓝边）
    octx.globalCompositeOperation = 'destination-out';
    for (const road of roads) {
      if (!road.points || road.points.length < 2) continue;
      const level = CONFIG.roadLevels[road.level] || CONFIG.roadLevels.local;
      const W = level.width / State.project.meterPerPixel;
      const pts = State.getRoadSamples(road);
      octx.lineWidth = W;
      octx.beginPath();
      octx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
      octx.stroke();
    }
    octx.globalCompositeOperation = 'source-over';

    // 通道3：红点划线中心线
    for (const road of roads) {
      if (!road.points || road.points.length < 2) continue;
      const level = CONFIG.roadLevels[road.level] || CONFIG.roadLevels.local;
      if (level.centerType !== 'red-dashed' || !level.centerWidth) continue;
      const pts = State.getRoadSamples(road);
      octx.strokeStyle = level.centerColor;
      octx.lineWidth = Math.max(0.3, level.centerWidth);
      octx.setLineDash(CONFIG.redDashPattern);
      octx.beginPath();
      octx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
      octx.stroke();
      octx.setLineDash([]);
    }

    // 将离屏画布贴回主画布（单位变换，物理像素对齐）
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

  /* ── 道路分层渲染（多通道，保留供预览使用） ──────── */
  function drawRoadLayer(ctx, road, layer) {
    if (!road.points || road.points.length < 2) return;
    const level = CONFIG.roadLevels[road.level] || CONFIG.roadLevels.local;
    const mpp = State.project.meterPerPixel;
    const W = level.width / mpp;
    const pts = State.getRoadSamples(road);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (layer === 'edge') {
      if (!level.edgeColor || level.edgeWidth <= 0) return;
      ctx.strokeStyle = level.edgeColor;
      ctx.lineWidth = W + level.edgeWidth * 2;
      strokePts(ctx, pts);
    } else if (layer === 'innerDash') {
      if (!level.innerDash) return;
      ctx.strokeStyle = level.innerDash;
      ctx.lineWidth = W - 1;
      ctx.setLineDash([8, 6]);
      strokePts(ctx, pts);
      ctx.setLineDash([]);
    } else if (layer === 'body') {
      ctx.strokeStyle = level.bodyColor;
      ctx.lineWidth = Math.max(1, W);
      strokePts(ctx, pts);
    } else if (layer === 'center') {
      if (level.centerType === 'red-dashed' && level.centerWidth > 0) {
        ctx.strokeStyle = level.centerColor;
        ctx.lineWidth = Math.max(0.5, level.centerWidth);
        ctx.setLineDash(CONFIG.redDashPattern);
        strokePts(ctx, pts);
        ctx.setLineDash([]);
      }
    }
  }

  function drawRoadName(ctx, road) {
    if (!road.name || !road.points || road.points.length < 2) return;
    const level = CONFIG.roadLevels[road.level] || CONFIG.roadLevels.local;
    const W = level.width / State.project.meterPerPixel;
    const pts = State.getRoadSamples(road);
    const mid = pts[Math.floor(pts.length / 2)];
    ctx.fillStyle = '#444';
    ctx.font = `${Math.max(9, W * 0.28)}px ${CONFIG.fangSong}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(road.name, mid.x, mid.y - W / 2 - 4);
  }

  /* ── 路口绿点 ──────────────────────────────────── */
  function drawIntersectionDots(ctx, zoom) {
    const pts = State.getAllIntersections();
    const r = Math.max(0.8, 1.5 / Math.max(0.5, zoom));
    for (const p of pts) {
      ctx.fillStyle = '#2ec27e';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function strokePts(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  /* ── 用地（街区/片区）平涂 ─────────────────────── */
  function drawLandUse(ctx, e) {
    if (!e.points || e.points.length < 3) return;
    const cat = getLandUseByCode(e.category) || { color: '#cccccc' };
    ctx.beginPath();
    ctx.moveTo(e.points[0].x, e.points[0].y);
    for (let i = 1; i < e.points.length; i++) ctx.lineTo(e.points[i].x, e.points[i].y);
    ctx.closePath();
    ctx.fillStyle = cat.color;
    ctx.fill();
    // 细边框（同色系加深）
    ctx.strokeStyle = darken(cat.color, 0.3);
    ctx.lineWidth = 0.15;
    ctx.stroke();
  }

  /* ── 地块编号：正圆内显示用地代码（B1/R2 等），楷体 ──── */
  function drawPlotNumber(ctx, block, zoom) {
    if (!block.category || !block.points) return;
    const center = State.polygonCenter(block.points);
    const label = block.category;
    const size = Math.max(7, Math.min(11, 9 / Math.max(0.5, zoom)));
    ctx.font = `${size}px ${CONFIG.kaiti}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    const radius = Math.max(tw * 0.65 + 3, size * 0.85);
    // 正圆
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = Math.max(0.4, 0.6 / zoom);
    ctx.stroke();
    // 文字（楷体）
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(label, center.x, center.y + 0.5);
  }

  /* ── 街区边界线（细灰实线，非道路） ────────────── */
  function drawBoundary(ctx, b, zoom) {
    if (!b.points || b.points.length < 2) return;
    const pts = b.curve === 'bezier' ? State.sampleSpline(b.points, CONFIG.splineSegments) : b.points;
    ctx.strokeStyle = '#4a4a4a';
    ctx.lineWidth = Math.max(0.6, 1.0 / zoom);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* ── 水系 ──────────────────────────────────────── */
  function drawWater(ctx, w) {
    if (!w.points || w.points.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(w.points[0].x, w.points[0].y);
    for (let i = 1; i < w.points.length; i++) ctx.lineTo(w.points[i].x, w.points[i].y);
    ctx.closePath();
    ctx.fillStyle = '#b8d4e8';
    ctx.fill();
    ctx.strokeStyle = '#7aa8c8';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* ── 标注 ──────────────────────────────────────── */
  function drawAnnotation(ctx, a, zoom) {
    const size = (a.fontSize || 14) / Math.max(0.5, zoom);
    ctx.fillStyle = a.color || '#1a1a1a';
    ctx.font = `${a.bold ? 'bold ' : ''}${size}px ${CONFIG.fangSong}`;
    ctx.textAlign = a.align || 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(a.text || '', a.x, a.y);
  }

  /* ── 校准线 ────────────────────────────────────── */
  function drawCalibrateLine(ctx, line, zoom) {
    ctx.strokeStyle = '#d62b2b';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [x, y] of [[line.x1, line.y1], [line.x2, line.y2]]) {
      ctx.fillStyle = '#d62b2b';
      ctx.beginPath();
      ctx.arc(x, y, 4 / zoom, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ── 节点编辑引导线 ────────────────────────────── */
  function drawGuideLine(ctx, gl, zoom) {
    ctx.strokeStyle = '#ff6b35';
    ctx.lineWidth = 1.2 / Math.max(0.5, zoom);
    ctx.setLineDash([5 / zoom, 3 / zoom]);
    ctx.beginPath();
    ctx.moveTo(gl.x1, gl.y1);
    ctx.lineTo(gl.x2, gl.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff6b35';
    ctx.beginPath();
    ctx.arc(gl.x2, gl.y2, 3.5 / Math.max(0.5, zoom), 0, Math.PI * 2);
    ctx.fill();
  }

  /* ── 选中态 ──────────────────────────────────────
     非编辑模式：不画任何标记（用户不喜欢蓝框蓝点）
     编辑模式（右键道路/边界）：画橙色节点 */
  function drawSelection(ctx, entity, zoom, panX, panY) {
    if (!entity.points) return;
    const isEdit = editModeRoadId === entity.id;
    if (!isEdit) return; // 非编辑模式无视觉反馈

    const toScreen = p => ({ x: p.x * zoom + panX, y: p.y * zoom + panY });
    // 编辑模式：橙色节点
    for (let i = 0; i < entity.points.length; i++) {
      const s = toScreen(entity.points[i]);
      ctx.fillStyle = '#ff6b35';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold 9px ${CONFIG.cadFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), s.x, s.y);
    }
    ctx.fillStyle = '#ff6b35';
    ctx.font = `bold 11px ${CONFIG.cadFont}`;
    ctx.textAlign = 'left';
    const first = toScreen(entity.points[0]);
    ctx.fillText('编辑节点：左键添加 / 右键删除 / 拖拽移动 / Enter 退出', first.x + 12, first.y - 12);
  }

  function darken(hex, amount) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substr(0, 2), 16);
    const g = parseInt(c.substr(2, 2), 16);
    const b = parseInt(c.substr(4, 2), 16);
    const f = 1 - amount;
    return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
  }

  /* ── 导出用纯内容渲染 ──────────────────────────── */
  function renderContent(ctx, opts) {
    opts = opts || {};
    const p = State.project;
    if (opts.basemap !== false && State.isLayerVisible('basemap')) drawBasemap(ctx);
    if (State.isLayerVisible('water'))
      for (const e of p.entities) if (e.type === 'water') drawWater(ctx, e);
    if (State.isLayerVisible('landuse')) {
      for (const e of p.entities) if (e.type === 'block' || e.type === 'district') drawLandUse(ctx, e);
      for (const e of p.entities) if (e.type === 'block') drawPlotNumber(ctx, e, 1);
    }
    if (State.isLayerVisible('roads')) {
      const roads = p.entities.filter(e => e.type === 'road');
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // 蓝边
      for (const e of roads) drawRoadLayer(ctx, e, 'edge');
      // destination-out 挖空内部（路口融合）
      ctx.globalCompositeOperation = 'destination-out';
      for (const e of roads) {
        if (!e.points || e.points.length < 2) continue;
        const lv = CONFIG.roadLevels[e.level] || CONFIG.roadLevels.local;
        const W = lv.width / State.project.meterPerPixel;
        const pts = State.getRoadSamples(e);
        ctx.lineWidth = W;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      // 红中心
      for (const e of roads) drawRoadLayer(ctx, e, 'center');
      drawIntersectionDots(ctx, 1);
      for (const e of roads) drawRoadName(ctx, e);
    }
    for (const e of p.entities) if (e.type === 'boundary') drawBoundary(ctx, e, 1);
    if (State.isLayerVisible('annotations'))
      for (const e of p.entities) if (e.type === 'annotation') drawAnnotation(ctx, e, 1);
  }

  return { init, resize, render, setPreview, setCalibrateLine, setEditMode, setGuideLine, setBoundaryVisible, renderContent };
})();
