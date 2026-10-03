/**
 * main.js — 应用入口与 UI 接线
 */
'use strict';

(function () {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const canvas = $('#canvas');
  const projectNameInput = $('#projectName');
  const toolButtons = $$('.tool-btn[data-tool]');
  const optionsPanel = $('#optionsPanel');
  const optionsContent = $('#optionsContent');
  const layerList = $('#layerList');
  const propertiesPanel = $('#propertiesPanel');
  const statusCoords = $('#statusCoords');
  const statusZoom = $('#statusZoom');
  const statusScale = $('#statusScale');
  const statusTool = $('#statusTool');
  const undoBtn = $('#undoBtn');
  const redoBtn = $('#redoBtn');
  const zoomInBtn = $('#zoomInBtn');
  const zoomOutBtn = $('#zoomOutBtn');
  const zoomResetBtn = $('#zoomResetBtn');
  const basemapInput = $('#basemapInput');
  const projectInput = $('#projectInput');

  Renderer.init(canvas);
  Tools.init(canvas);

  State.onChange(() => { updateLayers(); updateProperties(); updateUndoRedo(); updateStatus(); });
  Tools.onToolChange(tool => { toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === tool)); updateOptions(tool); updateStatus(); });
  Tools.onCoords(w => { statusCoords.textContent = `X: ${w.x.toFixed(0)}  Y: ${w.y.toFixed(0)}`; });
  Tools.onZoom(z => { statusZoom.textContent = `缩放: ${(z * 100).toFixed(0)}%`; });

  toolButtons.forEach(btn => { btn.addEventListener('click', () => Tools.setTool(btn.dataset.tool)); });
  undoBtn.addEventListener('click', () => { State.undo(); Renderer.render(); });
  redoBtn.addEventListener('click', () => { State.redo(); Renderer.render(); });
  zoomInBtn.addEventListener('click', () => zoomBy(1.25));
  zoomOutBtn.addEventListener('click', () => zoomBy(0.8));
  zoomResetBtn.addEventListener('click', () => { State.setView({ zoom: 1, panX: 60, panY: 40 }); Renderer.render(); });

  function zoomBy(factor) {
    const view = State.project.view;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const wx = (cx - view.panX) / view.zoom, wy = (cy - view.panY) / view.zoom;
    const nz = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, view.zoom * factor));
    State.setView({ zoom: nz, panX: cx - wx * nz, panY: cy - wy * nz });
    Renderer.render();
  }

  projectNameInput.addEventListener('focus', () => State.recordUndo());
  projectNameInput.addEventListener('input', e => { State.setProjectMeta({ name: e.target.value }, true); });

  $('#newBtn').addEventListener('click', () => {
    UI.Modal.confirm('确定新建工程？当前未保存内容将丢失。', { title: '新建工程' }).then(ok => {
      if (ok) { State.newProject(); projectNameInput.value = State.project.name; Renderer.render(); }
    });
  });
  $('#saveBtn').addEventListener('click', () => Export.saveProject());
  $('#loadBtn').addEventListener('click', () => projectInput.click());
  projectInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) Export.loadProject(file, ok => { if (ok) { projectNameInput.value = State.project.name; updateAll(); } });
    e.target.value = '';
  });
  $('#exportBtn').addEventListener('click', () => Export.exportPNG());
  $('#basemapBtn').addEventListener('click', () => basemapInput.click());
  basemapInput.addEventListener('change', e => { const file = e.target.files[0]; if (file) Export.loadBasemap(file); e.target.value = ''; });
  $('#basemapOpacity').addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    State.setBasemap({ opacity: val }, true);
    const ov = $('#opacityVal'); if (ov) ov.textContent = Math.round(val * 100) + '%';
    Renderer.render();
  });
  $('#deleteBtn').addEventListener('click', () => Tools.deleteSelected());

  function updateOptions(tool) {
    let html = '';
    const landUseCats = [];
    for (const major of CONFIG.landUseOrder) {
      const cfg = CONFIG.landUse[major];
      for (const code in cfg.sub) landUseCats.push({ code, name: cfg.sub[code], color: cfg.color });
    }
    if (tool === 'road-bezier' || tool === 'road-polyline') {
      html = `
        <div class="opt-group"><label>道路等级</label>
          <select id="optRoadLevel">
            ${CONFIG.roadLevelOrder.filter(k => k !== 'ramp').map(k => `<option value="${k}"${Tools.getOption('roadLevel') === k ? ' selected' : ''}>${CONFIG.roadLevels[k].name}（${CONFIG.roadLevels[k].width}m）</option>`).join('')}
          </select></div>
        <div class="opt-group"><label>路名（可选）</label>
          <input type="text" id="optRoadName" value="${Tools.getOption('roadName') || ''}" placeholder="如：中山大道"></div>
        <div class="opt-hint">${tool === 'road-bezier' ? '单击添加锚点，曲线自动平滑，按回车完成' : '单击添加顶点，按回车完成'}</div>`;
    } else if (tool === 'road-ramp') {
      html = `
        <div class="opt-group"><label>路名（可选）</label>
          <input type="text" id="optRoadName" value="${Tools.getOption('roadName') || ''}" placeholder="如：A匝道"></div>
        <div class="opt-hint">单击添加锚点绘制平滑匝道，按回车完成。端点尽量靠近已有道路。</div>`;
    } else if (tool === 'boundary') {
      html = `
        <div class="opt-hint" style="color:#1d4ed8;font-weight:600;">绘制街区边界线（细灰虚线），可围合新街区或拆分已有街区。</div>
        <div class="opt-hint" style="margin-top:8px;">单击添加锚点，回车完成。边界线参与街区填充围合，右键可编辑节点。</div>`;
    } else if (tool === 'eraser') {
      html = `
        <div class="opt-hint" style="color:#c0392b;font-weight:600;">按住鼠标拖动擦除道路/边界节点。</div>
        <div class="opt-hint" style="margin-top:8px;">擦除内部节点会将道路拆分为两段，同时删除关联街区。擦除端点则缩短道路。</div>`;
    } else if (tool === 'block-clear') {
      html = `
        <div class="opt-hint" style="color:#c0392b;font-weight:600;">点击街区即可清除其用地填充。</div>
        <div class="opt-hint" style="margin-top:8px;">仅删除街区色块和标注，不影响道路和边界线。</div>`;
    } else if (tool === 'block-fill') {
      html = `
        <div class="opt-group"><label>用地分类</label>
          <select id="optLandUse">
            ${landUseCats.map(c => `<option value="${c.code}"${Tools.getOption('landUseCode') === c.code ? ' selected' : ''}>${c.code} ${c.name}</option>`).join('')}
          </select></div>
        <div class="opt-hint" style="color:#1d4ed8;font-weight:600;">点击被道路围合的街区内部，自动识别边界并填充用途。街区将自动编号。</div>`;
    } else if (tool === 'district-polygon' || tool === 'district-rect') {
      html = `
        <div class="opt-group"><label>用地分类</label>
          <select id="optLandUse">
            ${landUseCats.map(c => `<option value="${c.code}"${Tools.getOption('landUseCode') === c.code ? ' selected' : ''}>${c.code} ${c.name}</option>`).join('')}
          </select></div>
        <div class="opt-group"><label>片区名称（可选）</label>
          <input type="text" id="optDistrictName" value="${Tools.getOption('districtName') || ''}" placeholder="如：中心商业区"></div>
        <div class="opt-hint">${tool === 'district-polygon' ? '单击添加顶点，按回车或点击起点闭合' : '按住鼠标拖拽绘制矩形'}</div>`;
    } else if (tool === 'annotation') {
      html = `
        <div class="opt-group"><label>标注文字</label>
          <input type="text" id="optAnnText" value="${Tools.getOption('annotationText') || ''}" placeholder="点击画布放置"></div>
        <div class="opt-group"><label>字号: <span id="annSizeVal">${Tools.getOption('annotationSize')}</span></label>
          <input type="range" id="optAnnSize" min="10" max="36" value="${Tools.getOption('annotationSize')}"></div>`;
    } else if (tool === 'calibrate') {
      html = `
        <div class="opt-hint" style="color:#b45309;font-weight:600;">在画布上拖拽一条已知长度的线段，松开后输入实际米数。</div>
        <div class="opt-group" style="margin-top:12px;"><label>当前比例</label>
          <div style="font-size:14px;color:#333;">1 像素 = ${State.project.meterPerPixel.toFixed(3)} 米</div></div>`;
    } else if (tool === 'select') {
      html = `<div class="opt-hint">点击实体选中，拖拽顶点修改形状，拖拽实体移动位置。<br>按 Delete 删除选中。</div>`;
    } else if (tool === 'pan') {
      html = `<div class="opt-hint">拖拽平移画布。也可在任意工具下按住空格拖拽。</div>`;
    }
    optionsContent.innerHTML = html;
    const rl = $('#optRoadLevel'); if (rl) rl.addEventListener('change', e => Tools.setOption('roadLevel', e.target.value));
    const rn = $('#optRoadName'); if (rn) rn.addEventListener('input', e => Tools.setOption('roadName', e.target.value));
    const lu = $('#optLandUse'); if (lu) lu.addEventListener('change', e => Tools.setOption('landUseCode', e.target.value));
    const dn = $('#optDistrictName'); if (dn) dn.addEventListener('input', e => Tools.setOption('districtName', e.target.value));
    const at = $('#optAnnText'); if (at) at.addEventListener('input', e => Tools.setOption('annotationText', e.target.value));
    const as_ = $('#optAnnSize'); if (as_) as_.addEventListener('input', e => {
      Tools.setOption('annotationSize', parseInt(e.target.value));
      $('#annSizeVal').textContent = e.target.value;
    });
    UI.Select.scan(optionsContent);
    UI.Tooltip.scan(optionsContent);
  }

  function updateLayers() {
    layerList.innerHTML = CONFIG.layers.map(l => {
      const visible = State.isLayerVisible(l.id);
      return `<div class="layer-item" data-layer="${l.id}"><span class="layer-eye ${visible ? '' : 'off'}">${visible ? '◉' : '○'}</span><span class="layer-name">${l.name}</span></div>`;
    }).join('');
    $$('.layer-item').forEach(item => {
      item.addEventListener('click', () => { const id = item.dataset.layer; State.setLayerVisible(id, !State.isLayerVisible(id)); });
    });
  }

  function updateProperties() {
    const sel = State.getSelected();
    if (!sel) { propertiesPanel.innerHTML = '<div class="prop-empty">未选中对象<br><span style="font-size:12px;color:#999;">使用选择工具点击实体</span></div>'; return; }
    let html = `<div class="prop-title">${entityTypeLabel(sel.type)}</div>`;
    if (sel.type === 'road') {
      html += `
        <div class="prop-row"><label>道路等级</label>
          <select data-prop="level">${CONFIG.roadLevelOrder.map(k => `<option value="${k}"${sel.level === k ? ' selected' : ''}>${CONFIG.roadLevels[k].name}</option>`).join('')}</select></div>
        <div class="prop-row"><label>路名</label><input type="text" data-prop="name" value="${sel.name || ''}"></div>
        <div class="prop-row"><label>线型</label><span>${sel.curve === 'bezier' ? '贝塞尔曲线' : '折线'}</span></div>
        <div class="prop-row"><label>锚点数</label><span>${sel.points ? sel.points.length : 0}</span></div>`;
    } else if (sel.type === 'block') {
      const cat = getLandUseByCode(sel.category);
      const bbox = State.getBBox(sel);
      const area = bbox ? (bbox.w * bbox.h * Math.pow(State.project.meterPerPixel, 2) / 10000).toFixed(1) : '?';
      html += `
        <div class="prop-row"><label>用地</label><span>${cat ? cat.subName : sel.category}</span></div>
        <div class="prop-row"><label>代码</label><span>${sel.category || '-'}</span></div>
        <div class="prop-row"><label>面积</label><span>${area} 公顷</span></div>
        <div class="opt-hint" style="margin-top:8px;">街区由道路/边界自动围合，不可直接编辑。调整周边道路或边界节点可改变街区范围，变动过大时街区将自动清除。</div>`;
    } else if (sel.type === 'district') {
      const cats = [];
      for (const major of CONFIG.landUseOrder) { const cfg = CONFIG.landUse[major]; for (const code in cfg.sub) cats.push({ code, name: cfg.sub[code] }); }
      const bbox = State.getBBox(sel);
      const area = bbox ? (bbox.w * bbox.h * Math.pow(State.project.meterPerPixel, 2) / 10000).toFixed(1) : '?';
      html += `
        <div class="prop-row"><label>用地分类</label>
          <select data-prop="category">${cats.map(c => `<option value="${c.code}"${sel.category === c.code ? ' selected' : ''}>${c.code} ${c.name}</option>`).join('')}</select></div>
        <div class="prop-row"><label>名称</label><input type="text" data-prop="name" value="${sel.name || ''}"></div>
        <div class="prop-row"><label>估算面积</label><span>${area} 公顷</span></div>`;
    } else if (sel.type === 'annotation') {
      html += `
        <div class="prop-row"><label>文字</label><input type="text" data-prop="text" value="${sel.text || ''}"></div>
        <div class="prop-row"><label>字号</label><input type="number" data-prop="fontSize" value="${sel.fontSize || 14}" min="8" max="72"></div>`;
    }
    html += `<button class="prop-delete" id="propDelete">删除此对象</button>`;
    propertiesPanel.innerHTML = html;
    propertiesPanel.querySelectorAll('[data-prop]').forEach(el => {
      const prop = el.dataset.prop;
      if (el.type === 'text') {
        el.addEventListener('focus', () => State.recordUndo());
        el.addEventListener('input', () => { State.updateEntity(sel.id, { [prop]: el.value }, true); Renderer.render(); });
      } else {
        el.addEventListener('change', () => {
          const val = el.type === 'number' ? parseFloat(el.value) : el.value;
          State.updateEntity(sel.id, { [prop]: val }); Renderer.render();
        });
      }
    });
    const delBtn = $('#propDelete');
    if (delBtn) delBtn.addEventListener('click', () => { State.removeEntity(sel.id); Renderer.render(); });
    UI.Select.scan(propertiesPanel);
  }

  function entityTypeLabel(type) {
    return { road: '道路', district: '片区/用地', block: '街区/用地', annotation: '标注', water: '水系' }[type] || type;
  }

  function updateStatus() {
    statusTool.textContent = `工具: ${Tools.getToolName()}`;
    statusScale.textContent = `1px = ${State.project.meterPerPixel.toFixed(2)}m`;
    statusZoom.textContent = `缩放: ${(State.project.view.zoom * 100).toFixed(0)}%`;
  }

  function updateUndoRedo() {
    undoBtn.disabled = !State.canUndo(); redoBtn.disabled = !State.canRedo();
    undoBtn.classList.toggle('disabled', !State.canUndo());
    redoBtn.classList.toggle('disabled', !State.canRedo());
  }

  function updateAll() { updateLayers(); updateProperties(); updateUndoRedo(); updateStatus(); updateOptions(Tools.getTool()); }

  window.addEventListener('resize', () => { Renderer.resize(); Renderer.render(); });

  projectNameInput.value = State.project.name;
  Tools.setTool('select');
  updateAll();
  Renderer.render();
  UI.Tooltip.scan(document);
  console.log('%c架空城市规划设计器 v1.3.1 已启动', 'font-size:16px;font-weight:bold;color:#333;');
  console.log('快捷键: V选择 H平移 B贝塞尔路 L折线路 M匝道 F填街区 K划边界 E橡皮擦 P多边形 R矩形 T标注 C校准 空格+拖拽平移 Ctrl+Z撤销 Delete删除');
})();
