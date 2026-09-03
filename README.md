# Smart QR Attendance Tool 📱⚡

Sistem presensi (absen) modern berbasis web dengan teknologi **Dynamic Single-Use QR Token**, **Device Lock & Fingerprinting** (1 perangkat fisik hanya bisa absen 1 kali), **Real-Time Audit Anti-Double QR**, dan **Integrasi Google Calendar**.

---

## 🌐 Live Web Hosting (Langsung Akses Online)
Website ini sudah siap dan dapat langsung diakses secara online melalui **GitHub Pages**:
🔗 **[https://apippps11.github.io/Smart-QR-Attendance-Tool/](https://apippps11.github.io/Smart-QR-Attendance-Tool/)**

---

## 🌟 Fitur Utama

1. **QR Code Dinamis 1x Pakai (Single-Use Token)**
   - Setiap QR Code yang ditampilkan hanya bisa digunakan tepat 1 kali.
   - Setelah ada 1 peserta yang berhasil presensi, QR lama seketika hangus (`USED`) dan layar Admin otomatis me-refresh QR baru secara real-time melalui WebSocket (`socket.io`).
   - Mencegah foto QR dibagikan ke orang lain di luar ruangan.

2. **Kunci Perangkat (Device Lock & Fingerprinting)**
   - Mendeteksi identitas unik perangkat fisik (*hardware signature, canvas hash, screen, persistent client UUID*).
   - 1 perangkat fisik tidak dapat digunakan untuk mengabsenkan orang lain pada hari yang sama (anti-titip absen).

3. **Audit Log Anti-Double QR**
   - Admin dapat melihat tabel audit real-time berisi status semua QR yang pernah dibuat:
     - 🟢 `ACTIVE` (Sedang tampil di layar)
     - 🔵 `USED` (Sudah terpakai lengkap dengan nama peserta, jam, dan ID perangkat)
     - ⚪ `EXPIRED` (Sudah kedaluwarsa karena di-refresh manual/otomatis)
   - Dijamin tidak ada presensi ganda.

4. **Form Presensi Cerdas Pengguna**
   - Input Nama Lengkap.
   - Pilihan Tanggal & Hari (otomatis mendeteksi hari ini, misal *Kamis, 3 September 2026*, dengan konversi nama hari Indonesia otomatis).
   - Peringatan ramah jika QR sudah terpakai atau perangkat sudah pernah absen hari ini.

5. **Integrasi Google Calendar**
   - Setelah sukses absen, muncul tombol:
     - 📅 **"Tambahkan ke Google Calendar"**: 1-klik langsung membuka Google Calendar di HP/komputer pengguna dengan jadwal, judul, dan detail presensi yang sudah terisi otomatis.
     - 📥 **"Unduh File Kalender (.ics)"**: File standar kalender untuk Apple Calendar (iOS), Outlook, atau aplikasi kalender offline.

6. **Tampilan Layar Proyektor & TV**
   - Mode fullscreen proyektor untuk menampilkan QR besar di monitor kelas/kantor.
   - Efek suara (*Audio Chime Synth*) dan animasi flash visual saat ada peserta yang berhasil absen.

7. **Rekapitulasi & Ekspor Data**
   - Filter berdasarkan tanggal dan kolom pencarian instan.
   - Tombol **Export CSV / Excel** untuk mengunduh rekap kehadiran lengkap.

---

## 🚀 Cara Menjalankan Aplikasi

### 1. Jalankan Server
Buka terminal di folder project ini:
```bash
npm start
```
atau menggunakan node langsung:
```bash
node server/index.js
```

### 2. Buka di Browser
- **Layar Admin / Proyektor**: Buka [http://localhost:3000](http://localhost:3000)
- **Akses Peserta via HP**: Sambungkan smartphone ke Wi-Fi yang sama dengan komputer, lalu scan QR Code yang muncul di layar proyektor atau buka alamat IP lokal yang tertera di layar (contoh: `http://10.58.183.212:3000/attend.html`).

---

## 📁 Struktur File Proyek

```
Smart QR Attendance Tool/
├── server/
│   ├── index.js          # Express server + Socket.io + REST API
│   └── db.js             # SQLite WAL database & repository models
├── public/
│   ├── index.html        # Dashboard Admin & Layar Proyektor QR
│   ├── admin.js          # Controller admin, socket client & export CSV
│   ├── attend.html       # Halaman presensi peserta (mobile-friendly)
│   ├── attend.js         # Validasi token, submit absen & Google Calendar
│   └── fingerprint.js    # Modul pembuat Device Fingerprint
├── tests/
│   └── verify.js         # Uji otomatis aturan 1x QR, device lock & audit
├── data/
│   └── attendance.sqlite # Database SQLite penyimpanan presensi & QR
├── package.json
└── README.md
```

---

## 🧪 Pengujian Otomatis

Untuk memverifikasi seluruh aturan (Single-Use Token, Device-Lock, dan Anti-Double QR):
```bash
npm test
```
Semua 9 skenario pengujian berhasil lulus (100% Pass).
