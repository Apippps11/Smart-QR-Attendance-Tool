const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const cors = require('cors');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { Server } = require('socket.io');
const { QRTokenModel, AttendanceModel } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helper to determine best host / LAN IP for phone scanning
function getPreferredIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // Find IPv4 non-internal address
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function getAllIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ name, address: net.address });
      }
    }
  }
  return ips;
}

// Generate active QR code data helper
async function generateOrGetActiveQr(reqHost = null) {
  let activeTokenRecord = QRTokenModel.getActiveToken();
  if (!activeTokenRecord) {
    const newToken = 'QR-' + Date.now().toString(36).toUpperCase() + '-' + uuidv4().substring(0, 6).toUpperCase();
    activeTokenRecord = QRTokenModel.createToken(newToken);
  }

  // Determine host URL
  const host = reqHost || `${getPreferredIp()}:${PORT}`;
  const attendUrl = `http://${host}/attend.html?token=${encodeURIComponent(activeTokenRecord.token)}`;

  // Generate QR code data URL (High Quality)
  const qrImageData = await QRCode.toDataURL(attendUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 8,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    }
  });

  return {
    token: activeTokenRecord.token,
    status: activeTokenRecord.status,
    createdAt: activeTokenRecord.created_at,
    url: attendUrl,
    qrImage: qrImageData
  };
}

// Socket.io connection handling
io.on('connection', (socket) => {
  // When admin connects, send current active QR right away
  socket.on('request_active_qr', async (data) => {
    try {
      const qrData = await generateOrGetActiveQr(data?.host);
      socket.emit('active_qr_updated', qrData);
    } catch (err) {
      console.error('Error sending active QR to socket:', err);
    }
  });
});

// --- API ROUTES ---

// 1. System Info
app.get('/api/system/info', (req, res) => {
  const preferredIp = getPreferredIp();
  const allIps = getAllIps();
  res.json({
    preferredIp,
    allIps,
    port: PORT,
    serverTime: new Date().toISOString()
  });
});

// 2. Get currently active QR (or generate if none)
app.get('/api/qr/active', async (req, res) => {
  try {
    const hostHeader = req.headers.host;
    const qrData = await generateOrGetActiveQr(hostHeader);
    res.json(qrData);
  } catch (err) {
    console.error('Error in /api/qr/active:', err);
    res.status(500).json({ error: 'Gagal menghasilkan QR Code' });
  }
});

// 3. Force refresh/generate a new QR token (Admin manual refresh)
app.post('/api/qr/refresh', async (req, res) => {
  try {
    const newToken = 'QR-' + Date.now().toString(36).toUpperCase() + '-' + uuidv4().substring(0, 6).toUpperCase();
    QRTokenModel.createToken(newToken);

    const hostHeader = req.headers.host;
    const qrData = await generateOrGetActiveQr(hostHeader);

    // Notify all connected clients/admins of the new QR
    io.emit('active_qr_updated', qrData);

    res.json({
      success: true,
      message: 'QR Code baru berhasil di-generate',
      qr: qrData
    });
  } catch (err) {
    console.error('Error in /api/qr/refresh:', err);
    res.status(500).json({ error: 'Gagal merefresh QR Code' });
  }
});

// 4. Check token status before attendee submits
app.get('/api/qr/check/:token', (req, res) => {
  const { token } = req.params;
  const tokenRecord = QRTokenModel.getByToken(token);

  if (!tokenRecord) {
    return res.status(404).json({
      valid: false,
      status: 'NOT_FOUND',
      message: 'QR Code tidak terdaftar dalam sistem!'
    });
  }

  if (tokenRecord.status === 'USED') {
    return res.status(409).json({
      valid: false,
      status: 'USED',
      usedByName: tokenRecord.used_by_name,
      usedAt: tokenRecord.used_at,
      message: `QR Code ini sudah pernah digunakan oleh ${tokenRecord.used_by_name || 'pengguna lain'}. Silakan minta QR code baru di layar admin.`
    });
  }

  if (tokenRecord.status === 'EXPIRED') {
    return res.status(410).json({
      valid: false,
      status: 'EXPIRED',
      message: 'QR Code sudah kedaluwarsa. Silakan scan QR code terbaru di layar admin.'
    });
  }

  res.json({
    valid: true,
    status: 'ACTIVE',
    token: tokenRecord.token,
    createdAt: tokenRecord.created_at
  });
});

