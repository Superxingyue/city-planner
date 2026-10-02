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
  let offscreenCanvas = null;
  let renderScheduled = false;

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
  }

  function entityBBox(e) {
    if (!e.points || e.points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of e.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }

  function bboxVisible(bbox, vx, vy, vw, vh, margin) {
    if (!bbox) return true;
    margin = margin || 100;
    return !(bbox.maxX < vx - margin || bbox.minX > vx + vw + margin ||
             bbox.maxY < vy - margin || bbox.minY > vy + vh + margin);
  }

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

  function render() {
    if (!ctx || !canvas) return;
    const p = State.project;
    const { zoom, panX, panY } = p.view;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);

    const vx = -panX / zoom, vy = -panY / zoom;
    const vw = cw / zoom, vh = ch / zoom;

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    if (State.isLayerVisible('basemap')) drawBasemap(ctx);

    if (State.isLayerVisible('water')) {
      for (const e of p.entities) {
        if (e.type !== 'water') continue;
        if (!bboxVisible(entityBBox(e), vx, vy, vw, vh)) continue;
        drawWater(ctx, e);
      }
    }
    if (State.isLayerVisible('landuse')) {
      for (const e of p.entities) {
        if (e.type !== 'block' && e.type !== 'district') continue;
        if (!bboxVisible(entityBBox(e), vx, vy, vw, vh)) continue;
        drawLandUse(ctx, e);
      }
      for (const e of p.entities) {
        if (e.type !== 'block') continue;
        if (!bboxVisible(entityBBox(e), vx, vy, vw, vh)) continue;
        drawPlotNumber(ctx, e, zoom);
      }
    }
    if (State.isLayerVisible('roads')) {
      const visibleRoads = [];
      for (const e of p.entities) {
        if (e.type !== 'road') continue;
        const bb = entityBBox(e);
        if (bb && !bboxVisible(bb, vx, vy, vw, vh, 200)) continue;
        visibleRoads.push(e);
      }
      if (visibleRoads.length > 0) {
        drawRoadsOffscreen(ctx, visibleRoads, zoom, panX, panY);
        drawIntersectionDots(ctx, zoom);
        for (const e of visibleRoads) drawRoadName(ctx, e);
      }
    }
    if (boundaryVisible && State.isLayerVisible('roads')) {
      for (const e of p.entities) {
        if (e.type !== 'boundary') continue;
        if (!bboxVisible(entityBBox(e), vx, vy, vw, vh, 50)) continue;
        drawBoundary(ctx, e, zoom);
      }
    }
    if (State.isLayerVisible('annotations')) {
      for (const e of p.entities) {
        if (e.type !== 'annotation') continue;
        if (e.x < vx - 100 || e.x > vx + vw + 100 || e.y < vy - 100 || e.y > vy + vh + 100) continue;
        drawAnnotation(ctx, e, zoom);
      }
    }

    if (previewProvider) previewProvider(ctx, zoom);
    if (calibrateLine) drawCalibrateLine(ctx, calibrateLine, zoom);
    if (guideLine) drawGuideLine(ctx, guideLine, zoom);

    ctx.restore();

    const sel = State.getSelected();
    if (sel) drawSelection(ctx, sel, zoom, panX, panY);
  }

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

  function drawRoadsOffscreen(ctx, roads, zoom, panX, panY) {
    if (roads.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (!offscreenCanvas || offscreenCanvas.width !== canvas.width || offscreenCanvas.height !== canvas.height) {
      offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = canvas.width;
      offscreenCanvas.height = canvas.height;
    }
    const off = offscreenCanvas;
    const octx = off.getContext('2d');
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, off.width, off.height);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.translate(panX, panY);
    octx.scale(zoom, zoom);
    octx.lineCap = 'round';
    octx.lineJoin = 'round';

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

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }

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

  function drawLandUse(ctx, e) {
    if (!e.points || e.points.length < 3) return;
    const cat = getLandUseByCode(e.category) || { color: '#cccccc' };
    ctx.beginPath();
    ctx.moveTo(e.points[0].x, e.points[0].y);
    for (let i = 1; i < e.points.length; i++) ctx.lineTo(e.points[i].x, e.points[i].y);
    ctx.closePath();
    ctx.fillStyle = cat.color;
    ctx.fill();
    ctx.strokeStyle = darken(cat.color, 0.3);
    ctx.lineWidth = 0.15;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function drawPlotNumber(ctx, block, zoom) {
    if (!block.category || !block.points) return;
    const center = State.polygonCenter(block.points);
    const label = block.category;
    const radius = Math.max(4.5, 6 / Math.max(0.5, zoom));
    const size = radius * 0.9;
    ctx.font = `${size}px ${CONFIG.kaiti}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = Math.max(0.25, 0.35 / zoom);
    ctx.stroke();
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(label, center.x, center.y + 0.5);
  }

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

  function drawAnnotation(ctx, a, zoom) {
    const size = (a.fontSize || 14) / Math.max(0.5, zoom);
    ctx.fillStyle = a.color || '#1a1a1a';
    ctx.font = `${a.bold ? 'bold ' : ''}${size}px ${CONFIG.fangSong}`;
    ctx.textAlign = a.align || 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(a.text || '', a.x, a.y);
  }

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

  function drawSelection(ctx, entity, zoom, panX, panY) {
    if (!entity.points) return;
    const isEdit = editModeRoadId === entity.id;
    if (!isEdit) return;

    const toScreen = p => ({ x: p.x * zoom + panX, y: p.y * zoom + panY });
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
      for (const e of roads) drawRoadLayer(ctx, e, 'edge');
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
      for (const e of roads) drawRoadLayer(ctx, e, 'center');
      drawIntersectionDots(ctx, 1);
      for (const e of roads) drawRoadName(ctx, e);
    }
    for (const e of p.entities) if (e.type === 'boundary') drawBoundary(ctx, e, 1);
    if (State.isLayerVisible('annotations'))
      for (const e of p.entities) if (e.type === 'annotation') drawAnnotation(ctx, e, 1);
  }

  return { init, resize, render, scheduleRender, setPreview, setCalibrateLine, setEditMode, setGuideLine, setBoundaryVisible, renderContent };
})();
