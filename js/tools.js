/**
 * tools.js — 绘制工具与交互（v3）
 * 左键绘制+回车完成 · 右键编辑道路节点 · 右键菜单 · 街区拆分器 · 路口自动修剪
 */
'use strict';

const Tools = (function () {
  let canvas = null;
  let current = 'select';
  let options = {
    roadLevel: 'arterial',
    roadName: '',
    landUseCode: 'R2',
    districtName: '',
    annotationText: '标注',
    annotationSize: 16,
  };

  let drawing = null;
  let isDragging = false;
  let dragStart = null;
  let vertexDrag = null;
  let entityDrag = null;
  let dragUndoRecorded = false;
  let spacePan = false;
  let calibrateStart = null;
  let mouseDownPos = null;
  let mouseDownTime = 0;
  let editModeRoadId = null;
  let extendEnd = null; // 'start' | 'end' | null
  let contextMenuEl = null;
  let eraserActive = false;
  let shiftPressed = false;

  const toolNames = {
    select: '选择/编辑', pan: '平移',
    'road-bezier': '道路(贝塞尔)', 'road-polyline': '道路(折线)',
    'road-ramp': '匝道',
    'block-fill': '街区填充', boundary: '划定街区边界',
    eraser: '橡皮擦', 'block-clear': '街区清除',
    'district-polygon': '片区(多边形)', 'district-rect': '片区(矩形)',
    annotation: '标注', calibrate: '比例尺校准',
  };

  let toolListeners = [], coordListeners = [], zoomListeners = [];

  function init(canvasEl) {
    canvas = canvasEl;
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    createContextMenu();
  }

  function createContextMenu() {
    contextMenuEl = document.createElement('div');
    contextMenuEl.id = 'contextMenu';
    contextMenuEl.style.cssText = 'position:fixed;z-index:9999;display:none;background:#fff;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.18);min-width:140px;padding:4px 0;font-size:13px;';
    document.body.appendChild(contextMenuEl);
    document.addEventListener('click', () => hideContextMenu());
  }

  function showContextMenu(x, y, items) {
    contextMenuEl.innerHTML = items.map(it =>
      `<div class="ctx-item" data-action="${it.action}" style="padding:7px 16px;cursor:pointer;${it.danger ? 'color:#d32f2f;' : ''}">${it.label}</div>`
    ).join('');
    contextMenuEl.style.left = x + 'px';
    contextMenuEl.style.top = y + 'px';
    contextMenuEl.style.display = 'block';
    contextMenuEl.querySelectorAll('.ctx-item').forEach(el => {
      el.addEventListener('click', () => {
        const action = el.dataset.action;
        hideContextMenu();
        const item = items.find(i => i.action === action);
        if (item && item.onClick) item.onClick();
      });
      el.addEventListener('mouseenter', () => el.style.background = '#f0f4ff');
      el.addEventListener('mouseleave', () => el.style.background = '');
    });
  }
  function hideContextMenu() { contextMenuEl.style.display = 'none'; }

  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left, sy = clientY - rect.top;
    const { zoom, panX, panY } = State.project.view;
    return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
  }

  /** 获取道路或边界线的采样点 */
  function getLineSamples(ent) {
    if (!ent || !ent.points) return [];
    if (ent.type === 'road') return State.getRoadSamples(ent);
    if (ent.curve === 'bezier') return State.sampleSpline(ent.points, CONFIG.splineSegments);
    return ent.points;
  }

  /** Shift 约束：将目标点吸附到水平/垂直/45°方向 */
  function constrainToAxis(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx < 0.5 && ady < 0.5) return to;
    const maxDim = Math.max(adx, ady);
    // 45°：|dx| 与 |dy| 接近
    if (Math.abs(adx - ady) < maxDim * 0.35) {
      const avg = (adx + ady) / 2;
      return { x: from.x + (dx >= 0 ? avg : -avg), y: from.y + (dy >= 0 ? avg : -avg) };
    }
    // 水平或垂直
    if (adx > ady) return { x: to.x, y: from.y };
    return { x: from.x, y: to.y };
  }

  function setTool(name) {
    cancelDrawing();
    exitEditMode();
    current = name;
    Renderer.setBoundaryVisible(name === 'boundary');
    canvas.style.cursor = name === 'pan' ? 'grab' :
      name === 'select' ? 'default' :
      name === 'eraser' ? 'cell' :
      name === 'block-clear' ? 'pointer' : 'crosshair';
    toolListeners.forEach(fn => fn(current));
    Renderer.render();
  }
  function getTool() { return current; }
  function getToolName() { return toolNames[current] || current; }
  function setOption(key, val) { options[key] = val; }
  function getOption(key) { return options[key]; }
  function onToolChange(fn) { toolListeners.push(fn); }
  function onCoords(fn) { coordListeners.push(fn); }
  function onZoom(fn) { zoomListeners.push(fn); }

  function cancelDrawing() {
    drawing = null; isDragging = false;
    vertexDrag = null; entityDrag = null; dragUndoRecorded = false;
    calibrateStart = null; dragStart = null;
    Renderer.setPreview(null);
    Renderer.setCalibrateLine(null);
    Renderer.render();
  }

  function exitEditMode() {
    if (editModeRoadId) {
      editModeRoadId = null;
      extendEnd = null;
      Renderer.setEditMode(null);
      Renderer.setGuideLine(null);
      Renderer.setPreview(null);
      Renderer.render();
    }
  }

  /* ── 鼠标按下 ──────────────────────────────────── */
  function onMouseDown(e) {
    mouseDownPos = { x: e.clientX, y: e.clientY };
    mouseDownTime = Date.now();
    hideContextMenu();

    if (e.button === 1 || (e.button === 0 && spacePan)) {
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY, panX: State.project.view.panX, panY: State.project.view.panY };
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    if (e.button === 2) {
      handleRightClick(e);
      return;
    }
    if (e.button !== 0) return;
    const w = toWorld(e.clientX, e.clientY);

    if (editModeRoadId) {
      handleEditModeClick(w, e);
      return;
    }

    switch (current) {
      case 'select': handleSelectDown(w); break;
      case 'pan':
        isDragging = true;
        dragStart = { x: e.clientX, y: e.clientY, panX: State.project.view.panX, panY: State.project.view.panY };
        canvas.style.cursor = 'grabbing';
        break;
      case 'district-rect':
        drawing = { type: 'district', category: options.landUseCode, name: options.districtName, start: w, points: [w, w, w, w] };
        isDragging = true;
        break;
      case 'calibrate':
        calibrateStart = w; isDragging = true;
        break;
      case 'eraser':
        eraserActive = true;
        eraseAt(w);
        break;
      case 'block-clear':
        clearBlockAt(w);
        break;
    }
  }

  /* ── 右键处理 ──────────────────────────────────── */
  function handleRightClick(e) {
    const w = toWorld(e.clientX, e.clientY);

    if (editModeRoadId) {
      const ent = State.getEntity(editModeRoadId);
      if (ent && ent.points) {
        for (let i = 0; i < ent.points.length; i++) {
          const p = ent.points[i];
          if (Math.hypot(w.x - p.x, w.y - p.y) * State.project.view.zoom < CONFIG.vertexHitRadius + 2) {
            if (ent.points.length <= 2) { alert('至少需要2个节点'); return; }
            State.recordUndo();
            ent.points.splice(i, 1);
            extendEnd = null;
            Renderer.setGuideLine(null);
            if (ent.type === 'road') State.trimTJunctions();
            refreshAdjacentBlocks(ent);
            Renderer.render();
            return;
          }
        }
      }
      exitEditMode();
      State.setSelected(null);
      Renderer.render();
      return;
    }

    const hit = hitTest(w);
    if (hit) {
      State.setSelected(hit.id);
      if (hit.type === 'road' || hit.type === 'boundary') {
        editModeRoadId = hit.id;
        Renderer.setEditMode(hit.id);
        Renderer.render();
      } else {
        const items = [
          { label: '删除', action: 'del', danger: true, onClick: () => { State.removeEntity(hit.id); Renderer.render(); } },
        ];
        if (hit.type === 'block' || hit.type === 'district') {
          items.unshift({ label: '更改用地分类…', action: 'cat', onClick: () => {
            const input = prompt('输入用地分类代码（如 R2、B1、G1）：', hit.category || 'R2');
            if (input) { State.updateEntity(hit.id, { category: input.trim() }); Renderer.render(); }
          }});
        }
        if (hit.type === 'annotation') {
          items.unshift({ label: '编辑文字…', action: 'text', onClick: () => {
            const text = prompt('标注文字：', hit.text || '');
            if (text !== null) { State.updateEntity(hit.id, { text }); Renderer.render(); }
          }});
        }
        showContextMenu(e.clientX, e.clientY, items);
      }
    } else {
      State.setSelected(null);
      Renderer.render();
    }
  }

  /* ── 编辑模式左键 ────────────────────────────────
     端点点击 → 进入延伸模式（start=向前追加, end=向后追加）
     延伸模式下点击空白 → 在对应端点插入节点
     中间节点点击 → 仅可拖拽 */
  function handleEditModeClick(w, e) {
    const ent = State.getEntity(editModeRoadId);
    if (!ent || !ent.points) { exitEditMode(); return; }
    const isRoad = ent.type === 'road';

    // 检查是否点击了现有节点
    let hitIdx = -1;
    for (let i = 0; i < ent.points.length; i++) {
      const p = ent.points[i];
      if (Math.hypot(w.x - p.x, w.y - p.y) * State.project.view.zoom < CONFIG.vertexHitRadius + 3) {
        hitIdx = i;
        break;
      }
    }

    if (hitIdx >= 0) {
      vertexDrag = { entityId: ent.id, pointIndex: hitIdx };
      if (hitIdx === 0) {
        extendEnd = 'start';
      } else if (hitIdx === ent.points.length - 1) {
        extendEnd = 'end';
      } else {
        extendEnd = null;
      }
      Renderer.setGuideLine(null);
      Renderer.render();
      return;
    }

    // 延伸模式：点击空白处添加节点到对应端点
    if (extendEnd !== null) {
      State.recordUndo();
      const endPoint = extendEnd === 'start' ? ent.points[0] : ent.points[ent.points.length - 1];
      const target = shiftPressed ? constrainToAxis(endPoint, w) : w;
      if (extendEnd === 'start') {
        ent.points.unshift({ x: target.x, y: target.y });
      } else {
        ent.points.push({ x: target.x, y: target.y });
      }
      if (isRoad) State.trimTJunctions();
      refreshAdjacentBlocks(ent);
      Renderer.setPreview(null);
      Renderer.render();
      return;
    }

    // 未在延伸模式且未点中节点：靠近线则忽略，远离则退出
    const mpp = State.project.meterPerPixel;
    const level = isRoad ? (CONFIG.roadLevels[ent.level] || CONFIG.roadLevels.local) : null;
    const threshold = level ? Math.max(level.width / mpp * 1.5, 30) : 20;
    const d = State.distToPolyline(w.x, w.y, getLineSamples(ent));
    if (d > threshold) {
      exitEditMode();
      State.setSelected(null);
      Renderer.render();
    }
  }

  function distToSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - a.x, py - a.y);
    let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  /* ── 鼠标移动 ──────────────────────────────────── */
  function onMouseMove(e) {
    const w = toWorld(e.clientX, e.clientY);
    coordListeners.forEach(fn => fn(w));

    // 橡皮擦拖拽
    if (eraserActive) { eraseAt(w); return; }

    if (isDragging && dragStart) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      State.setView({ panX: dragStart.panX + dx, panY: dragStart.panY + dy }, true);
      Renderer.scheduleRender();
      return;
    }

    if (vertexDrag) {
      if (!dragUndoRecorded) { State.recordUndo(); dragUndoRecorded = true; }
      const ent = State.getEntity(vertexDrag.entityId);
      if (ent && ent.points) {
        ent.points[vertexDrag.pointIndex] = { x: w.x, y: w.y };
        if (ent.type === 'road') State.trimTJunctions();
        Renderer.scheduleRender();
      }
      return;
    }

    // 延伸模式：预览（道路显示完整样式，边界显示细虚线）
    if (editModeRoadId && extendEnd !== null && !vertexDrag) {
      const ent = State.getEntity(editModeRoadId);
      if (ent && ent.points && ent.points.length >= 2) {
        let tempPts;
        if (extendEnd === 'start') {
          tempPts = [{ x: w.x, y: w.y }, ...ent.points];
        } else {
          tempPts = [...ent.points, { x: w.x, y: w.y }];
        }
        const sampled = State.sampleSpline(tempPts, CONFIG.splineSegments);
        const isRoad = ent.type === 'road';
        const level = isRoad ? (CONFIG.roadLevels[ent.level] || CONFIG.roadLevels.local) : null;
        const W = level ? level.width / State.project.meterPerPixel : 0;
        Renderer.setPreview((ctx, zoom) => {
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.globalAlpha = 0.7;
          if (isRoad) {
            if (level && level.edgeColor) {
              ctx.strokeStyle = level.edgeColor;
              ctx.lineWidth = W + level.edgeWidth * 2;
              strokePtsPreview(ctx, sampled);
            }
            if (level && level.centerType === 'red-dashed') {
              ctx.strokeStyle = level.centerColor;
              ctx.lineWidth = Math.max(0.3, level.centerWidth);
              ctx.setLineDash(CONFIG.redDashPattern);
              strokePtsPreview(ctx, sampled);
              ctx.setLineDash([]);
            }
          } else {
            ctx.strokeStyle = '#4a4a4a';
            ctx.lineWidth = Math.max(0.6, 1.0 / zoom);
            ctx.setLineDash([4, 3]);
            strokePtsPreview(ctx, sampled);
            ctx.setLineDash([]);
          }
          ctx.globalAlpha = 1;
        });
        Renderer.scheduleRender();
      }
      return;
    }

    if (entityDrag) {
      if (!dragUndoRecorded) { State.recordUndo(); dragUndoRecorded = true; }
      const ent = State.getEntity(entityDrag.entityId);
      if (ent && ent.points) {
        for (const p of ent.points) { p.x = w.x + entityDrag.offsetX; p.y = w.y + entityDrag.offsetY; }
        Renderer.scheduleRender();
      }
      return;
    }

    if (current === 'district-rect' && drawing && isDragging) {
      const s = drawing.start;
      drawing.points = [
        { x: s.x, y: s.y }, { x: w.x, y: s.y },
        { x: w.x, y: w.y }, { x: s.x, y: w.y },
      ];
      updatePreview();
      return;
    }

    if (current === 'calibrate' && calibrateStart && isDragging) {
      Renderer.setCalibrateLine({ x1: calibrateStart.x, y1: calibrateStart.y, x2: w.x, y2: w.y });
      Renderer.scheduleRender();
      return;
    }

    if ((current === 'road-bezier' || current === 'road-polyline' || current === 'road-ramp' || current === 'boundary' || current === 'district-polygon') && drawing) {
      if (shiftPressed && drawing.points.length > 0) {
        drawing.previewPoint = constrainToAxis(drawing.points[drawing.points.length - 1], w);
      } else {
        drawing.previewPoint = w;
      }
      updatePreview();
    }
  }

  /* ── 鼠标抬起 ──────────────────────────────────── */
  function onMouseUp(e) {
    if (eraserActive) { eraserActive = false; return; }
    if (isDragging && dragStart) {
      isDragging = false; dragStart = null;
      canvas.style.cursor = current === 'pan' ? 'grab' : (current === 'select' ? 'default' : 'crosshair');
      return;
    }
    if (vertexDrag) {
      const ent = State.getEntity(vertexDrag.entityId);
      vertexDrag = null; dragUndoRecorded = false;
      if (ent) refreshAdjacentBlocks(ent);
      Renderer.render();
      return;
    }
    if (entityDrag) { entityDrag = null; dragUndoRecorded = false; Renderer.render(); return; }

    const isClick = mouseDownPos &&
      Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y) < 5 &&
      Date.now() - mouseDownTime < 400;
    mouseDownPos = null;

    if (current === 'district-rect' && drawing) { finishRectDistrict(); return; }
    if (current === 'calibrate' && calibrateStart) { finishCalibrate(e); return; }
    if (isClick && e.button === 0) handleClick(e);
    isDragging = false;
  }

  function onMouseLeave() {
    if (isDragging && dragStart) { isDragging = false; dragStart = null; }
    vertexDrag = null; entityDrag = null; dragUndoRecorded = false;
  }

  /* ── 左键单击 ──────────────────────────────────── */
  function handleClick(e) {
    const w = toWorld(e.clientX, e.clientY);

    if (current === 'road-bezier' || current === 'road-polyline' || current === 'road-ramp' || current === 'boundary') {
      const level = current === 'road-ramp' ? 'ramp' : options.roadLevel;
      const curve = (current === 'road-bezier' || current === 'road-ramp' || current === 'boundary') ? 'bezier' : 'polyline';
      const type = current === 'boundary' ? 'boundary' : 'road';
      if (!drawing) {
        drawing = { type, level, curve, name: options.roadName, points: [{ x: w.x, y: w.y }], previewPoint: w };
      } else {
        const last = drawing.points[drawing.points.length - 1];
        const target = shiftPressed ? constrainToAxis(last, w) : w;
        if (Math.hypot(target.x - last.x, target.y - last.y) > 1) drawing.points.push({ x: target.x, y: target.y });
      }
      updatePreview();
    } else if (current === 'district-polygon') {
      if (!drawing) {
        drawing = { type: 'district', category: options.landUseCode, name: options.districtName, points: [{ x: w.x, y: w.y }], previewPoint: w };
      } else {
        const first = drawing.points[0];
        if (drawing.points.length >= 3 && Math.hypot(w.x - first.x, w.y - first.y) * State.project.view.zoom < CONFIG.vertexHitRadius) {
          finishPolygonDistrict(); return;
        }
        const last = drawing.points[drawing.points.length - 1];
        if (Math.hypot(w.x - last.x, w.y - last.y) > 1) drawing.points.push({ x: w.x, y: w.y });
      }
      updatePreview();
    } else if (current === 'block-fill') {
      fillBlockAt(w.x, w.y);
    } else if (current === 'annotation') {
      const text = options.annotationText || prompt('请输入标注文字：', '标注');
      if (text) {
        State.addEntity({ type: 'annotation', x: w.x, y: w.y, text, fontSize: options.annotationSize, color: '#1a1a1a', align: 'left' });
      }
    }
  }

  /* ── 回车完成绘制 ──────────────────────────────── */
  function finishByEnter() {
    if (!drawing) return;
    if (drawing.type === 'road' && drawing.points.length >= 2) {
      finishRoad();
    } else if (drawing.type === 'boundary' && drawing.points.length >= 2) {
      finishBoundary();
    } else if (drawing.type === 'district' && drawing.points.length >= 3) {
      finishPolygonDistrict();
    } else {
      cancelDrawing();
      Renderer.render();
    }
  }

  function finishRoad() {
    if (!drawing || drawing.points.length < 2) { drawing = null; Renderer.setPreview(null); Renderer.render(); return; }
    const newRoad = State.addEntity({ type: 'road', level: drawing.level, curve: drawing.curve, name: drawing.name, points: drawing.points.map(p => ({ x: p.x, y: p.y })) });
    drawing = null;
    Renderer.setPreview(null);
    State.trimTJunctions();
    // 新道路穿过街区时自动拆分（类似划边界的拆分功能）
    const roadSamples = State.getRoadSamples(newRoad);
    const splitCount = splitIntersectedBlocks(roadSamples);
    // 同时刷新相邻但未被穿过的街区
    refreshAdjacentBlocks(newRoad);
    if (splitCount > 0) showToast(`道路已拆分 ${splitCount} 个街区`);
    Renderer.render();
  }

  function finishBoundary() {
    if (!drawing || drawing.points.length < 2) { drawing = null; Renderer.setPreview(null); Renderer.render(); return; }
    State.recordUndo();
    const pts = drawing.points.map(p => ({ x: p.x, y: p.y }));
    const curve = drawing.curve;
    // 创建持久边界线
    State.addEntity({ type: 'boundary', curve, points: pts });

    // 用共享函数拆分被边界线穿过的街区
    const curvePts = curve === 'bezier' ? State.sampleSpline(pts, CONFIG.splineSegments) : pts;
    const splitCount = splitIntersectedBlocks(curvePts);
    // 刷新相邻街区
    const boundaryEntity = State.project.entities[State.project.entities.length - 1];
    refreshAdjacentBlocks(boundaryEntity);

    if (splitCount > 0) showToast(`已拆分 ${splitCount} 个街区`);
    drawing = null;
    Renderer.setPreview(null);
    Renderer.render();
  }

  function finishPolygonDistrict() {
    if (!drawing || drawing.points.length < 3) { drawing = null; Renderer.setPreview(null); Renderer.render(); return; }
    State.addEntity({ type: 'district', category: drawing.category, name: drawing.name, points: drawing.points.map(p => ({ x: p.x, y: p.y })) });
    drawing = null;
    Renderer.setPreview(null);
  }

  function finishRectDistrict() {
    if (!drawing || drawing.points.length < 3) { drawing = null; Renderer.setPreview(null); Renderer.render(); return; }
    const s = drawing.points[0], ep = drawing.points[2];
    if (Math.abs(ep.x - s.x) < 2 || Math.abs(ep.y - s.y) < 2) { drawing = null; Renderer.setPreview(null); Renderer.render(); return; }
    State.addEntity({ type: 'district', category: drawing.category, name: drawing.name, points: drawing.points.map(p => ({ x: p.x, y: p.y })) });
    drawing = null;
    Renderer.setPreview(null);
  }

  function finishCalibrate(e) {
    if (!calibrateStart) return;
    const w = toWorld(e.clientX, e.clientY);
    const pxLen = Math.hypot(w.x - calibrateStart.x, w.y - calibrateStart.y);
    Renderer.setCalibrateLine(null);
    calibrateStart = null; isDragging = false;
    if (pxLen < 5) return;
    const input = prompt(`该线段图上长度 ${pxLen.toFixed(1)} 像素。\n请输入实际长度（米）：`, '500');
    if (input === null) return;
    const meters = parseFloat(input);
    if (!meters || meters <= 0) { alert('请输入有效的正数'); return; }
    State.setProjectMeta({ meterPerPixel: meters / pxLen });
    alert(`比例尺已校准：1 像素 = ${(meters / pxLen).toFixed(3)} 米`);
    setTool('select');
  }

  /* ══════════════════════════════════════════════════
     智能填充街区
     ══════════════════════════════════════════════════ */
  function fillBlockAt(worldX, worldY) {
    const roads = State.project.entities.filter(e => e.type === 'road' && e.points && e.points.length >= 2);
    if (roads.length === 0) { alert('请先绘制道路，再使用街区填充。'); return; }

    // 街区认领：点击点已在现有街区内 → 直接更改其用途，不重复创建
    const existingBlocks = State.project.entities.filter(e => e.type === 'block' && e.points);
    for (const blk of existingBlocks) {
      if (State.pointInPolygon(worldX, worldY, blk.points)) {
        State.recordUndo();
        State.updateEntity(blk.id, { category: options.landUseCode });
        Renderer.render();
        return;
      }
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of roads) {
      const pts = State.getRoadSamples(r);
      const mpp = State.project.meterPerPixel;
      const level = CONFIG.roadLevels[r.level] || CONFIG.roadLevels.local;
      const halfW = level.width / mpp / 2 + 6;
      for (const p of pts) {
        minX = Math.min(minX, p.x - halfW); maxX = Math.max(maxX, p.x + halfW);
        minY = Math.min(minY, p.y - halfW); maxY = Math.max(maxY, p.y + halfW);
      }
    }
    const pad = 80;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const scale = 4;
    const ow = Math.ceil((maxX - minX) * scale);
    const oh = Math.ceil((maxY - minY) * scale);
    if (ow > 10000 || oh > 10000) { alert('区域过大，请缩小视图后再试。'); return; }

    const off = document.createElement('canvas');
    off.width = ow; off.height = oh;
    const octx = off.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, ow, oh);
    octx.scale(scale, scale);
    octx.translate(-minX, -minY);
    octx.lineCap = 'round';
    octx.lineJoin = 'round';
    for (const r of roads) {
      const pts = State.getRoadSamples(r);
      const mpp = State.project.meterPerPixel;
      const level = CONFIG.roadLevels[r.level] || CONFIG.roadLevels.local;
      const w = level.width / mpp + (level.edgeWidth || 0) * 2 + 2;
      octx.strokeStyle = '#000000';
      octx.lineWidth = w;
      octx.beginPath();
      octx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
      octx.stroke();
    }
    // 街区边界线也作为围合屏障（极窄，几乎无空隙）
    const boundaries = State.project.entities.filter(e => e.type === 'boundary' && e.points && e.points.length >= 2);
    for (const b of boundaries) {
      const pts = b.curve === 'bezier' ? State.sampleSpline(b.points, CONFIG.splineSegments) : b.points;
      octx.strokeStyle = '#000000';
      octx.lineWidth = 1;
      octx.beginPath();
      octx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
      octx.stroke();
    }

    const seedX = (worldX - minX) * scale;
    const seedY = (worldY - minY) * scale;
    const result = State.floodFillContour(octx, seedX, seedY);
    if (result.leaked) { alert('该区域未被道路完全围合，无法填充。请检查道路是否闭合。'); return; }
    if (result.points.length < 6) { alert('未检测到有效的街区区域。'); return; }

    const worldPts = result.points.map(([px, py]) => ({ x: px / scale + minX, y: py / scale + minY }));
    const simplified = State.simplifyDP(worldPts, 0.5 / scale);
    if (simplified.length < 3) { alert('区域过小。'); return; }

    // 二次认领：新街区质心若落在现有街区内则跳过（防御性检查）
    const center = State.polygonCenter(simplified);
    for (const blk of existingBlocks) {
      if (State.pointInPolygon(center.x, center.y, blk.points)) {
        State.recordUndo();
        State.updateEntity(blk.id, { category: options.landUseCode });
        Renderer.render();
        return;
      }
    }
    State.addEntity({ type: 'block', category: options.landUseCode, name: options.districtName, points: simplified });
    Renderer.render();
  }

  /* ── 预览绘制 ──────────────────────────────────── */
  function updatePreview() {
    if (!drawing) { Renderer.setPreview(null); Renderer.scheduleRender(); return; }
    Renderer.setPreview((ctx, zoom) => {
      if (drawing.type === 'road' || drawing.type === 'boundary') {
        const pts = drawing.curve === 'bezier' ? State.sampleSpline(drawing.points, CONFIG.splineSegments) : drawing.points;
        const isBoundary = drawing.type === 'boundary';
        const level = CONFIG.roadLevels[drawing.level] || CONFIG.roadLevels.local;
        const W = level.width / State.project.meterPerPixel;
        if (isBoundary) {
          ctx.strokeStyle = '#4a4a4a';
          ctx.globalAlpha = 0.8;
          ctx.lineWidth = Math.max(0.6, 1.0 / zoom);
          ctx.setLineDash([4, 3]);
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          strokePreview(ctx, pts, drawing.previewPoint);
          ctx.setLineDash([]);
        } else {
          if (level.edgeColor) {
            ctx.strokeStyle = level.edgeColor;
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = W + (level.edgeWidth || 0) * 2;
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            strokePreview(ctx, pts, drawing.previewPoint);
          }
          if (level.centerType === 'red-dashed') {
            ctx.strokeStyle = level.centerColor;
            ctx.globalAlpha = 0.7;
            ctx.lineWidth = Math.max(0.3, level.centerWidth || 0.5);
            ctx.setLineDash(CONFIG.redDashPattern);
            strokePreview(ctx, pts, drawing.previewPoint);
            ctx.setLineDash([]);
          }
        }
        ctx.globalAlpha = 1;
        for (const p of drawing.points) {
          ctx.fillStyle = isBoundary ? '#4a4a4a' : '#ff6b35';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5 / zoom, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (drawing.type === 'district') {
        const cat = getLandUseByCode(drawing.category) || { color: '#ccc' };
        ctx.beginPath();
        ctx.moveTo(drawing.points[0].x, drawing.points[0].y);
        for (let i = 1; i < drawing.points.length; i++) ctx.lineTo(drawing.points[i].x, drawing.points[i].y);
        if (drawing.previewPoint) ctx.lineTo(drawing.previewPoint.x, drawing.previewPoint.y);
        if (drawing.points.length >= 3) ctx.closePath();
        ctx.fillStyle = cat.color;
        ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;
        // 无蓝色虚线边框，仅用细实线提示
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 0.8 / zoom;
        ctx.stroke();
        for (const p of drawing.points) {
          ctx.fillStyle = '#ff6b35';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5 / zoom, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    Renderer.scheduleRender();
  }

  function strokePreview(ctx, pts, previewPoint) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (previewPoint) ctx.lineTo(previewPoint.x, previewPoint.y);
    ctx.stroke();
  }

  function strokePtsPreview(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  /* ── 选择工具 ──────────────────────────────────── */
  function handleSelectDown(w) {
    dragUndoRecorded = false;
    const sel = State.getSelected();
    // 街区不可直接编辑形状：跳过顶点拖拽
    if (sel && sel.points && !editModeRoadId && sel.type !== 'block') {
      for (let i = 0; i < sel.points.length; i++) {
        const p = sel.points[i];
        if (Math.hypot(w.x - p.x, w.y - p.y) * State.project.view.zoom < CONFIG.vertexHitRadius) {
          vertexDrag = { entityId: sel.id, pointIndex: i };
          return;
        }
      }
    }
    const hit = hitTest(w);
    if (hit) {
      State.setSelected(hit.id);
      // 街区不可拖拽移动；道路/边界/片区/标注可拖拽
      if (hit.points && hit.points.length > 0 && !editModeRoadId && hit.type !== 'block') {
        entityDrag = { entityId: hit.id, offsetX: hit.points[0].x - w.x, offsetY: hit.points[0].y - w.y };
      }
    } else {
      State.setSelected(null);
    }
  }

  function hitTest(w) {
    const zoom = State.project.view.zoom;
    const entities = State.project.entities;
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      const layer = State.entityLayer(e);
      if (!State.isLayerVisible(layer)) continue;
      if ((e.type === 'district' || e.type === 'block') && e.points && e.points.length >= 3) {
        if (State.pointInPolygon(w.x, w.y, e.points)) return e;
      } else if (e.type === 'road' && e.points && e.points.length >= 2) {
        const pts = State.getRoadSamples(e);
        const level = CONFIG.roadLevels[e.level] || CONFIG.roadLevels.local;
        const width = level.width / State.project.meterPerPixel;
        const tol = Math.max(width / 2, CONFIG.roadHitTolerance / zoom);
        if (State.distToPolyline(w.x, w.y, pts) < tol) return e;
      } else if (e.type === 'boundary' && e.points && e.points.length >= 2) {
        const pts = getLineSamples(e);
        if (State.distToPolyline(w.x, w.y, pts) < CONFIG.roadHitTolerance / zoom) return e;
      } else if (e.type === 'annotation') {
        if (Math.hypot(w.x - e.x, w.y - e.y) < 20 / zoom) return e;
      }
    }
    return null;
  }

  /* ── 键盘 ──────────────────────────────────────── */
  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === 'Shift') { shiftPressed = true; return; }
    if (e.code === 'Space') { spacePan = true; e.preventDefault(); return; }
    if (e.key === 'Enter') {
      if (drawing) { e.preventDefault(); finishByEnter(); return; }
      if (editModeRoadId && extendEnd !== null) {
        // 退出延伸模式，保持编辑模式
        e.preventDefault();
        extendEnd = null;
        Renderer.setGuideLine(null);
        Renderer.setPreview(null);
        Renderer.render();
        return;
      }
      if (editModeRoadId) { e.preventDefault(); exitEditMode(); State.setSelected(null); Renderer.render(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault(); State.undo(); Renderer.render(); return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault(); State.redo(); Renderer.render(); return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const sel = State.getSelected();
      if (sel) { e.preventDefault(); State.removeEntity(sel.id); exitEditMode(); Renderer.render(); }
      return;
    }
    if (e.key === 'Escape') { cancelDrawing(); exitEditMode(); State.setSelected(null); Renderer.render(); return; }
    const keyMap = { v: 'select', h: 'pan', b: 'road-bezier', l: 'road-polyline', m: 'road-ramp', f: 'block-fill', k: 'boundary', e: 'eraser', p: 'district-polygon', r: 'district-rect', t: 'annotation', c: 'calibrate' };
    if (keyMap[e.key]) setTool(keyMap[e.key]);
  }

  function onKeyUp(e) {
    if (e.key === 'Shift') { shiftPressed = false; return; }
    if (e.code === 'Space') spacePan = false;
  }

  /* ── 滚轮缩放 ──────────────────────────────────── */
  function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const view = State.project.view;
    const wx = (sx - view.panX) / view.zoom, wy = (sy - view.panY) / view.zoom;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, view.zoom * factor));
    State.setView({ zoom: newZoom, panX: sx - wx * newZoom, panY: sy - wy * newZoom }, true);
    Renderer.scheduleRender();
    zoomListeners.forEach(fn => fn(newZoom));
  }

  function deleteSelected() {
    const sel = State.getSelected();
    if (sel) { State.removeEntity(sel.id); exitEditMode(); Renderer.render(); }
  }

  /* ── 橡皮擦：擦除节点，拆分道路/边界，删除关联街区 ── */
  function eraseAt(w) {
    const zoom = State.project.view.zoom;
    const hitR = CONFIG.vertexHitRadius / zoom;
    let erased = false;

    // 收集所有可擦除的线实体（道路+边界）
    const lineEntities = State.project.entities.filter(e =>
      (e.type === 'road' || e.type === 'boundary') && e.points && e.points.length >= 2);

    for (const ent of lineEntities) {
      for (let i = 0; i < ent.points.length; i++) {
        const p = ent.points[i];
        if (Math.hypot(w.x - p.x, w.y - p.y) < hitR) {
          State.recordUndo();
          splitOrRemoveNode(ent, i);
          erased = true;
          break;
        }
      }
      if (erased) break;
    }
    if (erased) {
      State.trimTJunctions();
      Renderer.render();
    }
  }

  /** 从线实体中移除节点：端点直接删，内部节点拆分为两段 */
  function splitOrRemoveNode(ent, idx) {
    const pts = ent.points;
    if (pts.length <= 2) {
      // 不足3个节点，删除整个实体并清除关联街区
      removeEntityAndBlocks(ent);
      return;
    }
    if (idx === 0 || idx === pts.length - 1) {
      // 端点：直接删除
      pts.splice(idx, 1);
      removeBlocksAdjacentTo(ent);
    } else {
      // 内部节点：拆分为两段
      const leftPts = pts.slice(0, idx);
      const rightPts = pts.slice(idx + 1);
      State.removeEntity(ent.id);
      removeBlocksAdjacentTo(ent);
      if (leftPts.length >= 2) {
        State.addEntity({ type: ent.type, level: ent.level, name: ent.name, curve: ent.curve, points: leftPts });
      }
      if (rightPts.length >= 2) {
        State.addEntity({ type: ent.type, level: ent.level, name: ent.name, curve: ent.curve, points: rightPts });
      }
    }
  }

  /** 删除实体及与其相邻的所有街区 */
  function removeEntityAndBlocks(ent) {
    removeBlocksAdjacentTo(ent);
    State.removeEntity(ent.id);
  }

  /** 删除与指定线实体相邻的街区 */
  function removeBlocksAdjacentTo(lineEnt) {
    if (!lineEnt.points) return;
    const samples = lineEnt.type === 'road' ? State.getRoadSamples(lineEnt) :
      (lineEnt.curve === 'bezier' ? State.sampleSpline(lineEnt.points, CONFIG.splineSegments) : lineEnt.points);
    const blocks = State.project.entities.filter(e => e.type === 'block' && e.points);
    for (const blk of blocks) {
      // 只要线的任意采样点在街区内，或街区任意顶点在线附近，视为相邻
      let adjacent = false;
      for (const sp of samples) {
        if (State.pointInPolygon(sp.x, sp.y, blk.points)) { adjacent = true; break; }
      }
      if (!adjacent) {
        for (const bp of blk.points) {
          if (State.distToPolyline(bp.x, bp.y, samples) < 5) { adjacent = true; break; }
        }
      }
      if (adjacent) State.removeEntity(blk.id);
    }
  }

  /* ── 街区清除器：点击删除指定街区 ── */
  function clearBlockAt(w) {
    const blocks = State.project.entities.filter(e => e.type === 'block' && e.points);
    for (const blk of blocks) {
      if (State.pointInPolygon(w.x, w.y, blk.points)) {
        State.recordUndo();
        State.removeEntity(blk.id);
        Renderer.render();
        return;
      }
    }
  }

  /* ── Toast 通知 ─────────────────────────────────── */
  let toastTimer = null;
  function showToast(msg, duration) {
    duration = duration || 2500;
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  /* ── 编辑后自动刷新相邻街区 ────────────────────────
     街区完全随道路/边界变动：删除所有相邻街区→从原质心重新填充（保留名称和类型）
     填充失败则永久删除。相邻判定：线采样点在街区内 OR 街区顶点靠近线 */
  function refreshAdjacentBlocks(entity) {
    if (!entity || !entity.points) return;
    const samples = getLineSamples(entity);
    const blocks = State.project.entities.filter(e => e.type === 'block' && e.points);
    const mpp = State.project.meterPerPixel;
    let threshold = 30;
    if (entity.type === 'road') {
      const level = CONFIG.roadLevels[entity.level] || CONFIG.roadLevels.local;
      threshold = level.width / mpp / 2 + 25;
    }

    const affected = [];
    for (const blk of blocks) {
      let adjacent = false;
      for (const sp of samples) {
        if (State.pointInPolygon(sp.x, sp.y, blk.points)) { adjacent = true; break; }
      }
      if (!adjacent) {
        for (const bp of blk.points) {
          if (State.distToPolyline(bp.x, bp.y, samples) < threshold) { adjacent = true; break; }
        }
      }
      if (adjacent) affected.push(blk);
    }
    if (affected.length === 0) return;

    // 记录信息后全部删除
    const toRefill = affected.map(blk => ({
      category: blk.category,
      name: blk.name,
      center: State.polygonCenter(blk.points),
    }));
    for (const blk of affected) State.removeEntity(blk.id, true);

    // 逐个重新填充
    let refreshed = 0, removed = 0;
    for (const info of toRefill) {
      // 街区认领：质心已在新创建的街区内则跳过
      const currentBlocks = State.project.entities.filter(e => e.type === 'block' && e.points);
      let claimed = false;
      for (const blk of currentBlocks) {
        if (State.pointInPolygon(info.center.x, info.center.y, blk.points)) { claimed = true; break; }
      }
      if (claimed) { refreshed++; continue; }

      const newPts = tryRefillAtWithFallback(info.center.x, info.center.y);
      if (newPts && newPts.length >= 3) {
        State.addEntity({ type: 'block', category: info.category, name: info.name, points: newPts }, true);
        refreshed++;
      } else {
        removed++;
      }
    }
    if (refreshed > 0) showToast(`已自动刷新 ${refreshed} 个街区`);
    if (removed > 0) showToast(`${removed} 个街区因边界变动已清除`, 3500);
  }

  /** 尝试在指定点重新洪水填充，返回轮廓点或 null（高精度版） */
  function tryRefillAt(wx, wy) {
    const roads = State.project.entities.filter(e => e.type === 'road' && e.points && e.points.length >= 2);
    const boundaries = State.project.entities.filter(e => e.type === 'boundary' && e.points && e.points.length >= 2);
    if (roads.length === 0 && boundaries.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const allLines = [...roads, ...boundaries];
    for (const r of allLines) {
      const pts = getLineSamples(r);
      const mpp = State.project.meterPerPixel;
      const halfW = r.type === 'road' ?
        (CONFIG.roadLevels[r.level] || CONFIG.roadLevels.local).width / mpp / 2 + 6 : 3;
      for (const p of pts) {
        minX = Math.min(minX, p.x - halfW); maxX = Math.max(maxX, p.x + halfW);
        minY = Math.min(minY, p.y - halfW); maxY = Math.max(maxY, p.y + halfW);
      }
    }
    const pad = 80; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const scale = 4;
    const ow = Math.ceil((maxX - minX) * scale), oh = Math.ceil((maxY - minY) * scale);
    if (ow > 10000 || oh > 10000) return null;

    const off = document.createElement('canvas');
    off.width = ow; off.height = oh;
    const octx = off.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, ow, oh);
    octx.scale(scale, scale);
    octx.translate(-minX, -minY);
    octx.lineCap = 'round'; octx.lineJoin = 'round';
    for (const r of roads) {
      const pts = State.getRoadSamples(r);
      const mpp = State.project.meterPerPixel;
      const level = CONFIG.roadLevels[r.level] || CONFIG.roadLevels.local;
      octx.strokeStyle = '#000';
      octx.lineWidth = level.width / mpp + (level.edgeWidth || 0) * 2 + 2;
      octx.beginPath(); octx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
      octx.stroke();
    }
    for (const b of boundaries) {
      const pts = getLineSamples(b);
      octx.strokeStyle = '#000';
      octx.lineWidth = 1;
      octx.beginPath(); octx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
      octx.stroke();
    }
    const seedX = (wx - minX) * scale, seedY = (wy - minY) * scale;
    const result = State.floodFillContour(octx, seedX, seedY);
    if (result.leaked || result.points.length < 6) return null;
    const worldPts = result.points.map(([px, py]) => ({ x: px / scale + minX, y: py / scale + minY }));
    return State.simplifyDP(worldPts, 0.5 / scale);
  }

  /** 带 fallback 的重填充：原点失败时尝试周围8个偏移点 */
  function tryRefillAtWithFallback(wx, wy) {
    let pts = tryRefillAt(wx, wy);
    if (pts && pts.length >= 3) return pts;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      pts = tryRefillAt(wx + Math.cos(angle) * 35, wy + Math.sin(angle) * 35);
      if (pts && pts.length >= 3) return pts;
    }
    return null;
  }

  /** 用线（道路/边界）拆分被穿过的街区：删除原街区→从两侧分别洪水填充 */
  function splitIntersectedBlocks(lineSamples) {
    if (!lineSamples || lineSamples.length < 2) return 0;
    const blocks = State.project.entities.filter(e => e.type === 'block' && e.points && e.points.length >= 3);
    let splitCount = 0;
    for (const block of blocks) {
      let intersects = false;
      for (const cp of lineSamples) {
        if (State.pointInPolygon(cp.x, cp.y, block.points)) { intersects = true; break; }
      }
      if (!intersects) continue;

      const category = block.category;
      const name = block.name;
      const center = State.polygonCenter(block.points);

      // 计算线中点处的法向，找对侧种子点
      const midIdx = Math.floor(lineSamples.length / 2);
      const mid = lineSamples[midIdx];
      const prev = lineSamples[Math.max(0, midIdx - 2)];
      const next = lineSamples[Math.min(lineSamples.length - 1, midIdx + 2)];
      const tx = next.x - prev.x, ty = next.y - prev.y;
      const tlen = Math.hypot(tx, ty) || 1;
      const nx = -ty / tlen, ny = tx / tlen;
      const side = (center.x - mid.x) * nx + (center.y - mid.y) * ny;
      const offset = 35;
      const otherSeed = {
        x: mid.x + nx * offset * (side >= 0 ? -1 : 1),
        y: mid.y + ny * offset * (side >= 0 ? -1 : 1),
      };

      State.removeEntity(block.id, true);

      // 从原质心填充一侧
      const newPts1 = tryRefillAtWithFallback(center.x, center.y);
      if (newPts1 && newPts1.length >= 3) {
        State.addEntity({ type: 'block', category, name, points: newPts1 }, true);
      }
      // 从对侧种子点填充另一侧
      const newPts2 = tryRefillAtWithFallback(otherSeed.x, otherSeed.y);
      if (newPts2 && newPts2.length >= 3) {
        const c2 = State.polygonCenter(newPts2);
        const currentBlocks = State.project.entities.filter(e => e.type === 'block' && e.points);
        let alreadyExists = false;
        for (const blk of currentBlocks) {
          if (State.pointInPolygon(c2.x, c2.y, blk.points)) { alreadyExists = true; break; }
        }
        if (!alreadyExists) {
          State.addEntity({ type: 'block', category, name, points: newPts2 }, true);
        }
      }
      splitCount++;
    }
    return splitCount;
  }

  return {
    init, setTool, getTool, getToolName, setOption, getOption,
    onToolChange, onCoords, onZoom, cancelDrawing, deleteSelected, toWorld,
  };
})();
