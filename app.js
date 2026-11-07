'use strict';

/* ---------- Konstanta ---------- */
const STORE_KEY = 'hsr-planner-v1';
const MAX_SP = 5;
const DEFAULT_START_SP = 3;

const PATHS = ['Destruction', 'The Hunt', 'Erudition', 'Harmony', 'Nihility', 'Preservation', 'Abundance', 'Remembrance', 'Elation'];
const ELEMENTS = ['Physical', 'Fire', 'Ice', 'Lightning', 'Wind', 'Quantum', 'Imaginary'];

// Data game dari data.js (dibuat oleh tools/update-data.js). Dipakai untuk saran/autofill;
// nilai di luar daftar tetap bisa diketik manual.
const PRESETS = GAME_DATA.characters.map(c => [c.n, c.p, c.e, c.r, c.u]);
const RELIC_SETS = GAME_DATA.relicSets;
const PLANAR_SETS = GAME_DATA.planarSets;
const LIGHT_CONES = GAME_DATA.lightCones;
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Waktu (Action Value): 150 AV pertama = Cycle 0, lalu 100 AV per Cycle.
const FIRST_CYCLE_AV = 150;
const CYCLE_AV = 100;
const CYCLE = 'cycle'; // action khusus: penanda awal Cycle baru

// Energy: Basic +20, Skill +30 (dikali 1 + ERR). Ultimate mengembalikan 5 Energy setelah dipakai.
const ENERGY_GAIN = { basic: 20, skill: 30 };
const ULT_REFUND = 5;
const DEFAULT_START_ENERGY = 0; // % dari Energi Ultimate saat battle mulai

const ACTIONS = {
  basic:     { label: 'Basic ATK', delta: 1 },
  skill:     { label: 'Skill', delta: -1 },
  ultimate:  { label: 'Ultimate', delta: 0 },
  followup:  { label: 'Follow-up', delta: 0 },
  technique: { label: 'Technique', delta: 0 },
  other:     { label: 'Lainnya', delta: 0 },
};

const BODY = ['HP%', 'ATK%', 'DEF%', 'CRIT Rate', 'CRIT DMG', 'Outgoing Healing Boost', 'Effect Hit Rate'];
const FEET = ['HP%', 'ATK%', 'DEF%', 'SPD'];
const SPHERE = ['HP%', 'ATK%', 'DEF%', ...ELEMENTS.map(e => e + ' DMG Boost')];
const ROPE = ['HP%', 'ATK%', 'DEF%', 'Break Effect', 'Energy Regeneration Rate'];

const TARGET_FIELDS = [
  ['spd', 'SPD'], ['crate', 'CRIT Rate'], ['cdmg', 'CRIT DMG'],
  ['ehr', 'Effect Hit Rate'], ['be', 'Break Effect'], ['err', 'Energy Regen'],
];

