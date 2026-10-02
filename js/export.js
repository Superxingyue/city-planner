/**
 * export.js — 导出成图与工程存取
 * 负责：计算内容范围、绘制国标图廓（边框/图名/图例/指北针/比例尺）、导出 PNG
 *       工程 JSON 保存与加载
 */
'use strict';

const Export = (function () {

  /* ── 计算所有内容的包围盒 ──────────────────────── */
  function computeContentBBox() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let found = false;

    // 底图
    const img = State.getBasemapImage();
    const bm = State.project.basemap;
    if (img && bm.dataUrl && State.isLayerVisible('basemap')) {
      minX = Math.min(minX, bm.x);
      minY = Math.min(minY, bm.y);
      maxX = Math.max(maxX, bm.x + img.width * bm.scale);
      maxY = Math.max(maxY, bm.y + img.height * bm.scale);
      found = true;
    }

    // 实体
    for (const e of State.project.entities) {
      if (!State.isLayerVisible(State.entityLayer(e))) continue;
      if (e.type === 'annotation') {
        minX = Math.min(minX, e.x); minY = Math.min(minY, e.y);
        maxX = Math.max(maxX, e.x + 100); maxY = Math.max(maxY, e.y + 30);
        found = true;
      } else if (e.points && e.points.length) {
        for (const p of e.points) {
          minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        }
        // 道路宽度外延
        if (e.type === 'road') {
          const level = CONFIG.roadLevels[e.level] || CONFIG.roadLevels.local;
          const w = level.width / State.project.meterPerPixel / 2 + 5;
          minX -= w; maxX += w; minY -= w; maxY += w;
        }
        found = true;
      }
    }

    if (!found) return { x: -200, y: -150, w: 800, h: 600 };
    // 加边距
    const pad = 40;
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  }

  /* ── 收集已使用的用地分类 ──────────────────────── */
  function collectUsedCategories() {
    const set = new Set();
    for (const e of State.project.entities) {
      if ((e.type === 'district' || e.type === 'block') && e.category) set.add(e.category);
    }
    return Array.from(set).sort();
  }

  /* ── 计算合适的比例尺线段长度（米） ─────────────── */
  function niceScaleBarMeters(pxPerMeter, targetPx) {
    const targetMeters = targetPx / pxPerMeter;
    if (targetMeters <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(targetMeters)));
    const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    for (const c of candidates) {
      const m = c * pow / 10;
      if (m >= targetMeters * 0.5 && m <= targetMeters * 2) return m;
    }
    return targetMeters;
  }

  /* ── 主导出函数 ────────────────────────────────── */
  function exportPNG() {
    const bbox = computeContentBBox();
    const pad = CONFIG.exportPadding;
    const legendW = CONFIG.legendWidth;
    const bottomH = CONFIG.frameBottom;
    const scale = CONFIG.exportScale;

    const contentW = bbox.w;
    const contentH = bbox.h;
    const totalW = contentW + pad * 2 + legendW + 30;
    const totalH = contentH + pad * 2 + bottomH;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(totalW * scale);
    canvas.height = Math.round(totalH * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // 白底
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalW, totalH);

    // ── 内容区 ──
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad, pad, contentW, contentH);
    ctx.clip();
    ctx.translate(pad - bbox.x, pad - bbox.y);
    Renderer.renderContent(ctx, { zoom: 1 });
    ctx.restore();

    // ── 图廓边框 ──
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(pad - 8, pad - 8, contentW + 16, contentH + 16);
    ctx.lineWidth = 1;
    ctx.strokeRect(pad - 14, pad - 14, contentW + 28, contentH + 28);

    // ── 指北针（内容区右上角） ──
    drawNorthArrow(ctx, pad + contentW - 40, pad + 40);

    // ── 比例尺（内容区左下角） ──
    drawScaleBar(ctx, pad + 20, pad + contentH - 25);

    // ── 图例（右侧） ──
    drawLegend(ctx, pad + contentW + 30, pad, legendW, contentH);

    // ── 底部标题栏 ──
    drawTitleBlock(ctx, pad, pad + contentH + 20, contentW + legendW + 30, bottomH - 20);

    // 下载
    const name = (State.project.name || '城市规划图').replace(/[\\/:*?"<>|]/g, '_');
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}_规划图.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  /* ── 指北针 ────────────────────────────────────── */
  function drawNorthArrow(ctx, cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    // 外圈
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.stroke();
    // 箭头
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(-6, 6);
    ctx.lineTo(0, 2);
    ctx.lineTo(6, 6);
    ctx.closePath();
    ctx.fill();
    // N
    ctx.fillStyle = '#1a1a2e';
    ctx.font = `bold 12px ${CONFIG.cadFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -22);
    ctx.restore();
  }

  /* ── 比例尺 ────────────────────────────────────── */
  function drawScaleBar(ctx, x, y) {
    const mpp = State.project.meterPerPixel;
    const pxPerMeter = 1 / mpp;
    const meters = niceScaleBarMeters(pxPerMeter, 120);
    const barPx = meters * pxPerMeter;
    const h = 8;

    ctx.save();
    ctx.strokeStyle = '#1a1a2e';
    ctx.fillStyle = '#1a1a2e';
    ctx.lineWidth = 1.2;
    // 分段黑白
    const seg = barPx / 4;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#1a1a2e' : '#ffffff';
      ctx.fillRect(x + i * seg, y, seg, h);
      ctx.strokeRect(x + i * seg, y, seg, h);
    }
    // 刻度文字
    ctx.font = `11px ${CONFIG.cadFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#1a1a2e';
    ctx.fillText('0', x, y + h + 2);
    ctx.fillText(formatMeters(meters / 2), x + barPx / 2, y + h + 2);
    ctx.fillText(formatMeters(meters), x + barPx, y + h + 2);
    ctx.restore();
  }

  function formatMeters(m) {
    if (m >= 1000) return (m / 1000) + 'km';
    return m + 'm';
  }

  /* ── 图例 ──────────────────────────────────────── */
  function drawLegend(ctx, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = '#1a1a2e';
    ctx.font = `bold 14px ${CONFIG.cadFont}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('图  例', x + 12, y + 12);

    let cy = y + 40;
    const cats = collectUsedCategories();

    if (cats.length === 0) {
      ctx.font = `12px ${CONFIG.cadFont}`;
      ctx.fillStyle = '#888';
      ctx.fillText('（暂无用地分类）', x + 12, cy);
      cy += 24;
    }

    for (const code of cats) {
      const cat = getLandUseByCode(code);
      if (!cat) continue;
      // 色块
      ctx.fillStyle = cat.color;
      ctx.fillRect(x + 12, cy, 18, 16);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x + 12, cy, 18, 16);
      // 圈内代码（B1/R2 等）
      ctx.font = `10px ${CONFIG.fangSong}`;
      const tw = ctx.measureText(code).width;
      const cx = x + 42, cy2 = cy + 8;
      ctx.beginPath();
      ctx.ellipse(cx, cy2, tw * 0.7 + 5, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.fillStyle = '#1a1a1a';
      ctx.textAlign = 'center';
      ctx.fillText(code, cx, cy2 + 0.5);
      // 名称
      ctx.fillStyle = '#1a1a2e';
      ctx.font = `12px ${CONFIG.fangSong}`;
      ctx.textAlign = 'left';
      ctx.fillText(cat.subName, x + 58, cy + 11);
      cy += 24;
      if (cy > y + h - 30) break;
    }

    // 道路图例（多层套色预览）
    cy += 10;
    ctx.fillStyle = '#1a1a2e';
    ctx.font = `bold 12px ${CONFIG.cadFont}`;
    ctx.fillText('道路分级', x + 12, cy);
    cy += 18;
    for (const key of CONFIG.roadLevelOrder) {
      const lv = CONFIG.roadLevels[key];
      const mpp = State.project.meterPerPixel;
      const W = Math.min(lv.width / mpp, 12);
      const lx = x + 12, ly = cy + 8, len = 36;
      ctx.lineCap = 'round';
      // 蓝边
      if (lv.edgeColor) {
        ctx.strokeStyle = lv.edgeColor;
        ctx.lineWidth = W + (lv.edgeWidth || 0) * 2;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + len, ly); ctx.stroke();
      }
      // 中心线（点划线）
      if (lv.centerType === 'red-dashed') {
        ctx.strokeStyle = lv.centerColor;
        ctx.lineWidth = Math.max(0.5, lv.centerWidth);
        ctx.setLineDash(CONFIG.redDashPattern);
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + len, ly); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#1a1a2e';
      ctx.font = `11px ${CONFIG.cadFont}`;
      ctx.textAlign = 'left';
      ctx.fillText(lv.name, x + 54, cy + 2);
      cy += 22;
    }

    ctx.restore();
  }

  /* ── 标题栏 ────────────────────────────────────── */
  function drawTitleBlock(ctx, x, y, w, h) {
    ctx.save();
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, y, w, h);

    // 图名
    ctx.fillStyle = '#1a1a2e';
    ctx.font = `bold 22px ${CONFIG.cadFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(State.project.name || '城市总体规划图', x + w / 2, y + h / 2 - 8);

    // 副信息
    const mpp = State.project.meterPerPixel;
    const scaleText = `比例尺 1:${State.project.scale}  |  1像素 = ${mpp.toFixed(2)}米`;
    ctx.font = `12px ${CONFIG.cadFont}`;
    ctx.fillStyle = '#555';
    ctx.fillText(scaleText, x + w / 2, y + h / 2 + 16);

    // 制图信息（右下）
    const today = new Date();
    const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
    ctx.textAlign = 'right';
    ctx.font = `11px ${CONFIG.cadFont}`;
    ctx.fillStyle = '#888';
    ctx.fillText(`制图日期 ${dateStr}`, x + w - 12, y + h - 10);

    ctx.restore();
  }

  /* ── 工程保存 ──────────────────────────────────── */
  function saveProject() {
    const data = State.exportProject();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const name = (State.project.name || '未命名城市').replace(/[\\/:*?"<>|]/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.cityplan.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ── 工程加载 ──────────────────────────────────── */
  function loadProject(file, callback) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        State.loadProject(data);
        // 加载底图图片
        if (data.basemap && data.basemap.dataUrl) {
          const img = new Image();
          img.onload = () => {
            State.setBasemapImage(img);
            Renderer.render();
            if (callback) callback(true);
          };
          img.onerror = () => { Renderer.render(); if (callback) callback(true); };
          img.src = data.basemap.dataUrl;
        } else {
          Renderer.render();
          if (callback) callback(true);
        }
      } catch (err) {
        alert('工程文件解析失败：' + err.message);
        if (callback) callback(false);
      }
    };
    reader.readAsText(file);
  }

  /* ── 底图加载 ──────────────────────────────────── */
  function loadBasemap(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        State.setBasemapImage(img);
        State.setBasemap({ dataUrl: e.target.result });
        Renderer.render();
      };
      img.onerror = () => alert('底图加载失败');
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  return { exportPNG, saveProject, loadProject, loadBasemap, computeContentBBox };
})();
