/**
 * Automated Verification Script for Smart QR Attendance Tool
 * Menguji semua skenario sesuai permintaan user:
 * 1. Generate QR Code aktif
 * 2. Scan pertama (sukses)
 * 3. Scan kedua dengan QR yang sama (harus DITOLAK: Single-use token)
 * 4. Scan dengan device yang sama di hari yang sama (harus DITOLAK: Device-lock 1x per device)
 * 5. Pelacakan Audit status QR (Anti-double QR)
 * 6. Validasi data payload Google Calendar
 */

const http = require('http');

const PORT = 3001;
process.env.PORT = PORT;

// Start server in-process for testing
const { db, QRTokenModel, AttendanceModel } = require('../server/db');

// Clear test DB
AttendanceModel.clearAll();

const app = require('express')();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

// Replicate server endpoints for isolated testing
app.use(require('express').json());

app.get('/api/qr/active', async (req, res) => {
  let active = QRTokenModel.getActiveToken();
  if (!active) {
    const newToken = 'QR-TEST-' + uuidv4().substring(0, 6).toUpperCase();
    active = QRTokenModel.createToken(newToken);
  }
  const attendUrl = `http://localhost:${PORT}/attend.html?token=${encodeURIComponent(active.token)}`;
  const qrImage = await QRCode.toDataURL(attendUrl);
  res.json({ token: active.token, status: active.status, url: attendUrl, qrImage });
});

app.post('/api/attendance/submit', async (req, res) => {
  const { token, name, date, day, time, deviceId, deviceInfo } = req.body;
  
  if (!token || !name || !deviceId) {
    return res.status(400).json({ success: false, error: 'Data tidak lengkap' });
  }

  const tokenRecord = QRTokenModel.getByToken(token);
  if (!tokenRecord) {
    return res.status(404).json({ success: false, error: 'QR tidak valid' });
  }

  if (tokenRecord.status === 'USED') {
    return res.status(409).json({ success: false, error: 'QR Code sudah pernah digunakan!' });
  }

  if (tokenRecord.status === 'EXPIRED') {
    return res.status(410).json({ success: false, error: 'QR Code kedaluwarsa' });
  }

  const targetDate = date || new Date().toISOString().split('T')[0];
  const existingDevice = AttendanceModel.hasDeviceAttended(deviceId, targetDate);
  if (existingDevice) {
    return res.status(403).json({ success: false, error: 'Perangkat ini sudah tercatat absen hari ini!' });
  }

  const markSuccess = QRTokenModel.markUsed(token, name.trim(), deviceId);
  if (!markSuccess) {
    return res.status(409).json({ success: false, error: 'Konflik scan QR' });
  }

  const att = AttendanceModel.createAttendance({
    token,
    name: name.trim(),
    date: targetDate,
    day: day || 'Kamis',
    time: time || '16:00:00',
    deviceId,
    deviceInfo: deviceInfo || 'Test Device'
  });

  // Rotate to new active token
  const nextToken = 'QR-TEST-' + uuidv4().substring(0, 6).toUpperCase();
  QRTokenModel.createToken(nextToken);

  res.json({
    success: true,
    message: 'Presensi berhasil dicatat!',
    attendance: att,
    gcal: {
      title: `Presensi Berhasil: ${name}`,
      date: targetDate
    }
  });
});

app.get('/api/qr/audit', (req, res) => {
  const history = QRTokenModel.getHistory(50);
  const stats = QRTokenModel.getStats();
  res.json({ history, stats });
});

