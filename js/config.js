/**
 * config.js — 全局配置常量
 * 道路多层渲染参数、用地分类（GB 50137-2011）、高饱和规划图色卡
 */
'use strict';

const CONFIG = {
  /* ── 版本 ────────────────────────────────────── */
  version: 'v1.2.0',

  /* ── 字体栈 ────────────────────────────────────── */
  cadFont: '"Courier New","Consolas","Liberation Mono",monospace',
  fangSong: '"FangSong","仿宋","STFangsong","SimSun",serif',
  kaiti: '"FZKaiTi","方正楷体","KaiTi","楷体","STKaiti","SimKai","SimSun",serif',

  /* ── 国标用地图例（序号对应 GB 50137-2011 常用图例） ── */
  landUseLegend: {
    R1:  { num: 1,  name: '一类居住用地' },
    R2:  { num: 2,  name: '二类居住用地' },
    R3:  { num: 3,  name: '三类居住用地' },
    A1:  { num: 4,  name: '行政办公用地' },
    A2:  { num: 5,  name: '文化设施用地' },
    A3:  { num: 6,  name: '教育科研用地' },
    A31: { num: 7,  name: '高等院校用地' },
    A32: { num: 8,  name: '中等专业学校用地' },
    A33: { num: 9,  name: '中小学用地' },
    A35: { num: 11, name: '科研用地' },
    A4:  { num: 12, name: '体育用地' },
    A5:  { num: 13, name: '医疗卫生用地' },
    A51: { num: 14, name: '医院用地' },
    A6:  { num: 15, name: '社会福利用地' },
    A7:  { num: 16, name: '文物古迹用地' },
    B1:  { num: 17, name: '商业用地' },
    B14: { num: 18, name: '旅馆用地' },
    B2:  { num: 19, name: '商务用地' },
    B3:  { num: 20, name: '娱乐康体用地' },
    B31: { num: 21, name: '娱乐用地' },
    B4:  { num: 22, name: '公用设施营业网点用地' },
    M1:  { num: 23, name: '一类工业用地' },
    M2:  { num: 24, name: '二类工业用地' },
    M3:  { num: 25, name: '三类工业用地' },
    W1:  { num: 26, name: '一类物流仓储用地' },
    W2:  { num: 27, name: '二类物流仓储用地' },
    W3:  { num: 28, name: '三类物流仓储用地' },
    S1:  { num: 29, name: '城市道路用地' },
    S2:  { num: 30, name: '城市轨道交通用地' },
    S3:  { num: 31, name: '交通枢纽用地' },
    S4:  { num: 32, name: '交通场站用地' },
    U1:  { num: 33, name: '供应设施用地' },
    U2:  { num: 34, name: '环境设施用地' },
    U21: { num: 35, name: '排水用地' },
    G1:  { num: 37, name: '公园绿地' },
    G2:  { num: 38, name: '防护绿地' },
    G3:  { num: 39, name: '广场用地' },
    E1:  { num: 62, name: '河流水域' },
  },

  /* ── 道路等级 ──────────────────────────────────────
     渲染：深蓝边线 + 点划中心线 + 路口绿点
     内部透明透底图，路口通过离屏 destination-out 融合 */
  roadLevels: {
    expressway: {
      name: '高速/快速路', width: 50,
      edgeColor: '#0a2f7a', edgeWidth: 0.25,
      centerType: 'red-dashed', centerWidth: 0.25, centerColor: '#c41e1e',
    },
    arterial: {
      name: '主干路', width: 36,
      edgeColor: '#0a2f7a', edgeWidth: 0.25,
      centerType: 'red-dashed', centerWidth: 0.22, centerColor: '#c41e1e',
    },
    collector: {
      name: '次干路', width: 24,
      edgeColor: '#0a2f7a', edgeWidth: 0.2,
      centerType: 'red-dashed', centerWidth: 0.2, centerColor: '#c41e1e',
    },
    local: {
      name: '支路', width: 14,
      edgeColor: '#0a2f7a', edgeWidth: 0.15,
      centerType: 'red-dashed', centerWidth: 0.15, centerColor: '#c41e1e',
    },
    ramp: {
      name: '匝道', width: 8,
      edgeColor: '#0a2f7a', edgeWidth: 0.12,
      centerType: 'none', centerWidth: 0, centerColor: '#c41e1e',
    },
  },
  roadLevelOrder: ['expressway', 'arterial', 'collector', 'local', 'ramp'],
  /* 点划线线型：长划-空-点-空（加密版） */
  redDashPattern: [6, 2, 1, 2],

  /* ── 城市用地分类 ──────────────────────────────────
     代码依据 GB 50137-2011；配色参照真实规划总图 */
  landUse: {
    R: { name: '居住用地', color: '#ffee00',
         sub: { R1: '一类居住用地', R2: '二类居住用地', R3: '三类居住用地' } },
    A: { name: '公共管理与公共服务', color: '#f8a4a4',
         sub: { A1: '行政办公用地', A2: '文化设施用地', A3: '教育科研用地', A31: '高等院校用地', A32: '中等专业学校用地', A33: '中小学用地', A35: '科研用地', A4: '体育用地', A5: '医疗卫生用地', A51: '医院用地', A6: '社会福利用地', A7: '文物古迹用地' } },
    B: { name: '商业服务业设施', color: '#ff2222',
         sub: { B1: '商业用地', B14: '旅馆用地', B2: '商务用地', B3: '娱乐康体用地', B31: '娱乐用地', B4: '公用设施营业网点用地' } },
    M: { name: '工业用地', color: '#e89850',
         sub: { M1: '一类工业用地', M2: '二类工业用地', M3: '三类工业用地' } },
    W: { name: '物流仓储', color: '#a0a0a0',
         sub: { W1: '一类物流仓储用地', W2: '二类物流仓储用地', W3: '三类物流仓储用地' } },
    S: { name: '道路与交通设施', color: '#808080',
         sub: { S1: '城市道路用地', S2: '城市轨道交通用地', S3: '交通枢纽用地', S4: '交通场站用地' } },
    U: { name: '公用设施', color: '#c8a850',
         sub: { U1: '供应设施用地', U2: '环境设施用地', U21: '排水用地', U3: '安全设施用地' } },
    G: { name: '绿地与广场', color: '#33cc33',
         sub: { G1: '公园绿地', G2: '防护绿地', G3: '广场用地' } },
    E: { name: '水域与其他', color: '#b8d4e8',
         sub: { E1: '水域', E2: '农林用地', E9: '其他非建设用地' } },
    H: { name: '特殊用地', color: '#d8b8e8',
         sub: { H1: '特殊用地' } },
  },
  landUseOrder: ['R', 'A', 'B', 'M', 'W', 'S', 'U', 'G', 'E', 'H'],

  /* ── 图层定义（固定渲染顺序） ────────────────────── */
  layers: [
    { id: 'basemap',    name: '底图',   type: 'basemap' },
    { id: 'water',      name: '水系',   type: 'water' },
    { id: 'landuse',    name: '用地',   type: 'landuse' },
    { id: 'roads',      name: '路网',   type: 'roads' },
    { id: 'annotations',name: '标注',   type: 'annotations' },
  ],

  /* ── 默认参数 ────────────────────────────────────── */
  defaultMeterPerPixel: 3,
  defaultScale: 10000,
  minZoom: 0.1,
  maxZoom: 20,
  maxUndo: 80,
  vertexHitRadius: 8,
  roadHitTolerance: 6,
  splineSegments: 24,

  /* ── 导出参数 ────────────────────────────────────── */
  exportScale: 2,
  exportPadding: 60,
  legendWidth: 180,
  frameBottom: 90,
};

/** 根据子分类代码（如 R2）查找大类配置 */
function getLandUseByCode(code) {
  if (!code) return null;
  const major = code.charAt(0);
  const majorCfg = CONFIG.landUse[major];
  if (!majorCfg) return null;
  const subName = majorCfg.sub[code] || majorCfg.name;
  return { major, majorName: majorCfg.name, color: majorCfg.color, code, subName };
}

/** 根据子分类代码查找国标图例序号 */
function getLegendNum(code) {
  if (!code) return null;
  const entry = CONFIG.landUseLegend[code];
  if (entry) return entry.num;
  // 回退：按大类找第一个子类
  const major = code.charAt(0);
  const majorCfg = CONFIG.landUse[major];
  if (majorCfg && majorCfg.sub) {
    const firstCode = Object.keys(majorCfg.sub)[0];
    const le = CONFIG.landUseLegend[firstCode];
    if (le) return le.num;
  }
  return null;
}

/** 带圈数字（①-㊿），超出范围返回普通数字 */
function circledNumber(n) {
  if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
  if (n >= 21 && n <= 35) return String.fromCharCode(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCharCode(0x32B1 + n - 36);
  return String(n);
}