/* ---------- Utilitas ---------- */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
const opts = (list, sel, blank) =>
  (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
  list.map(o => `<option value="${esc(o)}"${o === sel ? ' selected' : ''}>${esc(o)}</option>`).join('');

function setPath(obj, path, val) {
  const p = path.split('.');
  let o = obj;
  while (p.length > 1) { const k = p.shift(); if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; }
  o[p[0]] = val;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- Model & penyimpanan ---------- */
function newBuild(label = 'Build 1') {
  return {
    id: uid(), label, lightCone: '', superimposition: 'S1', relicSet: '', planarSet: '',
    body: '', feet: '', sphere: '', rope: '', substats: '',
    targets: { spd: '', crate: '', cdmg: '', ehr: '', be: '', err: '' }, notes: '',
  };
}

const presetUlt = name => PRESETS.find(p => p[0].toLowerCase() === String(name).toLowerCase())?.[4] || 0;

function newStep(actor, action, note = '') {
  return {
    id: uid(), actor, action, delta: ACTIONS[action]?.delta ?? 0, note,
    adv: 0, advTarget: '', energy: '', // Action Advance (%), target advance, override perubahan Energi
  };
}

function normBuild(b) {
  const d = newBuild(str(b?.label) || 'Build');
  for (const k of ['lightCone', 'superimposition', 'relicSet', 'planarSet', 'body', 'feet', 'sphere', 'rope', 'substats', 'notes']) {
    if (b && k in b) d[k] = str(b[k]);
  }
  if (b?.id) d.id = str(b.id);
  for (const [k] of TARGET_FIELDS) d.targets[k] = str(b?.targets?.[k]);
  return d;
}

function normalize(data) {
  const s = { characters: [], teams: [] };
  for (const c of Array.isArray(data?.characters) ? data.characters : []) {
    s.characters.push({
      id: str(c.id) || uid(), name: str(c.name) || 'Tanpa nama', path: str(c.path), element: str(c.element),
      ultCost: c.ultCost !== '' && c.ultCost != null && Number.isFinite(Number(c.ultCost))
        ? Math.max(0, Number(c.ultCost)) : presetUlt(c.name),
      builds: (Array.isArray(c.builds) ? c.builds : []).map(normBuild),
    });
  }
  for (const t of Array.isArray(data?.teams) ? data.teams : []) {
    const members = Array.from({ length: 4 }, (_, i) => ({
      charId: str(t.members?.[i]?.charId), buildId: str(t.members?.[i]?.buildId), spd: str(t.members?.[i]?.spd),
    }));
    const startSP = Number.isFinite(Number(t.startSP)) ? Number(t.startSP) : DEFAULT_START_SP;
    const se = Number(t.startEnergy);
    const startEnergy = t.startEnergy !== '' && t.startEnergy != null && Number.isFinite(se)
      ? Math.min(100, Math.max(0, se)) : DEFAULT_START_ENERGY;
    s.teams.push({
      id: str(t.id) || uid(), name: str(t.name) || 'Tim', startSP, startEnergy, members,
      rotation: (Array.isArray(t.rotation) ? t.rotation : []).map(r => {
        const action = ACTIONS[r?.action] || r?.action === CYCLE ? r.action : 'other';
        const delta = action === CYCLE ? 0 : Number.isFinite(Number(r?.delta)) ? Number(r.delta) : ACTIONS[action].delta;
        const adv = Number(r?.adv);
        return {
          id: str(r?.id) || uid(), actor: str(r?.actor), action, delta, note: str(r?.note),
          adv: Number.isFinite(adv) ? adv : 0, advTarget: str(r?.advTarget), energy: str(r?.energy),
        };
      }),
    });
  }
  return s;
}

function load() {
  try { return normalize(JSON.parse(localStorage.getItem(STORE_KEY))); }
  catch { return normalize(null); }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch { toast('Gagal menyimpan ke browser'); }
}

let state = load();
const ui = { tab: 'chars', teamId: null, open: new Set(), simCycles: 4 };

const charById = id => state.characters.find(c => c.id === id);
const buildOf = (c, bid) => c?.builds.find(b => b.id === bid);
const currentTeam = () => state.teams.find(t => t.id === ui.teamId) || state.teams[0] || null;

/* ---------- Hitung Skill Point ---------- */
function computeSP(team) {
  let sp = team.startSP;
  return team.rotation.map(step => {
    const before = sp;
    const raw = before + step.delta;
    const issue = raw < 0 ? 'bad' : raw > MAX_SP ? 'over' : '';
    sp = Math.min(MAX_SP, Math.max(0, raw));
    return { before, after: sp, issue };
  });
}
/* ---------- Speed, Action Value, Cycle ---------- */
// SPD anggota: isian manual di slot, kalau kosong pakai target SPD dari build. Ambil angka pertama.
function memberSpd(m) {
  const b = buildOf(charById(m.charId), m.buildId);
  const raw = str(m.spd).trim() || str(b?.targets.spd);
  const n = parseFloat((raw.match(/\d+(\.\d+)?/) || [])[0]);
  return n > 0 ? n : 0;
}
const baseAV = spd => 10000 / spd;
const cycleOfAV = av => (av <= FIRST_CYCLE_AV + 1e-9 ? 0 : Math.ceil((av - FIRST_CYCLE_AV) / CYCLE_AV - 1e-9));

// Urutan giliran sampai akhir Cycle `cycles`. Tanpa buff SPD, advance, atau delay.
function simulateTurns(team, cycles) {
  const limit = FIRST_CYCLE_AV + CYCLE_AV * cycles;
  const turns = [];
  team.members.forEach((m, slot) => {
    const spd = memberSpd(m);
    if (!m.charId || !spd) return;
    const step = baseAV(spd);
    for (let k = 1; k * step <= limit + 1e-9; k++) turns.push({ charId: m.charId, av: k * step, spd, slot });
  });
  turns.sort((x, y) => x.av - y.av || y.spd - x.spd || x.slot - y.slot);
  turns.forEach(t => { t.cycle = cycleOfAV(t.av); });
  return turns;
}

// Nomor urut aksi dan label Cycle per langkah (penanda Cycle ke-k = awal Cycle k; sebelum penanda pertama = Cycle 0).
function stepMeta(team) {
  let n = 0, cycle = 0;
  return team.rotation.map(s => (s.action === CYCLE ? { cycle: ++cycle, num: '' } : { cycle, num: ++n }));
}

const pips = n => '<span class="pip on"></span>'.repeat(n) + '<span class="pip"></span>'.repeat(MAX_SP - n);
function spCell(r) {
  const flag = r.issue === 'bad' ? '<span class="flag bad">SP kurang</span>'
    : r.issue === 'over' ? '<span class="flag over">SP terbuang</span>' : '';
  return `${r.before} ke ${r.after} <span class="pips">${pips(r.after)}</span>${flag}`;
}

/* ---------- Energy & Action Advance ---------- */
const fmt = n => String(Math.round(n * 10) / 10);
const numIn = v => {
  const n = parseFloat((String(v ?? '').match(/-?\d+(\.\d+)?/) || [])[0]);
  return Number.isFinite(n) ? n : 0;
};

// Energi per karakter selama rotasi. Basic +20 dan Skill +30 (dikali 1 + ERR), Ultimate memakai seluruh
// Energi lalu mengembalikan 5. ERR diambil dari target "Energy Regen" build (bonus % seperti di layar stat game).
// Kolom Energi pada langkah menimpa perubahan otomatis, untuk energi dari serangan musuh, kill, atau buff.
function computeEnergy(team) {
  const energy = {};
  return team.rotation.map(step => {
    if (step.action === CYCLE || !step.actor) return null;
    const c = charById(step.actor);
    const cost = Number(c?.ultCost) || 0;
    if (!cost) return { cost: 0 };
    if (!(step.actor in energy)) energy[step.actor] = cost * team.startEnergy / 100;
    const before = energy[step.actor];
    const m = team.members.find(x => x.charId === step.actor);
    const mult = 1 + numIn(buildOf(c, m?.buildId)?.targets.err) / 100;
    const auto = step.action === 'ultimate' ? ULT_REFUND - cost : (ENERGY_GAIN[step.action] || 0) * mult;
    const raw = String(step.energy ?? '').trim();
    const delta = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : auto;
    const issue = step.action === 'ultimate' && before + 1e-9 < cost ? 'bad' : '';
    const after = Math.min(cost, Math.max(0, before + delta));
    energy[step.actor] = after;
    return { cost, before, after, auto, issue };
  });
}

// AV tiap langkah. Basic/Skill adalah giliran: jam maju ke AV giliran berikutnya milik karakter itu.
// Ultimate dan Follow-up terjadi di AV terakhir (ditandai ~), Technique di AV 0.
// Advance (%) menarik giliran berikutnya sekutu sebesar % dari AV dasarnya; nilai negatif menunda.
// Delay pada musuh tidak disimulasikan. Tanda "urutan?" muncul bila karakter lain seharusnya bertindak lebih dulu.
function computeTiming(team) {
  const units = {};
  for (const m of team.members) {
    const spd = memberSpd(m);
    if (m.charId && spd && !units[m.charId]) units[m.charId] = { base: baseAV(spd), next: baseAV(spd) };
  }
  let now = 0;
  return team.rotation.map(step => {
    if (step.action === CYCLE) return null;
    const u = units[step.actor];
    let av = null, approx = false, issue = '';
    if (step.action === 'technique') {
      av = 0; approx = true;
    } else if (step.action === 'basic' || step.action === 'skill') {
      if (u) {
        av = u.next;
        let first = null;
        for (const [id, x] of Object.entries(units)) {
          if (id !== step.actor && x.next < av - 1e-6 && (!first || x.next < first.next)) first = { id, next: x.next };
        }
        if (first) issue = `Seharusnya ${charById(first.id)?.name || '?'} bertindak lebih dulu (AV ${fmt(first.next)})`;
        now = av;
        u.next = av + u.base;
      }
    } else if (u) {
      av = now; approx = true;
    }
    const pct = Number(step.adv) || 0;
    if (av !== null && pct) {
      const t = units[step.advTarget || step.actor];
      if (t) t.next = pct > 0 ? Math.max(av, t.next - pct / 100 * t.base) : t.next - pct / 100 * t.base;
    }
    return { av, approx, issue, cycle: av === null ? null : cycleOfAV(av) };
  });
}

function enCell(e) {
  if (!e) return '';
  if (!e.cost) return '<span class="muted">-</span>';
  const flag = e.issue ? '<span class="flag bad">Energi kurang</span>' : '';
  return `<span title="sebelum ${fmt(e.before)}, perubahan ${fmt(e.after - e.before)}">${fmt(e.after)}/${e.cost}</span>${flag}`;
}
function avCell(t) {
  if (!t || t.av === null) return '<span class="muted">-</span>';
  const flag = t.issue ? `<span class="flag over" title="${esc(t.issue)}">urutan?</span>` : '';
  return `${t.approx ? '~' : ''}${fmt(t.av)} <small class="muted">C${t.cycle}</small>${flag}`;
}
const rowClass = (sp, en, tm) =>
  sp.issue === 'bad' || en?.issue ? 'bad' : [sp.issue, tm?.issue ? 'warn' : ''].filter(Boolean).join(' ');

/* ---------- Render: Karakter & Build ---------- */
function buildEditor(c, b) {
  const a = `data-bind="build" data-cid="${c.id}" data-bid="${b.id}"`;
  const inp = (label, field, val, list) =>
    `<label>${label}<input ${a} data-field="${field}" value="${esc(val)}"${list ? ` list="${list}"` : ''}></label>`;
  const sel = (label, field, val, list) =>
    `<label>${label}<select ${a} data-field="${field}">${opts(list, val, '— pilih —')}</select></label>`;
  return `
    <div class="editor">
      <div class="sect">Umum</div>
      <div class="grid two">
        ${inp('Nama build', 'label', b.label)}
        ${inp('Light Cone', 'lightCone', b.lightCone, PATHS.includes(c.path) ? 'dl-lc-' + slug(c.path) : 'dl-lc-all')}
        ${sel('Superimposition', 'superimposition', b.superimposition, ['S1', 'S2', 'S3', 'S4', 'S5'])}
      </div>
      <div class="sect">Relic &amp; Ornamen</div>
      <div class="grid two">
        ${inp('Set relic (mis. 4pc atau 2pc+2pc)', 'relicSet', b.relicSet, 'dl-relic')}
        ${inp('Set planar ornament', 'planarSet', b.planarSet, 'dl-planar')}
      </div>
      <div class="sect">Main stat</div>
      <div class="grid">
        ${sel('Body', 'body', b.body, BODY)}
        ${sel('Feet', 'feet', b.feet, FEET)}
        ${sel('Planar Sphere', 'sphere', b.sphere, SPHERE)}
        ${sel('Link Rope', 'rope', b.rope, ROPE)}
      </div>
      <label>Prioritas substat<input ${a} data-field="substats" value="${esc(b.substats)}" placeholder="SPD > CRIT Rate > CRIT DMG > ATK%"></label>
      <div class="sect">Target stat</div>
      <div class="grid">
        ${TARGET_FIELDS.map(([k, l]) => inp(l, 'targets.' + k, b.targets[k])).join('')}
      </div>
      <label>Catatan<textarea ${a} data-field="notes">${esc(b.notes)}</textarea></label>
      <div class="actions">
        <button data-act="dup-build" data-cid="${c.id}" data-bid="${b.id}">Duplikat</button>
        <button class="danger" data-act="del-build" data-cid="${c.id}" data-bid="${b.id}">Hapus build</button>
      </div>
    </div>`;
}

function buildSubtitle(b) {
  const parts = [b.lightCone && `${b.lightCone} ${b.superimposition}`, b.relicSet, b.planarSet].filter(Boolean);
  return parts.join(' · ');
}

function charCard(c) {
  const builds = c.builds.map(b => `
    <details data-key="${b.id}"${ui.open.has(b.id) ? ' open' : ''}>
      <summary><span class="t">${esc(b.label)}</span><span class="sub">${esc(buildSubtitle(b))}</span></summary>
      ${buildEditor(c, b)}
    </details>`).join('') || '<div class="empty">Belum ada build.</div>';
  return `
    <article class="card">
      <header>
        <div>
          <h3>${esc(c.name)}</h3>
          ${c.element ? `<span class="tag el-${esc(c.element.toLowerCase())}">${esc(c.element)}</span>` : ''}
          ${c.path ? `<span class="tag">${esc(c.path)}</span>` : ''}
        </div>
        <div class="actions">
          <label class="inline-lbl" title="Energi yang dibutuhkan untuk Ultimate. Isi 0 bila tidak memakai Energy biasa.">Energi Ult
            <input type="number" min="0" data-bind="char" data-cid="${c.id}" data-field="ultCost" value="${c.ultCost || ''}" placeholder="0"></label>
          <button data-act="add-build" data-cid="${c.id}">+ Build</button>
          <button class="danger" data-act="del-char" data-cid="${c.id}">Hapus karakter</button>
        </div>
      </header>
      <div class="body">${builds}</div>
    </article>`;
}

// Satu datalist Light Cone per path (urut rarity), ditambah daftar lengkap untuk karakter tanpa path.
function lightConeLists() {
  const list = (id, items) => `<datalist id="${id}">${items.map(l =>
    `<option value="${esc(l.n)}" label="${l.r}★ ${esc(l.p)}">`).join('')}</datalist>`;
  return PATHS.map(p => list('dl-lc-' + slug(p), LIGHT_CONES.filter(l => l.p === p))).join('') +
    list('dl-lc-all', LIGHT_CONES);
}

function charsView() {
  const list = state.characters.map(charCard).join('') ||
    '<div class="panel empty">Belum ada karakter. Tambahkan di atas, atau muat data contoh di tab Data.</div>';
  return `
    <datalist id="dl-chars">${PRESETS.map(p => `<option value="${esc(p[0])}" label="${esc(`${p[3]}★ ${p[2]} · ${p[1]}`)}">`).join('')}</datalist>
    ${lightConeLists()}
    <datalist id="dl-relic">${RELIC_SETS.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <datalist id="dl-planar">${PLANAR_SETS.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <section class="panel">
      <h2>Tambah karakter</h2>
      <div class="row">
        <label>Nama<input id="new-name" list="dl-chars" placeholder="mis. Seele"></label>
        <label>Path<select id="new-path">${opts(PATHS, '', '— pilih —')}</select></label>
        <label>Element<select id="new-element">${opts(ELEMENTS, '', '— pilih —')}</select></label>
        <button class="primary" data-act="add-char">Tambah</button>
      </div>
    </section>
    ${list}`;
}

/* ---------- Render: Rotasi ---------- */
function memberCard(team, i) {
  const m = team.members[i];
  const c = charById(m.charId);
  const b = buildOf(c, m.buildId);
  const summary = b
    ? `${esc(buildSubtitle(b)) || 'Build belum diisi'}${b.targets.spd ? ` · SPD ${esc(b.targets.spd)}` : ''}`
    : c ? 'Pilih build' : 'Slot kosong';
  const quick = c ? `
    <div class="quick">
      ${['basic', 'skill', 'ultimate', 'followup', 'technique'].map(a =>
        `<button data-act="add-step" data-actor="${c.id}" data-action="${a}">+ ${ACTIONS[a].label}</button>`).join('')}
    </div>` : '';
  return `
    <div class="member">
      <label>Slot ${i + 1}
        <select data-bind="member" data-idx="${i}" data-field="charId">
          ${state.characters.map(ch => `<option value="${ch.id}"${ch.id === m.charId ? ' selected' : ''}>${esc(ch.name)}</option>`).join('')
            .replace(/^/, '<option value="">— kosong —</option>')}
        </select>
      </label>
      ${c ? `<label>Build
        <select data-bind="member" data-idx="${i}" data-field="buildId">
          <option value="">— tanpa build —</option>
          ${c.builds.map(x => `<option value="${x.id}"${x.id === m.buildId ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}
        </select></label>
      <label>SPD (untuk simulasi)
        <input data-bind="member" data-idx="${i}" data-field="spd" value="${esc(m.spd)}"
          placeholder="${esc(b?.targets.spd || 'mis. 134')}" inputmode="decimal"></label>` : ''}
      <div class="summary">${summary}</div>
      ${quick}
    </div>`;
}

function stepRow(team, step, meta, calc) {
  const buttons = `<div class="actions">
        <button data-act="up" data-sid="${step.id}" title="Naik">Naik</button>
        <button data-act="down" data-sid="${step.id}" title="Turun">Turun</button>
        <button class="danger" data-act="del-step" data-sid="${step.id}" title="Hapus">Hapus</button>
      </div>`;
  if (step.action === CYCLE) {
    return `
    <tr class="cycle" data-row="${step.id}">
      <td colspan="10">Cycle ${meta.cycle} <span class="muted">(mulai AV ${FIRST_CYCLE_AV + CYCLE_AV * (meta.cycle - 1)})</span></td>
      <td>${buttons}</td>
    </tr>`;
  }
  const memberIds = team.members.map(m => m.charId).filter(Boolean);
  const actorIds = [...memberIds];
  if (step.actor && !actorIds.includes(step.actor)) actorIds.push(step.actor);
  const nameOf = id => esc(charById(id)?.name || '(dihapus)');
  const actorOpts = actorIds.map(id => `<option value="${id}"${id === step.actor ? ' selected' : ''}>${nameOf(id)}</option>`).join('');
  const targetIds = [...memberIds];
  if (step.advTarget && !targetIds.includes(step.advTarget)) targetIds.push(step.advTarget);
  const targetOpts = `<option value="">diri sendiri</option>` +
    targetIds.map(id => `<option value="${id}"${id === step.advTarget ? ' selected' : ''}>${nameOf(id)}</option>`).join('');
  const a = `data-bind="step" data-sid="${step.id}"`;
  const en = calc.en;
  return `
    <tr class="${rowClass(calc.sp, en, calc.tm)}" data-row="${step.id}">
      <td class="num">${meta.num}</td>
      <td><select ${a} data-field="actor">${actorOpts}</select></td>
      <td><select ${a} data-field="action">${Object.entries(ACTIONS).map(([k, v]) =>
        `<option value="${k}"${k === step.action ? ' selected' : ''}>${v.label}</option>`).join('')}</select></td>
      <td class="delta"><input type="number" step="1" ${a} data-field="delta" value="${step.delta}"></td>
      <td class="sp" data-sp="${step.id}">${spCell(calc.sp)}</td>
      <td class="en">
        <div data-en="${step.id}">${enCell(en)}</div>
        <input class="mini" ${a} data-field="energy" data-enin="${step.id}" value="${esc(step.energy)}"
          placeholder="${en?.cost ? fmt(en.auto) : '-'}" title="Perubahan energi (kosong = otomatis)" inputmode="decimal">
      </td>
      <td class="av" data-av="${step.id}">${avCell(calc.tm)}</td>
      <td class="adv"><input type="number" step="5" ${a} data-field="adv" value="${step.adv || ''}" placeholder="0" title="Action Advance % (negatif = delay)"></td>
      <td><select ${a} data-field="advTarget">${targetOpts}</select></td>
      <td><input ${a} data-field="note" value="${esc(step.note)}" placeholder="catatan"></td>
      <td>${buttons}</td>
    </tr>`;
}

// Panel simulasi Speed / Action Value. Diganti sendiri (tanpa render ulang halaman) saat SPD berubah.
function simView(team) {
  const members = team.members.map((m, i) => ({ m, i, c: charById(m.charId), spd: memberSpd(m) })).filter(x => x.c);
  if (!members.length) return '<p class="muted">Pilih karakter pada slot tim untuk memulai simulasi.</p>';
  const named = members.filter(x => x.spd);
  const turns = simulateTurns(team, ui.simCycles);
  const speedRows = members.map(x => `
      <tr><td>${esc(x.c.name)}</td>
        <td>${x.spd ? x.spd : '<span class="muted">isi SPD</span>'}</td>
        <td>${x.spd ? baseAV(x.spd).toFixed(1) : '-'}</td>
        <td>${x.spd ? (x.spd / 100).toFixed(2) : '-'}</td></tr>`).join('');
  const byCycle = [];
  turns.forEach(t => { (byCycle[t.cycle] ||= []).push(t); });
  const cycleRows = Array.from({ length: ui.simCycles + 1 }, (_, k) => {
    const list = byCycle[k] || [];
    const range = k === 0 ? `0–${FIRST_CYCLE_AV} AV` : `${FIRST_CYCLE_AV + CYCLE_AV * (k - 1)}–${FIRST_CYCLE_AV + CYCLE_AV * k} AV`;
    return `<tr><td class="nowrap"><strong>Cycle ${k}</strong><div class="muted">${range}</div></td>
      <td>${list.map(t => `<span class="chip" title="SPD ${t.spd}">${esc(charById(t.charId)?.name || '?')} <small>${t.av.toFixed(1)}</small></span>`).join(' ') || '<span class="muted">-</span>'}</td></tr>`;
  }).join('');
  return `
    <table>
      <thead><tr><th>Karakter</th><th>SPD</th><th>AV dasar</th><th>Giliran per 100 AV</th></tr></thead>
      <tbody>${speedRows}</tbody>
    </table>
    ${named.length ? `
    <h3 class="sub-h">Urutan giliran</h3>
    <table><tbody>${cycleRows}</tbody></table>` : ''}`;
}

function rotationView() {
  if (!state.characters.length) {
    return '<div class="panel empty">Tambahkan karakter dulu di tab Karakter &amp; Build.</div>';
  }
  const team = currentTeam();
  const header = `
    <section class="panel">
      <div class="row">
        <label>Tim
          <select id="team-select" data-bind="teamSelect">
            ${state.teams.map(t => `<option value="${t.id}"${team && t.id === team.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select>
        </label>
        <button class="primary" data-act="new-team">+ Tim baru</button>
        ${team ? '<button class="danger" data-act="del-team">Hapus tim</button>' : ''}
      </div>
    </section>`;
  if (!team) return header + '<div class="panel empty">Belum ada tim. Buat tim baru.</div>';

  const sp = computeSP(team), en = computeEnergy(team), tm = computeTiming(team);
  const meta = stepMeta(team);
  return `${header}
    <section class="panel">
      <div class="row">
        <label>Nama tim<input data-bind="team" data-field="name" value="${esc(team.name)}"></label>
        <label>SP awal (maks ${MAX_SP})<input type="number" min="0" max="${MAX_SP}" data-bind="team" data-field="startSP" value="${team.startSP}"></label>
        <label title="Energi tiap karakter di awal battle, dalam % dari Energi Ultimate (mis. dari efek Light Cone atau Trace)">Energi awal (% dari Ult)<input type="number" min="0" max="100" data-bind="team" data-field="startEnergy" value="${team.startEnergy}"></label>
      </div>
    </section>
    <section class="members">
      ${[0, 1, 2, 3].map(i => memberCard(team, i)).join('')}
    </section>
    <section class="panel">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h2 style="margin:0">Speed &amp; Action Value</h2>
        <label style="flex:0 0 150px">Simulasi sampai Cycle
          <input type="number" min="1" max="10" data-bind="sim" data-field="cycles" value="${ui.simCycles}"></label>
      </div>
      <p class="muted">AV = 10000 ÷ SPD. Cycle 0 berlangsung 150 AV, tiap Cycle berikutnya 100 AV. Urutan di bawah adalah dasar tanpa buff SPD, Advance, atau Delay. AV yang memperhitungkan Advance per langkah ada di kolom AV pada tabel Urutan aksi. SPD diambil dari kolom di slot, atau dari target SPD pada build.</p>
      <div id="sim">${simView(team)}</div>
      <div class="actions" style="margin-top:10px">
        <button data-act="fill-turns">Isi rotasi dari urutan giliran</button>
      </div>
    </section>
    <section class="panel">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h2 style="margin:0">Urutan aksi</h2>
        <div class="actions" style="flex:0 0 auto">
          <button data-act="add-cycle">+ Penanda Cycle</button>
          <button data-act="copy-text">Salin teks</button>
          <button class="danger" data-act="clear-steps">Kosongkan</button>
        </div>
      </div>
      <ul class="muted help">
        <li><b>SP:</b> Basic +1, Skill −1. Ubah ΔSP untuk skill dengan efek SP berbeda.</li>
        <li><b>Energi:</b> Basic +20 dan Skill +30 (dikali 1 + ERR dari target build), Ultimate memakai seluruh Energi lalu mengembalikan 5. Isi kotak kecil di bawah angka untuk menimpa perubahan energi (serangan musuh, kill, buff).</li>
        <li><b>AV:</b> dihitung dari SPD. Tanda ~ berarti terjadi di AV terakhir (Ultimate, Follow-up). <b>Adv %</b> memajukan giliran sekutu terpilih (negatif = menunda). Delay pada musuh tidak disimulasikan.</li>
      </ul>
      ${team.rotation.length ? `
      <div class="tbl-wrap"><table class="steps">
        <thead><tr><th>#</th><th>Karakter</th><th>Aksi</th><th>ΔSP</th><th>SP</th><th>Energi</th><th>AV</th><th>Adv %</th><th>Ke</th><th>Catatan</th><th></th></tr></thead>
        <tbody>${team.rotation.map((s, i) => stepRow(team, s, meta[i], { sp: sp[i], en: en[i], tm: tm[i] })).join('')}</tbody>
      </table></div>` : '<div class="empty">Belum ada langkah. Tekan tombol aksi pada kartu karakter di atas, atau isi dari urutan giliran.</div>'}
    </section>`;
}

/* ---------- Render: Data ---------- */
function dataView() {
  return `
    <section class="panel">
      <h2>Cadangan &amp; pemulihan</h2>
      <p class="muted">Data disimpan di browser ini (localStorage). Ekspor secara berkala untuk cadangan atau pindah perangkat.</p>
      <div class="actions">
        <button class="primary" data-act="export">Ekspor JSON</button>
        <button data-act="import">Impor JSON</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
    </section>
    <section class="panel">
      <h2>Data game</h2>
      <p class="muted">${GAME_DATA.characters.length} karakter, ${GAME_DATA.relicSets.length} set relic, ${GAME_DATA.planarSets.length} planar ornament, ${GAME_DATA.lightCones.length} Light Cone (diperbarui ${esc(GAME_DATA.generated)}). Sumber: <a href="https://github.com/Mar-7th/StarRailRes" target="_blank" rel="noopener">Mar-7th/StarRailRes</a>. Setelah ada patch baru, jalankan <code>node tools/update-data.js</code>.</p>
    </section>
    <section class="panel">
      <h2>Lainnya</h2>
      <div class="actions">
        <button data-act="sample">Muat data contoh</button>
        <button class="danger" data-act="reset">Hapus semua data</button>
      </div>
    </section>`;
}

/* ---------- Render utama ---------- */
function render() {
  document.querySelectorAll('.top nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  const view = { chars: charsView, rotation: rotationView, data: dataView }[ui.tab];
  document.getElementById('app').innerHTML = view();
}

// Hitung ulang SP, Energi, dan AV lalu perbarui sel tabel di tempat (tanpa render ulang).
function refreshCalc() {
  const team = currentTeam();
  if (!team) return;
  const sp = computeSP(team), en = computeEnergy(team), tm = computeTiming(team);
  team.rotation.forEach((step, i) => {
    if (step.action === CYCLE) return;
    const tr = document.querySelector(`[data-row="${step.id}"]`);
    if (!tr) return;
    tr.querySelector('[data-sp]').innerHTML = spCell(sp[i]);
    tr.querySelector('[data-en]').innerHTML = enCell(en[i]);
    tr.querySelector('[data-enin]').placeholder = en[i]?.cost ? fmt(en[i].auto) : '-';
    tr.querySelector('[data-av]').innerHTML = avCell(tm[i]);
    tr.className = rowClass(sp[i], en[i], tm[i]);
  });
}

function refreshSim() {
  const team = currentTeam();
  const box = document.getElementById('sim');
  if (team && box) box.innerHTML = simView(team);
}

/* ---------- Aksi ---------- */
function moveStep(team, sid, dir) {
  const i = team.rotation.findIndex(s => s.id === sid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= team.rotation.length) return;
  [team.rotation[i], team.rotation[j]] = [team.rotation[j], team.rotation[i]];
}

function rotationText(team) {
  const sp = computeSP(team), en = computeEnergy(team), tm = computeTiming(team);
  const head = `${team.name} (SP awal ${team.startSP}, energi awal ${team.startEnergy}%)`;
  const meta = stepMeta(team);
  const lines = team.rotation.map((s, i) => {
    if (s.action === CYCLE) return `-- Cycle ${meta[i].cycle} --`;
    const name = charById(s.actor)?.name || '?';
    const parts = [`SP ${sp[i].before}→${sp[i].after}`];
    if (tm[i]?.av != null) parts.push(`AV ${tm[i].approx ? '~' : ''}${fmt(tm[i].av)}`);
    if (en[i]?.cost) parts.push(`Energi ${fmt(en[i].after)}/${en[i].cost}`);
    let extra = '';
    if (Number(s.adv)) {
      const target = s.advTarget ? (charById(s.advTarget)?.name || '?') : name;
      extra = ` (${s.adv > 0 ? 'advance' : 'delay'} ${Math.abs(s.adv)}% ${target})`;
    }
    return `${meta[i].num}. ${name} - ${ACTIONS[s.action].label}${extra} [${parts.join(', ')}]${s.note ? ' - ' + s.note : ''}`;
  });
  return [head, ...lines].join('\n');
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sampleData() {
  const mk = (name, path, element, b) => ({
    id: uid(), name, path, element, ultCost: presetUlt(name), builds: [{ ...newBuild('Build contoh'), ...b }],
  });
  const seele = mk('Seele', 'The Hunt', 'Quantum', {
    lightCone: 'In the Night', relicSet: 'Genius of Brilliant Stars', planarSet: 'Rutilant Arena',
    body: 'CRIT Rate', feet: 'SPD', sphere: 'Quantum DMG Boost', rope: 'ATK%',
    substats: 'CRIT Rate > CRIT DMG > SPD > ATK%', targets: { spd: '134', crate: '', cdmg: '', ehr: '', be: '', err: '' },
  });
  const bronya = mk('Bronya', 'Harmony', 'Wind', {
    lightCone: 'But the Battle Isn\'t Over', relicSet: 'Messenger Traversing Hackerspace', planarSet: 'Broken Keel',
    body: 'CRIT DMG', feet: 'SPD', sphere: 'HP%', rope: 'Energy Regeneration Rate',
    substats: 'SPD > CRIT DMG > HP%', targets: { spd: '134', crate: '', cdmg: '', ehr: '', be: '', err: '' },
  });
  const sw = mk('Silver Wolf', 'Nihility', 'Quantum', {
    lightCone: 'Before Dawn', relicSet: 'Prisoner in Deep Confinement', planarSet: 'Sprightly Vonwacq',
    body: 'Effect Hit Rate', feet: 'SPD', sphere: 'Quantum DMG Boost', rope: 'Energy Regeneration Rate',
    substats: 'Effect Hit Rate > SPD > Break Effect', targets: { spd: '120', crate: '', cdmg: '', ehr: '', be: '', err: '' },
  });
  const fx = mk('Fu Xuan', 'Preservation', 'Quantum', {
    lightCone: 'Day One of My New Life', relicSet: 'Longevous Disciple', planarSet: 'Fleet of the Ageless',
    body: 'HP%', feet: 'SPD', sphere: 'HP%', rope: 'Energy Regeneration Rate',
    substats: 'SPD > HP% > Effect RES', targets: { spd: '110', crate: '', cdmg: '', ehr: '', be: '', err: '' },
  });
  const step = (actor, action, note = '', extra = {}) => ({ ...newStep(actor, action, note), ...extra });
  const cycle = () => step('', CYCLE);
  const team = {
    id: uid(), name: 'Contoh: Seele Quantum', startSP: DEFAULT_START_SP, startEnergy: DEFAULT_START_ENERGY,
    members: [seele, sw, bronya, fx].map(c => ({ charId: c.id, buildId: c.builds[0].id, spd: '' })),
    rotation: [
      step(bronya.id, 'skill', 'Buff ke Seele, advance 100%', { adv: 100, advTarget: seele.id }),
      step(seele.id, 'skill', 'Energi diisi manual (serangan musuh, kill)', { energy: '120' }),
      step(sw.id, 'skill', 'Pasang debuff'),
      step(fx.id, 'basic', 'SP habis, pakai Basic'), cycle(), step(seele.id, 'ultimate'), step(seele.id, 'skill'),
      step(bronya.id, 'basic'),
    ],
  };
  return { characters: [seele, sw, bronya, fx], teams: [team] };
}

const actions = {
  tab(el) { ui.tab = el.dataset.tab; render(); },

  'add-char'() {
    const name = document.getElementById('new-name').value.trim();
    if (!name) return toast('Isi nama karakter dulu');
    const preset = PRESETS.find(p => p[0].toLowerCase() === name.toLowerCase());
    const c = {
      id: uid(), name,
      path: document.getElementById('new-path').value || preset?.[1] || '',
      element: document.getElementById('new-element').value || preset?.[2] || '',
      ultCost: preset?.[4] || 0,
      builds: [newBuild('Build 1')],
    };
    state.characters.push(c);
    ui.open.add(c.builds[0].id);
    save(); render();
  },
  'del-char'(el) {
    const c = charById(el.dataset.cid);
    if (!c || !confirm(`Hapus ${c.name} beserta semua build-nya?`)) return;
    state.characters = state.characters.filter(x => x !== c);
    for (const t of state.teams) {
      t.members.forEach(m => { if (m.charId === c.id) { m.charId = ''; m.buildId = ''; m.spd = ''; } });
      t.rotation = t.rotation.filter(s => s.actor !== c.id);
    }
    save(); render();
  },
  'add-build'(el) {
    const c = charById(el.dataset.cid);
    const b = newBuild(`Build ${c.builds.length + 1}`);
    c.builds.push(b); ui.open.add(b.id);
    save(); render();
  },
  'dup-build'(el) {
    const c = charById(el.dataset.cid);
    const src = buildOf(c, el.dataset.bid);
    const copy = normBuild({ ...src, id: uid(), label: src.label + ' (salinan)' });
    copy.id = uid();
    c.builds.push(copy); ui.open.add(copy.id);
    save(); render();
  },
  'del-build'(el) {
    const c = charById(el.dataset.cid);
    const b = buildOf(c, el.dataset.bid);
    if (!b || !confirm(`Hapus build "${b.label}"?`)) return;
    c.builds = c.builds.filter(x => x !== b);
    for (const t of state.teams) t.members.forEach(m => { if (m.buildId === b.id) m.buildId = ''; });
    save(); render();
  },

  'new-team'() {
    const name = prompt('Nama tim:', `Tim ${state.teams.length + 1}`);
    if (!name) return;
    const t = {
      id: uid(), name: name.trim() || 'Tim', startSP: DEFAULT_START_SP, startEnergy: DEFAULT_START_ENERGY, rotation: [],
      members: Array.from({ length: 4 }, () => ({ charId: '', buildId: '', spd: '' })),
    };
    state.teams.push(t); ui.teamId = t.id;
    save(); render();
  },
  'del-team'() {
    const t = currentTeam();
    if (!t || !confirm(`Hapus tim "${t.name}"?`)) return;
    state.teams = state.teams.filter(x => x !== t); ui.teamId = null;
    save(); render();
  },
  'add-step'(el) {
    const t = currentTeam();
    const action = el.dataset.action;
    t.rotation.push(newStep(el.dataset.actor, action));
    save(); render();
  },
  'add-cycle'() {
    const t = currentTeam();
    t.rotation.push(newStep('', CYCLE));
    save(); render();
  },
  'fill-turns'() {
    const t = currentTeam();
    const turns = simulateTurns(t, ui.simCycles);
    if (!turns.length) return toast('Isi SPD minimal satu karakter dulu');
    if (t.rotation.length && !confirm('Rotasi saat ini akan diganti. Lanjut?')) return;
    // Aksi awal otomatis: Skill bila SP cukup, selain itu Basic ATK. Sesuaikan dengan kit karakter.
    let sp = t.startSP, cycle = 0;
    const rot = [];
    for (const turn of turns) {
      while (cycle < turn.cycle) { cycle++; rot.push(newStep('', CYCLE)); }
      const action = sp >= 1 ? 'skill' : 'basic';
      sp = Math.min(MAX_SP, Math.max(0, sp + ACTIONS[action].delta));
      rot.push(newStep(turn.charId, action, `AV ${turn.av.toFixed(1)}`));
    }
    t.rotation = rot;
    save(); render();
    toast('Rotasi dibuat. Ubah aksi sesuai kit karakter');
  },
  'del-step'(el) {
    const t = currentTeam();
    t.rotation = t.rotation.filter(s => s.id !== el.dataset.sid);
    save(); render();
  },
  up(el) { moveStep(currentTeam(), el.dataset.sid, -1); save(); render(); },
  down(el) { moveStep(currentTeam(), el.dataset.sid, 1); save(); render(); },
  'clear-steps'() {
    const t = currentTeam();
    if (!t.rotation.length || !confirm('Kosongkan semua langkah rotasi?')) return;
    t.rotation = []; save(); render();
  },
  async 'copy-text'() {
    const text = rotationText(currentTeam());
    try { await navigator.clipboard.writeText(text); toast('Rotasi disalin'); }
    catch { prompt('Salin teks rotasi:', text); }
  },

  export() { download('hsr-planner.json', JSON.stringify(state, null, 2)); },
  import() { document.getElementById('import-file').click(); },
  sample() {
    if ((state.characters.length || state.teams.length) && !confirm('Data contoh akan ditambahkan ke data yang ada. Lanjut?')) return;
    const s = sampleData();
    state.characters.push(...s.characters); state.teams.push(...s.teams);
    ui.teamId = s.teams[0].id; ui.tab = 'chars';
    save(); render();
  },
  reset() {
    if (!confirm('Hapus SEMUA karakter, build, dan tim? Tindakan ini tidak bisa dibatalkan.')) return;
    state = normalize(null); ui.teamId = null; ui.open.clear();
    save(); render();
  },
};

/* ---------- Event delegation ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
});

// Simpan state tanpa render ulang saat mengetik; render ulang hanya jika struktur berubah.
function onEdit(e, committed) {
  const el = e.target.closest('[data-bind]');
  if (!el) return;
  const d = el.dataset;
  const isSelect = el.tagName === 'SELECT';

  if (d.bind === 'build') {
    const b = buildOf(charById(d.cid), d.bid);
    if (!b) return;
    setPath(b, d.field, el.value);
    const det = el.closest('details');
    if (det) {
      det.querySelector('.t').textContent = b.label;
      det.querySelector('.sub').textContent = buildSubtitle(b);
    }
    save();
    return;
  }

  if (d.bind === 'char') {
    const c = charById(d.cid);
    if (!c) return;
    c.ultCost = Math.max(0, Number(el.value) || 0);
    save();
    return;
  }

  if (d.bind === 'teamSelect') {
    if (!committed) return;
    ui.teamId = el.value; render(); return;
  }

  const team = currentTeam();
  if (!team) return;

  if (d.bind === 'team') {
    if (d.field === 'startSP') {
      const n = Math.min(MAX_SP, Math.max(0, parseInt(el.value, 10) || 0));
      team.startSP = n;
      if (committed) el.value = n;
      refreshCalc();
    } else if (d.field === 'startEnergy') {
      const n = Math.min(100, Math.max(0, Number(el.value) || 0));
      team.startEnergy = n;
      if (committed) el.value = n;
      refreshCalc();
    } else {
      team.name = el.value;
      const opt = document.querySelector('#team-select option:checked');
      if (opt) opt.textContent = el.value;
    }
    save();
    return;
  }

  if (d.bind === 'sim') {
    const n = Math.min(10, Math.max(1, parseInt(el.value, 10) || 1));
    ui.simCycles = n;
    if (committed) el.value = n;
    refreshSim();
    return;
  }

  if (d.bind === 'member' && d.field === 'spd') {
    team.members[Number(d.idx)].spd = el.value;
    save(); refreshSim(); refreshCalc();
    return;
  }

  if (d.bind === 'member') {
    if (!committed) return;
    const m = team.members[Number(d.idx)];
    m[d.field] = el.value;
    if (d.field === 'charId') { m.buildId = charById(el.value)?.builds[0]?.id || ''; m.spd = ''; }
    save(); render(); return;
  }

  if (d.bind === 'step') {
    const step = team.rotation.find(s => s.id === d.sid);
    if (!step) return;
    if (d.field === 'delta') {
      const n = Number(el.value);
      step.delta = Number.isFinite(n) ? n : 0;
      refreshCalc();
    } else if (d.field === 'action') {
      if (!committed) return;
      step.action = el.value; step.delta = ACTIONS[el.value].delta; step.energy = '';
      save(); render(); return;
    } else if (d.field === 'actor') {
      if (!committed) return;
      step.actor = el.value;
      refreshCalc();
    } else if (d.field === 'adv') {
      const n = Number(el.value);
      step.adv = Number.isFinite(n) ? n : 0;
      refreshCalc();
    } else if (d.field === 'advTarget') {
      if (!committed) return;
      step.advTarget = el.value;
      refreshCalc();
    } else if (d.field === 'energy') {
      step.energy = el.value;
      refreshCalc();
    } else {
      step[d.field] = el.value;
    }
    save();
  }
}
document.addEventListener('input', e => onEdit(e, false));
document.addEventListener('change', e => {
  onEdit(e, true);
  if (e.target.id === 'import-file') importFile(e.target);
});

// Pertahankan status buka/tutup <details> saat render ulang.
document.addEventListener('toggle', e => {
  const key = e.target.dataset?.key;
  if (!key) return;
  e.target.open ? ui.open.add(key) : ui.open.delete(key);
}, true);

function importFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.characters)) throw new Error('format');
      if (!confirm('Impor akan MENGGANTI semua data saat ini. Lanjut?')) return;
      state = normalize(data); ui.teamId = null;
      save(); render(); toast('Impor berhasil');
    } catch { toast('File tidak valid'); }
  };
  reader.readAsText(file);
  input.value = '';
}

// Autofill path/element saat nama karakter cocok dengan preset.
document.addEventListener('input', e => {
  if (e.target.id !== 'new-name') return;
  const p = PRESETS.find(x => x[0].toLowerCase() === e.target.value.trim().toLowerCase());
  if (!p) return;
  document.getElementById('new-path').value = p[1];
  document.getElementById('new-element').value = p[2];
});

if (!state.characters.length && !state.teams.length) ui.tab = 'chars';
render();
