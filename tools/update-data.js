#!/usr/bin/env node
// Mengunduh data game dari Mar-7th/StarRailRes (hasil ekstrak file game, bahasa Inggris)
// dan menulis ../data.js. Jalankan setiap ada patch baru:  node tools/update-data.js
// Butuh Node 18+ (fetch bawaan) dan koneksi internet.
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_min/en/';
const ELEMENT_FIX = { Thunder: 'Lightning' }; // nama internal -> nama di game

async function get(name) {
  const res = await fetch(BASE + name + '.json');
  if (!res.ok) throw new Error(`Gagal mengunduh ${name}.json (HTTP ${res.status})`);
  return res.json();
}

(async () => {
  const [chars, relics, cones, paths, elements] = await Promise.all(
    ['characters', 'relic_sets', 'light_cones', 'paths', 'elements'].map(get));

  const pathName = id => {
    const p = paths[id]?.name;
    if (!p) throw new Error(`Path tidak dikenal: ${id}`);
    return p;
  };
  // Nilai kecil (mis. 9, 12, 24) adalah sumber daya khusus (stack/poin), bukan Energy. Anggap tidak diketahui (0).
const ultCost = v => (Number(v) >= 60 ? Number(v) : 0);
const elementName = id => ELEMENT_FIX[id] || id;
  for (const c of Object.values(chars)) {
    const e = elementName(c.element);
    if (!Object.values(elements).some(x => x.name === e)) throw new Error(`Element tidak dikenal: ${c.element}`);
  }

  // Karakter. Trailblazer bernama placeholder {NICKNAME} (versi pria/wanita); satukan per path.
  let list = Object.values(chars).map(c => ({
    n: c.name.includes('{') ? 'Trailblazer' : c.name,
    p: pathName(c.path), e: elementName(c.element), r: c.rarity, u: ultCost(c.max_sp), id: Number(c.id),
  }));
  const count = {};
  list.forEach(c => { count[c.n] = (count[c.n] || 0) + 1; });
  list = list.map(c => (c.n === 'Trailblazer' || count[c.n] > 1 ? { ...c, n: `${c.n} (${c.p})` } : c));
  const seen = new Set();
  list = list.filter(c => !seen.has(c.n) && seen.add(c.n)).sort((a, b) => a.id - b.id);

  // Relic: set cavern punya bonus 2pc+4pc (2 deskripsi), planar ornament hanya 2pc (1 deskripsi).
  const relicSets = [], planarSets = [];
  for (const s of Object.values(relics)) (s.desc.length >= 2 ? relicSets : planarSets).push(s.name);
  relicSets.sort(); planarSets.sort();

  const lightCones = Object.values(cones)
    .map(l => ({ n: l.name, p: pathName(l.path), r: l.rarity }))
    .sort((a, b) => b.r - a.r || a.n.localeCompare(b.n));

  const row = o => '    ' + JSON.stringify(o);
  const out = `// File ini dibuat otomatis oleh tools/update-data.js. Jangan diedit manual.
// Sumber: https://github.com/Mar-7th/StarRailRes
const GAME_DATA = {
  generated: ${JSON.stringify(new Date().toISOString().slice(0, 10))},
  characters: [
${list.map(({ id, ...c }) => row(c)).join(',\n')}
  ],
  relicSets: ${JSON.stringify(relicSets)},
  planarSets: ${JSON.stringify(planarSets)},
  lightCones: [
${lightCones.map(row).join(',\n')}
  ],
};
`;
  fs.writeFileSync(path.join(__dirname, '..', 'data.js'), out);
  console.log(`OK: ${list.length} karakter, ${relicSets.length} set relic, ${planarSets.length} planar, ${lightCones.length} light cone`);
})().catch(e => { console.error(e.message); process.exit(1); });