// 5. Submit attendance (Single-use QR validation + Device lock + Masuk/Keluar)
app.post('/api/attendance/submit', async (req, res) => {
  try {
    const { token, name, date, day, time, deviceId, deviceInfo, type = 'MASUK' } = req.body;
    const attendType = String(type).toUpperCase() === 'KELUAR' ? 'KELUAR' : 'MASUK';

    if (!token || !name || !deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Data presensi tidak lengkap! Nama, token QR, dan identitas perangkat wajib disertakan.'
      });
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Silakan masukkan nama lengkap yang valid (minimal 2 karakter).'
      });
    }

    // 1. Verify QR token existence & status
    const tokenRecord = QRTokenModel.getByToken(token);
    if (!tokenRecord) {
      return res.status(404).json({
        success: false,
        error: 'QR Code tidak valid atau tidak terdaftar.'
      });
    }

    if (tokenRecord.status === 'USED') {
      return res.status(409).json({
        success: false,
        error: `QR Code ini sudah pernah digunakan oleh "${tokenRecord.used_by_name || 'perangkat lain'}" pada ${tokenRecord.used_at || ''}. Setiap QR hanya berlaku 1 kali!`
      });
    }

    if (tokenRecord.status === 'EXPIRED') {
      return res.status(410).json({
        success: false,
        error: 'QR Code ini sudah kedaluwarsa karena admin telah memperbarui kode QR.'
      });
    }

    // 2. Regional Time Lock Validation (Must be today's date)
    const localNow = new Date();
    const todayRegional = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
    if (date && date !== todayRegional) {
      return res.status(400).json({
        success: false,
        error: `Kunci Waktu Regional Aktif: Presensi hanya dapat dilakukan pada tanggal hari ini (${todayRegional}). Anda tidak dapat melakukan presensi untuk tanggal sebelum atau sesudah hari ini!`
      });
    }

    const targetDate = todayRegional;

    // 3. Validation for MASUK vs KELUAR
    if (attendType === 'MASUK') {
      const existingMasuk = AttendanceModel.hasDeviceAttendedMasuk(deviceId, targetDate);
      if (existingMasuk) {
        return res.status(403).json({
          success: false,
          error: `Perangkat ini sudah tercatat melakukan Absensi Masuk hari ini atas nama "${existingMasuk.name}" pada pukul ${existingMasuk.time}. Setiap perangkat fisik hanya diperbolehkan absen masuk 1 kali per hari!`
        });
      }
    } else if (attendType === 'KELUAR') {
      // Must have checked in today
      const masukRecord = AttendanceModel.getMasukRecord(deviceId, targetDate);
      if (!masukRecord) {
        return res.status(403).json({
          success: false,
          error: 'Presensi Keluar Ditolak: Perangkat Anda belum tercatat melakukan Absensi Masuk hari ini. Silakan lakukan Absensi Masuk terlebih dahulu!'
        });
      }

      // Name must match check-in name
      if (masukRecord.name.trim().toLowerCase() !== trimmedName.toLowerCase()) {
        return res.status(400).json({
          success: false,
          error: `Presensi Keluar Ditolak: Nama ("${trimmedName}") tidak cocok dengan data nama saat Absensi Masuk ("${masukRecord.name}"). Harap gunakan nama yang sama persis!`
        });
      }

      // Must not double check-out
      const existingKeluar = AttendanceModel.hasDeviceAttendedKeluar(deviceId, targetDate);
      if (existingKeluar) {
        return res.status(403).json({
          success: false,
          error: `Perangkat ini sudah tercatat melakukan Absensi Keluar hari ini pada pukul ${existingKeluar.time}. Anda sudah menyelesaikan absensi hari ini!`
        });
      }
    }

    // 4. Mark QR as USED atomically
    const markSuccess = QRTokenModel.markUsed(token, trimmedName, deviceId);
    if (!markSuccess) {
      return res.status(409).json({
        success: false,
        error: 'Terjadi konflik scan! QR Code baru saja digunakan oleh orang lain. Silakan scan QR code baru.'
      });
    }

    // 5. Record attendance
    const currentTime = time || new Date().toLocaleTimeString('id-ID', { hour12: false });
    const currentDay = day || new Intl.DateTimeFormat('id-ID', { weekday: 'long' }).format(new Date());

    const newAttendance = AttendanceModel.createAttendance({
      token,
      name: trimmedName,
      type: attendType,
      date: targetDate,
      day: currentDay,
      time: currentTime,
      deviceId,
      deviceInfo: deviceInfo || req.headers['user-agent'] || 'Perangkat Pengguna'
    });

    // 5. Automatically generate the NEXT fresh QR Code immediately!
    const newToken = 'QR-' + Date.now().toString(36).toUpperCase() + '-' + uuidv4().substring(0, 6).toUpperCase();
    QRTokenModel.createToken(newToken);

    const hostHeader = req.headers.host;
    const nextQrData = await generateOrGetActiveQr(hostHeader);

    // 6. Real-time broadcast to Admin screen via Socket.io
    io.emit('attendance_recorded', {
      attendance: newAttendance,
      usedToken: token,
      nextQr: nextQrData
    });

    // Also emit active_qr_updated so any screen showing the QR refreshes immediately
    io.emit('active_qr_updated', nextQrData);

    // 7. Format Google Calendar details for response
    const gcalDetails = {
      title: `Presensi Berhasil: ${trimmedName}`,
      description: `Konfirmasi Kehadiran Sistem QR Attendance Tool.\nNama: ${trimmedName}\nHari & Tanggal: ${currentDay}, ${targetDate}\nJam Presensi: ${currentTime}\nToken QR: ${token}\nDevice ID: ${deviceId.substring(0, 10)}...`,
      location: 'Sistem Presensi QR Otomatis',
      startDate: targetDate,
      time: currentTime
    };

    res.json({
      success: true,
      message: 'Presensi berhasil dicatat!',
      attendance: newAttendance,
      gcal: gcalDetails,
      qrRotated: true
    });
  } catch (err) {
    console.error('Error submitting attendance:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan sistem saat mencatat presensi.' });
  }
});

