/* Magic Tower Remastered — game engine
 * Faithful HTML5 remake of xhy1999/MagicTower (胖老鼠 Flash 魔塔 v1.12 clone).
 * No score system. Data-driven, sprite-based, localStorage save.
 */
(function () {
  'use strict';
  const G = window.GAME_DATA;
  const TILE = 32;                       // render tile size (sprites are 32px — 1:1, no upscale)
  const GRID = 11;
  const BORDER = 0;                      // no thick wall ring; thin brick border drawn on canvas
  const VIEW = GRID;                    // 11×11 canvas (map fills entire canvas)
  // 多存档槽：三个手动槽 + 一个自动存档槽（不可手动保存）
  const SLOTS = ['motarem_save_v1_0', 'motarem_save_v1_1', 'motarem_save_v1_2'];
  const AUTO_SLOT_KEY = 'motarem_save_auto';
  const LAST_SLOT_KEY = 'motarem_save_v1_last';
  const GALLERY_KEY = 'motarem_gallery_v1';   // 资料馆解锁标记（独立于存档）

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  // 高清渲染：画布物理分辨率 = CSS 显示尺寸 × devicePixelRatio，最近邻缩放，
  // 避免 32px 素材在手机上被双线性插值放大而模糊。
  canvas.width = 1024; canvas.height = 1024;  // 大占位：由 CSS max-width/max-height 钳制，供 rect 测量真实显示尺寸
  // 高清渲染（整数倍像素映射）：
  // 位图 = 逻辑尺寸 × 整数 N；CSS 显示尺寸 = 位图/DPR。
  // 这样物理渲染 (显示CSS × DPR) 恰好等于位图，1:1 零缩放，素材像素永远整数倍。
  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    // 可用宽度 = stage 外宽(含 border) - 左右砖墙(18+18)
    const cssMax = (stage.getBoundingClientRect().width - 36) || canvas.getBoundingClientRect().width || (VIEW * TILE);
    const n = Math.max(1, Math.floor((cssMax * dpr) / (VIEW * TILE)));  // 最大整数倍
    const px = VIEW * TILE * n;
    if (canvas.width !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    canvas.style.width = (px / dpr) + 'px';
    canvas.style.height = (px / dpr) + 'px';
    ctx.setTransform(n, 0, 0, n, 0, 0);
    ctx.imageSmoothingEnabled = false;   // 像素风：关闭插值，保持硬边
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fitCanvas);
  } else {
    fitCanvas();
  }
  window.addEventListener('resize', () => { fitCanvas(); if (started) draw(); });
  const stage = document.getElementById('stage');
  // 四边砖墙：生成完整砖块（上下 21 块、左右 19 块，grid 自动分配 → 砖块完整不切）
  function buildBrickWalls() {
    document.querySelectorAll('.bw-top, .bw-bottom').forEach((w) => {
      for (let i = 0; i < 21; i++) {
        const b = document.createElement('div');
        b.className = 'brick';
        w.appendChild(b);
      }
    });
    document.querySelectorAll('.bw-left, .bw-right').forEach((w) => {
      for (let i = 0; i < 19; i++) {
        const b = document.createElement('div');
        b.className = 'brick';
        w.appendChild(b);
      }
    });
  }
  buildBrickWalls();
  const hud = document.getElementById('hud');
  const logEl = document.getElementById('log');
  const dpad = document.getElementById('dpad');
  const overlay = document.getElementById('overlay');
  const ovName = document.getElementById('ovName');
  const ovText = document.getElementById('ovText');
  const ovHint = document.getElementById('ovHint');
  const startScreen = document.getElementById('startScreen');
  const guideScreen = document.getElementById('guideScreen');
  const soundBtn = document.getElementById('soundBtn');
  const shopScreen = document.getElementById('shopScreen');
  const shopNameEl = shopScreen.querySelector('.shopName');
  const shopCurEl = shopScreen.querySelector('.shopCur');
  const shopOptsEl = shopScreen.querySelector('.shopOpts');
  const shopConfirmBtn = shopScreen.querySelector('.shopConfirm');
  // new UI elements
  const itemBar = document.getElementById('itemBar');
  const btnSaveGame = document.getElementById('btnSaveGame');
  const btnLoadGameUI = document.getElementById('btnLoadGame');
  const btnFlight = document.getElementById('btnFlight');
  const btnManual = document.getElementById('btnManual');
  const btnLossToggle = document.getElementById('btnLossToggle');
  const flightScreen = document.getElementById('flightScreen');
  const flightGrid = document.getElementById('flightGrid');
  const flightClose = document.getElementById('flightClose');
  const manualScreen = document.getElementById('manualScreen');
  const manualGrid = document.getElementById('manualGrid');
  const manualClose = document.getElementById('manualClose');
  const manualCount = document.getElementById('manualCount');
  // 多存档槽面板
  const slotScreen = document.getElementById('slotScreen');
  const slotList = document.getElementById('slotList');
  const slotClose = document.getElementById('slotClose');
  const slotNameDraft = {};   // 保存前暂存的命名输入
  const menuScreen = document.getElementById('menuScreen');
  const menuClose = document.getElementById('menuClose');
  const menuCine = document.getElementById('menuCine');
  const menuRestart = document.getElementById('menuRestart');
  const menuHome = document.getElementById('menuHome');
  const btnMenu = document.getElementById('btnMenu');

  // ---------- persistent settings (global; independent of per-slot saves) ----------
  const SETTINGS_KEY = 'motarem_settings';
  function loadSettings() {
    let s = { sound: true, battleCinematic: true };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) s = Object.assign(s, JSON.parse(raw));
    } catch (e) {}
    return s;
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
  }
  const settings = loadSettings();

  // ---------- audio (faithful to original MusicPlayer mapping) ----------
  const AU = {
    base: 'assets/audio/',
    cache: {}, enabled: true, unlocked: false, bgmEl: null, bgmName: null,
    /* Asset files are PascalCase (Walk.mp3, GetItem.mp3, UpAndDown.mp3) while
       call sites use camelCase. Capitalising the first letter maps every name
       onto its real file, and leaves already-PascalCase BGM names untouched. */
    fileOf(name) { return name.charAt(0).toUpperCase() + name.slice(1); },
    get(name) {
      const key = this.fileOf(name);
      if (!this.cache[key]) {
        const a = new Audio(this.base + key + '.mp3');
        a.preload = 'auto';
        this.cache[key] = a;
      }
      return this.cache[key];
    },
    unlock() {
      if (this.unlocked) return;
      this.unlocked = true;
      // first .play() inside a user gesture (the start/load button) is allowed
    },
    sfx(name) {
      if (!this.enabled || !this.unlocked) return;
      const a = this.get(name);
      a.loop = false; a.currentTime = 0;
      const p = a.play(); if (p) p.catch(() => {});
    },
    playBgm(name) {
      if (!this.enabled) { this.bgmName = name; return; }
      if (!this.unlocked) { this.bgmName = name; return; }
      if (this.bgmName === name && this.bgmEl && !this.bgmEl.paused) return;
      this.bgmName = name;
      if (this.bgmEl) { this.bgmEl.pause(); this.bgmEl.currentTime = 0; }
      const a = this.get(name); a.loop = true; a.currentTime = 0; this.bgmEl = a;
      const p = a.play(); if (p) p.catch(() => {});
    },
    stopBgm() { if (this.bgmEl) { this.bgmEl.pause(); this.bgmEl.currentTime = 0; } this.bgmName = null; },
    toggle() {
      this.enabled = !this.enabled;
      if (!this.enabled) this.stopBgm();
      else if (this.bgmName) this.playBgm(this.bgmName);
      return this.enabled;
    },
  };
  // floor id -> original "musicNo" BGM file (MusicPlayer.playBackgroundMusic)
  AU.enabled = settings.sound;   // 音效开关取自上局持久化设置
  function bgmForFloor(id) {
    if (typeof id === 'number') {
      if (id === 0) return 'Underground1';
      if (id < 8) return 'Underground2';
      if (id < 16) return 'Underground3';
      if (id < 21) return 'Underground4';
      return 'Underground5';
    }
    if (id === 'hell' || id === '23_L' || id === '23_R') return 'Underground5';
    return 'Underground2'; // special_1/2/3
  }

  // ---------- sprite cache ----------
  const IMG = {};
  function dirOf(file) {
    if (file.startsWith('monster')) {
      const m = file.match(/monster(\d{2})_/);
      const n = m ? parseInt(m[1], 10) : 0;
      if (n <= 4) return 'monster_a/';
      if (n <= 8) return 'monster_b/';
      return 'monster_c/';
    }
    if (file.startsWith('item')) return 'item/';
    if (file.startsWith('npc')) return 'npc/';
    if (file.startsWith('door')) return 'door/';
    if (file.startsWith('wall') || file.startsWith('floor')) return 'wall/';
    if (file.startsWith('stair')) return 'stair/';
    if (file.startsWith('shop')) return 'shop/';
    if (file.startsWith('player')) return 'player/';
    return 'wall/';
  }
  function loadSprite(file) {
    if (IMG[file]) return IMG[file];
    const img = new Image();
    img.src = 'assets/' + dirOf(file) + file;
    IMG[file] = img;
    // 图片加载完成 → 触发重绘（修复首次 draw 时图片未到齐的灰色方块）
    img.addEventListener('load', () => {
      if (started && !battleAnimating && !dialogueActive && !floorTransitioning)
        draw();
    });
    return img;
  }
  const FLOOR_TILE = 'floor01_1.png';
  // preload all referenced sprites + player + floor
  loadSprite(FLOOR_TILE);
  // 主角：4 方向 × 4 帧 全部预加载（转向后才能立即显示）
  for (let d = 0; d <= 3; d++) {
    for (let f = 1; f <= 4; f++) loadSprite('player01_' + d + '_' + f + '.png');
  }
  Object.values(G.sprite_map).forEach(loadSprite);
  Object.values(G.npcs).forEach(n => { if (n.sprite) loadSprite(n.sprite); });
  loadSprite('monster10_15_1.png');
  // 动画帧：怪物 _2 待机帧（原版动效）
  Object.values(G.sprite_map).forEach(sp => {
    if (sp.startsWith('monster') && /_1\.png$/.test(sp)) loadSprite(sp.replace(/_1\.png$/, '_2.png'));
  });

  // ---------- state ----------
  let state = null;
  let started = false;           // becomes true after choosing 新游戏 / 加载存档
  let shopActive = false;        // true while the shop overlay is open
  let battleAnimating = false;   // true while the battle cinematic page is playing
  let skipBattle = false;        // set by clicking the battle page to fast-forward
  /* Gallery ("资料馆") visiting mode. The three special_* floors are the
     original developer galleries: every item and every monster laid out in
     index order with no walls. They are worth showing off, but only under
     museum rules — look, don't touch. While `visiting` is true nothing is
     picked up, no fight starts, and nothing is written to the save slot.
     `preGallery` holds the snapshot we return to when leaving. */
  let visiting = false;
  let preGallery = null;

  function freshState() {
    // deep clone floors so mutations (pickups, kills, events) persist
    const map = JSON.parse(JSON.stringify(G.floors));
    return {
      floorId: 0,
      special: false,
      px: 5, py: 9,            // start just below the elf on floor 0 (matches original upPosition)
      hp: G.player_init.hp,
      maxhp: G.player_init.hp,
      atk: G.player_init.atk,
      def: G.player_init.def,
      level: G.player_init.level,
      exp: 0,
      money: 0,
      keys: { y: 0, b: 0, r: 0 },
      flags: {
        hasCross: false, elfPower: false, SpiritStick: false, SunStick: false,
        LumpHammer: false, canUseFloorTransfer: false, canUseMonsterManual: false,
        showLossLabels: true,
        metPrincess: false, thiefOpen: false, elfStage: 0, IceStick: false,
        doubleGold: false,
      },
      map: map,
      visited: { 0: true },
      inventory: [],                   // item bar: [{id, name, count, sprite}]
      weapon: null, shield: null,     // equipped display names
      kills: {},                       // 已击败怪物 ID → true（怪物手册标记用）
      playStart: Date.now(),          // play-time tracking (ms epoch)
      over: false, win: false,
      ending: 'normal',              // 通关结局：normal / true / peace（随存档持久化）
      __slot: 0, __slotName: '存档1',  // 当前存档槽索引 / 显示名（随存档一起持久化）
      steps: 0, killCount: 0, goldEarned: 0, startTime: Date.now(),  // 通关统计
    };
  }

  /* Object.keys(state.visited) hands back strings, so "5" must be turned back
     into the number 5 before it can match a floor id. */
  function normFloorId(id) {
    if (typeof id === 'number') return id;
    return /^\d+$/.test(id) ? Number(id) : id;
  }
  function floorById(id) {
    const key = normFloorId(id);
    return state.map.find(f => f.id === key);
  }
  function curFloor() { return floorById(state.floorId); }

  // ---------- helpers ----------
  function log(msg) {
    logEl.textContent = msg;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // any bottom panel (shop / flight / manual / menu / slots) currently open — blocks movement input
  function panelOpen() {
    return shopActive || flightScreen.classList.contains('show') || manualScreen.classList.contains('show')
      || (menuScreen && menuScreen.classList.contains('show'))
      || (slotScreen && slotScreen.classList.contains('show'));
  }

  function floorLabel(rawId) {
    const id = normFloorId(rawId);
    if (typeof id === 'number') return '第 ' + (id + 1) + ' 层';
    const names = {
      special_1: '魔塔工具栏', special_2: '怪物陈列馆', special_3: '神秘空间',
      '23_L': '第 23 层（左）', '23_R': '第 23 层（右）', hell: '魔界·血影',
    };
    return names[id] || String(id);
  }
  // sort floor ids: numeric main tower first (0..23), then special areas in fixed order
  const FLOOR_ORDER = { special_1: 100, special_2: 101, special_3: 102, '23_L': 103, '23_R': 104, hell: 105 };
  // original developer galleries — reachable in the data, but off-limits in play
  const DEBUG_FLOORS = new Set(['special_1', 'special_2', 'special_3']);
  function isDebugFloor(id) { return DEBUG_FLOORS.has(normFloorId(id)); }
  function floorSort(rawA, rawB) {
    const a = normFloorId(rawA), b = normFloorId(rawB);
    const ka = (typeof a === 'number') ? a : (FLOOR_ORDER[a] ?? 999);
    const kb = (typeof b === 'number') ? b : (FLOOR_ORDER[b] ?? 999);
    return ka - kb;
  }

  // ---------- rendering ----------
  // ---------- player slide animation (smooth move between cells) ----------
  let moveAnim = null;    // {fx, fy, tx, ty, t0, dur}
  let moveRAF = null;
  // 玩家朝向：0=朝下（背面）, 1=朝上（正面）, 2=朝右, 3=朝左
  // 修正：素材 player01_2 实际朝左、player01_3 实际朝右，代码中已交换映射
  let playerDir = 1;
  function setPlayerDir(dx, dy) {
    if (dx === 0 && dy === -1) playerDir = 1;
    else if (dx === 0 && dy === 1) playerDir = 0;
    else if (dx === 1 && dy === 0) playerDir = 3;  // 实际朝右的素材是 3
    else if (dx === -1 && dy === 0) playerDir = 2; // 实际朝左的素材是 2
  }
  function startMoveAnim(fx, fy, tx, ty) {
    moveAnim = { fx, fy, tx, ty, t0: performance.now(), dur: 110 };
    if (!moveRAF) {
      const step = () => {
        draw();
        if (moveAnim) moveRAF = requestAnimationFrame(step);
        else moveRAF = null;
      };
      moveRAF = requestAnimationFrame(step);
    }
  }
  function playerDrawPos() {
    let px = state.px, py = state.py;
    if (moveAnim) {
      const k = Math.min(1, (performance.now() - moveAnim.t0) / moveAnim.dur);
      const e = 1 - (1 - k) * (1 - k);        // easeOutQuad：起步快、收尾缓
      px = moveAnim.fx + (moveAnim.tx - moveAnim.fx) * e;
      py = moveAnim.fy + (moveAnim.ty - moveAnim.fy) * e;
      if (k >= 1) { moveAnim = null; moveRAF = null; }   // 动画结束（同步清理，防 rAF 停摆卡死）
    }
    return [px, py];
  }
  // 待机动画循环：层上有怪物时低频重绘，让怪物 _1/_2 帧持续交替（呼吸/浮动）
  let lastIdleDraw = 0;
  function hasMonsterOnScreen() {
    const f = curFloor();
    if (!f || !f.layer1) return false;
    for (let y = 0; y < GRID; y++) {
      const row = f.layer1[y];
      if (!row) continue;
      for (let x = 0; x < GRID; x++) {
        const c = row[x];
        if (c && c.indexOf('monster') === 0) return true;
      }
    }
    return false;
  }
  function idleAnimLoop() {
    const now = performance.now();
    if (started && !battleAnimating && !dialogueActive && !moveAnim && !floorTransitioning
        && now - lastIdleDraw > 400 && hasMonsterOnScreen()) {
      lastIdleDraw = now;
      draw();
    }
    requestAnimationFrame(idleAnimLoop);
  }
  requestAnimationFrame(idleAnimLoop);

  function draw() {
    const f = curFloor();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 1) map
    const lossLabels = [];                 // collected first, painted last (topmost)
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const ox = x, oy = y;
        // base floor
        drawSprite(FLOOR_TILE, ox, oy);
        const l3 = f.layer3[y][x];
        if (l3 && l3 !== '') {
          if (l3.indexOf('wall') === 0) drawCode(l3, ox, oy);
          else if (l3.indexOf('door') === 0) { if (l3.indexOf('open') === -1) drawCode(l3, ox, oy); }
          else if (l3.indexOf('stair') === 0) drawCode(l3, ox, oy);
        }
        const l2 = f.layer2[y][x];
        if (l2 && l2 !== '') drawCode(l2, ox, oy);
        const l1 = f.layer1[y][x];
        if (l1 && l1 !== '') drawCode(l1, ox, oy);
        // 战斗伤害预览：收集待绘制的损失标签（不在此处绘制，避免被下一格地砖/怪物覆盖）
        if (l1 && l1.indexOf('monster') === 0 && state.flags.canUseMonsterManual
            && state.flags.showLossLabels) {
          const loss = battleResult(l1).fullLoss;
          if (loss > 0) lossLabels.push([ox, oy, loss]);
        }
      }
    }
    // player（滑步动画插值位置 + 行走帧轮播：摆臂/脚步）
    const pp = playerDrawPos();
    let pFile = 'player01_' + playerDir + '_1.png';
    if (moveAnim) {
      const k = Math.min(1, (performance.now() - moveAnim.t0) / moveAnim.dur);
      pFile = 'player01_' + playerDir + '_' + (1 + Math.min(3, Math.floor(k * 4))) + '.png';
    }
    drawSprite(pFile, pp[0], pp[1]);
    // 损失数字最后统一绘制，始终位于最上层，不会被地砖或怪物遮挡
    for (let i = 0; i < lossLabels.length; i++) {
      drawLossLabel(lossLabels[i][0], lossLabels[i][1], lossLabels[i][2]);
    }
    // 道具方向反馈：待使用道具时，高亮周围四个格子（琥珀色闪烁）
    if (pendingItem !== null) {
      const flash = (Math.floor(performance.now() / 250) % 2 === 0);
      [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dx,dy]) => {
        const nx = state.px + dx, ny = state.py + dy;
        if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) return;
        ctx.save();
        ctx.globalAlpha = flash ? .35 : .15;
        ctx.fillStyle = '#ffa500';
        ctx.fillRect(nx * TILE, ny * TILE, TILE, TILE);
        ctx.restore();
      });
    }
    if (hudDirty) { updateHUD(); hudDirty = false; }
    updateGalleryChrome();
  }

  // 怪物待机动画帧选择：_1/_2 帧按时间交替（呼吸/浮动，原版动效）
  function monsterAnimFrame(file) {
    if (file && file.startsWith('monster') && /_1\.png$/.test(file)) {
      const alt = file.replace(/_1\.png$/, '_2.png');
      if (IMG[alt] && IMG[alt].complete && IMG[alt].naturalWidth) {
        return (Math.floor(performance.now() / 480) % 2 === 0) ? file : alt;
      }
    }
    return file;
  }
  function drawSprite(file, x, y) {
    file = monsterAnimFrame(file);   // 待机动画帧
    const img = IMG[file];
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, x * TILE, y * TILE, TILE, TILE);
    } else {
      ctx.fillStyle = '#888';
      ctx.fillRect(x * TILE + 4, y * TILE + 4, TILE - 8, TILE - 8);
    }
  }
  function drawCode(code, x, y) {
    const file = G.sprite_map[code];
    if (file) drawSprite(file, x, y);
    else {
      ctx.fillStyle = 'rgba(120,120,200,0.5)';
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }
  // small "-N" cost label drawn just BELOW a monster tile (damage preview),
  // so it never overlaps the sprite itself; font kept tiny
  let __lossLabelCount = 0;
  function drawLossLabel(ox, oy, loss) {
    __lossLabelCount++;
    const px = ox * TILE, py = oy * TILE;
    const txt = '' + loss;                                // digits only, no minus sign
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // uniform small size: picked so the widest loss string fits inside the tile,
    // so every number is the same (small) size and never exceeds the tile width
    let fs = 16;
    const maxW = TILE - 16;
    while (fs > 6) {
      ctx.font = 'bold ' + fs + 'px monospace';
      if (ctx.measureText('-0000').width <= maxW) break;
      fs--;
    }
    const bx = px + TILE / 2, by = py + TILE - 4;        // overlap the monster's lower edge
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, fs * 0.22);
    ctx.strokeStyle = '#ffffff';                         // white outline so it reads on any bg
    ctx.strokeText(txt, bx, by);
    ctx.fillStyle = '#dd6666';                            // blood-red, same as the red potion
    ctx.fillText(txt, bx, by);
    ctx.restore();
  }

  // ---------- HUD icons (pixel sprites from game assets) ----------
  function imgIcon(spriteFile, alt) {
    return '<span class="ic"><img src="assets/item/' + spriteFile + '" alt="' + alt + '" style="width:22px;height:22px;image-rendering:pixelated;display:block"></span>';
  }
  const ICONS = {
    heart:  '<span style="font-size:16px;line-height:1">❤️</span>',
    sword:  imgIcon('item04_1.png', 'ATK'),
    shield: imgIcon('item05_1.png', 'DEF'),
    keyY:   imgIcon('item01_1.png', '黄钥匙'),
    keyB:   imgIcon('item01_2.png', '蓝钥匙'),
    keyR:   imgIcon('item01_3.png', '红钥匙'),
    gold:   imgIcon('item09_1.png', '金币'),
    exp:    '<span style="font-size:16px;line-height:1">🌟</span>',
    floor:  '<svg viewBox="0 0 24 24" fill="none" stroke="#9fd0ff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>',
    lv:     '<svg viewBox="0 0 24 24" fill="#ffd479" stroke="#c9a000" stroke-width="1.5"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>',
    manual: imgIcon('item09_6.png', '圣光徽'),
    flight: imgIcon('item09_4.png', '风之罗盘'),
    soundOn:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>',
    soundOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
  };

  // ---------- HUD helpers: icon + value box (zoned layout) ----------
  function ic(name) { return '<span class="ic">' + (ICONS[name] || '') + '</span>'; }
  /* one vertical stat row: [icon] ........ [value box] */
  // value box auto-shrinks its font as the number grows (5+ digits) so it
  // never overflows the narrow HUD module on small phones.
  function statRow(iconName, cls, val, flash) {
    const s = String(val);
    const fs = s.length >= 7 ? 8 : s.length >= 6 ? 9 : s.length >= 5 ? 10 : 11;
    return '<div class="stat-row' + (flash ? ' flash' : '') + '">' + ic(iconName) +
      '<span class="vbox ' + cls + '" style="font-size:' + fs + 'px">' + s + '</span></div>';
  }
  /* equip module entry: left half = label + name bar, right half = big icon slot */
  function eqz(lbl, item, flash) {
    const none = !item;
    const name = (item && typeof item === 'object') ? item.name : (item || '—');
    const id = (item && typeof item === 'object') ? item.id : null;
    const icon = none || !id ? '<span class="eq-slot empty">空</span>'
      : '<span class="eq-slot"><img src="assets/item/' + G.sprite_map[id] + '" alt="' + lbl + '"></span>';
    const typeCls = (lbl === '武器') ? 'eq-weapon' : 'eq-shield';
    return '<div class="eq-card ' + typeCls + (flash ? ' flash' : '') + '">' +
      '<div class="eq-info">' +
        '<span class="eq-lbl">' + lbl + '</span>' +
        '<span class="eq-name-box">' + name + '</span>' +
      '</div>' + icon +
      '</div>';
  }
  /* lucky-coin badge (left column, below floor): grey until obtained */
  function luckyCoinZone() {
    const got = !!(state.flags && state.flags.doubleGold);
    return '<div class="hz-coin' + (got ? ' on' : ' locked') + '" title="' +
      (got ? '幸运金币：战斗金币翻倍' : '幸运金币：尚未获得') + '">' +
      '<img src="assets/item/item09_1.png" alt="幸运金币">' +
      '</div>';
  }

  let lastHud = null;   // 上一帧 HUD 数值快照，用于变化时闪动提示
  function updateHUD() {
    const fl = floorLabel(state.floorId);
    const cur = {
      lv: state.level, money: state.money, exp: state.exp,
      hp: state.hp, atk: state.atk, def: state.def,
      ky: state.keys.y, kb: state.keys.b, kr: state.keys.r,
      wpn: state.weapon && state.weapon.id, shd: state.shield && state.shield.id
    };
    const firstRun = !lastHud;
    const prev = lastHud || cur;
    const ch = (k) => !firstRun && cur[k] !== prev[k];
    const lvlUp = ch('lv');   // 仅升级时 HUD 闪动；拾取钥匙/血瓶/宝石/金币均不闪
    hud.innerHTML =
      /* === LEFT COLUMN: floor + lucky-coin badge === */
      '<div class="hz-left">' +
        '<div class="hz-floor"><span class="fl-num">' + fl + '</span></div>' +
        luckyCoinZone() +
      '</div>' +
      /* === MODULE A: lv / gold / exp === */
      '<div class="hud-mod">' +
        statRow('lv',   'lv',   state.level, lvlUp) +
        statRow('gold', 'gold', state.money, false) +
        statRow('exp',  'exp',  state.exp,  false) +
      '</div>' +
      /* === MODULE B: hp / atk / def (仅随升级一起闪, 拾取宝石/血瓶不闪) === */
      '<div class="hud-mod">' +
        statRow('heart', 'hp',  state.hp,  lvlUp) +
        statRow('sword', 'atk', state.atk, lvlUp) +
        statRow('shield','def', state.def, lvlUp) +
      '</div>' +
      /* === MODULE C: keys (拾取不闪) === */
      '<div class="hud-mod mod-keys">' +
        statRow('keyY', 'keyy', state.keys.y, false) +
        statRow('keyB', 'keyb', state.keys.b, false) +
        statRow('keyR', 'keyr', state.keys.r, false) +
      '</div>' +
      /* === MODULE D (rightmost): weapon / shield (装备即闪) === */
      '<div class="hud-mod hud-equip-mod">' +
        eqz('武器', state.weapon, ch('wpn')) +
        eqz('盾牌', state.shield, ch('shd')) +
      '</div>';
    // update tool button states
    btnFlight.classList.toggle('disabled', !state.flags.canUseFloorTransfer);
    btnManual.classList.toggle('disabled', !state.flags.canUseMonsterManual);
    btnLossToggle.classList.toggle('disabled', !state.flags.canUseMonsterManual);
    btnLossToggle.classList.toggle('on', state.flags.showLossLabels);
    btnLossToggle.classList.toggle('off', !state.flags.showLossLabels);
    // render item bar
    renderItemBar();
    lastHud = cur;
  }

  // ---------- item bar (inventory) ----------
  // Two distinct classes of items live in the bar. Everything else applies on
  // pickup and is NOT stored, otherwise its effect would fire a second time
  // when the player taps it in the bar (the old bug: 1 yellow key = 2 keys).
  //   ACTIVE — consumed on tap, effect fires here (never on pickup)
  //   BADGE  — permanent quest tokens, tap only shows a description
  const ACTIVE_ITEM_KINDS = new Set(['wallbreak', 'passwall', 'openany', 'bomb']);
  const BADGE_ITEM_KINDS  = new Set(['quest', 'flag', 'doubleGold']);
  function isActiveKind(k) { return ACTIVE_ITEM_KINDS.has(k); }
  function isBadgeKind(k)  { return BADGE_ITEM_KINDS.has(k); }
  function shouldStore(k)  { return isActiveKind(k) || isBadgeKind(k); }

  function addToInventory(itemId) {
    if (!itemId) return;
    const name = G.items[itemId] || itemId;
    const spriteFile = G.sprite_map[itemId];
    const eff = G.item_effects[itemId];
    const badge = !!(eff && isBadgeKind(eff.kind));
    const existing = state.inventory.find(i => i.id === itemId);
    // badges are unique tokens — never stack them
    if (existing) { if (!badge) existing.count++; }
    else { state.inventory.push({ id: itemId, name, count: 1, sprite: spriteFile, badge }); }
  }
  function useInventoryItem(idx) {
    if (visiting) { log('参观资料馆时无法使用道具'); return; }
    if (idx < 0 || idx >= state.inventory.length) return;
    const item = state.inventory[idx];
    if (!item) return;
    const eff = G.item_effects[item.id];
    if (!eff) { log(item.name + '：无特殊效果'); return; }
    // badge — passive token, tap just reports what it does
    if (isBadgeKind(eff.kind)) {
      log(item.name + '：' + (eff.msg || '已生效的关键道具'));
      return;
    }
    // bomb — 炸药: area blast, no direction needed
    if (eff.kind === 'bomb') { detonateBomb(idx, item); return; }
    // directional active items (镐 / 飞羽 / 万用钥匙): arm "pick direction" mode,
    // then tap a HUD direction key (screen d-pad or keyboard arrows) to apply
    if (eff.kind === 'wallbreak' || eff.kind === 'passwall' || eff.kind === 'openany') {
      pendingItem = idx;
      setDirMode(true);
      log('选择方向使用 ' + item.name + '（按方向键，再次点击可取消）');
      return;
    }
    // other active items: fire the effect now, then consume one
    applyEffect(eff);
    log('使用 ' + item.name + (eff.msg ? ' — ' + eff.msg : ''));
    AU.sfx('GetItem');
    consumeInventory(idx);
    updateHUD(); draw(); save();
  }
  /* remove one unit of an inventory entry (badges are never consumed) */
  function consumeInventory(idx) {
    const item = state.inventory[idx];
    if (!item || item.badge) return;
    item.count--;
    if (item.count <= 0) state.inventory.splice(idx, 1);
  }
  // directional active items: arm a "pick direction" mode, then the player
  // presses a HUD direction key (on-screen d-pad or keyboard arrows) to apply.
  let pendingItem = null;
  function setDirMode(on) { if (dpad) dpad.classList.toggle('awaiting', !!on); }

  // 炸药: clear every wall in the 3×3 ring around the player, no self-damage
  function detonateBomb(idx, item) {
    const f = curFloor();
    let cleared = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = state.px + dx, ny = state.py + dy;
        if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) continue;
        const c = (f.layer3[ny] || [])[nx] || '';
        if (c && c.indexOf('wall') === 0) { f.layer3[ny][nx] = ''; cleared++; }
      }
    }
    log('炸药炸开了周围 ' + cleared + ' 格墙壁');
    AU.sfx('getSpecialItem');
    consumeInventory(idx);
    pendingItem = null; setDirMode(false);
    draw(); save();
  }

  // apply the armed item toward (dx, dy); called by d-pad / keyboard arrows
  function usePendingDir(dx, dy) {
    if (pendingItem === null) return;
    const idx = pendingItem;
    const item = state.inventory[idx];
    if (!item) { pendingItem = null; setDirMode(false); return; }
    const eff = G.item_effects[item.id];
    const f = curFloor();
    const nx = state.px + dx, ny = state.py + dy;
    if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) return;
    const cell = (f.layer3[ny] || [])[nx] || '';
    const isWall = !!cell && cell.indexOf('wall') === 0;
    const isDoor = !!cell && cell.indexOf('door') === 0;
    let acted = false;
    if (eff.kind === 'wallbreak' && isWall) { f.layer3[ny][nx] = ''; acted = true; }
    else if (eff.kind === 'passwall' && isWall) { f.layer3[ny][nx] = ''; state.px = nx; state.py = ny; acted = true; }
    else if (eff.kind === 'openany' && isDoor) { f.layer3[ny][nx] = ''; acted = true; }
    if (!acted) { log('该方向没有可作用的' + (isDoor ? '门' : '墙壁')); return; }
    log('使用 ' + item.name);
    AU.sfx('getSpecialItem');
    consumeInventory(idx);
    pendingItem = null; setDirMode(false);
    draw(); save();
  }
  function renderItemBar() {
    if (!state.inventory || state.inventory.length === 0) {
      itemBar.innerHTML = '<span class="item-bar-label">道具栏（空）</span>';
      return;
    }
    let html = '<span class="item-bar-label">道具栏</span>';
    // 飞行器 / 怪物手册 由 HUD 按钮接管：跳过渲染但保留真实索引（旧存档残留不显示）
    state.inventory.forEach((item, i) => {
      if (item.id === 'item09_4' || item.id === 'item09_6') return;
      const spriteHtml = item.sprite
        ? '<img src="assets/' + dirOf(item.sprite) + '/' + item.sprite + '" alt="' + item.name + '" onerror="this.style.display=\'none\'">'
        : '<span style="font-size:16px;color:#6b7299;">?</span>';
      const cnt = (!item.badge && item.count > 1) ? '<span class="item-count">' + item.count + '</span>' : '';
      const cls = 'item-slot' + (item.badge ? ' is-badge' : ' is-active');
      const tag = item.badge ? '🔹' : '🔸';
      const eff = G.item_effects[item.id];
      const tip = tag + ' ' + item.name + (item.badge ? '（已生效）' : '（点击使用）');
      html += '<div class="' + cls + '" data-idx="' + i + '" title="' + tip + '">' + spriteHtml + cnt + '</div>';
    });
    itemBar.innerHTML = html;
    itemBar.querySelectorAll('.item-slot').forEach(slot => {
      slot.addEventListener('click', () => {
        if (!started || dialogueActive || panelOpen()) return;
        const idx = parseInt(slot.dataset.idx, 10);
        const it = state.inventory[idx];
        const eff = it && G.item_effects[it.id];
        const dirKind = eff && (eff.kind === 'wallbreak' || eff.kind === 'passwall' || eff.kind === 'openany');
        // tap an armed item again to cancel direction-pick mode
        if (dirKind && pendingItem === idx) {
          pendingItem = null; setDirMode(false); log('已取消 ' + it.name);
          updateHUD(); return;
        }
        useInventoryItem(idx);
      });
    });
  }

  // ---------- movement & interaction ----------
  // step onto a tile after whatever blocked it is resolved: move, pick up,
  // take stairs. Shared by the synchronous path and the battle cinematic's
  // post-victory callback so both behave identically.
  function enterTile(f, nx, ny) {
    startMoveAnim(state.px, state.py, nx, ny);
    state.px = nx; state.py = ny;
    state.steps = (state.steps || 0) + 1;   // 通关统计：步数
    hudDirty = true;
    AU.sfx('walk');
    const l2 = f.layer2[ny][nx];
    if (l2 && l2 !== '') pickupItem(l2, f, nx, ny);
    const afterL3 = f.layer3[ny][nx];
    if (afterL3 && afterL3.indexOf('stair') === 0) useStair(afterL3);
    draw();
    save();
  }

  function tryMove(dx, dy) {
    if (battleAnimating) return;        // 战斗演示期间锁定一切移动输入
    if (floorTransitioning) return;     // 楼层转场中
    if (state.over || state.win || dialogueActive || panelOpen()) return;
    // 滑步动画由 startMoveAnim 覆盖，不锁输入 → 连续操作流畅
    setPlayerDir(dx, dy);
    const f = curFloor();
    const nx = state.px + dx, ny = state.py + dy;
    if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) return;

    const l1 = f.layer1[ny][nx];
    // NPC -> bump to talk FIRST. Matches the original canMove(): layer1 is checked
    // before layer3, so an NPC standing on a wall tile (e.g. 仙子 npc01_1_5 at
    // floor 21 (6,2), whose layer3 is wall05) is still talkable by bumping into it.
    if (l1 && l1.indexOf('shop') === 0) {
      openShop(l1, f, nx, ny);
      return;
    }
    if (l1 && l1.indexOf('npc') === 0) {
      talkNPC(l1, f, nx, ny);
      return;
    }
    const l3 = f.layer3[ny][nx];
    // wall blocks
    if (l3 && l3.indexOf('wall') === 0) return;
    // door
    if (l3 && l3.indexOf('door') === 0 && l3.indexOf('open') === -1) {
      if (!tryOpenDoor(l3, f, nx, ny)) return;
    }
    // museum rules: exhibits are described, never fought or collected
    if (visiting) {
      if (l1 && l1.indexOf('monster') === 0) { showExhibitMonster(l1); return; }
      const ex = f.layer2[ny][nx];
      startMoveAnim(state.px, state.py, nx, ny);
      state.px = nx; state.py = ny;
      AU.sfx('walk');
      if (ex && ex !== '') showExhibitItem(ex);
      const exStair = f.layer3[ny][nx];
      if (exStair && exStair.indexOf('stair') === 0) useStair(exStair);
      draw();
      return;                            // deliberately no save() while touring
    }
    // monster -> fight
    if (l1 && l1.indexOf('monster') === 0) {
      if (!fightMonster(l1, f, nx, ny)) return; // blocked if can't defeat
    }
    enterTile(f, nx, ny);
  }

  function tryOpenDoor(code, f, x, y) {
    if (code.indexOf('door05') === 0) { openDoor(f, x, y, true); return true; } // iron door: always openable
    if (code === 'door01') { if (state.keys.y > 0) { state.keys.y--; openDoor(f, x, y, false); return true; } log('需要黄钥匙'); return false; }
    if (code === 'door02') { if (state.keys.b > 0) { state.keys.b--; openDoor(f, x, y, false); return true; } log('需要蓝钥匙'); return false; }
    if (code === 'door03') { if (state.keys.r > 0) { state.keys.r--; openDoor(f, x, y, false); return true; } log('需要红钥匙'); return false; }
    // special doors
    if (code === 'door04_1') {
      if (state.flags.thiefOpen) { openDoor(f, x, y, true); return true; }
      log('这扇门需要小偷的帮助才能打开'); return false;
    }
    if (code.indexOf('door04') === 0) { // hell gate (door04_2 / door04)
      if (state.flags.elfPower || (state.flags.SpiritStick && state.flags.SunStick)) { openDoor(f, x, y, true); return true; }
      log('地狱之门紧闭——需要仙子的魔力或心炎双灵杖'); return false;
    }
    openDoor(f, x, y, false); return true;
  }
  function openDoor(f, x, y, special) {
    f.layer3[y][x] = '';
    AU.sfx(special ? 'openSpecialDoor' : 'openDoor');
  }

  // ---------- combat (exact FightCalc replication) ----------
  /* Pure (read-only) projection of a fight outcome, shared by the damage
     preview and (for consistency) fightMonster. Mirrors the original
     canFight()/battle loop from 胖老鼠 魔塔 exactly. Reads state, mutates nothing. */
  function battleResult(id) {
    const m = G.monsters[id];
    if (!m) return { win: false, reason: 'missing', hpLost: 0, fullLoss: 0, rounds: 0, pDmg: 0, mDmg: 0, gold: 0, exp: 0 };
    let mDamage;
    if (m.mage) mDamage = m.atk;                  // mage: true damage
    else mDamage = m.atk - state.def;
    if (mDamage <= 0 && mDamage > -20) mDamage = 1;
    else if (mDamage <= -20) mDamage = 0;
    let pDamage = state.atk - m.df;
    if (pDamage <= 0 && pDamage > -20) pDamage = 1;
    else if (pDamage <= -20) pDamage = 0;
    if (pDamage <= 0) return { win: false, reason: 'weak', hpLost: 0, fullLoss: 0, rounds: 0, pDmg: pDamage, mDmg: mDamage, gold: 0, exp: 0 };

    let mHP = m.hp, pHP = state.hp;
    let attackNo = 0, mTotal = 0;
    while (mHP > 0 && pHP > 0) {
      if (attackNo % 2 === 0) mHP -= pDamage;
      else { pHP -= mDamage; mTotal += mDamage; }
      attackNo++;
    }
    if (id === 'monster04_13' && (mTotal === 0 || mDamage === 1)) mTotal = Math.round(state.hp / 3);
    else if (id === 'monster10_1' && (mTotal === 0 || mDamage === 1)) mTotal = Math.round(state.hp / 4);

    const win = mTotal < state.hp;
    return {
      win, reason: win ? 'ok' : 'lethal',
      hpLost: win ? mTotal : 0, fullLoss: mTotal,
      rounds: attackNo, pDmg: pDamage, mDmg: mDamage,
      gold: state.flags.doubleGold ? m.money * 2 : m.money, exp: m.exp,
    };
  }

  // ---------- battle cinematic helpers ----------
  function bsAttr(file, val) {
    return '<span class="ic"><img src="assets/item/' + file + '" alt="">' + val + '</span>';
  }
  function setBar(barId, txtId, pct, cur, max) {
    const bar = document.getElementById(barId);
    bar.style.width = Math.max(0, Math.min(100, pct * 100)) + '%';
    const t = document.getElementById(txtId);
    if (t) t.textContent = Math.max(0, Math.round(cur)) + ' / ' + max;
  }
  function bsHit(clsId) {
    const el = document.getElementById(clsId);
    el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
  }
  function bsFillPanels(m, id) {
    const mf = G.sprite_map[id];
    const mImg = document.getElementById('bsMonsterImg');
    if (mf) mImg.src = 'assets/' + dirOf(mf) + mf; else mImg.removeAttribute('src');
    document.getElementById('bsMonsterName').textContent = m.name;
    document.getElementById('bsMonsterAttrs').innerHTML =
      bsAttr('item06_1.png', m.hp) + bsAttr('item04_1.png', m.atk) + bsAttr('item05_1.png', m.df);
    document.getElementById('bsHeroImg').src = 'assets/' + dirOf('player01_1_1.png') + 'player01_1_1.png';
    document.getElementById('bsHeroAttrs').innerHTML =
      bsAttr('item06_1.png', state.hp) + bsAttr('item04_1.png', state.atk) + bsAttr('item05_1.png', state.def);
  }

  // 正常战斗演示：逐回合播放扣血过程，结束才提交状态
  function playBattle(o) {
    const { m, id, x, y, f, rounds, won, mTotal, goldGain } = o;
    const monMax = m.hp, heroMax = state.hp;
    bsFillPanels(m, id);
    // 预估损失血量：在怪物卡片下方动态添加/更新
    let lossHint = document.getElementById('bsLossHint');
    if (!lossHint) {
      lossHint = document.createElement('div');
      lossHint.id = 'bsLossHint';
      lossHint.style.cssText = 'font-size:12px;color:#ff9b3b;text-align:center;margin-top:4px;font-weight:700';
      document.getElementById('bsMonster').appendChild(lossHint);
    }
    lossHint.textContent = '预估损失 HP：' + mTotal;
    setBar('bsMonsterHp', 'bsMonsterHpTxt', 1, monMax, monMax);
    setBar('bsHeroHp', 'bsHeroHpTxt', 1, heroMax, heroMax);
    const logEl = document.getElementById('bsLog');
    logEl.innerHTML = '';
    const bs = document.getElementById('battleScreen');
    skipBattle = false;
    bs.onclick = () => { skipBattle = true; };
    const skipBtn = document.getElementById('battleSkip');
    if (skipBtn) skipBtn.onclick = (e) => { e.stopPropagation(); skipBattle = true; };
    bs.classList.add('show');
    battleAnimating = true;

    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    (async () => {
      for (const r of rounds) {
        const ln = document.createElement('div');
        if (r.who === 'hero') {
          ln.className = 'ln hero';
          ln.textContent = '▶ 勇士 攻击，造成 ' + r.dmg + ' 点伤害';
          setBar('bsMonsterHp', 'bsMonsterHpTxt', r.mHP / monMax, r.mHP, monMax);
          bsHit('bsMonster');
        } else {
          ln.className = 'ln monster';
          ln.textContent = '◀ ' + m.name + ' 反击，造成 ' + r.dmg + ' 点伤害';
          setBar('bsHeroHp', 'bsHeroHpTxt', r.pHp / heroMax, r.pHp, heroMax);
          bsHit('bsHero');
        }
        logEl.appendChild(ln);
        logEl.scrollTop = logEl.scrollHeight;
        if (!skipBattle) await delay(220);  // 战斗演示速度：单步 220ms
      }
      const end = document.createElement('div');
      if (won) {
        end.className = 'ln win';
        end.textContent = '★ 胜利！获得经验 ' + m.exp + (goldGain ? '、金币 ' + goldGain : '');
        logEl.appendChild(end);
        state.hp -= mTotal;
        state.money += goldGain;
        state.exp += m.exp;
        hudDirty = true;                 // 战斗后 HP/金币/经验变化
        f.layer1[y][x] = '';               // monster defeated
        state.kills = state.kills || {};
        state.kills[id] = true;             // 怪物手册「已击败」标记
        state.killCount = (state.killCount || 0) + 1;  // 通关统计
        state.goldEarned += goldGain;       // 通关统计：累计金币
        log('击杀: ' + m.name + '，损失 ' + mTotal + ' HP（获得经验 ' + m.exp + (goldGain ? '、金币 ' + goldGain : '') + '）');
        if (!skipBattle) await delay(320);  // 战斗演示速度：结束停顿 320ms
        bs.classList.remove('show'); bs.onclick = null; battleAnimating = false;
        enterTile(f, x, y);
      } else {
        end.className = 'ln lose';
        end.textContent = '× 战败……你倒在了 ' + m.name + ' 面前';
        logEl.appendChild(end);
        autoSave();                      // 阵亡前自动存档（方便读回重试）
        state.hp = 0;
        log('被 ' + m.name + ' 击败，损失 ' + mTotal + ' HP……');
        AU.sfx('Fail');
        if (!skipBattle) await delay(320);  // 战斗演示速度：结束停顿 320ms
        bs.classList.remove('show'); bs.onclick = null; battleAnimating = false;
        showLose();
      }
    })();
  }

  function fightMonster(id, f, x, y) {
    const m = G.monsters[id];
    if (!m) return false;
    if (state.flags.canUseMonsterManual) {
      log('【' + m.name + '】 HP ' + m.hp + ' 攻 ' + m.atk + ' 防 ' + m.df);
    }
    let mHP = m.hp;
    let pHP = state.hp;
    let mDamage;
    if (m.mage) mDamage = m.atk;                  // mage: true damage
    else mDamage = m.atk - state.def;
    if (mDamage <= 0 && mDamage > -20) mDamage = 1;
    else if (mDamage <= -20) mDamage = 0;
    let pDamage = state.atk - m.df;
    if (pDamage <= 0 && pDamage > -20) pDamage = 1;
    else if (pDamage <= -20) pDamage = 0;
    const canDefeat = pDamage > 0;

    // 同步模拟整场战斗并逐回合记录（供演出与即时结算共用）
    const rounds = [];
    let attackNo = 0, pTotal = 0, mTotal = 0, simMHP = mHP, simPHP = pHP;
    if (canDefeat) {
      while (simMHP > 0 && simPHP > 0) {
        if (attackNo % 2 === 0) { simMHP -= pDamage; pTotal += pDamage; rounds.push({ who: 'hero', dmg: pDamage, mHP: Math.max(0, simMHP), pHp: simPHP }); }
        else { simPHP -= mDamage; mTotal += mDamage; rounds.push({ who: 'monster', dmg: mDamage, mHP: simMHP, pHp: Math.max(0, simPHP) }); }
        attackNo++;
      }
    }
    const won = canDefeat && simMHP <= 0;
    if (id === 'monster04_13' && (mTotal === 0 || mDamage === 1)) mTotal = Math.round(state.hp / 3);
    else if (id === 'monster10_1' && (mTotal === 0 || mDamage === 1)) mTotal = Math.round(state.hp / 4);
    const goldGain = state.flags.doubleGold ? m.money * 2 : m.money;

    // 演出默认在“正常游玩”触发；测试模式下关闭，除非显式 __MT_FORCE_CINEMATIC__（仅用于自动化验证）
    const cinematic = settings.battleCinematic !== false
      && (!window.__MT_TEST__ || window.__MT_FORCE_CINEMATIC__);

    // 攻防不足：直接提示，不弹出任何战斗页面 / 画面
    if (!canDefeat) {
      log('它太强大了，无法战胜');
      return false;
    }
    // 演出分支：立即返回（阻止 tryMove 提前移动），动画结束再提交状态
    if (cinematic) {
      AU.sfx('fight');
      playBattle({ m, id, x, y, f, rounds, won, mTotal, goldGain });
      return false;
    }
    // 即时结算分支（测试 / 关闭演出）：与旧逻辑完全一致
    AU.sfx('fight');
    state.hp -= mTotal;
    if (state.hp <= 0) {
      // 力战不敌 —— 玩家阵亡，怪物仍在场，本次进攻无效（玩家不能前进一步）
      state.hp = 0;
      log('被 ' + m.name + ' 击败，损失 ' + mTotal + ' HP……');
      AU.sfx('Fail');
      draw();
      showLose();
      return false;
    }
    // survived: collect rewards and clear the tile
    state.money += goldGain;
    state.exp += m.exp;
    f.layer1[y][x] = '';               // monster defeated
    log('击杀: ' + m.name + '，损失 ' + mTotal + ' HP（获得经验 ' + m.exp + (goldGain ? '、金币 ' + goldGain : '') + '）');
    save();
    return true;
  }

  // ---------- items ----------
  function pickupItem(id, f, x, y) {
    const eff = G.item_effects[id];
    f.layer2[y][x] = '';
    if (!eff) { log('获得 ' + (G.items[id] || id) + '（无特殊效果）'); AU.sfx('getItem'); return; }
    // equip weapons / shields into HUD slot
    if (id.indexOf('item04_') === 0) state.weapon = { name: G.items[id], id: id };
    if (id.indexOf('item05_') === 0) state.shield = { name: G.items[id], id: id };
    const special = (eff.kind === 'quest' || eff.kind === 'flag' || eff.kind === 'level');
    // ACTIVE items are stored unused — their effect fires from the item bar.
    // Everything else (keys, potions, gems, quest tokens) applies right now.
    if (!isActiveKind(eff.kind)) applyEffect(eff);
    // 飞行器 / 怪物手册 已由下方 HUD 按钮接管，不再进道具栏
    if (shouldStore(eff.kind) && id !== 'item09_4' && id !== 'item09_6') addToInventory(id);
    AU.sfx(special ? 'GetSpecialItem' : 'GetItem');
    log(eff.msg || ('获得 ' + (G.items[id] || id)));
  }
  function applyEffect(eff) {
    hudDirty = true;                     // 属性/钥匙变化 → HUD 刷新
    switch (eff.kind) {
      case 'key':
        if (eff.key === 'ybr') { state.keys.y++; state.keys.b++; state.keys.r++; }
        else if (eff.key === 'y') state.keys.y++;
        else if (eff.key === 'b') state.keys.b++;
        else if (eff.key === 'r') state.keys.r++;
        break;
      case 'atk': state.atk += eff.val; break;
      case 'def': state.def += eff.val; break;
      case 'atkdef': state.atk += eff.atk; state.def += eff.def; break;
      case 'hp': state.hp += eff.val; state.maxhp = Math.max(state.maxhp, state.hp); break;
      case 'hpmul': state.hp = Math.round(state.hp * eff.val); state.maxhp = Math.max(state.maxhp, state.hp); break;
      case 'fullmul':
        state.hp = Math.round(state.hp * eff.val);
        state.atk = Math.round(state.atk * eff.val);
        state.def = Math.round(state.def * eff.val);
        state.maxhp = Math.max(state.maxhp, state.hp);
        break;
      case 'exp': state.exp += eff.val; break;
      case 'money': state.money += eff.val; state.goldEarned += eff.val; break;
      case 'level': state.level++; state.atk += eff.atk; state.def += eff.def; state.hp += eff.hp; break;
      case 'quest': state.flags[eff.flag] = true; break;
      case 'flag': state.flags[eff.flag] = true; break;
      case 'doubleGold': state.flags.doubleGold = true; break;
      case 'wallbreak': break;   // active-use item, handled by useInventoryItem
    }
    if (eff.flag === 'hasCross' && state.flags.elfPower === false) {
      // hint
    }
  }

  // ---------- stairs / floor transition ----------
  // ---------- floor transition (white flash, then swap, then fade out) ----------
  let floorTransitioning = false;
  let hudDirty = true;             // HUD 脏标志：仅在状态变化时重建 DOM（图标不跳）
  function goFloorWithFade(id, x, y) {
    if (window.__MT_TEST__) { goToFloor(id, x, y); return; }   // 测试环境同步换层（不播转场）
    if (floorTransitioning) return;
    floorTransitioning = true;
    autoSave();                          // 楼层切换前自动存档
    const fade = document.getElementById('floorFade');
    fade.style.transition = 'none';
    fade.classList.add('active');                 // 立即白屏
    setTimeout(() => {
      goToFloor(id, x, y);                        // 换层
      fade.style.transition = 'opacity .18s ease';
      fade.classList.remove('active');            // 淡出
      setTimeout(() => { floorTransitioning = false; }, 200);
    }, 110);
  }

  function useStair(code) {
    // special stairs (stair03_* / stair04_*) work on BOTH normal and special
    // floors — e.g. stair03_1 on floor 0 (→ 魔塔工具栏) and stair04_4 on floor
    // 23 (→ 魔界). The original TowerPanel handles stair03/04 via the same
    // special-stair script regardless of floor type.
    if (code.indexOf('stair03') === 0 || code.indexOf('stair04') === 0) {
      AU.sfx('specialStair');
      const info = G.special_stair[code];
      if (info) { goFloorWithFade(info.target, info.x, info.y); return; }
      return;
    }
    if (state.special) return;           // stair01/02 only on normal floors
    if (code === 'stair01') {            // down a floor
      const t = state.floorId - 1;
      if (t < 0) return;
      const tf = floorById(t);
      AU.sfx('upAndDown');
      goFloorWithFade(t, tf.down[0], tf.down[1]);
    } else if (code === 'stair02') {     // up a floor
      const t = state.floorId + 1;
      if (t > 23) return;
      const tf = floorById(t);
      AU.sfx('upAndDown');
      goFloorWithFade(t, tf.up[0], tf.up[1]);
    }
  }
  // 里程碑提示：主塔每 10 层 + 地下特殊层（23_L / 23_R / hell）
  let milestoneTimer = null;
  function showMilestone(floorId) {
    const el = document.getElementById('milestoneToast');
    if (!el) return;
    const isSpecial = (typeof floorId !== 'number');
    el.querySelector('.mt-big').textContent = floorLabel(floorId);
    el.querySelector('.mt-small').textContent = isSpecial ? '地下特殊层' : '进度里程碑';
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    if (milestoneTimer) clearTimeout(milestoneTimer);
    milestoneTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }
  function goToFloor(rawId, x, y) {
    const id = normFloorId(rawId);          // never store "5" where 5 is meant
    state.floorId = id;
    // 里程碑 / 地下特殊层 提示
    const disp = (typeof id === 'number') ? id + 1 : null;
    if (disp && disp % 10 === 0) showMilestone(id);
    else if (id === '23_L' || id === '23_R' || id === 'hell') showMilestone(id);
    hudDirty = true;                     // 换层 → HUD 刷新楼层显示
    state.special = (typeof id !== 'number');
    state.px = x; state.py = y;
    state.visited[id] = true;
    log('进入 ' + floorLabel(id));
    AU.playBgm(bgmForFloor(id));         // switch BGM only when musicNo changes
    draw();
    save();                              // no-op while visiting (see save())
  }

  // ---------- gallery ("资料馆") visiting mode ----------
  /* Enter with a full snapshot of the run so the tour can never corrupt it. */
  function enterGallery(floorId) {
    const target = floorId || 'special_1';
    const f = floorById(target);
    if (!f) { log('资料馆数据缺失'); return; }
    if (!visiting) {
      preGallery = { state: JSON.parse(JSON.stringify(state)), started: started };
      visiting = true;
    }
    started = true;
    hideStart(); hideEnd();
    state.floorId = target;
    state.special = true;
    const spot = galleryEntry(f);
    state.px = spot[0]; state.py = spot[1];
    AU.unlock();
    AU.playBgm('Underground2');
    draw();
    log('资料馆 · ' + floorLabel(target) + '　—　展品仅供观看');
  }
  /* Leave and restore everything exactly as it was before the tour. */
  function exitGallery() {
    if (!visiting) return;
    const snap = preGallery;
    visiting = false; preGallery = null;
    if (snap) { state = snap.state; started = snap.started; }
    if (started) {
      AU.playBgm(bgmForFloor(state.floorId));
      draw();
      log('离开资料馆，回到 ' + floorLabel(state.floorId));
    } else {
      // toured straight from the title screen — go back there
      AU.playBgm('HometownDomina');
      draw();
      showStart();
    }
    updateGalleryChrome();
  }
  /* Banner visibility + which wing is highlighted. */
  function updateGalleryChrome() {
    const bar = document.getElementById('galleryBar');
    if (!bar) return;
    bar.classList.toggle('show', visiting);
    if (!visiting) return;
    const here = String(state.floorId);
    bar.querySelectorAll('.gb-nav button').forEach((b) => {
      b.classList.toggle('cur', b.dataset.floor === here);
    });
    const txt = bar.querySelector('.gb-text');
    if (txt) txt.textContent = floorLabel(state.floorId) + ' · 展品仅供观看';
  }

  /* Exhibit labels. The original data already carries a human-readable `msg`
     for every effect, so reuse it rather than re-describing the numbers. */
  function exhibitEffectText(id) {
    const eff = G.item_effects[id];
    if (!eff) return '陈列品 · 无实际效果';
    if (eff.msg) return String(eff.msg).replace(/^获得/, '');
    switch (eff.kind) {
      case 'key':      return '钥匙类道具';
      case 'atk':      return '攻击 +' + eff.val;
      case 'def':      return '防御 +' + eff.val;
      case 'atkdef':   return '攻击 +' + eff.atk + '、防御 +' + eff.def;
      case 'hp':       return '生命 +' + eff.val;
      case 'exp':      return '经验 +' + eff.val;
      case 'fullmul':  return '生命/攻击/防御 ×' + eff.val;
      case 'quest':    return '剧情关键道具';
      case 'wallbreak':return '可凿开身边的墙壁';
      case 'passwall': return '可飞越相邻的墙壁';
      case 'openany':  return '可打开任意一扇门（不耗钥匙）';
      case 'bomb':     return '炸毁周围一圈的墙壁';
      default:         return '特殊道具';
    }
  }
  function showExhibitItem(id) {
    const name = G.items[id] || id;
    showFlavor('展品 · ' + name, exhibitEffectText(id) + '\n\n（资料馆展品，仅供观看）');
  }
  function showExhibitMonster(id) {
    const m = G.monsters[id];
    if (!m) { log('未知展品'); return; }
    const rows = [
      '生命 ' + (m.hp != null ? m.hp : '—'),
      '攻击 ' + (m.atk != null ? m.atk : '—'),
      '防御 ' + (m.df != null ? m.df : '—'),
      '经验 ' + (m.exp || 0),
      '金币 ' + (m.money || 0),
    ].join('　');
    const tags = [];
    if (m.mage) tags.push('法师（无视防御）');
    if (m.real === false) tags.push('未收录于怪物手册');
    showFlavor('展品 · ' + (m.name || id),
      rows + (tags.length ? '\n' + tags.join(' · ') : '') + '\n\n（资料馆展品，不会发生战斗）');
  }

  /* First walkable tile — galleries have no walls, but stay defensive. */
  function galleryEntry(f) {
    for (let y = GRID - 1; y >= 0; y--) {
      for (let x = 0; x < GRID; x++) {
        const l3 = (f.layer3[y] || [])[x];
        if (l3 && l3.indexOf('wall') === 0) continue;
        if (l3 && l3.indexOf('stair') === 0) continue;   // don't spawn on a stair
        if ((f.layer1[y] || [])[x]) continue;
        if ((f.layer2[y] || [])[x]) continue;
        return [x, y];
      }
    }
    return [5, 10];
  }

  // ---------- NPC / Boss 分支对话配置（Task C） ----------
  // 与 data.js 的 G.npcs 解耦：这里只描述“选项”与“分支文本”，引擎读取后渲染。
  // 每个选项可含：label（按钮文字）、event（复用 applyEvent 的事件名）、
  // set（写 flags / 改 stats）、goto（指向 branches 中的分支 id）。
  const BRANCHES = {
    // 1) 仙子（已得十字架，可强化）
    npc01_1_2: {
      choices: [
        { label: '接受仙子的祝福（攻防提升，开启 21 层）', event: 'elf_boost' },
        { label: '稍后再来，我先去探探路', set: { flags: { elfBoostDeferred: true } } },
      ],
    },
    // 2) 老者·银剑（500 经验换银剑）
    npc02_1: {
      choices: [
        { label: '用 500 经验换下那把银剑', event: 'merchant_give_sword' },
        { label: '暂不需要，留着经验要紧', set: { flags: { declinedSword: true } } },
      ],
    },
    // 3) 神秘老人·冰之令牌
    npc02_3: {
      choices: [
        { label: '接受圣光徽试炼，领取冰之令牌', event: 'grant_ice_stick' },
        { label: '先不领取，容后再议', set: { flags: { declinedIceStick: true } } },
      ],
    },
    // 4) 老者·银盾（500 经验换银盾）
    npc03_1: {
      choices: [
        { label: '用 500 经验换下那面银盾', event: 'merchant_give_shield' },
        { label: '暂不需要，留着经验要紧', set: { flags: { declinedShield: true } } },
      ],
    },
    // 5) 神秘老人·圣剑（500 经验换圣剑）
    npc02_2_2: {
      choices: [
        { label: '用 500 经验换下那把圣剑', event: 'merchant2_give' },
        { label: '暂不需要', set: { flags: { declinedHolySword: true } } },
      ],
    },
    // 6) 小偷（帮忙砸开 18 层通道）
    npc04_2: {
      choices: [
        { label: '请小偷用铁锤砸开通道', event: 'thief_clear' },
        { label: '我自己想办法开路', set: { flags: { thiefDeclined: true } } },
      ],
    },
    // 7) 公主（营救使命）
    npc05_1: {
      choices: [
        { label: '接受使命，先去击败大魔王', event: 'princess', set: { flags: { acceptedPrincess: true } } },
        { label: '我想先尽情探索魔塔', event: 'princess', set: { flags: { exploreFirst: true } } },
      ],
    },
    // 3 Boss 分支（战前抉择，记录玩家意图旗标）
    npc06_1_1: {
      choices: [
        { label: '正面迎战红衣魔王', set: { flags: { bossRedChallenged: true } } },
        { label: '暂避其锋芒，日后再来', set: { flags: { bossRedAvoided: true } } },
      ],
    },
    npc06_2_1: {
      choices: [
        { label: '前往 21 楼会一会格勒第', set: { flags: { bossGreatChallenged: true } } },
        { label: '暂作休整，再战不迟', set: { flags: { bossGreatAvoided: true } } },
      ],
    },
    npc06_2_2: {
      choices: [
        { label: '乘胜追击，终结格勒第', set: { flags: { bossTauntChallenged: true } } },
        { label: '且看他能唤来什么救兵', set: { flags: { bossTauntAvoided: true } } },
      ],
    },
  };

  // ---------- NPC dialogue & events ----------
  let dialogueActive = false;
  let dlgQueue = [], dlgNPC = null, dlgFloor = null, dlgX = 0, dlgY = 0, dlgIdx = 0;
  let choiceMode = false, currentChoices = null, dlgBranching = false, pendingEvent = null;
  const ovChoices = document.getElementById('ovChoices');

  // 「向导」提示系统：二次对话按玩家进度给不剧透的游戏指引
  function guideHints(floorId) {
    const f = (typeof floorId === 'number') ? floorId : 0;
    let tip = '';
    if (f <= 2)      tip = '提示：第二层那位老人提到的物品，留意附近的发光物。';
    else if (f <= 6) tip = '提示：蓝钥匙别浪费，大房间附近常有秘密通路。';
    else if (f <= 13)tip = '提示：冰封之地的入口不止一条路。';
    else if (f <= 19)tip = '提示：拿到飞行器后可以去之前到不了的楼层看看。';
    else if (f <= 24)tip = '提示：第21层如果打不动，回头强化属性再来。';
    else             tip = '提示：魔龙的弱点，也许藏在他身后的某件东西里。';
    return [
      { who: 'businessman', text: '嘿，又见面了！我这有个小提示：' },
      { who: 'businessman', text: tip },
      { who: 'player', text: '谢谢，我会留意的。' },
    ];
  }
  function talkNPC(id, f, x, y) {
    const npc = G.npcs[id];
    if (!npc) return;
    if (!npcCanMeet(id)) { log((npc.name || '对方') + ' 暂时不愿见你'); return; }
    autoSave();                          // NPC 对话前自动存档
    // 「奇怪的人」二次对话 → 根据当前进度给出游戏提示
    if (id === 'npc03_3' && state.flags.talkedToGuide) {
      dlgQueue = guideHints(state.floorId);
      dlgNPC = id; dlgFloor = f; dlgX = x; dlgY = y; dlgIdx = 0; dlgBranching = false; currentChoices = null; pendingEvent = '';
      showDlg(0); overlay.style.display = 'block'; dialogueActive = true; AU.sfx('dialogueSpace');
      return;
    }
    dlgQueue = npc.dialogues.map(d => ({ who: d.who, text: d.text }));
    dlgNPC = id; dlgFloor = f; dlgX = x; dlgY = y; dlgIdx = 0;
    const br = BRANCHES[id];
    dlgBranching = !!(br && br.choices && br.choices.length);
    currentChoices = dlgBranching ? br.choices : null;
    pendingEvent = '';
    dialogueActive = true;
    AU.sfx('dialogueSpace');
    overlay.style.display = 'block';
    showDlg(0);
  }
  function npcCanMeet(id) {
    if (id === 'npc01_1_2') return state.flags.hasCross;
    if (id === 'npc01_1_3') return state.flags.IceStick === true;
    if (id === 'npc01_1_4') return state.flags.IceStick === true && state.flags.hasCross;
    if (id === 'npc01_1_6') return state.flags.SpiritStick && state.flags.SunStick;
    if (id === 'npc02_2_2') return state.exp >= 500;
    if (id === 'npc03_2_2') return state.money >= 500;
    if (id === 'npc04_2') return state.flags.LumpHammer === true;
    return true;
  }
  function showDlg(i) {
    const d = dlgQueue[i];
    ovName.textContent = d.who === 'player' ? '勇士' : (G.npcs[dlgNPC] ? G.npcs[dlgNPC].name : '');
    ovText.textContent = d.text;
    const last = i >= dlgQueue.length - 1;
    ovHint.textContent = (last && currentChoices && currentChoices.length)
      ? '请选择下方选项 ▼'
      : (last ? '空格 / 点击 结束 ✕' : '空格 / 点击 继续 ▶');
  }
  function showChoices(choices) {
    choiceMode = true;
    ovChoices.innerHTML = '';
    choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'ov-choice';
      b.textContent = c.label;
      b.addEventListener('click', (e) => { e.stopPropagation(); chooseOption(i); });
      ovChoices.appendChild(b);
    });
    ovChoices.style.display = 'flex';
  }
  function hideChoices() {
    choiceMode = false;
    ovChoices.style.display = 'none';
    ovChoices.innerHTML = '';
  }
  function applySet(set) {
    if (!set) return;
    if (set.flags) Object.keys(set.flags).forEach((k) => { state.flags[k] = set.flags[k]; });
    if (set.stats) Object.keys(set.stats).forEach((k) => {
      const v = set.stats[k];
      if (k === 'hp') { state.hp += v; state.maxhp = Math.max(state.maxhp, state.hp); }
      else if (state[k] != null) state[k] += v;
      else state[k] = v;
    });
  }
  function chooseOption(i) {
    if (!choiceMode || !currentChoices) return;
    autoSave();                          // 关键剧情分支前自动存档
    const c = currentChoices[i];
    if (!c) return;
    hideChoices();
    if (c.set) applySet(c.set);
    pendingEvent = c.event || '';     // '' = 显式“无事件”（避免回落到 NPC 默认事件）
    const br = BRANCHES[dlgNPC];
    const branch = (c.goto && br && br.branches && br.branches[c.goto]);
    if (branch) {
      dlgQueue = branch.map(d => ({ who: d.who, text: d.text }));
      dlgIdx = 0;
      currentChoices = null;
      showDlg(0);
    } else {
      closeDlg();
    }
  }
  function advanceDlg() {
    if (!dialogueActive) return;
    if (choiceMode) return;          // 选项展示中，空格/点击不推进对话
    if (dlgIdx < dlgQueue.length - 1) { dlgIdx++; showDlg(dlgIdx); return; }
    if (currentChoices && currentChoices.length) { showChoices(currentChoices); return; }
    closeDlg();
  }
  function closeDlg() {
    overlay.style.display = 'none';
    dialogueActive = false;
    // 首次与「奇怪的人」对话 → 标记已对话（之后再来给提示）
    if (dlgNPC === 'npc03_3' && !state.flags.talkedToGuide) {
      state.flags.talkedToGuide = true;
    }
    // exhibit cards carry no event and must not mutate the tower
    if (!visiting) applyEvent(dlgNPC, dlgFloor, dlgX, dlgY, dlgBranching ? pendingEvent : undefined);
    dlgBranching = false; pendingEvent = null;
    hideChoices();
    draw();
    save();
  }

  function applyEvent(id, f, x, y, evName) {
    const npc = G.npcs[id];
    const ev = (evName == null) ? (npc && npc.event) : evName;
    if (!ev) return;
    switch (ev) {
      case 'elf_first':
        state.keys.y++; state.keys.b++; state.keys.r++;
        floorById(0).layer1[8][4] = 'npc01_1_2';   // elf becomes "powered" version
        floorById(0).layer1[8][5] = '';            // clear the old elf so the up-corridor opens (fixes original soft-lock)
        // NOTE: do NOT open stair03_1 here. special_1/2/3 are the original
        // developer galleries — 49 items (神圣剑 included) and 107 monsters with
        // no walls. Placing their entrance under the player's starting tile let
        // the whole game be trivialised on turn one.
        log('仙子赠予 黄/蓝/红 钥匙，并指引你寻找十字架');
        break;
      case 'elf_boost':
        if (!state.flags.hasCross) { log('仙子：你还未找到幸运十字架'); break; }
        state.atk = Math.round(state.atk * 4 / 3);
        state.def = Math.round(state.def * 4 / 3);
        state.flags.elfPower = true;
        floorById(20).layer3[7][5] = 'stair02';    // open the gate to floor 21
        log('仙子授予更强力量！攻防提升，第21层的门已开启');
        break;
      case 'elf_ice':
        if (state.flags.IceStick) { floorById(0).layer1[8][4] = 'npc01_1_2'; state.flags.elfPower = true; }
        break;
      case 'elf_ice_boost':
        state.atk = Math.round(state.atk * 4 / 3); state.def = Math.round(state.def * 4 / 3);
        floorById(20).layer3[7][5] = 'stair02';
        break;
      case 'elf_stick5':
        // 仙子（21层）：安置22层仙子、打开23_L/23_R铁门，并打通 21→22 上行楼梯
        floorById(22).layer1[2][6] = 'npc01_1_6';
        floorById('23_R').layer3[5][7] = 'door05';
        floorById('23_L').layer3[5][3] = 'door05';
        floorById(21).layer3[1][5] = 'stair02';   // 修复原版移植遗漏的 21→22 上行楼梯
        log('仙子：去第22层找我吧！第21层的上行之门已经开启。');
        break;
      case 'elf_stick6':
        // 仙子（22层）：解封魔界守卫、清空18层公主
        for (let r = 1; r <= 3; r++) for (let c = 4; c <= 6; c++) floorById('hell').layer1[r][c] = 'monster11_' + ((r - 1) * 3 + (c - 3));
        floorById(18).layer1[4][5] = '';
        log('仙子：三灵杖的封印已解除！速去魔界斩杀大魔王！');
        break;
      case 'merchant_give_sword':
        floorById(2).layer2[10][7] = 'item04_2'; log('商人：我送你一把银剑，去2层取吧'); break;
      case 'merchant2_spawn':
        floorById(15).layer1[3][4] = 'npc02_2_2'; break;
      case 'merchant2_give':
        if (state.exp >= 500) { state.exp -= 500; floorById(15).layer2[3][4] = 'item04_4'; log('商人：经验足够，收下圣剑！'); }
        break;
      case 'merchant_give_shield':
        floorById(2).layer2[10][9] = 'item05_2'; log('商人：我送你一面银盾，去2层取吧'); break;
      case 'merchant3_spawn':
        floorById(15).layer1[3][6] = 'npc03_2_2'; break;
      case 'merchant3_give':
        if (state.money >= 500) { state.money -= 500; floorById(15).layer2[3][6] = 'item05_4'; log('商人：金币足够，收下圣盾！'); }
        break;
      case 'special1_exit_spawn':
        floorById('special_1').layer1[10][0] = 'npc03_4_2'; break;
      case 'special1_teleport':
        goFloorWithFade(1, 5, 9); log('传送回第 2 层'); break;
      case 'thief_open':
        state.flags.thiefOpen = true;
        floorById(4).layer1[0][5] = 'npc04_2'; log('小偷：我去帮你打开那扇绿门'); break;
      case 'thief_clear':
        if (state.flags.LumpHammer) { floorById(18).layer3[8][5] = ''; floorById(18).layer3[9][5] = ''; log('小偷用铁锤砸开了通道！'); }
        break;
      case 'princess':
        floorById(18).layer3[10][10] = 'stair02';
        state.flags.metPrincess = true;
        log('公主：勇士，去击败魔王救我出去！（18层通道已开启）');
        break;
      case 'win':
        state.win = true; showWin(); break;
      case 'grant_ice_stick':
        // 神秘老人赠予 冰之令牌（原版 NPC.java script_end: npc02_3 -> IceStick=1）
        state.flags.IceStick = true;
        // 若此刻仙子已就位（npc01_1_2），按其是否已得十字架切换为冰之灵杖形态
        if (floorById(0).layer1[8][4] === 'npc01_1_2') {
          floorById(0).layer1[8][4] = state.flags.hasCross ? 'npc01_1_4' : 'npc01_1_3';
        }
        log('神秘老人赠予你 冰之令牌！');
        break;
      // boss_red / boss_great / boss_great_taunt: dialogue only
    }
  }

  // ---------- shop (faithful to original ShopPane / LoadShop) ----------
  let pendingShopBuy = null;           // {shop, option} waiting for confirmation
  function shopKeyOf(attr) {
    return attr === 'yKey' ? 'y' : attr === 'bKey' ? 'b' : attr === 'rKey' ? 'r' : null;
  }
  function openShop(id, f, x, y) {
    const shop = G.shops[id];
    if (!shop) {
      const info = {
        shop01_1: ['贪婪之神', '贪婪之神：用金币换取力量吧，找我身边的祭坛即可。'],
        shop01_3: ['贪婪之神', '贪婪之神：力量，是用金币买来的。'],
        shop02_1: ['贪欲之神', '贪欲之神：更强的力量，需要更多的金币。'],
        shop02_3: ['贪欲之神', '贪欲之神：金币越多，力量越大。'],
      }[id] || ['商人', '这里似乎没有可交易的商品。'];
      showFlavor(info[0], info[1]);
      return;
    }
    shopActive = true;
    pendingShopBuy = null;
    shopNameEl.textContent = shop.name;
    shopConfirmBtn.style.display = 'none';
    renderShop(shop);
    shopScreen.classList.add('show');
    AU.sfx('dialogueSpace');
  }
  function renderShop(shop) {
    const cur = shop.currency === 'money' ? state.money : state.exp;
    shopCurEl.textContent = (shop.currency === 'money' ? '金币: ' : '经验: ') + cur;
    shopOptsEl.innerHTML = '';
    shop.options.forEach((o) => {
      const b = document.createElement('button');
      let affordable, tag;
      if (shop.sell) {
        const k = shopKeyOf(o.attr);
        affordable = state.keys[k] > 0;
        tag = '+' + o.price + ' 金币';
      } else {
        affordable = cur >= o.price;
        tag = o.price + (shop.currency === 'money' ? ' 金币' : ' 经验');
      }
      b.innerHTML = o.label + '<span class="price">' + tag + '</span>';
      b.disabled = !affordable;
      b.addEventListener('click', () => buyOption(shop, o));
      shopOptsEl.appendChild(b);
    });
  }
  function buyOption(shop, o) {
    // stage for confirmation — don't buy yet
    pendingShopBuy = { shop, o };
    AU.sfx('shopSelect');
    shopConfirmBtn.textContent = '确认购买：' + o.label;
    shopConfirmBtn.style.display = '';
    shopConfirmBtn.focus();
  }
  function confirmShopBuy() {
    if (!pendingShopBuy) return;
    const { shop, o } = pendingShopBuy;
    pendingShopBuy = null;
    shopConfirmBtn.style.display = 'none';
    _executeShopBuy(shop, o);
  }
  function _executeShopBuy(shop, o) {
    if (shop.sell) {
      const k = shopKeyOf(o.attr);
      if (!k || state.keys[k] <= 0) {       // was a silent no-op before
        AU.sfx('shopBuyFail');
        log('你没有可以出售的' + (o.label || '钥匙'));
        return;
      }
      state.keys[k]--;
      state.money += o.price;
      AU.sfx('shopBuySuc');
    } else {
      const byExp = shop.currency !== 'money';
      const cur = byExp ? state.exp : state.money;
      if (cur < o.price) {
        AU.sfx('shopBuyFail');
        log((byExp ? '经验' : '金币') + '不足，还差 ' + (o.price - cur));
        return;
      }
      if (byExp) state.exp -= o.price; else state.money -= o.price;
      applyShopEffect(o);
      AU.sfx(byExp ? 'shopExpBuySuc' : 'shopBuySuc');
    }
    log('交易成功：' + o.label);
    renderShop(shop);
    updateHUD();
    draw();
    save();
  }
  function applyShopEffect(o) {
    switch (o.attr) {
      case 'hp': state.hp += o.val; state.maxhp = Math.max(state.maxhp, state.hp); break;
      case 'atk': state.atk += o.val; break;
      case 'def': state.def += o.val; break;
      case 'lv':
        state.level += o.val;
        state.hp += 1000 * o.val; state.maxhp = Math.max(state.maxhp, state.hp);
        state.atk += 7 * o.val; state.def += 7 * o.val;
        break;
      case 'yKey': state.keys.y += o.val; break;
      case 'bKey': state.keys.b += o.val; break;
      case 'rKey': state.keys.r += o.val; break;
    }
  }
  function closeShop() {
    shopActive = false;
    shopScreen.classList.remove('show');
    draw();
  }
  function showFlavor(name, text) {
    ovName.textContent = name;
    ovText.textContent = text;
    ovHint.textContent = '空格 / 点击 结束 ✕';
    dialogueActive = true; dlgNPC = null; dlgIdx = 0; dlgQueue = [{ who: 'x', text: text }];
    overlay.style.display = 'block';
    AU.sfx('dialogueSpace');
  }

  // ---------- gallery unlock (persists across runs, separate from the save) ----------
  /* Kept out of SAVE_KEY on purpose: clearing or finishing a run wipes the save,
     but the gallery stays earned. */
  function galleryUnlocked() {
    try { return localStorage.getItem(GALLERY_KEY) === '1'; } catch (e) { return false; }
  }
  function unlockGallery(reason) {
    let fresh = false;
    try {
      fresh = localStorage.getItem(GALLERY_KEY) !== '1';
      localStorage.setItem(GALLERY_KEY, '1');
    } catch (e) {}
    refreshGalleryBtn();
    if (fresh && reason) log(reason);
    return fresh;
  }
  function refreshGalleryBtn() {
    const b = document.getElementById('btnGallery');
    if (!b) return;
    b.style.display = galleryUnlocked() ? '' : 'none';
  }

  // ---------- win / game over ----------
  /* Multiple endings. The path the hero walked decides how the tower falls.
     Each ending is data-driven so adding more is a one-liner in ENDINGS. */
  function fmtStats(s) {
    const sec = Math.floor(((Date.now() - (s.startTime || Date.now())) / 1000));
    const mm = Math.floor(sec / 60), ss = sec % 60;
    return '步数 ' + (s.steps || 0) + '　击杀 ' + (s.killCount || 0)
      + '　金币 ' + (s.goldEarned || 0) + '　耗时 ' + mm + '分' + (ss < 10 ? '0' : '') + ss + '秒';
  }
  const ENDINGS = {
    true: {
      cls: 'true',
      title: '真·结局 · 光明的馈赠',
      text: (s) =>
        '你接受了仙子的祝福，踏入尘封的 21 层，获得了改写命运的力量。\n' +
        '魔王在圣光中溃散，魔界裂隙被彻底封印——这一次，再无余孽。\n' +
        '公主醒来，眼中映着初升的朝阳。你们并肩走出魔塔，身后石塔化作漫天星尘。\n\n' +
        '【真·结局结算】\n' +
        '等级 ' + s.level + '　生命 ' + s.hp + '　攻击 ' + s.atk + '　防御 ' + s.def + '\n' +
        '金币 ' + s.money + '　经验 ' + s.exp + '\n\n' +
        '★ 已解锁「资料馆」——标题页可查阅全部道具与怪物图鉴。\n\n' + fmtStats(s),
    },
    peace: {
      cls: 'peace',
      title: '和平结局 · 守信的盟友',
      text: (s) =>
        '你曾信守承诺，为小偷打开绿门，换来一路相助。\n' +
        '魔王倒下时，四面八方的旧友——小偷、仙子、神秘老人——都赶来为你庆贺。\n' +
        '公主安然归国，魔塔化作一处宁静的纪念碑，再无人死于其中。\n\n' +
        '【和平结局结算】\n' +
        '等级 ' + s.level + '　生命 ' + s.hp + '　攻击 ' + s.atk + '　防御 ' + s.def + '\n' +
        '金币 ' + s.money + '　经验 ' + s.exp + '\n\n' +
        '★ 已解锁「资料馆」——标题页可查阅全部道具与怪物图鉴。\n\n' + fmtStats(s),
    },
    normal: {
      cls: 'normal',
      title: '营救成功！',
      text: (s) =>
        '勇士终于击败了魔王，将公主从魔界救出。魔塔崩塌，只余一片寂静……\n' +
        '而你，带着荣光悄然离去，从此再无人见过你的身影。\n\n' +
        '【通关结算】\n' +
        '等级 ' + s.level + '　生命 ' + s.hp + '　攻击 ' + s.atk + '　防御 ' + s.def + '\n' +
        '金币 ' + s.money + '　经验 ' + s.exp + '\n\n' +
        '★ 已解锁「资料馆」——标题页可查阅全部道具与怪物图鉴。\n\n' + fmtStats(s),
    },
  };
  function computeEnding() {
    if (state.flags.elfPower) return 'true';          // 仙子祝福 / 21 层隐藏线
    if (state.flags.thiefOpen) return 'peace';        // 守信相助小偷线
    return 'normal';
  }
  function showWin() {
    state.over = true; state.win = true;
    state.ending = computeEnding();
    const ending = ENDINGS[state.ending] || ENDINGS.normal;
    unlockGallery();                      // finishing the tower opens 资料馆
    AU.playBgm('UndergroundEnd');         // original: playEndBackgroundMusic
    const el = document.getElementById('endScreen');
    el.style.display = 'flex';
    el.className = 'win ' + ending.cls;
    const lb = document.getElementById('endLoad'); if (lb) lb.style.display = 'none';
    el.querySelector('.endTitle').textContent = ending.title;
    el.querySelector('.endText').textContent = ending.text(state);
    clearSave();
  }

  function showLose() {
    state.over = true; state.win = false;
    AU.playBgm('UndergroundEnd');
    const el = document.getElementById('endScreen');
    el.style.display = 'flex';
    el.className = 'lose';
    el.querySelector('.endTitle').textContent = '你倒下了……';
    el.querySelector('.endText').textContent =
      '你在魔塔中力竭而亡，灵魂飘散在冰冷的石墙之间。\n' +
      '但冒险尚未终结——从存档中重来，或再度踏入魔塔。\n\n' +
      '【阵亡结算】\n' +
      '等级 ' + state.level + '　生命 ' + state.hp + '/' + state.maxhp +
      '　攻击 ' + state.atk + '　防御 ' + state.def + '\n' +
      '金币 ' + state.money + '　经验 ' + state.exp + '\n\n' +
      fmtStats(state);
    // 阵亡不清存档——让玩家从存档重试，或重新开始
    const loadBtn = document.getElementById('endLoad');
    if (loadBtn) {
      let any = false;
      for (let i = 0; i < SLOTS.length; i++) {
        try { if (localStorage.getItem(SLOTS[i])) { any = true; break; } } catch (e) {}
      }
      loadBtn.style.display = any ? '' : 'none';
    }
  }

  // ---------- save / load (multi-slot) ----------
  // Each run lives in one of SLOTS; `state.__slot` records which one. The live
  // "current run" auto-save writes straight to that slot so the start screen's
  // "加载存档" (reads LAST_SLOT_KEY) and the in-game panel stay in sync.
  function saveToSlot(i, name) {
    if (visiting) { log('参观资料馆时无法存档'); return; }
    state.__slot = i;
    state.__slotName = (name && String(name).trim()) || ('存档' + (i + 1));
    try {
      localStorage.setItem(SLOTS[i], JSON.stringify({ ts: Date.now(), state: state }));
      localStorage.setItem(LAST_SLOT_KEY, String(i));
    } catch (e) {}
  }
  function save() {
    // A gallery tour must never touch the real run's save slot.
    if (visiting) return;
    if (typeof state.__slot !== 'number' || state.__slot < 0 || state.__slot >= SLOTS.length) state.__slot = 0;
    if (!state.__slotName) state.__slotName = '存档' + (state.__slot + 1);
    try {
      localStorage.setItem(SLOTS[state.__slot], JSON.stringify({ ts: Date.now(), state: state }));
      localStorage.setItem(LAST_SLOT_KEY, String(state.__slot));
    } catch (e) {}
  }
  // 自动存档：在 NPC 对话前 / 关键剧情前 / 楼层切换前 / 阵亡时触发
  function autoSave() {
    if (visiting) return;
    try {
      state.__autoSaved = Date.now();
      localStorage.setItem(AUTO_SLOT_KEY, JSON.stringify({ ts: state.__autoSaved, state: state, auto: true }));
    } catch (e) {}
  }
  function readSlot(i) {
    try {
      const raw = localStorage.getItem(SLOTS[i]);
      if (!raw) return { empty: true };
      const p = JSON.parse(raw);
      if (!p || !p.state) return { empty: true };
      const s = p.state;
      return {
        empty: false,
        name: s.__slotName || ('存档' + (i + 1)),
        ts: p.ts || 0,
        floor: s.floorId,
        level: s.level,
        hp: s.hp,
        maxhp: s.maxhp,
      };
    } catch (e) { return { empty: true }; }
  }
  function readAutoSlot() {
    try {
      const raw = localStorage.getItem(AUTO_SLOT_KEY);
      if (!raw) return { empty: true };
      const p = JSON.parse(raw);
      if (!p || !p.state) return { empty: true };
      const s = p.state;
      return { empty: false, ts: p.ts || 0, floor: s.floorId, level: s.level, hp: s.hp, maxhp: s.maxhp };
    } catch (e) { return { empty: true }; }
  }
  function loadAutoSlot() {
    try {
      const raw = localStorage.getItem(AUTO_SLOT_KEY);
      if (!raw) return false;
      const p = JSON.parse(raw);
      if (!p || !p.state) return false;
      state = p.state;
      return true;
    } catch (e) { return false; }
  }
  function loadFromSlot(i) {
    try {
      const raw = localStorage.getItem(SLOTS[i]);
      if (!raw) return false;
      const p = JSON.parse(raw);
      if (!p || !p.state) return false;
      state = p.state;
      migrateState();
      try { localStorage.setItem(LAST_SLOT_KEY, String(i)); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }
  function load() {
    let i = 0;
    try { const v = localStorage.getItem(LAST_SLOT_KEY); if (v !== null) i = +v; } catch (e) {}
    if (i < 0 || i >= SLOTS.length) i = 0;
    return loadFromSlot(i);
  }
  function firstEmptySlot() {
    for (let i = 0; i < SLOTS.length; i++) {
      try { if (!localStorage.getItem(SLOTS[i])) return i; } catch (e) {}
    }
    return -1;
  }
  function deleteSlot(i) {
    try { localStorage.removeItem(SLOTS[i]); } catch (e) {}
    try {
      const v = localStorage.getItem(LAST_SLOT_KEY);
      if (v !== null && +v === i) localStorage.removeItem(LAST_SLOT_KEY);
    } catch (e) {}
    refreshLoadBtn();
  }
  // ---------- save share codes (export / import) ----------
  function b64enc(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64dec(b64) { return decodeURIComponent(escape(atob(b64.trim()))); }
  function slotCode(i) {
    // Read the raw stored blob (which carries the full `state`); `readSlot`
    // only returns metadata, so it cannot be used to recover the save here.
    try {
      const raw = localStorage.getItem(SLOTS[i]);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || !p.state) return null;
      return b64enc(JSON.stringify({ v: 1, ts: p.ts, state: p.state }));
    } catch (e) { return null; }
  }
  function applySlotCode(i, code) {
    if (!code || typeof code !== 'string') return false;
    try {
      const obj = JSON.parse(b64dec(code));
      if (!obj || !obj.state || !Array.isArray(obj.state.map)) return false;
      localStorage.setItem(SLOTS[i], JSON.stringify({ ts: obj.ts || Date.now(), state: obj.state }));
      refreshLoadBtn();
      return true;
    } catch (e) { return false; }
  }
  /* Bring an older save in line with the current rules. Saves written before
     the item-bar split stored keys/potions as "usable", which let the player
     re-trigger their effect; drop anything that no longer belongs there. */
  function migrateState() {
    if (!state.playStart) state.playStart = Date.now();
    if (!state.flags) state.flags = {};
    if (typeof state.flags.doubleGold !== 'boolean') state.flags.doubleGold = false;
    if (typeof state.flags.showLossLabels !== 'boolean') state.flags.showLossLabels = true;
    if (typeof state.__slot !== 'number') state.__slot = 0;
    if (!state.__slotName) state.__slotName = '存档' + (state.__slot + 1);
    // drop gallery floors an older build may have exposed
    if (state.visited) {
      Object.keys(state.visited).forEach((k) => {
        if (isDebugFloor(k)) delete state.visited[k];
      });
    }
    if (isDebugFloor(state.floorId)) {             // stranded inside a gallery
      state.floorId = 0; state.special = false;
      const f0 = floorById(0);
      if (f0 && f0.up) { state.px = f0.up[0]; state.py = f0.up[1]; }
    }
    if (!Array.isArray(state.inventory)) { state.inventory = []; return; }
    state.inventory = state.inventory.filter((it) => {
      const eff = it && G.item_effects[it.id];
      if (!eff || !shouldStore(eff.kind)) return false;   // never belonged here
      it.badge = isBadgeKind(eff.kind);
      if (it.badge) it.count = 1;
      return true;
    });
  }
  function clearSave() {
    let i = 0;
    if (typeof state.__slot === 'number') i = state.__slot;
    else { try { const v = localStorage.getItem(LAST_SLOT_KEY); if (v !== null) i = +v; } catch (e) {} }
    if (i >= 0 && i < SLOTS.length) { try { localStorage.removeItem(SLOTS[i]); } catch (e) {} }
    try { localStorage.removeItem(LAST_SLOT_KEY); } catch (e) {}
    refreshLoadBtn();
  }

  // ---------- input ----------
  const KEYMAP = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
  };
  window.addEventListener('keydown', (e) => {
    if (!started) return;                 // ignore input until game started
    if (battleAnimating && (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault(); skipBattle = true; return;   // 战斗演出中一键跳过
    }
    if (dialogueActive) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advanceDlg(); }
      return;
    }
    if (panelOpen()) return;               // any bottom panel swallows movement keys
    if (state && (state.over || state.win)) return;
    if (pendingItem !== null && KEYMAP[e.key]) {
      const [dx, dy] = KEYMAP[e.key]; e.preventDefault(); usePendingDir(dx, dy); return;
    }
    if (KEYMAP[e.key]) {
      e.preventDefault();
      const [dx, dy] = KEYMAP[e.key];
      startHoldMove(dx, dy);             // 长按连发（键盘按下即持续移动）
    }
    if (e.key === 't' || e.key === 'T') openFlight();
  });
  window.addEventListener('keyup', () => stopHoldMove());  // 放手即停

  // d-pad（长按连发：pointerdown 开始移动，setInterval 驱动，手机不节流）
  const DIR_MAP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const HOLD_STEP_MS = 120;  // 每步间隔 ms（长按连走）
  let heldDir = null;        // {dx, dy} 当前长按方向
  let holdInterval = null;   // setInterval id
  let holdLastDown = 0;      // 防抖
  function holdTick() {
    if (!heldDir) return;
    if (!tryMove(heldDir.dx, heldDir.dy)) { stopHoldMove(); }
  }
  function startHoldMove(dx, dy) {
    const now = Date.now();
    if (heldDir && heldDir.dx === dx && heldDir.dy === dy && now - holdLastDown < 200) return;
    holdLastDown = now;
    stopHoldMove();
    heldDir = { dx, dy };
    tryMove(dx, dy);              // 第一步立即走
    holdInterval = setInterval(holdTick, HOLD_STEP_MS);
  }
  function stopHoldMove() {
    if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
    heldDir = null;
  }
  dpad.querySelectorAll('button').forEach(b => {
    const dir = b.dataset.dir;
    if (dir && DIR_MAP[dir]) {
      const [dx, dy] = DIR_MAP[dir];
      const onDown = (e) => {
        e.preventDefault();
        if (!started || panelOpen()) return;
        if (pendingItem !== null) { usePendingDir(dx, dy); return; }
        startHoldMove(dx, dy);
      };
      b.addEventListener('pointerdown', onDown);
      b.addEventListener('touchstart', onDown, { passive: false }); // 移动端兼容
      b.addEventListener('pointerup', stopHoldMove);
      b.addEventListener('pointerleave', stopHoldMove);
      b.addEventListener('pointercancel', stopHoldMove);
      b.addEventListener('touchend', stopHoldMove);
      b.addEventListener('contextmenu', (e) => e.preventDefault());  // 长按禁止系统菜单
    }
  });

  // ---------- mobile gestures: swipe to move + tap to interact (Task E) ----------
  function gestureBlocked() {
    return !started || dialogueActive || panelOpen() || state.over || state.win
      || visiting || pendingItem !== null || battleAnimating;
  }
  // interact with an adjacent grid cell (used by tap-on-canvas)
  function handleTapCell(col, row) {
    if (gestureBlocked()) return;
    if (col < 0 || col >= GRID || row < 0 || row >= GRID) return;
    const ddx = col - state.px, ddy = row - state.py;
    if (Math.abs(ddx) + Math.abs(ddy) === 1) tryMove(ddx, ddy);  // 仅相邻格可交互/移动
  }
  let touchSX = 0, touchSY = 0;
  if (canvas) {
    canvas.addEventListener('touchstart', (e) => {
      if (gestureBlocked()) return;
      const t = e.changedTouches[0];
      touchSX = t.clientX; touchSY = t.clientY;
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (gestureBlocked()) return;
      e.preventDefault();                 // 阻止页面滚动
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
      if (gestureBlocked() || !e.changedTouches.length) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchSX, dy = t.clientY - touchSY;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      const THRESH = 24;                  // 小于该位移视为“点击”而非“滑动”
      if (adx < THRESH && ady < THRESH) {
        const rect = canvas.getBoundingClientRect();
        const tw = rect.width / VIEW;      // pixel width per grid cell
        const col = Math.floor((t.clientX - rect.left) / tw);
        const row = Math.floor((t.clientY - rect.top) / tw);
        handleTapCell(col, row);
      } else {
        let dir;
        if (adx > ady) dir = dx > 0 ? [1, 0] : [-1, 0];
        else dir = dy > 0 ? [0, 1] : [0, -1];
        tryMove(dir[0], dir[1]);
      }
    }, { passive: false });
  }
  // dialogue: click overlay to advance (no separate confirm button)
  overlay.addEventListener('click', advanceDlg);
  // shop buttons
  shopScreen.querySelector('.shopClose').addEventListener('click', closeShop);
  shopConfirmBtn.addEventListener('click', confirmShopBuy);

  // ---------- bottom control buttons ----------
  btnSaveGame.addEventListener('click', () => {
    if (!started) return;
    if (visiting) { log('参观资料馆时无法存档'); return; }
    openSlots('save');
  });
  btnLoadGameUI.addEventListener('click', () => {
    if (!started) return;
    if (visiting) { log('参观资料馆时无法读档，请先退出'); return; }
    openSlots('load');
  });
  btnFlight.addEventListener('click', () => {
    if (!started || !state.flags.canUseFloorTransfer) return;
    openFlight();
  });
  btnManual.addEventListener('click', () => {
    if (!started || !state.flags.canUseMonsterManual) return;
    openManual();
  });
  btnLossToggle.addEventListener('click', () => {
    if (!started || !state.flags.canUseMonsterManual) return;
    state.flags.showLossLabels = !state.flags.showLossLabels;
    updateHUD(); draw(); save();
  });
  flightClose.addEventListener('click', () => flightScreen.classList.remove('show'));
  manualClose.addEventListener('click', () => manualScreen.classList.remove('show'));

  // ---------- flight (飞行器): floor picker UI ----------
  function openFlight() {
    if (visiting) { log('参观资料馆时无法使用飞行器'); return; }
    if (!state.flags.canUseFloorTransfer) { log('需要飞行器才能使用楼层传送'); return; }
    // reset to flight mode (稿子 may have hijacked the panel)
    flightScreen.querySelector('.shopName').textContent = '飞行器 · 选择楼层';
    flightClose.onclick = () => flightScreen.classList.remove('show');
    flightGrid.innerHTML = '';
    // visited keys arrive as strings — normalise before touching floor data
    const ids = Object.keys(state.visited).map(normFloorId)
      .filter((id) => !isDebugFloor(id))           // galleries stay unlisted
      .sort(floorSort);
    ids.forEach((id) => {
      const f = floorById(id);
      if (!f) return;                              // stale id in an old save
      const isCur = (id === normFloorId(state.floorId));
      const b = document.createElement('button');
      b.className = 'floor-btn' + (isCur ? ' cur' : '');
      b.innerHTML = floorLabel(id) + '<span class="fb-sub">' + (isCur ? '当前' : '已探索') + '</span>';
      b.addEventListener('click', () => {
        const pos = flightArrival(f);
        if (!pos) { log('该楼层没有可降落的位置'); return; }
        AU.sfx('floorTransferSelect');
        flightScreen.classList.remove('show');
        goFloorWithFade(id, pos[0], pos[1]);
      });
      flightGrid.appendChild(b);
    });
    if (!flightGrid.children.length) {
      flightGrid.innerHTML = '<div style="color:#6b7299;padding:8px;font-size:12px">还没有去过任何楼层</div>';
    }
    flightScreen.classList.add('show');
  }
  /* Where the flight device drops the player: prefer the up-stair, fall back to
     the down-stair, then to any walkable tile. */
  function flightArrival(f) {
    if (Array.isArray(f.up) && f.up.length === 2) return f.up;
    if (Array.isArray(f.down) && f.down.length === 2) return f.down;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const blocked = (f.layer3 && (f.layer3[y] || [])[x]) || (f.layer2 && (f.layer2[y] || [])[x]);
        if (!blocked) return [x, y];
      }
    }
    return null;
  }

  // ---------- monster manual (怪物手册) ----------
  function openManual() {
    manualGrid.innerHTML = '';
    const list = Object.keys(G.monsters)
      .map((id) => ({ id, m: G.monsters[id] }))
      .filter((x) => x.m && x.m.real !== false)
      .sort((a, b) => (a.m.hp - b.m.hp) || a.id.localeCompare(b.id));
    list.forEach(({ id, m }) => {
      const loss = battleResult(id).fullLoss;   // 当前属性下的战斗损失 HP
      const card = document.createElement('div');
      const killed = (state.kills && state.kills[id]);
      card.className = 'monster-card' + (killed ? ' killed' : '');
      card.innerHTML =
        '<div class="mc-name">' + (killed ? '✓ ' : '') + (m.name || id) +
          (m.mage ? ' <span class="mc-mage">法师</span>' : '') + '</div>' +
        '<div class="mc-stats">' +
          '<span class="mc-hp">生命 <b>' + m.hp + '</b></span> · ' +
          '<span class="mc-atk">攻 <b>' + m.atk + '</b></span> · ' +
          '<span class="mc-def">防 <b>' + m.df + '</b></span> · ' +
          '<span class="mc-exp">经验 <b>' + (m.exp || 0) + '</b></span> · ' +
          '<span class="mc-loss">损失 <b' + (loss > 0 ? ' class="pos"' : '') + '>' + loss + '</b></span>' +
        '</div>';
      manualGrid.appendChild(card);
    });
    manualCount.textContent = '共 ' + list.length + ' 种';
    manualScreen.classList.add('show');
    AU.sfx('dialogueSpace');
  }

  // ---------- save-slot panel (多存档槽) ----------
  let slotMode = 'save';   // 'save' | 'load' — 区分保存/读取入口
  function openSlots(mode) {
    slotMode = mode || 'save';
    if (menuScreen.classList.contains('show')) menuScreen.classList.remove('show');
    renderSlots();
    slotScreen.classList.add('show');
  }
  function fmtSlotDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // 智能默认名：保存未改名时，用「楼层 + 时间」自动命名
  function defaultSlotName() {
    const t = new Date();
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    const hhmm = p(t.getHours()) + ':' + p(t.getMinutes());
    const f = state.floorId;
    const label = (typeof f === 'number') ? ('第' + (f + 1) + '层') : '资料馆';
    return label + ' ' + hhmm;
  }
  // 长按删除：满槽按住 0.6s 弹确认后删除
  let lpTimer = null, lpFired = false;
  function clearLp() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }
  function requestDeleteSlot(i) {
    const info = readSlot(i);
    if (info.empty) return;
    if (window.confirm('确定删除存档「' + (info.name || ('存档' + (i + 1))) + '」？此操作不可撤销。')) {
      deleteSlot(i);
      log('已删除存档槽 ' + (i + 1));
      AU.sfx('getItem');
      renderSlots();
    }
  }
  function renderSlots() {
    slotList.innerHTML = '';
    const isSave = slotMode === 'save';
    for (let i = 0; i < SLOTS.length; i++) {
      const info = readSlot(i);
      const empty = info.empty;
      const name = empty ? defaultSlotName() : info.name;
      const summary = empty
        ? (isSave ? '空槽位 · 点击保存到此' : '空槽位 · 无可读取')
        : floorLabel(info.floor) + ' · Lv' + info.level + ' · HP ' + info.hp + '/' + info.maxhp
          + ' · ' + fmtSlotDate(info.ts)
          + (isSave ? ' · 点击覆盖保存' : ' · 点击读取');
      const row = document.createElement('div');
      row.className = 'slot-row' + (empty ? ' empty' : '')
        + ((state && i === state.__slot) ? ' current' : '')
        + (empty && !isSave ? ' disabled' : '');   // 读取模式空槽灰显
      row.dataset.i = i;
      row.innerHTML =
        '<div class="slot-main" data-i="' + i + '">' +
          '<input class="slot-name" maxlength="12" value="' + esc(name) + '"'
            + (empty || !isSave ? '' : ' disabled') + ' data-i="' + i + '">' +
          '<div class="slot-summary">' + esc(summary) + '</div>' +
        '</div>';
      slotList.appendChild(row);
    }
    // 命名输入：保存模式空槽可编辑
    slotList.querySelectorAll('.slot-name').forEach((inp) => {
      inp.addEventListener('input', () => { slotNameDraft[+inp.dataset.i] = inp.value; });
      inp.addEventListener('click', (e) => e.stopPropagation());
    });
    // 点击卡片主体
    slotList.querySelectorAll('.slot-main').forEach((m) => {
      m.addEventListener('click', () => {
        if (lpFired) { lpFired = false; return; }
        const i = +m.dataset.i;
        const inf = readSlot(i);
        if (isSave) {
          // 保存模式：任何槽都保存（覆盖写入）
          const nm = (slotNameDraft[i] != null ? String(slotNameDraft[i]) : '').trim()
            || (inf.name || defaultSlotName());
          saveToSlot(i, nm);
          slotNameDraft[i] = null;
          log('已保存到「' + nm + '」');
          AU.sfx('getItem');
          renderSlots();
        } else {
          // 读取模式：仅满槽可读取
          if (inf.empty) { log('该存档槽为空'); return; }
          if (loadFromSlot(i)) {
            slotScreen.classList.remove('show');
            beginGame();
            log('已读取存档：' + (state.__slotName || '存档'));
            AU.sfx('getSpecialItem');
          } else { log('读取失败'); }
        }
      });
      // 长按删除（仅满槽 + 保存模式）
      m.addEventListener('pointerdown', (e) => {
        if (e.button && e.button !== 0) return;
        lpFired = false;
        const i = +m.dataset.i;
        if (readSlot(i).empty) return;
        clearLp();
        lpTimer = setTimeout(() => { lpTimer = null; lpFired = true; requestDeleteSlot(i); }, 600);
      });
      m.addEventListener('pointerup', clearLp);
      m.addEventListener('pointerleave', clearLp);
      m.addEventListener('pointercancel', clearLp);
    });
    // 自动存档槽（第 4 行，只读、不可手动保存）
    const as = readAutoSlot();
    const asRow = document.createElement('div');
    asRow.className = 'slot-row auto' + (as.empty ? ' empty' : '');
    asRow.innerHTML =
      '<div class="slot-main">' +
        '<div class="slot-name" style="color:#8ade9a">🟢 自动存档</div>' +
        '<div class="slot-summary">' +
          (as.empty ? '暂无自动存档 · 在 NPC 对话 / 关键剧情前自动触发'
            : floorLabel(as.floor) + ' · Lv' + as.level + ' · HP ' + as.hp + '/' + as.maxhp
              + ' · ' + fmtSlotDate(as.ts)) +
        '</div>' +
      '</div>';
    if (!isSave && !as.empty) {
      asRow.querySelector('.slot-main').addEventListener('click', () => {
        if (loadAutoSlot()) {
          slotScreen.classList.remove('show');
          beginGame();
          log('已读取自动存档：' + fmtSlotDate(as.ts));
          AU.sfx('getSpecialItem');
        }
      });
    }
    slotList.appendChild(asRow);
  }
  slotClose.addEventListener('click', () => slotScreen.classList.remove('show'));

  function updateSoundBtn() {
    soundBtn.style.background = settings.sound ? '#2f6f4a' : '#1e2338';
    soundBtn.style.borderColor = settings.sound ? '#3fae84' : '#2c3358';
    soundBtn.style.color = settings.sound ? '#d6ffe6' : '#9aa0c4';
    soundBtn.innerHTML = (settings.sound ? ICONS.soundOn : ICONS.soundOff)
      + '<span style="font-size:9px;margin-left:2px">' + (settings.sound ? 'ON' : 'OFF') + '</span>';
  }
  // 菜单面板：打开 / 关闭
  btnMenu.addEventListener('click', () => {
    if (!started) return;
    if (slotScreen.classList.contains('show')) slotScreen.classList.remove('show');
    menuCine.textContent = '🎬 战斗演示 ' + (settings.battleCinematic ? '开' : '关');
    menuCine.style.background = settings.battleCinematic ? '#2f6f4a' : '#1e2338';
    menuCine.style.borderColor = settings.battleCinematic ? '#3fae84' : '#2c3358';
    menuScreen.classList.add('show');
  });
  menuClose.addEventListener('click', () => menuScreen.classList.remove('show'));
  // 战斗演示：直接在菜单内切换
  if (menuCine) {
    menuCine.addEventListener('click', () => {
      settings.battleCinematic = !settings.battleCinematic; saveSettings();
      menuCine.textContent = '🎬 战斗演示 ' + (settings.battleCinematic ? '开' : '关');
      menuCine.style.background = settings.battleCinematic ? '#2f6f4a' : '#1e2338';
      menuCine.style.borderColor = settings.battleCinematic ? '#3fae84' : '#2c3358';
      log('战斗演示已' + (settings.battleCinematic ? '开启' : '关闭'));
    });
  }
  menuRestart.addEventListener('click', () => { menuScreen.classList.remove('show'); startNewGame(); });
  if (menuHome) {
    menuHome.addEventListener('click', () => {
      menuScreen.classList.remove('show');
      started = false; state = null;
      AU.stopBgm();
      showStart();
      draw();
    });
  }
  // 阵亡后可从此处读回存档重试
  const endLoad = document.getElementById('endLoad');
  if (endLoad) endLoad.addEventListener('click', () => {
    if (load()) { hideEnd(); beginGame(); log('已读取存档，继续你的冒险！'); }
    else { log('没有可用存档'); }
  });

  // ---------- start screen / new game / load / guide ----------
  function showStart() {
    startScreen.classList.add('show');
    // 生成背景星星
    const bg = document.getElementById('starsBg');
    if (bg && !bg.children.length) {
      for (let i = 0; i < 18; i++) {
        const s = document.createElement('div');
        s.className = 'star';
        s.style.left = (Math.random() * 90) + '%';
        s.style.top = (Math.random() * 50) + '%';   // 星星只在天空（上半截）
        s.style.animationDuration = (2.5 + Math.random() * 3.5) + 's';
        s.style.animationDelay = Math.random() * 4 + 's';
        s.style.width = s.style.height = (4 + Math.random() * 4) + 'px';
        bg.appendChild(s);
      }
    }
  }
  function hideStart() { startScreen.classList.remove('show'); }
  /* Title theme. Autoplay is blocked until the page has been interacted with,
     so arm it on the first pointer/key event and play it then. */
  function armTitleTheme() {
    const start = () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      if (started) return;                 // player already jumped into the game
      AU.unlock();
      AU.playBgm('HometownDomina');
    };
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }
  function hideEnd() { const el = document.getElementById('endScreen'); el.style.display = 'none'; }

  function beginGame() {
    started = true;
    hudDirty = true;                     // 新游戏/读档 → 完整刷新 HUD
    AU.unlock();
    hideStart(); hideEnd();
    // init sound button icon
    soundBtn.innerHTML = ICONS.soundOn + '<span style="font-size:9px;margin-left:2px">ON</span>';
    AU.playBgm(bgmForFloor(state.floorId));
    draw();
  }
  function startNewGame() {
    if (visiting) { visiting = false; preGallery = null; updateGalleryChrome(); }
    // 优先使用空槽位，避免覆盖已有存档；若三槽全满则复用“最近游玩”槽
    let target = firstEmptySlot();
    if (target < 0) {
      target = 0;
      try { const v = localStorage.getItem(LAST_SLOT_KEY); if (v !== null) target = +v; } catch (e) {}
    }
    try { localStorage.removeItem(SLOTS[target]); } catch (e) {}
    state = freshState();
    state.__slot = target;
    state.__slotName = '存档' + (target + 1);
    beginGame();
    save();   // 立即持久化新游戏，使标题页“加载存档”可用
    log('新游戏开始——醒来在魔塔底层，仙子在等你。');
  }
  function loadSave() {
    // 继续征程：直接加载最近存档（自动存档优先，其次最后保存槽）
    if (load()) { beginGame(); log('欢迎回来，继续你的征程！'); return; }
    const b = document.getElementById('btnLoadGameStart');
    if (b) { b.disabled = true; b.textContent = '暂无存档'; }
  }
  /* grey out the start-screen load button when there is nothing to load */
  function refreshLoadBtn() {
    const b = document.getElementById('btnLoadGameStart');
    if (!b) return;
    let any = false;
    for (let i = 0; i < SLOTS.length; i++) {
      try { if (localStorage.getItem(SLOTS[i])) { any = true; break; } } catch (e) {}
    }
    if (!any) try { if (localStorage.getItem(AUTO_SLOT_KEY)) any = true; } catch (e) {}
    b.disabled = !any;
    b.textContent = any ? '继续征程' : '暂无存档';
  }
  function showGuide() { guideScreen.classList.add('show'); }
  function hideGuide() { guideScreen.classList.remove('show'); }

  /* Konami code on the title screen — the curious get in without finishing. */
  const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown',
                  'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let konamiPos = 0;
  function armKonami() {
    window.addEventListener('keydown', (e) => {
      if (started || !startScreen.classList.contains('show')) { konamiPos = 0; return; }
      const want = KONAMI[konamiPos];
      const got = (e.key.length === 1) ? e.key.toLowerCase() : e.key;
      konamiPos = (got === want) ? konamiPos + 1 : (got === KONAMI[0] ? 1 : 0);
      if (konamiPos === KONAMI.length) {
        konamiPos = 0;
        AU.unlock();
        if (unlockGallery()) AU.sfx('getSpecialItem');
        const b = document.getElementById('btnGallery');
        if (b) { b.classList.add('just-unlocked'); setTimeout(() => b.classList.remove('just-unlocked'), 1600); }
      }
    });
  }

  document.getElementById('btnNewGame').addEventListener('click', startNewGame);
  // start-screen load button (btnLoadGame lives in the bottom bar and is
  // already wired above — binding it here again fired the handler twice)
  document.getElementById('btnLoadGameStart').addEventListener('click', loadSave);
  document.getElementById('btnGuide').addEventListener('click', showGuide);
  document.getElementById('btnGuideBack').addEventListener('click', hideGuide);
  document.getElementById('btnGallery').addEventListener('click', () => enterGallery('special_1'));
  document.getElementById('btnExitGallery').addEventListener('click', exitGallery);
  document.querySelectorAll('#galleryBar .gb-nav button').forEach((b) => {
    b.addEventListener('click', () => { if (visiting) enterGallery(b.dataset.floor); });
  });
  soundBtn.addEventListener('click', () => {
    const on = AU.toggle();
    settings.sound = on; saveSettings();
    updateSoundBtn();
  });

  // ---------- boot ----------
  function boot() {
    state = freshState();        // background render behind the start screen
    fitCanvas();                 // 确保首帧就在正确的高清坐标系下绘制
    draw();
    refreshLoadBtn();            // "加载存档" is only live when a save exists
    refreshGalleryBtn();         // 资料馆 shows once it has been earned
    updateSoundBtn();            // 音效按钮初始状态
    armTitleTheme();             // title BGM starts on first interaction
    armKonami();                 // ↑↑↓↓←→←→BA unlocks 资料馆 early
    showStart();                 // wait for the player to choose 新游戏 / 加载存档
  }
  boot();

  // ---------- inert test hook (only active when window.__MT_TEST__ is set) ----------
  if (window.__MT_TEST__) {
    window.__mtErrors = [];
    window.addEventListener('error', (e) => {
      window.__mtErrors.push(String(e.message) + ' @' + (e.filename || '') + ':' + (e.lineno || 0));
    });
    window.__MT = {
      getState: () => state, started: () => started, beginGame,
      openShop, closeShop, buyOption, confirmShopBuy, applyShopEffect,
      goToFloor, curFloor, freshState, G, battleResult,
      openManual, openFlight, useStair,
      setFlag: (k, v) => { state.flags[k] = v; updateHUD(); },
      manualChildren: () => manualGrid.children.length,
      flightChildren: () => flightGrid.children.length,
      // grant an item exactly the way walking onto its tile would
      giveItem: (id) => {
        const f = curFloor();
        f.layer2[0] = f.layer2[0] || [];
        f.layer2[0][0] = id;
        pickupItem(id, f, 0, 0);
        updateHUD();
      },
      useItem: (i) => useInventoryItem(i),
      useItemDir: (dx, dy) => usePendingDir(dx, dy),
      pendingItem: () => pendingItem,
      audioFile: (n) => AU.fileOf(n),
      move: (dx, dy) => tryMove(dx, dy),
      setPos: (x, y) => { state.px = x; state.py = y; draw(); },
      closeDlg, advanceDlg,
      save, load,
      // ---- gallery ("资料馆") visiting mode ----
      enterGallery, exitGallery,
      visiting: () => visiting,
      galleryUnlocked, unlockGallery,
      galleryBarShown: () => {
        const b = document.getElementById('galleryBar');
        return !!(b && b.classList.contains('show'));
      },
      getErrors: () => window.__mtErrors.slice(),
      lossLabelCount: () => __lossLabelCount,
      lossLabelReset: () => { __lossLabelCount = 0; },
      // ---- death judgment ----
      fight: (id) => {
        const f = curFloor();
        for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++)
          if (f.layer1[y][x] === id) return fightMonster(id, f, x, y);
        return false;
      },
      over: () => state.over,
      endClass: () => document.getElementById('endScreen').className,
      endTitle: () => { const t = document.querySelector('#endScreen .endTitle'); return t ? t.textContent : null; },
      endText: () => { const t = document.querySelector('#endScreen .endText'); return t ? t.textContent : null; },
      ending: () => state.ending,
      setFlag: (k, v) => { state.flags[k] = v; return state.flags[k]; },
      showWin: () => { state.win = true; showWin(); return state.ending; },
      battleAnimating: () => battleAnimating,   // 仅用于验证演出页状态，不影响玩法
      imgInfo: (f) => { const i = IMG[f]; return i ? { w: i.naturalWidth, complete: i.complete } : null; },
      draw: () => { draw(); return true; },
      animFrame: (f) => monsterAnimFrame(f),
      holdMove: (dx, dy) => startHoldMove(dx, dy),
      stopHold: () => stopHoldMove(),
      // ---- settings & save share codes ----
      getSettings: () => ({ sound: settings.sound, battleCinematic: settings.battleCinematic }),
      setSetting: (k, v) => { settings[k] = v; saveSettings(); return settings[k]; },
      exportSlot: (i) => slotCode(i),
      importSlot: (i, code) => applySlotCode(i, code),
      // ---- multi-slot save ----
      slotsInfo: () => SLOTS.map((_, i) => readSlot(i)),
      saveSlot: (i, n) => saveToSlot(i, n),
      loadSlot: (i) => loadFromSlot(i),
      delSlot: (i) => deleteSlot(i),
      clearAllSlots: () => {
        for (let i = 0; i < SLOTS.length; i++) { try { localStorage.removeItem(SLOTS[i]); } catch (e) {} }
        try { localStorage.removeItem(LAST_SLOT_KEY); } catch (e) {}
        refreshLoadBtn();
      },
      openSlots,
      // ---- NPC / Boss 分支对话 ----
      talk: (id) => { talkNPC(id, curFloor(), state.px, state.py); return true; },
      choose: (i) => { chooseOption(i); return true; },
      choiceLabels: () => (currentChoices ? currentChoices.map((c) => c.label) : []),
      hasChoices: () => choiceMode,
      branchIds: () => Object.keys(BRANCHES),
      // ---- 移动端手势（逻辑层，便于无头测试） ----
      swipe: (dx, dy) => {
        if (!started) return false;
        const adx = Math.abs(dx), ady = Math.abs(dy);
        if (adx < 24 && ady < 24) return false;
        const dir = adx > ady ? (dx > 0 ? [1, 0] : [-1, 0]) : (dy > 0 ? [0, 1] : [0, -1]);
        tryMove(dir[0], dir[1]);
        return true;
      },
      tapCell: (col, row) => handleTapCell(col, row),
    };
  }
})();
