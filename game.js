(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d', { alpha: false });
  const H = 820, END = 9700, ARENA = 8420, GRAVITY = 1900;
  let W = 1440, dpr = 1, mode = 'title', clock = 0, elapsed = 0, camera = 0, shake = 0;
  let rings = [], enemies = [], particles = [], projectiles = [], platforms = [], springs = [];
  let level = 0, character = 'sonic', cells = [], hazards = [], gateNotice = 0;
  const LEVELS = [
    { name: 'EMERALD COAST', subtitle: 'The coast fights back', sky: ['#123951','#498c9b','#b5d8ba'], rock: '#397b79' },
    { name: 'SKY RUINS', subtitle: 'Ancient traps. A dangerous climb.', sky: ['#302e58','#b07078','#f6c98c'], rock: '#756078' },
    { name: 'IRON FORTRESS', subtitle: 'Break through Eggman’s last defenses.', sky: ['#111c36','#414f70','#a7898f'], rock: '#46516d' }
  ];
  const HEROES = {
    sonic: { name: 'SONIC', color: '#59ceff', speed: 650, boost: 1120, hint: 'Fastest running and boost' },
    tails: { name: 'TAILS', color: '#ffcb68', speed: 580, boost: 960, hint: 'Double jump, then hold jump to fly · uses energy' },
    knuckles: { name: 'KNUCKLES', color: '#ff746f', speed: 600, boost: 1000, hint: 'Hold jump after double jump to glide · double-damage punch' }
  };
  let player, boss, checkpoint = 160, checkpointRings = 0, toastTime = 0, best = 0;
  let audio = null, sound = false, last = performance.now(), trail = [], ringSoundAt = 0;
  const keys = new Set(), pressed = new Set();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const noise = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const dist = (x, y, xx, yy) => Math.hypot(x - xx, y - yy);
  function ground(x) {
    const t = clamp((8200 - x) / 500, 0, 1);
    return 601 + (Math.sin(x / (510 - level * 60)) * (53 + level * 9) + Math.sin(x / 225) * 22) * t;
  }
  function resize() {
    W = H * innerWidth / innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
  }
  addEventListener('resize', resize); resize();
  try { best = Number(localStorage.getItem('sonic-velocity-three-acts-best') || 0); } catch (_) {}

  function tone(freq, length = .09, type = 'sine', vol = .04, slide = 1) {
    if (!sound || !audio) return;
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), audio.currentTime + length);
    gain.gain.setValueAtTime(vol, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + length);
    osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + length);
  }
  $('sound').onclick = () => {
    sound = !sound;
    if (sound) { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); }
    $('sound').innerHTML = `♪ <span>SOUND ${sound ? 'ON' : 'OFF'}</span>`;
    $('sound').setAttribute('aria-label', `${sound ? 'Disable' : 'Enable'} sound`);
    tone(660, .15);
  };
  function toast(message, duration = 3) { $('toast').textContent = message; toastTime = duration; $('toast').classList.add('visible'); }
  function burst(x, y, color, n = 15, force = 200) {
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: rand(-force, force), vy: rand(-force, force), life: rand(.25, .75), max: .75, color, size: rand(2, 6) });
  }
  function switchCharacter(next) {
    if (!HEROES[next]) return;
    character = next;
    document.querySelectorAll('[data-character]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.character === character)));
    $('ability-hint').textContent = `${HEROES[character].name} · ${HEROES[character].hint}`;
    if (player) player.special = false;
    if (mode === 'playing') { burst(player.x, player.y - 40, HEROES[character].color, 20); toast(`${HEROES[character].name} · ${HEROES[character].hint}`, 3); }
  }
  document.querySelectorAll('[data-character]').forEach(button => { button.onclick = () => { switchCharacter(button.dataset.character); button.blur(); }; });
  function reset() { elapsed = 0; loadLevel(0, true); }
  function loadLevel(next, fresh = false) {
    const saved = { rings: fresh ? 0 : player.rings, lives: fresh ? 3 : Math.min(5, player.lives + 1) };
    level = next; cells = []; hazards = []; gateNotice = 0;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    camera = 0; checkpoint = 160; checkpointRings = level ? 15 : 0; shake = 0;
    player = { x: 160, y: ground(160), vx: 0, vy: 0, dir: 1, onGround: true, jumps: 0, rings: saved.rings, lives: saved.lives, special: false, energy: 100, dash: 0, dashCooldown: 0, invulnerable: 0, coyote: .1, jumpBuffer: 0, boost: false };
    boss = { x: 9220, y: 400, hp: 14, maxHp: 14, active: false, timer: 1.5, state: 'intro', cycle: 0, vulnerable: false, hit: 0, phase: 1, warningX: 0 };
    rings = []; enemies = []; particles = []; projectiles = []; platforms = []; springs = []; trail = [];
    for (let x = 400; x < 8250; x += 420) {
      for (let j = 0; j < 7; j++) { const xx = x + j * 34; rings.push({ x: xx, y: ground(xx) - 55 - Math.sin(j / 6 * Math.PI) * 38, collected: false }); }
    }
    for (const x of [1250, 2660, 4090, 5500, 6900, 7800]) {
      const y = ground(x) - 145;
      platforms.push({ x, y, w: 235 });
      for (let j = 0; j < 6; j++) rings.push({ x: x + 30 + j * 34, y: y - 40, collected: false });
    }
    for (const x of [1120, 3940, 6750]) springs.push({ x, y: ground(x), cooldown: 0 });
    const patrols = [980, 1730, 2140, 3050, 3500, 4660, 5030, 5990, 6460, 7370, 8000];
    if (level > 0) patrols.push(1480, 2820, 4480, 5710, 7140, 7780);
    for (const x of patrols) enemies.push({ x, home: x, y: ground(x), alive: true, hp: level === 2 ? 2 : 1, hit: 0, phase: noise(x) * 6 });
    for (const [i, x] of [2350, 4900, 7460].entries()) {
      const y = ground(x) - 175 - level * 16;
      platforms.push({ x: x - 105, y: y + 45, w: 210 });
      cells.push({ x, y, collected: false });
      for (let j = 0; j < 4; j++) rings.push({ x: x - 160 + j * 32, y: ground(x) - 65 - j * 28, collected: false });
    }
    for (const x of [1540, 3200, 5650, 7020]) hazards.push({ type: 'spikes', x, w: 105 + level * 22 });
    if (level > 0) {
      for (const x of [1900, 3650, 6100]) hazards.push({ type: 'pit', x, w: 210 + level * 25 });
      for (const x of [2900, 5300, 7650]) hazards.push({ type: 'crusher', x, w: 75, phase: noise(x) * 5 });
    }
    if (level === 2) for (const x of [1200, 4050, 6600, 8100]) hazards.push({ type: 'laser', x, w: 26, phase: noise(x) * 4 });
    for (const e of enemies) for (const h of hazards) if (h.type === 'pit' && e.home + 55 > h.x && e.home - 55 < h.x + h.w) {
      e.home = h.x + h.w + 100; e.x = e.home; e.y = ground(e.x);
    }
    if (level === 1) for (const p of platforms) if (p.w === 235) p.baseY = p.y;

    for (let j = 0; j < 9; j++) rings.push({ x: ARENA + 200 + j * 110, y: 550, collected: false });
    $('level-screen').classList.add('hidden');
    $('zone-name').innerHTML = `${LEVELS[level].name} <b>/ ACT 0${level + 1} OF 03</b>`;
    $('route-name').textContent = `ACT ${level + 1} / 3`; $('route-goal').textContent = level === 2 ? 'EGGMAN' : 'EXIT';
    $('boss-hud').classList.add('hidden'); $('end-screen').classList.add('hidden'); $('pause-screen').classList.add('hidden');
    $('hud').classList.remove('hidden'); document.body.classList.add('playing');
    mode = 'playing'; keys.clear(); pressed.clear();
    toast(`${LEVELS[level].name} · Find 3 blue power cells to unlock ${level === 2 ? 'Eggman' : 'the exit'}!`, 5);
    updateHUD();
  }
  function clearLevel() {
    mode = 'levelclear'; keys.clear(); pressed.clear();
    $('level-kicker').textContent = `ACT 0${level + 1} COMPLETE · +1 LIFE`;
    $('level-title').innerHTML = `NEXT STOP.<br><em>${LEVELS[level + 1].name}.</em>`;
    $('level-copy').textContent = `${LEVELS[level + 1].subtitle} Your rings carry over. Collect three more power cells to break through the next gate.`;
    $('level-screen').classList.remove('hidden'); tone(880, .3, 'triangle', .05, 1.5);
  }
  $('next-level').onclick = () => { if (mode === 'levelclear') loadLevel(level + 1); };
  $('start').onclick = reset; $('restart').onclick = reset; $('retry').onclick = reset;
  function pause() {
    if (mode === 'playing') { mode = 'paused'; keys.clear(); pressed.clear(); $('pause-screen').classList.remove('hidden'); }
    else if (mode === 'paused') { mode = 'playing'; $('pause-screen').classList.add('hidden'); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }
  }
  $('pause').onclick = pause; $('resume').onclick = pause;
  addEventListener('blur', () => { if (mode === 'playing') pause(); keys.clear(); pressed.clear(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'playing') pause(); });
  const gameKeys = ['Digit1','Digit2','Digit3','Numpad1','Numpad2','Numpad3','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyA','KeyD','KeyW','KeyX','KeyJ','ShiftLeft','ShiftRight','Escape','KeyP'];
  addEventListener('keydown', e => {
    if (!gameKeys.includes(e.code)) return;
    if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
    e.preventDefault();
    if (e.repeat) return;
    if (/^(Digit|Numpad)[123]$/.test(e.code)) { switchCharacter(['sonic','tails','knuckles'][Number(e.code.slice(-1)) - 1]); return; }
    if (e.code === 'Escape' || e.code === 'KeyP') { pause(); return; }
    if (mode === 'title' && e.code === 'Space') { reset(); return; }
    keys.add(e.code); pressed.add(e.code);
  });
  addEventListener('keyup', e => { keys.delete(e.code); });
  document.querySelectorAll('[data-key]').forEach(button => {
    const release = () => { keys.delete(button.dataset.key); button.style.background = ''; };
    button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); keys.add(button.dataset.key); pressed.add(button.dataset.key); button.style.background = '#6caac0'; });
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
  });
  const down = (...codes) => codes.some(c => keys.has(c));
  const tap = (...codes) => codes.some(c => pressed.has(c));
  function attack() {
    if (player.dashCooldown > 0) return;
    player.dash = .24; player.dashCooldown = character === 'knuckles' ? .58 : .7; player.vy = 0;
    let target = null, nearest = 345;
    for (const e of enemies) if (e.alive) { const d = dist(player.x, player.y - 30, e.x, e.y - 23); if (d < nearest) { target = { x: e.x, y: e.y - 23 }; nearest = d; } }
    if (boss.active && boss.hp > 0 && boss.vulnerable && dist(player.x, player.y - 30, boss.x, boss.y) < 400) target = boss;
    if (target) { const a = Math.atan2(target.y - (player.y - 30), target.x - player.x); player.vx = Math.cos(a) * 1350; player.vy = Math.sin(a) * 1350; player.dir = player.vx >= 0 ? 1 : -1; player.onGround = false; }
    else player.vx = player.dir * 1350;
    burst(player.x, player.y - 30, '#9bf8ff', 12, 170); tone(220, .2, 'sawtooth', .025, 3);
  }
  function hurt(sourceX, falling = false) {
    if ((!falling && player.invulnerable > 0) || mode !== 'playing') return;
    player.invulnerable = 2.2; player.dash = 0; shake = 13;
    player.vx = player.x < sourceX ? -340 : 340; player.vy = -510; player.onGround = false;
    tone(160, .3, 'sawtooth', .045, .3);
    if (player.rings > 0 && !falling) {
      const lost = Math.min(player.rings, 20);
      for (let i = 0; i < lost; i++) rings.push({ x: player.x, y: player.y - 40, vx: Math.cos(i / lost * Math.PI * 2) * rand(170, 350), vy: -rand(300, 650), life: 7, pickup: .7, loose: true, collected: false });
      player.rings = 0; toast('Rings scattered! Grab them before they disappear.', 2.2);
    } else {
      player.lives--;
      if (player.lives <= 0) { end(false); return; }
      player.x = checkpoint; player.y = ground(checkpoint); player.vx = 0; player.vy = 0; player.onGround = true; player.jumps = 0; player.special = false; player.energy = 100; player.rings = checkpointRings;
      projectiles = []; trail = [];
      if (boss.active) { boss.hp = 14; boss.state = 'intro'; boss.timer = 1.6; boss.vulnerable = false; boss.cycle = 0; boss.x = 9220; }
      camera = clamp(player.x - W * .3, 0, END - W + 250);
      toast(`${player.lives} ${player.lives === 1 ? 'life' : 'lives'} left · Back at the checkpoint`, 3);
    }
  }
  function end(win) {
    mode = win ? 'won' : 'lost'; keys.clear(); pressed.clear();
    $('end-screen').classList.remove('hidden');
    $('end-kicker').textContent = win ? 'EGGMAN DOWN · COAST CLEAR' : 'EVEN LEGENDS NEED ANOTHER TRY';
    $('end-title').innerHTML = win ? 'TOO FAST.<br><em>TOO GOOD.</em>' : 'GET UP.<br><em>GO AGAIN.</em>';
    const time = formatTime(elapsed);
    if (win) {
      const record = !best || elapsed < best;
      if (record) { best = elapsed; try { localStorage.setItem('sonic-velocity-three-acts-best', best); } catch (_) {} }
      $('end-copy').textContent = `You cleared all three zones in ${time} with ${player.rings} rings. ${record ? 'A new personal best!' : 'Personal best: ' + formatTime(best) + '.'}`;
      tone(880, .4, 'triangle', .06, 1.5);
    } else $('end-copy').textContent = boss.active ? 'Rings protect you from a hit. Jump over the shockwaves, dodge the red targets, and dash into Eggman when his shield turns green.' : 'Find all three blue power cells in each level. Jump over spikes and gaps, and wait for crushers and lasers to clear. Try Tails for flight or Knuckles for gliding and powerful punches.';
  }
  function formatTime(t) { return `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`; }

  function updateBoss(dt) {
    if (!boss.active || boss.hp <= 0) return;
    boss.phase = boss.hp > 9 ? 1 : boss.hp > 4 ? 2 : 3;
    boss.hit = Math.max(0, boss.hit - dt); boss.timer -= dt;
    const open = boss.state === 'open'; boss.vulnerable = open;
    const targetX = open ? clamp(player.x + (boss.x > player.x ? 200 : -200), ARENA + 200, END - 160) : 9160 + Math.sin(elapsed * .65) * 280;
    boss.x = lerp(boss.x, targetX, dt * (open ? .65 : 1.3));
    boss.y = lerp(boss.y, open ? 453 : 340 + Math.sin(elapsed * 2) * 30, dt * 2.2);
    if (boss.timer <= 0) {
      switch (boss.state) {
        case 'intro': case 'open':
          boss.vulnerable = false; boss.state = 'warn'; boss.timer = 1.1 - boss.phase * .1;
          boss.warningX = clamp(player.x + player.vx * .25, ARENA + 60, END - 50); boss.cycle++;
          break;
        case 'warn':
          if (boss.cycle % 2) {
            for (let i = 0; i < 3 + boss.phase; i++) {
              const tx = boss.warningX + (i - (2 + boss.phase) / 2) * 115;
              const a = Math.atan2(ground(tx) - boss.y, tx - boss.x);
              projectiles.push({ type: 'missile', x: boss.x, y: boss.y + 40, vx: Math.cos(a) * (330 + boss.phase * 35), vy: Math.sin(a) * (330 + boss.phase * 35), life: 5 });
            }
            tone(140, .3, 'sawtooth', .03, .4);
          } else {
            for (const dir of [-1, 1]) projectiles.push({ type: 'wave', x: boss.x, y: ground(boss.x) - 19, vx: dir * (370 + boss.phase * 65), vy: 0, life: 5 });
            burst(boss.x, ground(boss.x), '#ffb457', 35, 300); shake = 7;
            if (boss.phase > 1) projectiles.push({ type: 'bomb', x: boss.warningX, y: 130, vx: 0, vy: 120, life: 4 });
          }
          boss.state = 'attack'; boss.timer = 1.2 + boss.phase * .14; break;
        case 'attack':
          boss.state = 'open'; boss.vulnerable = true; boss.timer = boss.phase === 3 ? 2 : 2.8;
          toast('SHIELD DOWN · Jump + X to home in on Eggman!', 1.9); tone(620, .2, 'triangle', .04, 1.5);
          break;
      }
    }
    const d = dist(player.x, player.y - 32, boss.x, boss.y);
    if (d < 82) {
      if (player.dash > 0 && boss.vulnerable && boss.hit <= 0) {
        boss.hp = Math.max(0, boss.hp - (character === 'knuckles' ? 2 : 1)); boss.hit = .65; player.dash = 0; player.vx = (player.x < boss.x ? -1 : 1) * 370; player.vy = -540; player.jumps = 1; player.onGround = false; player.invulnerable = Math.max(player.invulnerable, .6); player.energy = Math.min(100, player.energy + 20);
        burst(boss.x, boss.y, '#fff2a0', 40, 350); shake = 15; tone(110, .2, 'square', .06, .4);
        if (boss.hp <= 0) { burst(boss.x, boss.y, '#ff9556', 120, 600); projectiles = []; boss.state = 'defeated'; toast('EGGMAN DEFEATED!', 3); }
      } else if (!(boss.hit > 0) && player.dash <= 0) hurt(boss.x);
      else if (!boss.vulnerable && player.dash > 0) { player.dash = 0; player.vx *= -.45; player.vy = -360; toast('Shield active! Wait for the green opening.', 2); }
    }
  }
  function update(dt) {
    clock += dt;
    if (mode !== 'playing') return;
    elapsed += dt; gateNotice = Math.max(0, gateNotice - dt); toastTime -= dt; if (toastTime <= 0) $('toast').classList.remove('visible');
    shake = Math.max(0, shake - dt * 35);
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    player.dash = Math.max(0, player.dash - dt);
    player.coyote = player.onGround ? .11 : Math.max(0, player.coyote - dt);
    player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
    if (tap('Space', 'ArrowUp', 'KeyW')) player.jumpBuffer = .14;
    if (player.jumpBuffer > 0 && (player.coyote > 0 || player.jumps < 2)) {
      player.vy = player.jumps === 0 ? -740 : -660; player.jumps++; player.jumpBuffer = 0; player.onGround = false; player.coyote = 0;
      burst(player.x, player.y, '#c3ece2', 10, 100); tone(340, .13, 'triangle', .04, 2.2);
    }
    if (tap('KeyX', 'KeyJ')) attack();
    const direction = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0);
    player.boost = down('ShiftLeft', 'ShiftRight') && player.energy > 2 && direction !== 0 && player.dash <= 0;
    player.energy = clamp(player.energy + dt * (player.boost ? -26 : 16), 0, 100);
    if (player.dash <= 0) {
      const top = player.boost ? HEROES[character].boost : HEROES[character].speed, acceleration = player.onGround ? 1900 : 1100;
      if (direction) { player.dir = direction; player.vx = lerp(player.vx, direction * top, Math.min(1, dt * acceleration / top)); }
      else player.vx *= Math.exp(-dt * (player.onGround ? 6 : 1.1));
      player.vy += GRAVITY * dt;
      if (player.vy < -250 && !down('Space', 'ArrowUp', 'KeyW')) player.vy += 900 * dt;
    }
    player.special = false;
    if (character !== 'sonic' && !player.onGround && player.jumps >= 2 && down('Space', 'ArrowUp', 'KeyW') && player.energy > 2 && player.dash <= 0) {
      player.special = true;
      player.energy = Math.max(0, player.energy - dt * (character === 'tails' ? 52 : 34));
      if (character === 'tails') player.vy = Math.max(-150, player.vy - GRAVITY * dt - 600 * dt);
      else if (player.vy > 85) player.vy = 85;
    }
    // Moving platforms carry standing players before collision is resolved.
    for (const p of platforms) if (p.baseY !== undefined) {
      const previous = p.y; p.y = p.baseY + Math.sin(elapsed * 1.25 + p.x) * 35;
      if (player.onGround && Math.abs(player.y - previous) < 2 && player.x >= p.x && player.x <= p.x + p.w) player.y += p.y - previous;
    }
    const oldY = player.y, oldX = player.x, wasGrounded = player.onGround;
    player.x += player.vx * dt; player.y += player.vy * dt;
    player.x = clamp(player.x, boss.active ? ARENA + 35 : 30, END - 35);
    let floor = hazards.some(h => h.type === 'pit' && player.x > h.x && player.x < h.x + h.w) ? Infinity : ground(player.x);
    for (const p of platforms) if (player.x > p.x - 10 && player.x < p.x + p.w + 10 && oldY <= p.y + 12 && player.vy >= 0) floor = Math.min(floor, p.y);
    player.onGround = false;
    if (player.y >= floor && player.vy >= 0 && (oldY <= floor + 35 || wasGrounded) || wasGrounded && player.vy >= 0 && Math.abs(player.y - floor) < 35 && Math.abs(oldX - player.x) < 30) {
      if (!wasGrounded && player.vy > 350) burst(player.x, floor, '#d9e7b1', 8, 120);
      player.y = floor; player.vy = 0; player.onGround = true; player.jumps = 0;
    }
    if (player.y > H + 130) { hurt(player.x, true); updateHUD(); pressed.clear(); return; }
    if (player.onGround && Math.abs(player.vx) > 350 && Math.random() < .55) particles.push({ x: player.x - player.dir * 15, y: player.y - 4, vx: -player.vx * .12, vy: -rand(10, 60), life: .35, max: .35, size: rand(2, 6), color: '#d7e6a2' });
    for (const s of springs) { s.cooldown = Math.max(0, s.cooldown - dt); if (s.cooldown === 0 && Math.abs(player.x - s.x) < 28 && player.y > s.y - 30 && player.vy >= 0) { player.vy = -1120; player.onGround = false; player.jumps = 1; s.cooldown = .7; burst(s.x, s.y, '#ff748a', 14, 150); tone(200, .3, 'triangle', .07, 4); } }
    for (const r of rings) {
      if (r.collected) continue;
      if (r.loose) { r.life -= dt; r.pickup -= dt; r.vy += 1300 * dt; r.x += r.vx * dt; r.y += r.vy * dt; if (r.y > ground(r.x) - 15) { r.y = ground(r.x) - 15; r.vy *= -.62; r.vx *= .85; } if (r.life <= 0) r.collected = true; }
      if ((!r.loose || r.pickup <= 0) && dist(player.x, player.y - 34, r.x, r.y) < (player.boost ? 72 : 49)) { r.collected = true; player.rings++; player.energy = Math.min(100, player.energy + 2); burst(r.x, r.y, '#ffe986', 5, 90); if (clock - ringSoundAt > .055) { tone(1250 + player.rings % 4 * 160, .1, 'sine', .035); ringSoundAt = clock; } }
    }
    for (const e of enemies) {
      if (!e.alive) continue;
      e.hit = Math.max(0, e.hit - dt); e.x = e.home + Math.sin(elapsed * (1.5 + level * .35) + e.phase) * 55; e.y = ground(e.x);
      if (e.hit <= 0 && dist(player.x, player.y - 28, e.x, e.y - 21) < 43) {
        if (player.dash > 0 || !player.onGround && player.vy > 120 && player.y < e.y - 12) { e.hp -= character === 'knuckles' ? 2 : 1; e.hit = .4; e.alive = e.hp > 0; if (e.alive) { player.dash = 0; player.vx *= -.4; player.vy = -430; player.onGround = false; } burst(e.x, e.y - 20, '#ffa957', 23, 230); player.energy = Math.min(100, player.energy + 15); if (player.dash <= 0) { player.vy = -480; player.jumps = 1; } tone(130, .15, 'square', .03, .4); }
        else hurt(e.x);
      }
    }
    for (const cell of cells) if (!cell.collected && dist(player.x, player.y - 35, cell.x, cell.y) < 44) {
      cell.collected = true; burst(cell.x, cell.y, '#7affec', 35); tone(900, .25, 'triangle', .06, 1.7);
      toast(cells.every(c => c.collected) ? 'ALL POWER CELLS FOUND · The gate is open!' : 'POWER CELL FOUND · Keep searching the high route.', 3);
    }
    for (const h of hazards) {
      const within = player.x + 18 > h.x && player.x - 18 < h.x + h.w;
      if (!within) continue;
      const floorY = ground(player.x);
      if (h.type === 'spikes' && player.y > floorY - 26 && player.y < floorY + 30) hurt(h.x + h.w / 2);
      if (h.type === 'laser' && hazardPhase(h) > 1.25 && hazardPhase(h) < 2.65 && player.y > floorY - 230 && player.y - 65 < floorY) hurt(h.x);
      if (h.type === 'crusher') { const bottom = crusherBottom(h); if (player.y > bottom - 72 && player.y - 65 < bottom) hurt(h.x); }
    }
    if (mode !== 'playing') { updateHUD(); pressed.clear(); return; }
    if (player.x > 4200 && checkpoint < 4000) { checkpoint = 4260; checkpointRings = 10; toast('CHECKPOINT · Halfway to trouble. Keep moving!', 3); burst(player.x, player.y - 40, '#c6ff4a', 30); }
    if (player.x > ARENA - 55 && !cells.every(c => c.collected)) {
      player.x = ARENA - 55; player.vx = Math.min(0, player.vx);
      if (gateNotice <= 0) { const missing = cells.find(c => !c.collected); toast(`GATE LOCKED · Find the blue cell ${Math.round(Math.abs(player.x - missing.x))}m to your left.`, 3); gateNotice = 4; }
    }
    if (player.x > ARENA && cells.every(c => c.collected) && level < 2) { clearLevel(); updateHUD(); return; }
    if (player.x > ARENA && level === 2 && cells.every(c => c.collected) && !boss.active) { boss.active = true; checkpoint = ARENA + 110; checkpointRings = 15; $('boss-hud').classList.remove('hidden'); toast('DR. EGGMAN · Dodge the red warnings. Attack when green!', 4); }
    updateBoss(dt);
    for (const p of projectiles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'bomb') p.vy += 500 * dt;
      if (p.type === 'wave') p.y = ground(p.x) - 20;
      if (p.type !== 'wave' && p.y >= ground(p.x) - 8) { burst(p.x, p.y, '#ff8957', 18, 200); if (dist(player.x, player.y - 25, p.x, p.y) < 67) hurt(p.x); p.life = 0; }
      if (p.life > 0 && dist(player.x, player.y - 30, p.x, p.y) < (p.type === 'wave' ? 43 : 35)) { if (player.dash > 0 && p.type !== 'wave') { burst(p.x, p.y, '#9bf8ff', 10); p.life = 0; } else hurt(p.x); }
    }
    projectiles = projectiles.filter(p => p.life > 0 && p.x > ARENA - 100 && p.x < END + 100);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 350 * dt; p.life -= dt; }
    particles = particles.filter(p => p.life > 0).slice(-450);
    trail.push({ x: player.x, y: player.y - 30, life: .22, dash: player.dash > 0 }); trail.forEach(p => p.life -= dt); trail = trail.filter(p => p.life > 0);
    const desired = clamp(player.x - W * (boss.active ? .43 : .3) + player.vx * .13, 0, Math.max(0, END - W + 140));
    camera = lerp(camera, desired, 1 - Math.exp(-dt * 5));
    if (boss.hp <= 0) { boss.timer -= dt; if (boss.timer < -1.5) end(true); }
    updateHUD(); pressed.clear();
  }
  function hazardPhase(h) { return (elapsed + h.phase) % 3.6; }
  function crusherBottom(h) {
    const t = hazardPhase(h), g = ground(h.x);
    return g - 230 + (t < 1.3 ? 0 : t < 1.55 ? (t - 1.3) / .25 * 228 : t < 2.3 ? 228 : Math.max(0, (3.4 - t) / 1.1) * 228);
  }
  function updateHUD() {
    $('cell-count').textContent = `${cells.filter(c => c.collected).length} / 3`;
    const nextCell = cells.find(c => !c.collected);
    $('cell-hint').textContent = nextCell ? `${nextCell.x < player.x ? '←' : '→'} Next cell: ${Math.round(Math.abs(nextCell.x - player.x))}m · look above the path` : 'Gate unlocked · Head right!';
    $('ring-count').textContent = String(player.rings).padStart(3, '0'); $('time').textContent = formatTime(elapsed);
    $('lives').textContent = '● '.repeat(Math.max(0, player.lives)).trim(); $('speed').textContent = Math.round(Math.abs(player.vx) * .32);
    $('energy').style.width = `${player.energy}%`; $('boost-label').textContent = player.special ? character === 'tails' ? 'FLYING' : 'GLIDING' : player.boost ? 'BOOSTING' : player.energy < 25 ? 'RECHARGING' : 'SHIFT';
    const progress = clamp(player.x / ARENA * 100, 0, 100); $('route-progress').style.width = `${progress}%`; $('route-dot').style.left = `${progress}%`;
    $('boss-health').style.width = `${boss.hp / boss.maxHp * 100}%`; $('boss-phase').textContent = `PHASE 0${boss.phase}`;
    $('boss-hint').textContent = boss.vulnerable ? 'SHIELD DOWN · JUMP + DASH ATTACK' : boss.state === 'warn' ? boss.cycle % 2 ? 'MISSILES INCOMING · KEEP MOVING' : 'SHOCKWAVE INCOMING · JUMP!' : 'SHIELD ACTIVE · DODGE AND GET CLOSE';
    $('boss-hint').style.color = boss.vulnerable ? '#c6ff4a' : '#f4dfd2';
  }

  // Everything in the world is drawn locally: layered landscape, materials, characters and effects.
  function ellipse(x, y, rx, ry, fill) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(.01, rx), Math.max(.01, ry), 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
  function path(points, fill, stroke, width = 1) { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); if (fill) { ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); } }
  function gradient(x1, y1, x2, y2, stops) { const g = ctx.createLinearGradient(x1, y1, x2, y2); stops.forEach(s => g.addColorStop(...s)); return g; }
  function glow(x, y, r, color) { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  function background(cam) {
    ctx.fillStyle = gradient(0, 0, 0, H, [[0, LEVELS[level].sky[0]], [.35, LEVELS[level].sky[1]], [.68, LEVELS[level].sky[2]], [1, '#376e66']]); ctx.fillRect(0, 0, W, H);
    glow(W * .76, 175, 320, '#ffe3a045'); ellipse(W * .76, 175, 36, 36, '#ffefbaaa');
    ctx.save(); ctx.globalAlpha = .065; path([[W*.76-25,140],[W*.76+20,140],[W*.56,H],[W*.22,H]], '#fff6c8'); path([[W*.76,150],[W*.76+28,150],[W*1.05,H],[W*.82,H]], '#fff6c8'); ctx.restore();
    for (let i = 0; i < 13; i++) { const x = ((i * 237 - cam * .06 + clock * 2) % (W + 400) + W + 400) % (W + 400) - 200; const y = 85 + noise(i + 7) * 200; ctx.globalAlpha = .1 + noise(i) * .13; ellipse(x, y, 90 + noise(i + 5) * 100, 12, '#d8eddf'); ellipse(x + 35, y - 10, 60, 17, '#d8eddf'); } ctx.globalAlpha = 1;
    for (let layer = 0; layer < 3; layer++) {
      const step = 460, offset = cam * (.07 + layer * .055), base = 455 + layer * 42;
      for (let i = Math.floor(offset / step) - 1; i < (offset + W) / step + 1; i++) {
        const x = i * step - offset, high = 100 + noise(i + layer * 17) * 160;
        const color = level === 0 ? ['#4c8e8b','#397b79','#286565'][layer] : LEVELS[level].rock;
        path([[x-80,base],[x+20,base-high*.35],[x+88,base-high*.38],[x+135,base-high],[x+215,base-high-8],[x+250,base-high*.7],[x+320,base-high*.5],[x+450,base]], color);
        path([[x+135,base-high],[x+165,base-high+20],[x+193,base],[x+95,base]], '#a0c6a410');
        for(let k=0;k<6;k++) { const xx=x+140+k*13; path([[xx,base-high],[xx+4,base-high-12-noise(i+k)*15],[xx+10,base-high]], '#315f6035'); }
      }
    }
    ctx.fillStyle = gradient(0, 445, 0, 670, [[0,'#8bb9a0'],[.08,'#66b9b0'],[.5,'#247d86'],[1,'#145366']]); ctx.fillRect(0, 460, W, 270);
    for(let i=0;i<60;i++) { const y=467+noise(i+51)*220,x=((noise(i+2)*3000-cam*.2+clock*(5+noise(i)*10))%(W+200)+W+200)%(W+200)-100; ctx.fillStyle=i%3===0?'#d9eacc35':'#89e1d523'; ctx.fillRect(x,y,20+noise(i+1)*130,1+noise(i)*2); }
    for(let i=0;i<7;i++) {const x=((i*173-cam*.04+clock*10)%(W+160)+W+160)%(W+160)-80,y=180+noise(i+20)*150;ctx.strokeStyle='#163e4960';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x-7,y);ctx.quadraticCurveTo(x-3,y-4-Math.sin(clock*3+i)*2,x,y);ctx.quadraticCurveTo(x+4,y-4-Math.sin(clock*3+i)*2,x+8,y);ctx.stroke();}
  }
  function palm(x, y, scale = 1, seed = 0) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    const lean = Math.sin(seed) * 22;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-14, -80, lean, -165); ctx.strokeStyle = '#634d34'; ctx.lineWidth = 13; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3, 0); ctx.quadraticCurveTo(-9, -80, lean + 3, -165); ctx.strokeStyle = '#b39b58'; ctx.lineWidth = 4; ctx.stroke();
    for(let i=0;i<12;i++) { const yy=-i*13; path([[-7+lean*i/17,yy],[7+lean*i/17,yy-3]],null,'#302f283c',2); }
    ctx.translate(lean, -165);
    for(let i=0;i<8;i++) { const a=i/8*Math.PI*2+Math.sin(clock*.6+seed)*.035; ctx.save();ctx.rotate(a); ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(46,-45,102,5);ctx.quadraticCurveTo(45,-17,0,0);ctx.fillStyle=i%2?'#397d46':'#66a55a';ctx.fill();path([[0,0],[53,-14],[99,5]],null,'#b3c97355',1);ctx.restore(); }
    ellipse(-3, 4, 9, 10, '#786242'); ellipse(9, 5, 8, 9, '#9b7b45'); ctx.restore();
  }
  function arch(x, y, radius) {
    ctx.save();ctx.translate(x,y);ctx.strokeStyle='#344f40';ctx.lineWidth=55;ctx.beginPath();ctx.arc(0,0,radius,Math.PI,Math.PI*2);ctx.stroke();ctx.strokeStyle='#6f8760';ctx.lineWidth=40;ctx.stroke();ctx.strokeStyle='#9abb62';ctx.lineWidth=9;ctx.beginPath();ctx.arc(0,-17,radius+12,Math.PI,Math.PI*2);ctx.stroke();
    for(let i=0;i<24;i++){const a=Math.PI+i/24*Math.PI;path([[Math.cos(a)*(radius-19),Math.sin(a)*(radius-19)],[Math.cos(a)*(radius+23),Math.sin(a)*(radius+23)]],null,'#1d403348',2);}ctx.restore();
  }
  function landscape(cam) {
    for (const x of [1750, 3520, 5880, 7600]) if(x-cam>-600&&x-cam<W+600) arch(x-cam,ground(x)+15,180);
    if (level > 0) for (let i = Math.floor(cam / 380) - 1; i < (cam + W) / 380 + 1; i++) {
      const x = i * 380 - cam, y = ground(i * 380), height = 170 + noise(i + 4) * 150;
      if (level === 1) {
        ctx.fillStyle = gradient(x, 0, x + 50, 0, [[0,'#55475d'],[.5,'#b2a08a'],[1,'#746477']]); ctx.fillRect(x, y-height, 48, height);
        ctx.fillStyle='#c6b399';ctx.fillRect(x-13,y-height,74,17);ctx.fillRect(x-8,y-16,64,16);
        for(let j=0;j<4;j++)path([[x+8+j*10,y-height+24],[x+8+j*10,y-20]],null,'#483d5255',3);
        path([[x-22,y-height],[x+25,y-height-25],[x+70,y-height]],'#978591');
      } else {
        ctx.fillStyle='#283447';ctx.fillRect(x,y-height,70,height);ctx.fillStyle='#455668';ctx.fillRect(x+6,y-height+6,56,7);
        for(let yy=y-height+28;yy<y-20;yy+=34){ctx.fillStyle='#ffb57370';ctx.fillRect(x+13,yy,13,7);ctx.fillRect(x+42,yy,13,7);}
        path([[x+35,y-height],[x+35,y-height-65],[x+115,y-height-65]],null,'#32465b',7);
        ellipse(x+35,y-height-68,4,4,Math.sin(clock*3+i)>0?'#ff8b74':'#674354');
      }
    }
    for(let i=Math.floor(cam/390)-1;i<(cam+W)/390+1;i++) {const x=i*390+noise(i)*170; if(level === 0 && i%3!==1) palm(x-cam,ground(x)+25,.7+noise(i+8)*.6,i);}
    ctx.save(); ctx.beginPath(); ctx.moveTo(-10, H+10);
    for(let x=-10;x<=W+30;x+=20)ctx.lineTo(x,ground(x+cam));ctx.lineTo(W+30,H+10);ctx.closePath();ctx.clip();
    ctx.fillStyle=gradient(0,500,0,H,level === 0 ? [[0,'#69774c'],[.38,'#525538'],[1,'#152c2c']] : level === 1 ? [[0,'#a18a70'],[.38,'#685567'],[1,'#292e48']] : [[0,'#78818b'],[.38,'#414655'],[1,'#1c2135']]);ctx.fillRect(0,400,W,H);
    const size=56;
    for(let ix=Math.floor(cam/size)-1;ix<(cam+W)/size+1;ix++)for(let iy=8;iy<16;iy++) {ctx.fillStyle=(ix+iy)%2?'#091c202d':'#b2a87915';ctx.fillRect(ix*size-cam,iy*size,size,size);ctx.fillStyle='#d1b6810b';ctx.fillRect(ix*size-cam+3,iy*size+3,size-6,2);}
    for(let i=Math.floor(cam/37);i<(cam+W)/37+1;i++){const x=i*37-cam,y=ground(i*37);path([[x,y],[x+6,y+55+noise(i)*100],[x+14,y]],'#213b3055');}
    ctx.restore();
    ctx.beginPath();for(let x=-10;x<W+30;x+=12){const y=ground(x+cam);if(x===-10)ctx.moveTo(x,y+8);else ctx.lineTo(x,y+8);}ctx.lineWidth=20;ctx.strokeStyle='#253f2e';ctx.stroke();
    ctx.beginPath();for(let x=-10;x<W+30;x+=12){const y=ground(x+cam);if(x===-10)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.lineWidth=13;ctx.strokeStyle='#739a44';ctx.stroke();
    ctx.beginPath();for(let x=-10;x<W+30;x+=12){const y=ground(x+cam);if(x===-10)ctx.moveTo(x,y-4);else ctx.lineTo(x,y-4);}ctx.lineWidth=3;ctx.strokeStyle='#d0d789';ctx.stroke();
    for(let i=Math.floor(cam/17);i<(cam+W)/17+1;i++){const x=i*17-cam,y=ground(i*17);path([[x-4,y],[x-5,y-7-noise(i)*9],[x+2,y-1],[x+6,y-11],[x+5,y]],i%3?'#86a957':'#bdce77');if(i%19===0){path([[x,y],[x,y-23]],null,'#647e3e',2);ellipse(x,y-24,5,5,'#edce76');ellipse(x,y-24,2,2,'#68592d');}}
    for(const p of platforms){const x=p.x-cam;if(x<-300||x>W+300)continue;path([[x,p.y],[x+p.w,p.y],[x+p.w-16,p.y+22],[x+40,p.y+38],[x+10,p.y+22]],'#58684c');path([[x,p.y],[x+p.w,p.y]],null,'#a3c265',10);path([[x,p.y-4],[x+p.w,p.y-4]],null,'#d5dfa1',2);for(let i=0;i<7;i++)path([[x+i*31,p.y+8],[x+i*31+18,p.y+20]],null,'#203a323a',3);}
    if(cam<4600&&cam+W>4250){const x=4260-cam,y=ground(4260);path([[x,y],[x,y-125]],null,'#c3d8bd',5);ellipse(x,y-125,12,12,checkpoint>4000?'#c6ff4a':'#5ce5d9');glow(x,y-125,35,'#c6ff4a33');}
    if(level === 2 && cam+W>ARENA){const x=ARENA-cam;ctx.fillStyle='#34494d';ctx.fillRect(x,604,END-ARENA+200,20);for(let xx=Math.max(x,0);xx<W;xx+=60)path([[xx,604],[xx+17,604],[xx-2,624],[xx-19,624]],'#c7af5f');if(boss?.active){for(const xx of [ARENA,END]){path([[xx-cam,601],[xx-cam,370]],null,'#ff7f7055',5);glow(xx-cam,490,90,'#ff584420');}}}
  }
  function drawRing(x,y,scale=1,phase=0) {
    const width=(.35+Math.abs(Math.sin(clock*2.3+phase))*.65)*11*scale;
    ctx.save();ctx.translate(x,y);ctx.strokeStyle='#80501c';ctx.lineWidth=5*scale;ctx.beginPath();ctx.ellipse(1,2,width,15*scale,0,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#ffc64b';ctx.lineWidth=4*scale;ctx.beginPath();ctx.ellipse(0,0,width,15*scale,0,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#fff2b1';ctx.lineWidth=1.5*scale;ctx.beginPath();ctx.ellipse(-1,-1,width-1*scale,14*scale,0,Math.PI*.9,Math.PI*1.9);ctx.stroke();ctx.restore();
  }
  function drawObstacles(cam) {
    for (const h of hazards) {
      if (h.x + h.w < cam - 100 || h.x > cam + W + 100) continue;
      const x = h.x - cam, y = ground(h.x);
      if (h.type === 'pit') {
        path([[x,ground(h.x)-7],[x+h.w,ground(h.x+h.w)-7],[x+h.w,H+5],[x,H+5]],gradient(0,y,0,H,[[0,'#151d35'],[1,level===1?'#ca734e':'#597bb0']]));
        for(let i=0;i<7;i++){const xx=x+noise(i+8)*h.w,yy=y+50+((clock*32+i*37)%150);ellipse(xx,yy,2,3,level===1?'#ffa67788':'#87e5ff88');}
        path([[x-20,y-8],[x-9,y-8],[x-9,y+18]],null,'#f9d887',4);path([[x+h.w+9,ground(h.x+h.w)+16],[x+h.w+9,ground(h.x+h.w)-8],[x+h.w+20,ground(h.x+h.w)-8]],null,'#f9d887',4);
      } else if (h.type === 'spikes') {
        ctx.fillStyle='#394553';ctx.fillRect(x,y-5,h.w,10);
        for(let i=0;i<h.w;i+=19)path([[x+i,y],[x+i+9,y-30],[x+i+18,y]],gradient(0,y-30,0,y,[[0,'#ebf4f3'],[1,'#697484']]));
      } else if (h.type === 'crusher') {
        const bottom=crusherBottom(h),phase=hazardPhase(h);
        path([[x+h.w/2,y-290],[x+h.w/2,bottom-72]],null,'#607078',9);
        ctx.fillStyle=gradient(x,0,x+h.w,0,[[0,'#7d8a91'],[.5,'#c3c6b7'],[1,'#5c6676']]);ctx.fillRect(x,bottom-72,h.w,72);
        ctx.fillStyle='#303d4d';ctx.fillRect(x+7,bottom-65,h.w-14,45);
        for(let j=0;j<3;j++)path([[x+10+j*22,bottom-12],[x+20+j*22,bottom-12],[x+10+j*22,bottom]],'#f4c26d');
        if(phase>.7&&phase<2.4){glow(x+h.w/2,y-5,60,'#ff715944');path([[x-7,y-5],[x+h.w+7,y-5]],null,'#ff8968',3);}
      } else {
        const phase=hazardPhase(h),active=phase>1.25&&phase<2.65;
        ctx.fillStyle='#314255';ctx.fillRect(x-8,y-240,h.w+16,14);ctx.fillRect(x-8,y-3,h.w+16,10);
        if(active){glow(x+h.w/2,y-110,95,'#ff654533');path([[x+h.w/2,y-226],[x+h.w/2,y-4]],null,'#ff5a6477',22);path([[x+h.w/2,y-226],[x+h.w/2,y-4]],null,'#fff4de',4);}
        else {ctx.setLineDash([4,9]);path([[x+h.w/2,y-226],[x+h.w/2,y-4]],null,phase>.65?'#ffae6599':'#69e3d93a',2);ctx.setLineDash([]);}
      }
      ctx.fillStyle='#ffe0a9';ctx.font='bold 10px Barlow, sans-serif';ctx.textAlign='center';ctx.fillText(h.type==='pit'?'JUMP GAP':h.type==='laser'?'TIMED LASER':h.type==='crusher'?'WATCH ABOVE':'SPIKES',x+h.w/2,y+(h.type==='pit'?35:28));
    }
    for (const cell of cells) if (!cell.collected && cell.x > cam - 60 && cell.x < cam + W + 60) {
      const x=cell.x-cam,y=cell.y+Math.sin(clock*3)*5;
      glow(x,y,58,'#64f4ed55');ctx.save();ctx.translate(x,y);ctx.rotate(clock*.8);path([[0,-20],[16,0],[0,20],[-16,0]],'#8bfff0','#efffff',2);ctx.restore();
      ctx.font='bold 9px Barlow, sans-serif';ctx.textAlign='center';ctx.fillStyle='#dcfff3';ctx.fillText('POWER CELL',x,y-34);
    }
    if (!boss.active && ARENA - cam < W + 50 && ARENA - cam > -100) {
      const x=ARENA-cam,open=cells.every(c=>c.collected),y=ground(ARENA);
      path([[x-30,y],[x-30,y-280],[x+30,y-280],[x+30,y]],null,'#5b7681',11);
      if(!open){ctx.fillStyle='#5bdfee22';ctx.fillRect(x-23,y-273,46,270);for(let i=0;i<8;i++)path([[x-21,y-i*34],[x+21,y-i*34-16]],null,'#83eeff99',3);}
      glow(x,y-282,50,open?'#c6ff4a44':'#67e4ff44');ctx.fillStyle=open?'#c6ff4a':'#adf3ff';ctx.font='bold 12px Barlow, sans-serif';ctx.textAlign='center';ctx.fillText(open?(level===2?'EGGMAN →':'NEXT LEVEL →'):`${cells.filter(c=>c.collected).length} / 3 CELLS`,x,y-302);
    }
  }
  function drawHero(x,y,dir=1,speed=0,ball=false,scale=1,hero=false) {
    if (character === 'sonic') { sonic(x,y,dir,speed,ball,scale,hero); return; }
    const fox=character==='tails',special=mode!=='title'&&player?.special,run=Math.min(1,speed/300),step=Math.sin(clock*27)*run;
    ctx.save();ctx.translate(x,y);ctx.scale(dir*scale,scale);
    const fur=gradient(-22,-88,20,-8,fox?[[0,'#ffe39b'],[.35,'#efac36'],[1,'#b56628']]:[[0,'#ff9c87'],[.35,'#e94448'],[1,'#942b45']]);
    if(fox){
      for(const side of [-1,1]){ctx.save();ctx.translate(-12,-32);ctx.rotate(special?clock*30+side*1.2:side*.42+Math.sin(clock*4)*.12);path([[0,0],[-35,-8],[-60,-36],[-53,-3],[-27,14]],fur);path([[-40,-15],[-60,-36],[-53,-3],[-38,6],[-43,-6],[-32,-4]],'#fff5d5');ctx.restore();}
      if(special){ctx.strokeStyle='#fff2bc66';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(-17,-32,55,12,clock*3,0,Math.PI*2);ctx.stroke();}
    }
    if(ball){glow(0,-29,43,fox?'#ffc34b33':'#ff667733');ellipse(0,-29,28,28,fur);ctx.strokeStyle=fox?'#fff2c9':'#ffc5b7';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,-29,23,clock*24,clock*24+4);ctx.stroke();ctx.restore();return;}
    if(special&&!fox)ctx.rotate(-.28);
    for(const [xx,offset] of [[-8,-step],[10,step]]){path([[xx,-31],[xx+offset*16,-14],[xx+offset*21,-5]],null,fox?'#d99b34':'#bd3047',8);const foot=xx+offset*21;ellipse(foot,-1,10,6,fox?'#f5f1d9':'#71b35b');ellipse(foot+6,5,17,8,fox?'#d84838':'#d94740');path([[foot-10,10],[foot+22,10]],null,'#efe9cb',3);path([[foot+3,-1],[foot+3,10]],null,fox?'#fff8e0':'#e4cc58',6);}
    ellipse(0,-39,17,24,fur);
    if(fox)path([[-11,-51],[0,-45],[10,-53],[12,-28],[2,-21],[-10,-28]],'#fff0cd');
    else{ctx.beginPath();ctx.moveTo(-13,-48);ctx.quadraticCurveTo(0,-35,14,-48);ctx.quadraticCurveTo(0,-20,-13,-48);ctx.fillStyle='#fff0db';ctx.fill();}
    for(const side of [-1,1]){const armX=side*(special?38:25),handY=special?-44:-37;path([[side*10,-49],[armX,handY]],null,fox?'#edb445':'#d84348',7);ellipse(armX,handY,fox?9:13,fox?10:12,'#f3f3e6');path([[armX-5,handY-5],[armX+4,handY-5]],null,'#a7bdba',1);if(!fox){path([[armX-7,handY-8],[armX-5,handY-20],[armX+2,handY-9]],'#fffae3');path([[armX+2,handY-8],[armX+6,handY-19],[armX+10,handY-7]],'#fffae3');}}
    if(!fox)for(const [dx,dy] of [[-26,-65],[-18,-62],[-9,-60],[23,-62]]){ctx.beginPath();ctx.moveTo(dx+8,-85);ctx.quadraticCurveTo(dx-12,dy-8,dx,dy+22);ctx.quadraticCurveTo(dx+11,dy+8,dx+15,-73);ctx.fillStyle=fur;ctx.fill();}
    ellipse(0,-70,25,26,fur);
    if(fox){path([[-24,-81],[-23,-110],[-4,-88]],fur);path([[9,-89],[28,-109],[24,-77]],fur);path([[-20,-88],[-20,-102],[-10,-88]],'#fff1d2');path([[15,-88],[24,-101],[22,-85]],'#fff1d2');path([[-16,-91],[-10,-105],[-3,-96],[6,-104],[13,-91]],fur);path([[-15,-68],[-31,-60],[-16,-58],[-28,-49],[-7,-51]],'#fff1d1');}
    ellipse(10,-68,12,16,'#fff5dc');ellipse(23,-68,7,14,'#fff8e8');ellipse(15,-66,4,9,fox?'#4f8fc0':'#9875b9');ellipse(17,-66,2,7,'#17323b');ellipse(26,-66,2,7,'#263045');ellipse(16,-70,1.2,2,'white');
    if(!fox)path([[-1,-81],[13,-77],[25,-81]],null,'#c33643',4);
    ellipse(17,-53,18,10,fox?'#fff0cf':'#e8bb99');ellipse(32,-60,6,4,'#223039');ellipse(33,-61,2,1,'#829a9c');ctx.beginPath();ctx.moveTo(13,-51);ctx.quadraticCurveTo(22,-47,27,-51);ctx.strokeStyle='#805843';ctx.lineWidth=1.4;ctx.stroke();
    ctx.restore();
  }
  function sonic(x,y,dir=1,speed=0,ball=false,scale=1,hero=false) {
    ctx.save();ctx.translate(x,y);ctx.scale(dir*scale,scale);
    if(ball){glow(0,-28,45,'#46bcff44');const g=gradient(-22,-55,25,0,[[0,'#65d4ff'],[.35,'#1685ea'],[1,'#003886']]);ellipse(0,-29,28,28,g);ctx.strokeStyle='#b8f6ff';ctx.lineWidth=2;for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(0,-29,19+i*3,clock*24+i*2,clock*24+i*2+1.3);ctx.stroke();}ctx.restore();return;}
    const run=Math.min(1,Math.abs(speed)/300),step=Math.sin(clock*(speed>800?37:26))*run;
    const blue=gradient(-20,-72,18,-10,[[0,'#62c5f9'],[.25,'#1683d5'],[.6,'#0757ad'],[1,'#033674']]);
    ctx.rotate(run*.12);
    path([[-8,-30],[-14-step*16,-13],[-8-step*20,-5]],null,'#074d99',9);
    path([[6,-29],[14+step*14,-16],[12+step*22,-4]],null,'#1687d4',9);
    for(const [xx,yy] of [[-8-step*20,-4],[12+step*22,-3]]){ellipse(xx,yy-1,11,6,'#dfeee8');ellipse(xx+6,yy+4,18,8,gradient(xx,yy-2,xx,yy+10,[[0,'#f14d4a'],[1,'#961b25']]));path([[xx-11,yy+7],[xx+23,yy+7]],null,'#ebf0d7',3);path([[xx+3,yy-2],[xx+1,yy+7]],null,'#ffefd7',5);}
    path([[-13,-56],[-35,-49],[-21,-39],[-33,-30],[-13,-32]],blue);
    ellipse(-1,-38,17,24,blue);ellipse(5,-36,9,16,'#d9b78c');
    path([[-8,-49],[-23-run*9,-33],[-29-run*8,-40]],null,'#d9b88d',6);
    ellipse(-30-run*8,-40,9,10,'#e4f4ef');path([[-35-run*8,-45],[-29-run*8,-46]],null,'#9fb9bd',1);
    path([[9,-47],[22+run*8,-33],[28+run*11,-42]],null,'#edcda0',6);ellipse(28+run*11,-43,9,11,'#f3fff4');ellipse(23+run*11,-39,4,5,'#d0e2db');
    path([[-13,-89],[-31,-93],[-25,-78],[-44,-73],[-26,-65],[-39,-52],[-14,-54],[12,-62]],blue);
    ellipse(-2,-69,26,27,blue);
    path([[-18,-83],[-17,-104],[-2,-87]],'#1c88d0');path([[-14,-87],[-14,-97],[-6,-88]],'#dfbb98');path([[9,-87],[20,-99],[23,-75]],'#127ec7');path([[14,-86],[18,-92],[19,-81]],'#dfc099');
    ellipse(12,-67,16,18,'#f5fbdd');ellipse(23,-67,8,15,'#fffce3');ellipse(19,-65,4,10,'#3f985d');ellipse(21,-65,2,8,'#071f2b');ellipse(28,-66,2,7,'#163a35');ellipse(20,-69,1.3,2.3,'white');
    path([[1,-81],[15,-77],[24,-80]],null,'#1262ac',4);
    ellipse(18,-52,19,10,gradient(0,-60,0,-43,[[0,'#f3d7a8'],[1,'#b78d68']]));ellipse(33,-60,7,5,'#102b35');ellipse(34,-62,3,1.5,'#5a777c');
    ctx.beginPath();ctx.moveTo(15,-50);ctx.quadraticCurveTo(23,-46,28,-51);ctx.strokeStyle='#5d5043';ctx.lineWidth=1.5;ctx.stroke();
    if(hero){path([[-24,-75],[-30,-72]],null,'#a2e6ff77',1);path([[-20,-63],[-29,-56]],null,'#a2e6ff55',1);}
    ctx.restore();
  }
  function crab(e) {
    const x=e.x-camera,y=e.y;ctx.save();ctx.translate(x,y);ellipse(0,0,30,6,'#08293266');
    for(const dir of [-1,1]){path([[dir*10,-13],[dir*25,-9],[dir*29,-2]],null,'#9eb6b5',5);path([[dir*17,-21],[dir*31,-34],[dir*39,-29]],null,'#718b90',5);ellipse(dir*39,-31,10,8,'#b3443d');path([[dir*35,-35],[dir*43,-38]],null,'#ed7960',3);}
    ellipse(0,-20,23,16,gradient(0,-36,0,-4,e.hp>1?[[0,'#e4e7d5'],[.4,'#8197aa'],[1,'#394358']]:[[0,'#e98758'],[.4,'#bd493d'],[1,'#5d2d38']]));ellipse(-7,-27,6,6,'#d3e9cf');ellipse(7,-27,6,6,'#d3e9cf');ellipse(-6,-27,2,3,'#ea3f3b');ellipse(8,-27,2,3,'#ea3f3b');path([[-9,-12],[9,-12]],null,'#452f3a',3);if(e.hp>1){ellipse(-5,-44,3,3,'#ffd88c');ellipse(5,-44,3,3,'#ffd88c');}ctx.restore();
  }
  function drawBoss() {
    if(!boss.active||boss.hp<=0)return;
    const x=boss.x-camera,y=boss.y;
    ellipse(x,603,85,12,'#051b3155');
    if(boss.state==='warn') {
      const xx=boss.warningX-camera;ctx.globalAlpha=.5+Math.sin(clock*22)*.2;
      if(boss.cycle%2){ctx.fillStyle=gradient(0,200,0,600,[[0,'#ff5c4000'],[1,'#ff5c4066']]);ctx.fillRect(xx-210,200,420,400);path([[xx-210,596],[xx+210,596]],null,'#ff8d6c',5);for(let i=-2;i<=2;i++){path([[xx+i*95-12,576],[xx+i*95,588],[xx+i*95+12,576]],null,'#ffb28b',3);}}
      else{path([[x-100,590],[x+100,590]],null,'#ff9b68',7);glow(x,590,150,'#ff744c55');}ctx.globalAlpha=1;
    }
    ctx.save();ctx.translate(x,y);
    if(boss.hit>0)ctx.globalAlpha=.65+Math.sin(clock*60)*.3;
    for(const dir of [-1,1]){ellipse(dir*46,52,15,24+Math.sin(clock*35)*8,'#6ad8ff80');ellipse(dir*46,48,8,19,'#d8fbff');}
    glow(0,0,115,boss.vulnerable?'#b0ff4a22':'#fa795a15');
    ellipse(0,-25,53,54,gradient(-50,-70,50,0,[[0,'#aee0d680'],[.5,'#7fc8d036'],[1,'#0f485386']]));
    // Eggman's red jacket, enormous moustache, goggles and unmistakable grin.
    ellipse(0,-8,36,30,'#ba2930');path([[-24,-27],[-15,10]],null,'#e5be62',5);path([[24,-27],[15,10]],null,'#e5be62',5);
    ellipse(0,-44,21,25,'#efbf95');ellipse(0,-33,11,10,'#eeb186');
    path([[-5,-37],[-36,-50],[-27,-33],[-42,-29],[-9,-24],[0,-31],[9,-24],[42,-29],[27,-33],[36,-50],[5,-37]],'#793a25');
    ellipse(-10,-51,11,7,'#282e39');ellipse(10,-51,11,7,'#282e39');ellipse(-10,-52,7,4,'#9cdaea');ellipse(10,-52,7,4,'#9cdaea');ellipse(0,-40,7,7,'#ffcca0');path([[-7,-25],[7,-25],[3,-20],[-4,-20]],'#fff4ce');
    ellipse(0,20,81,39,gradient(-60,-10,50,60,[[0,'#d0e0d4'],[.23,'#708c97'],[.5,'#b7c4b5'],[.6,'#526578'],[1,'#192e43']]));
    path([[-78,15],[-59,35],[59,35],[78,15]],null,'#243749',10);
    for(let i=-2;i<=2;i++){ctx.fillStyle=i%2?'#d7b756':'#35404a';ctx.fillRect(i*20-7,36,15,8);}
    ellipse(0,16,22,16,'#273949');ellipse(0,16,13,10,boss.vulnerable?'#c6ff4a':'#ff7958');glow(0,16,30,boss.vulnerable?'#c6ff4a55':'#ff674b55');
    for(const dir of [-1,1]){ellipse(dir*76,20,18,24,'#2e4358');ellipse(dir*80,16,11,13,'#556f7a');ellipse(dir*81,16,5,6,'#ffb277');}
    ctx.strokeStyle=boss.vulnerable?'#c6ff4a88':'#8edcff77';ctx.lineWidth=boss.vulnerable?2:3;ctx.setLineDash(boss.vulnerable?[6,14]:[]);ctx.beginPath();ctx.ellipse(0,-2,99,88,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    if(boss.vulnerable){ctx.strokeStyle='#d7ff89';ctx.lineWidth=2;for(let i=0;i<4;i++){ctx.save();ctx.rotate(i*Math.PI/2+clock*.3);path([[103,-9],[103,9]],null,'#c6ff4a',3);ctx.restore();}}
    ctx.restore();
  }
  function render() {
    ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
    const title=mode==='title'; const cam=title?650+Math.sin(clock*.06)*60:camera;
    ctx.save();if(shake>0&&mode==='playing')ctx.translate(rand(-shake,shake)*.45,rand(-shake,shake)*.3);
    background(cam);landscape(cam); if (!title) drawObstacles(cam);
    if(title){
      const x=W*.74,y=ground(x+cam);ellipse(x,y+2,90,14,'#102f3666');glow(x,y-100,230,'#5cdcff16');
      for(let i=0;i<5;i++)drawRing(x-170+i*74,y-240-Math.sin(i/4*Math.PI)*50,1.4,i*.6);
      drawHero(x,y-2,1,0,false,2.55,true);
      for(let i=0;i<16;i++){const xx=(noise(i)*W+clock*8)%(W+50),yy=350+noise(i+40)*350;ellipse(xx,yy,1.3,1.3,'#e7ffb755');}
    }else{
      for(const r of rings)if(!r.collected&&r.x>cam-30&&r.x<cam+W+30&&(!r.loose||r.life>2||Math.sin(clock*22)>0))drawRing(r.x-cam,r.y,1,r.x*.012);
      for(const s of springs)if(s.x>cam-40&&s.x<cam+W+40){const x=s.x-cam,y=s.y,compressed=s.cooldown>.5;path([[x-17,y],[x+17,y]],null,'#33474d',7);path([[x-11,y-5],[x+10,y-10],[x-10,y-15],[x+10,y-20]],null,'#e2dcb6',3);ctx.fillStyle='#ed5460';ctx.fillRect(x-22,y-(compressed?12:29),44,9);ctx.fillStyle='#ffa19b';ctx.fillRect(x-21,y-(compressed?12:29),42,2);}
      for(const e of enemies)if(e.alive&&e.x>cam-70&&e.x<cam+W+70)crab(e);
      drawBoss();
      for(const p of projectiles){const x=p.x-cam;glow(x,p.y,35,'#ff874b44');if(p.type==='wave'){ctx.strokeStyle='#ffb463';ctx.lineWidth=6;ctx.beginPath();ctx.arc(x,p.y+17,30,Math.PI,Math.PI*2);ctx.stroke();path([[x-p.vx*.07,p.y+16],[x,p.y+16]],null,'#ffdf9f',4);}else{ctx.save();ctx.translate(x,p.y);ctx.rotate(Math.atan2(p.vy,p.vx));path([[-14,-7],[9,-7],[19,0],[9,7],[-14,7]],'#d4c7aa');path([[-15,-5],[-35-rand(0,15),0],[-15,5]],'#ffae50');ctx.fillStyle='#c24e45';ctx.fillRect(5,-6,6,12);ctx.restore();}}
      if(player.boost||player.dash>0){for(let i=0;i<trail.length;i++){const p=trail[i];ctx.globalAlpha=p.life/.22*.25;ellipse(p.x-cam,p.y,30,24,'#55cfff');}ctx.globalAlpha=1;glow(player.x-cam,player.y-30,90,'#5bcdff30');}
      ellipse(player.x-cam,ground(player.x)+2,Math.max(10,27-(ground(player.x)-player.y)*.035),5,'#112c3c55');
      if(player.invulnerable<=0||Math.floor(clock*14)%2===0)drawHero(player.x-cam,player.y,player.dir,Math.abs(player.vx),player.dash>0||(!player.onGround&&!player.special),1);
      for(const p of particles){ctx.globalAlpha=clamp(p.life/p.max,0,1);ellipse(p.x-cam,p.y,p.size,p.size*.65,p.color);}ctx.globalAlpha=1;
      if(player.boost){ctx.strokeStyle='#c6f6ed2b';ctx.lineWidth=1;for(let i=0;i<18;i++){const x=(noise(i)*W-clock*900) % W,y=noise(i+60)*H;path([[x<0?x+W:x,y],[(x<0?x+W:x)+70+noise(i+8)*180,y]],null,'#c6f6ed35',1);}}
    }
    ctx.restore();
    ctx.fillStyle=gradient(0,0,0,H,[[0,'#04182755'],[.2,'#04182700'],[.65,'#04182700'],[1,'#041827c9']]);ctx.fillRect(0,0,W,H);
    const vignette=ctx.createRadialGradient(W*.55,H*.45,H*.2,W*.5,H*.5,Math.max(W,H)*.8);vignette.addColorStop(0,'transparent');vignette.addColorStop(1,'#00152288');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
  }
  let accumulator = 0;
  function frame(now) {
    const delta=Math.min((now-last)/1000,.05);last=now;accumulator+=delta;
    while(accumulator>=1/120){update(1/120);accumulator-=1/120;}
    render();requestAnimationFrame(frame);
  }
  // A read-only snapshot is useful for local smoke checks without modifying play state.
  window.sonicGame = { get state() { return { mode, elapsed, level: level + 1, character, cells: cells.filter(c=>c.collected).length, player: player ? { ...player } : null, boss: boss ? { ...boss } : null, ringsRemaining: rings.filter(r=>!r.collected).length, enemiesRemaining: enemies.filter(e=>e.alive).length, checkpoint }; } };
  requestAnimationFrame(frame);
})();