// 6. Get list of attendances for admin table
app.get('/api/attendance/list', (req, res) => {
  try {
    const { date, limit } = req.query;
    const records = AttendanceModel.getAll(date || null, limit ? parseInt(limit) : 200);
    const stats = AttendanceModel.getStats();
    res.json({
      records,
      stats
    });
  } catch (err) {
    console.error('Error fetching attendance list:', err);
    res.status(500).json({ error: 'Gagal mengambil data kehadiran' });
  }
});

// 7. Get QR audit history (Anti-double check log)
app.get('/api/qr/audit', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 100;
    const history = QRTokenModel.getHistory(limit);
    const stats = QRTokenModel.getStats();
    res.json({
      history,
      stats
    });
  } catch (err) {
    console.error('Error fetching QR audit history:', err);
    res.status(500).json({ error: 'Gagal mengambil audit QR' });
  }
});

// 8. Admin Reset All Data
app.post('/api/admin/reset', (req, res) => {
  try {
    AttendanceModel.clearAll();
    // Generate fresh QR
    const newToken = 'QR-' + Date.now().toString(36).toUpperCase() + '-' + uuidv4().substring(0, 6).toUpperCase();
    QRTokenModel.createToken(newToken);
    io.emit('data_reset');
    res.json({ success: true, message: 'Semua data presensi dan QR berhasil direset' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mereset data' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const preferredIp = getPreferredIp();
  console.log(`\n======================================================`);
  console.log(`🚀 Smart QR Attendance Server berjalan di Port ${PORT}`);
  console.log(`💻 Akses Lokal (Admin) : http://localhost:${PORT}`);
  console.log(`📱 Akses Smartphone HP : http://${preferredIp}:${PORT}`);
  console.log(`======================================================\n`);
});
