# HSR Build & Rotation Planner

Aplikasi web statis untuk mengatur build karakter dan rotasi tim Honkai: Star Rail.
Buka `index.html` di browser. Data tersimpan di localStorage browser.

## Fitur
- Build per karakter: Light Cone, set relic/planar, main stat, prioritas substat, target stat.
- Rotasi tim: urutan aksi, hitungan Skill Point, penanda Cycle.
- Simulasi Speed / Action Value (AV = 10000 / SPD; Cycle 0 = 150 AV, lalu 100 AV per Cycle).
- AV per langkah rotasi dengan Action Advance (%) ke sekutu pilihan. Nilai negatif menunda giliran.
  Tanda "urutan?" muncul bila karakter lain seharusnya bertindak lebih dulu.
- Energi per karakter: Basic +20, Skill +30 (dikali 1 + ERR dari target build), Ultimate memakai seluruh
  Energi lalu mengembalikan 5. Perubahan energi tiap langkah bisa ditimpa manual.
- Ekspor/impor JSON dan salin rotasi sebagai teks.

## Memperbarui data game
`data.js` dibuat otomatis dari https://github.com/Mar-7th/StarRailRes (data versi 4.6).
Setelah ada patch baru:

    node tools/update-data.js

Butuh Node 18+ dan koneksi internet.

## Batasan
- Buff SPD belum disimulasikan, dan Delay pada musuh tidak dilacak (hanya Advance/Delay pada sekutu).
- Energi dari serangan musuh, kill, Light Cone, atau Trace tidak dihitung otomatis. Isi lewat kolom Energi
  per langkah, atau lewat "Energi awal" tim.
- Energi Ultimate diambil dari data game. Karakter dengan sumber daya khusus (mis. Acheron, Feixiao, Phainon,
  Cyrene, Castorice) dikosongkan, jadi hitungan energinya dilewati.