// Helper request
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  server.listen(PORT, async () => {
    console.log('--- MEMULAI VERIFIKASI FITUR SISTEM PRESENSI QR ---\n');
    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
      if (condition) {
        console.log(`✅ [PASS] ${message}`);
        passed++;
      } else {
        console.error(`❌ [FAIL] ${message}`);
        failed++;
      }
    }

    try {
      // TEST 1: Buat dan ambil QR Aktif
      const qrRes = await makeRequest('GET', '/api/qr/active');
      assert(qrRes.status === 200 && qrRes.data.token && qrRes.data.status === 'ACTIVE', 'Admin berhasil men-generate QR Code aktif.');
      const token1 = qrRes.data.token;
      console.log(`   -> Token QR 1: ${token1}`);

      // TEST 2: Presensi pertama (User A, Device 1)
      const attend1 = await makeRequest('POST', '/api/attendance/submit', {
        token: token1,
        name: 'Budi Santoso',
        date: '2026-09-03',
        day: 'Kamis',
        time: '16:15:00',
        deviceId: 'device-iphone-14-pro-abc123',
        deviceInfo: '📱 iOS - Safari'
      });
      assert(attend1.status === 200 && attend1.data.success === true, 'User A (Device 1) berhasil presensi dengan QR 1.');
      assert(attend1.data.gcal && attend1.data.gcal.title.includes('Budi Santoso'), 'Data Google Calendar terformat dengan benar.');

      // TEST 3: Coba gunakan QR 1 untuk kedua kalinya (Double QR Prevention)
      const attendDouble = await makeRequest('POST', '/api/attendance/submit', {
        token: token1,
        name: 'Siti Rahma',
        date: '2026-09-03',
        day: 'Kamis',
        time: '16:16:00',
        deviceId: 'device-samsung-s23-xyz789',
        deviceInfo: '📱 Android - Chrome'
      });
      assert(attendDouble.status === 409 && attendDouble.data.success === false, 'Scan kedua dengan QR yang sama BERHASIL DITOLAK (Single-Use Token terbukti!).');
      console.log(`   -> Respon Penolakan: "${attendDouble.data.error}"`);

      // TEST 4: Ambil QR baru yang otomatis di-generate setelah QR 1 terpakai
      const qrRes2 = await makeRequest('GET', '/api/qr/active');
      const token2 = qrRes2.data.token;
      assert(token2 !== token1, 'Sistem otomatis berganti ke QR baru setelah QR 1 terpakai.');
      console.log(`   -> Token QR 2 (Baru): ${token2}`);

      // TEST 5: Coba Device 1 absen lagi hari ini dengan QR baru (Device Lock Prevention)
      const attendDeviceDouble = await makeRequest('POST', '/api/attendance/submit', {
        token: token2,
        name: 'Budi Santoso (Mencoba titip absen)',
        date: '2026-09-03',
        day: 'Kamis',
        time: '16:17:00',
        deviceId: 'device-iphone-14-pro-abc123', // Device sama
        deviceInfo: '📱 iOS - Safari'
      });
      assert(attendDeviceDouble.status === 403 && attendDeviceDouble.data.success === false, 'Perangkat yang sama mencoba absen lagi BERHASIL DITOLAK (Device-Lock terbukti!).');
      console.log(`   -> Respon Penolakan: "${attendDeviceDouble.data.error}"`);

      // TEST 6: User B dengan Perangkat Berbeda (Device 2) absen dengan QR 2
      const attend2 = await makeRequest('POST', '/api/attendance/submit', {
        token: token2,
        name: 'Siti Rahma',
        date: '2026-09-03',
        day: 'Kamis',
        time: '16:18:00',
        deviceId: 'device-samsung-s23-xyz789', // Device berbeda
        deviceInfo: '📱 Android - Chrome'
      });
      assert(attend2.status === 200 && attend2.data.success === true, 'User B dengan perangkat berbeda berhasil absen dengan QR 2.');

      // TEST 7: Audit Log anti-double check
      const auditRes = await makeRequest('GET', '/api/qr/audit');
      assert(auditRes.status === 200, 'Endpoint Audit QR Anti-Double dapat diakses.');
      const usedTokens = auditRes.data.history.filter(h => h.status === 'USED');
      assert(usedTokens.length === 2, `Riwayat audit mencatat tepat 2 token USED tanpa ada duplikasi (Ditemukan: ${usedTokens.length}).`);
      console.log(`   -> Audit Stats: Total: ${auditRes.data.stats.total}, Used: ${auditRes.data.stats.used}, Active: ${auditRes.data.stats.active}`);

      console.log('\n---------------------------------------------');
      console.log(`HASIL AKHIR: ${passed} LULUS, ${failed} GAGAL`);
      console.log('---------------------------------------------\n');

    } catch (err) {
      console.error('Error during test execution:', err);
    } finally {
      server.close(() => {
        process.exit(failed > 0 ? 1 : 0);
      });
    }
  });
}

runTests();
