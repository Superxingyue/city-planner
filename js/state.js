/**
 * state.js — 工程状态管理 + 几何工具
 */
'use strict';

const State = (function () {
  let project = createNewProject();
  let layerVisibility = {};
  let undoStack = [];
  let redoStack = [];
  let selectedId = null;
  let listeners = [];
  let basemapImage = null;
  let plotCounter = 0;

  function createNewProject() {
    return {
      name: '未命名城市',
      scale: CONFIG.defaultScale,
      meterPerPixel: CONFIG.defaultMeterPerPixel,
      basemap: { dataUrl: null, opacity: 0.4, x: 0, y: 0, scale: 1, rotation: 0 },
      view: { zoom: 1, panX: 60, panY: 40 },
      entities: [],
      nextId: 1,
    };
  }

  CONFIG.layers.forEach(l => { layerVisibility[l.id] = true; });

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(fn => fn()); }

  function snapshot() {
    return {
      name: project.name, scale: project.scale, meterPerPixel: project.meterPerPixel,
      basemap: { ...project.basemap },
      entities: JSON.parse(JSON.stringify(project.entities)),
      nextId: project.nextId, plotCounter,
    };
  }
  function restore(snap) {
    project.name = snap.name; project.scale = snap.scale;
    project.meterPerPixel = snap.meterPerPixel;
    project.basemap = { ...snap.basemap };
    project.entities = JSON.parse(JSON.stringify(snap.entities));
    project.nextId = snap.nextId;
    plotCounter = snap.plotCounter || 0;
  }
  function recordUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > CONFIG.maxUndo) undoStack.shift();
    redoStack = [];
  }
  function undo() {
    if (undoStack.length === 0) return false;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    selectedId = null; emit(); return true;
  }
  function redo() {
    if (redoStack.length === 0) return false;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    selectedId = null; emit(); return true;
  }
  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  function genId() { return 'e' + (project.nextId++); }
  function nextPlotNumber() { return ++plotCounter; }

  function addEntity(entity, skipUndo) {
    if (!skipUndo) recordUndo();
    if (!entity.id) entity.id = genId();
    if (entity.type === 'block' && !entity.plotNumber) entity.plotNumber = nextPlotNumber();
    project.entities.push(entity);
    emit();
    return entity;
  }
  function updateEntity(id, patch, skipUndo) {
    if (!skipUndo) recordUndo();
    const e = project.entities.find(x => x.id === id);
    if (e) Object.assign(e, patch);
    emit(); return e;
  }
  function removeEntity(id, skipUndo) {
    if (!skipUndo) recordUndo();
    project.entities = project.entities.filter(x => x.id !== id);
    if (selectedId === id) selectedId = null;
    emit();
  }
  function getEntity(id) { return project.entities.find(x => x.id === id) || null; }
  function getSelected() { return selectedId ? getEntity(selectedId) : null; }
  function setSelected(id) { selectedId = id; emit(); }

  function isLayerVisible(layerId) { return !!layerVisibility[layerId]; }
  function setLayerVisible(layerId, visible) { layerVisibility[layerId] = visible; emit(); }
  function entityLayer(entity) {
    if (entity.type === 'road' || entity.type === 'boundary') return 'roads';
    if (entity.type === 'district' || entity.type === 'block') return 'landuse';
    if (entity.type === 'annotation') return 'annotations';
    if (entity.type === 'water') return 'water';
    return null;
  }

  function setView(patch, silent) { Object.assign(project.view, patch); if (!silent) emit(); }
  function setBasemap(patch, skipUndo) {
    if (!skipUndo) recordUndo();
    Object.assign(project.basemap, patch); emit();
  }
  function setBasemapImage(img) { basemapImage = img; }
  function getBasemapImage() { return basemapImage; }
  function setProjectMeta(patch, skipUndo) {
    if (!skipUndo) recordUndo();
    Object.assign(project, patch); emit();
  }
  function newProject() {
    recordUndo();
    project = createNewProject();
    CONFIG.layers.forEach(l => { layerVisibility[l.id] = true; });
    selectedId = null; basemapImage = null; plotCounter = 0; emit();
  }
  function loadProject(data) {
    recordUndo();
    project = createNewProject();
    Object.assign(project, data);
    if (!project.view) project.view = { zoom: 1, panX: 60, panY: 40 };
    if (!project.basemap) project.basemap = { dataUrl: null, opacity: 0.4, x: 0, y: 0, scale: 1, rotation: 0 };
    if (!Array.isArray(project.entities)) project.entities = [];
    if (!project.nextId) project.nextId = project.entities.length + 1;
    plotCounter = data.plotCounter || 0;
    selectedId = null; basemapImage = null; emit();
  }
  function exportProject() {
    const d = JSON.parse(JSON.stringify(project));
    d.plotCounter = plotCounter;
    return d;
  }

  function getBBox(entity) {
    if (!entity || !entity.points || entity.points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of entity.points) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function polygonCenter(points) {
    if (!points || points.length < 3) {
      if (!points || points.length === 0) return { x: 0, y: 0 };
      let sx = 0, sy = 0;
      for (const p of points) { sx += p.x; sy += p.y; }
      return { x: sx / points.length, y: sy / points.length };
    }
    let area = 0, cx = 0, cy = 0;
    for (let i = 0; i < points.length; i++) {
      const p0 = points[i], p1 = points[(i + 1) % points.length];
      const cross = p0.x * p1.y - p1.x * p0.y;
      area += cross;
      cx += (p0.x + p1.x) * cross;
      cy += (p0.y + p1.y) * cross;
    }
    area *= 0.5;
    if (Math.abs(area) < 1e-10) {
      let sx = 0, sy = 0;
      for (const p of points) { sx += p.x; sy += p.y; }
      return { x: sx / points.length, y: sy / points.length };
    }
    cx /= (6 * area);
    cy /= (6 * area);
    return { x: cx, y: cy };
  }

  function polygonArea(points) {
    if (!points || points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const p0 = points[i], p1 = points[(i + 1) % points.length];
      area += p0.x * p1.y - p1.x * p0.y;
    }
    return area * 0.5;
  }

  function pointInPolygon(px, py, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
        inside = !inside;
    }
    return inside;
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function distToPolyline(px, py, points) {
    let min = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      const d = distToSegment(px, py, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
      if (d < min) min = d;
    }
    return min;
  }

  function smoothChaikin(points, iterations) {
    if (points.length < 3) return points.slice();
    let pts = points.slice();
    for (let it = 0; it < iterations; it++) {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        out.push({ x: 0.75 * pts[i].x + 0.25 * pts[i + 1].x, y: 0.75 * pts[i].y + 0.25 * pts[i + 1].y });
        out.push({ x: 0.25 * pts[i].x + 0.75 * pts[i + 1].x, y: 0.25 * pts[i].y + 0.75 * pts[i + 1].y });
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }

  function smoothChaikinClosed(points, iterations) {
    if (points.length < 4) return points.slice();
    let pts = points.slice();
    if (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) {
      pts.pop();
    }
    const n = pts.length;
    if (n < 3) return points.slice();
    for (let it = 0; it < iterations; it++) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const p0 = pts[i];
        const p1 = pts[(i + 1) % n];
        out.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y });
        out.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y });
      }
      pts = out;
    }
    pts.push({ x: pts[0].x, y: pts[0].y });
    return pts;
  }

  function sampleSpline(anchors, segmentsPerSpan) {
    if (anchors.length < 2) return anchors.slice();
    if (anchors.length === 2) return anchors.slice();
    const pts = [anchors[0], ...anchors, anchors[anchors.length - 1]];
    const result = [];
    const seg = segmentsPerSpan || CONFIG.splineSegments;
    for (let i = 0; i < pts.length - 3; i++) {
      const p0 = pts[i], p1 = pts[i + 1], p2 = pts[i + 2], p3 = pts[i + 3];
      for (let t = 0; t < seg; t++) {
        const s = t / seg, s2 = s * s, s3 = s2 * s;
        result.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * s + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * s + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3),
        });
      }
    }
    result.push(anchors[anchors.length - 1]);
    return result;
  }

  const sampleCache = new Map();

  function getRoadSamples(road) {
    if (road.curve !== 'bezier' || road.points.length < 2) return road.points;
    const pts = road.points;
    let sig = pts.length + '|';
    for (let i = 0; i < pts.length; i++) {
      sig += pts[i].x.toFixed(1) + ',' + pts[i].y.toFixed(1) + ';';
    }
    const cached = sampleCache.get(road.id);
    if (cached && cached.sig === sig) return cached.pts;
    const sampled = sampleSpline(pts, CONFIG.splineSegments);
    sampleCache.set(road.id, { sig, pts: sampled });
    return sampled;
  }

  function simplifyDP(points, tolerance) {
    if (points.length < 3) return points.slice();
    let maxDist = 0, maxIdx = 0;
    const first = points[0], last = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++) {
      const d = distToSegment(points[i].x, points[i].y, first.x, first.y, last.x, last.y);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > tolerance) {
      const left = simplifyDP(points.slice(0, maxIdx + 1), tolerance);
      const right = simplifyDP(points.slice(maxIdx), tolerance);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  function floodFillContour(boundaryCtx, seedX, seedY) {
    const canvas = boundaryCtx.canvas;
    const W = canvas.width, H = canvas.height;
    const imgData = boundaryCtx.getImageData(0, 0, W, H);
    const data = imgData.data;
    const visited = new Uint8Array(W * H);
    const sx = Math.floor(seedX), sy = Math.floor(seedY);
    if (sx < 0 || sx >= W || sy < 0 || sy >= H) return { points: [], leaked: true };
    const seedIdx = (sy * W + sx) * 4;
    if (data[seedIdx] < 128) return { points: [], leaked: true };
    const stack = [sx, sy];
    let leaked = false;
    let filledCount = 0;
    while (stack.length > 0) {
      const y = stack.pop(), x = stack.pop();
      if (x < 0 || x >= W || y < 0 || y >= H) { leaked = true; continue; }
      const idx = y * W + x;
      if (visited[idx]) continue;
      const di = idx * 4;
      if (data[di] < 128) continue;
      visited[idx] = 1;
      filledCount++;
      if (x === 0 || x === W - 1 || y === 0 || y === H - 1) leaked = true;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    if (filledCount < 4) return { points: [], leaked: true };
    let startX = -1, startY = -1;
    outer:
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (visited[y * W + x]) {
          if (x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
              !visited[y * W + x - 1] || !visited[y * W + x + 1] ||
              !visited[(y - 1) * W + x] || !visited[(y + 1) * W + x]) {
            startX = x; startY = y; break outer;
          }
        }
      }
    }
    if (startX < 0) return { points: [], leaked };
    const dx = [0, 1, 1, 1, 0, -1, -1, -1];
    const dy = [-1, -1, 0, 1, 1, 1, 0, -1];
    const contour = [[startX, startY]];
    let x = startX, y = startY;
    let searchDir = 6;
    let guard = 0;
    const maxGuard = W * H * 4;
    while (guard++ < maxGuard) {
      let found = false;
      for (let i = 0; i < 8; i++) {
        const d = (searchDir + i) % 8;
        const nx = x + dx[d], ny = y + dy[d];
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && visited[ny * W + nx]) {
          x = nx; y = ny;
          searchDir = (d + 5) % 8;
          found = true;
          break;
        }
      }
      if (!found) break;
      if (x === startX && y === startY) break;
      if (contour.length === 0 ||
          Math.abs(x - contour[contour.length - 1][0]) + Math.abs(y - contour[contour.length - 1][1]) >= 2) {
        contour.push([x, y]);
      }
    }
    return { points: contour, leaked };
  }

  function segIntersect(p1, p2, p3, p4) {
    const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-10) return null;
    const t1 = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
    const t2 = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
    if (t1 < -0.01 || t1 > 1.01 || t2 < -0.01 || t2 > 1.01) return null;
    return { x: p1.x + t1 * d1x, y: p1.y + t1 * d1y, t1, t2 };
  }

  function roadIntersections(roadA, roadB) {
    const ptsA = getRoadSamples(roadA);
    const ptsB = getRoadSamples(roadB);
    let minAX = Infinity, minAY = Infinity, maxAX = -Infinity, maxAY = -Infinity;
    let minBX = Infinity, minBY = Infinity, maxBX = -Infinity, maxBY = -Infinity;
    for (const p of ptsA) { if (p.x < minAX) minAX = p.x; if (p.x > maxAX) maxAX = p.x; if (p.y < minAY) minAY = p.y; if (p.y > maxAY) maxAY = p.y; }
    for (const p of ptsB) { if (p.x < minBX) minBX = p.x; if (p.x > maxBX) maxBX = p.x; if (p.y < minBY) minBY = p.y; if (p.y > maxBY) maxBY = p.y; }
    if (maxAX < minBX || maxBX < minAX || maxAY < minBY || maxBY < minAY) return [];
    const hits = [];
    for (let i = 0; i < ptsA.length - 1; i++) {
      for (let j = 0; j < ptsB.length - 1; j++) {
        const hit = segIntersect(ptsA[i], ptsA[i + 1], ptsB[j], ptsB[j + 1]);
        if (hit) hits.push(hit);
      }
    }
    return hits;
  }

  function getAllIntersections() {
    const roads = project.entities.filter(e => e.type === 'road' && e.points && e.points.length >= 2);
    const pts = [];
    const mpp = project.meterPerPixel;
    for (let i = 0; i < roads.length; i++) {
      for (let j = i + 1; j < roads.length; j++) {
        const hits = roadIntersections(roads[i], roads[j]);
        for (const h of hits) pts.push({ x: h.x, y: h.y });
      }
    }
    for (const road of roads) {
      const rPts = getRoadSamples(road);
      if (rPts.length < 2) continue;
      const level = CONFIG.roadLevels[road.level] || CONFIG.roadLevels.local;
      const halfW = level.width / mpp / 2;
      for (const ep of [rPts[0], rPts[rPts.length - 1]]) {
        for (const other of roads) {
          if (other.id === road.id) continue;
          const otherPts = getRoadSamples(other);
          if (otherPts.length < 2) continue;
          const otherLevel = CONFIG.roadLevels[other.level] || CONFIG.roadLevels.local;
          const otherHalfW = otherLevel.width / mpp / 2;
          if (distToPolyline(ep.x, ep.y, otherPts) < otherHalfW + halfW * 0.5) {
            const closest = closestPointOnPolyline(ep.x, ep.y, otherPts);
            pts.push({ x: closest.x, y: closest.y });
            break;
          }
        }
      }
    }
    return pts;
  }

  function closestPointOnPolyline(px, py, points) {
    let best = { x: points[0].x, y: points[0].y }, bestD = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = a.x + t * dx, cy = a.y + t * dy;
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestD) { bestD = d; best = { x: cx, y: cy }; }
    }
    return best;
  }

  function trimTJunctions() {
    const roads = project.entities.filter(e => e.type === 'road' && e.points && e.points.length >= 2);
    let changed = false;
    for (const road of roads) {
      const mpp = project.meterPerPixel;
      const level = CONFIG.roadLevels[road.level] || CONFIG.roadLevels.local;
      const halfW = level.width / mpp / 2;
      const pts = getRoadSamples(road);
      if (pts.length < 2) continue;
      for (const endpointIdx of [0, pts.length - 1]) {
        const ep = pts[endpointIdx];
        for (const other of roads) {
          if (other.id === road.id) continue;
          const otherPts = getRoadSamples(other);
          if (otherPts.length < 2) continue;
          const otherLevel = CONFIG.roadLevels[other.level] || CONFIG.roadLevels.local;
          const otherHalfW = otherLevel.width / mpp / 2;
          const d = distToPolyline(ep.x, ep.y, otherPts);
          if (d < otherHalfW + halfW * 0.5) {
            const targetDist = 1.0;
            const dir = endpointIdx === 0 ? 1 : -1;
            const start = endpointIdx === 0 ? 0 : pts.length - 1;
            let trimPoint = null;
            for (let k = start; dir === 1 ? k < pts.length - 1 : k > 0; k += dir) {
              const cur = pts[k];
              const dCur = distToPolyline(cur.x, cur.y, otherPts);
              if (dCur >= targetDist) { trimPoint = cur; break; }
            }
            if (!trimPoint) {
              let bestD = Infinity, bestP = null;
              for (const cur of pts) {
                const dCur = distToPolyline(cur.x, cur.y, otherPts);
                if (dCur < bestD) { bestD = dCur; bestP = cur; }
              }
              trimPoint = bestP;
            }
            if (trimPoint) {
              const anchorIdx = endpointIdx === 0 ? 0 : road.points.length - 1;
              road.points[anchorIdx] = { x: trimPoint.x, y: trimPoint.y };
              changed = true;
            }
            break;
          }
        }
      }
    }
    return changed;
  }

  function splitPolygonByCurve(poly, curvePts) {
    if (poly.length < 3 || curvePts.length < 2) return null;
    const intersections = [];
    for (let ci = 0; ci < curvePts.length - 1; ci++) {
      for (let pi = 0; pi < poly.length; pi++) {
        const p1 = poly[pi], p2 = poly[(pi + 1) % poly.length];
        const hit = segIntersect(curvePts[ci], curvePts[ci + 1], p1, p2);
        if (hit) {
          intersections.push({ x: hit.x, y: hit.y, polyIdx: pi, curveIdx: ci, t: hit.t1 });
        }
      }
    }
    if (intersections.length < 2) return null;
    intersections.sort((a, b) => (a.curveIdx + a.t) - (b.curveIdx + b.t));
    const i1 = intersections[0], i2 = intersections[intersections.length - 1];
    const curveSeg = [];
    for (let ci = i1.curveIdx; ci <= i2.curveIdx; ci++) {
      curveSeg.push(curvePts[ci]);
    }
    curveSeg.push({ x: i2.x, y: i2.y });
    curveSeg.unshift({ x: i1.x, y: i1.y });
    const poly1 = [{ x: i1.x, y: i1.y }];
    for (let pi = (i1.polyIdx + 1) % poly.length; pi !== (i2.polyIdx + 1) % poly.length; pi = (pi + 1) % poly.length) {
      poly1.push(poly[pi]);
    }
    poly1.push({ x: i2.x, y: i2.y });
    for (let ci = curveSeg.length - 2; ci >= 1; ci--) poly1.push(curveSeg[ci]);
    const poly2 = [{ x: i2.x, y: i2.y }];
    for (let pi = (i2.polyIdx + 1) % poly.length; pi !== (i1.polyIdx + 1) % poly.length; pi = (pi + 1) % poly.length) {
      poly2.push(poly[pi]);
    }
    poly2.push({ x: i1.x, y: i1.y });
    for (let ci = 1; ci < curveSeg.length - 1; ci++) poly2.push(curveSeg[ci]);
    if (poly1.length < 3 || poly2.length < 3) return null;
    return [poly1, poly2];
  }

  return {
    get project() { return project; },
    get selectedId() { return selectedId; },
    onChange, emit,
    undo, redo, canUndo, canRedo, recordUndo,
    addEntity, updateEntity, removeEntity, getEntity,
    getSelected, setSelected,
    isLayerVisible, setLayerVisible, entityLayer,
    setView, setBasemap, setBasemapImage, getBasemapImage,
    setProjectMeta, newProject, loadProject, exportProject,
    getBBox, polygonCenter, polygonArea, pointInPolygon, distToPolyline,
    smoothChaikin, smoothChaikinClosed, sampleSpline, getRoadSamples, simplifyDP,
    floodFillContour,
    getAllIntersections, trimTJunctions, splitPolygonByCurve,
  };
})();
