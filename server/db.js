const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'attendance.sqlite');
const db = new DatabaseSync(dbPath);

// Initialize schema
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS qr_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, USED, EXPIRED
    created_at TEXT NOT NULL,
    expires_at TEXT,
    used_at TEXT,
    used_by_name TEXT,
    device_id TEXT
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'MASUK',
    date TEXT NOT NULL,
    day TEXT NOT NULL,
    time TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_info TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_qr_tokens_status ON qr_tokens(status);
  CREATE INDEX IF NOT EXISTS idx_qr_tokens_token ON qr_tokens(token);
  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date);
  CREATE INDEX IF NOT EXISTS idx_attendance_device ON attendance_records(device_id, date);
`);

// Safe column addition if table already existed
try {
  db.exec(`ALTER TABLE attendance_records ADD COLUMN type TEXT NOT NULL DEFAULT 'MASUK';`);
} catch (e) {}

// Repository helpers
const QRTokenModel = {
  // Get currently active QR token, or null
  getActiveToken() {
    const stmt = db.prepare(`
      SELECT * FROM qr_tokens 
      WHERE status = 'ACTIVE' 
      ORDER BY id DESC LIMIT 1
    `);
    return stmt.get();
  },

  // Create a new QR token and optionally expire any previous ACTIVE tokens
  createToken(token, expiresAt = null) {
    const now = new Date().toISOString();
    
    // Expire any existing ACTIVE tokens so only 1 QR is active at any time
    db.prepare(`
      UPDATE qr_tokens 
      SET status = 'EXPIRED' 
      WHERE status = 'ACTIVE'
    `).run();

    const insert = db.prepare(`
      INSERT INTO qr_tokens (token, status, created_at, expires_at)
      VALUES (?, 'ACTIVE', ?, ?)
    `);
    insert.run(token, now, expiresAt);

    return this.getByToken(token);
  },

  getByToken(token) {
    const stmt = db.prepare(`SELECT * FROM qr_tokens WHERE token = ?`);
    return stmt.get(token);
  },

  // Mark token as USED
  markUsed(token, userName, deviceId) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE qr_tokens 
      SET status = 'USED', used_at = ?, used_by_name = ?, device_id = ?
      WHERE token = ? AND status = 'ACTIVE'
    `);
    const result = stmt.run(now, userName, deviceId, token);
    return result.changes > 0;
  },

  // Expire token
  expireToken(token) {
    const stmt = db.prepare(`
      UPDATE qr_tokens 
      SET status = 'EXPIRED' 
      WHERE token = ? AND status = 'ACTIVE'
    `);
    const result = stmt.run(token);
    return result.changes > 0;
  },

  // Get list of recent tokens with audit details
  getHistory(limit = 50) {
    const stmt = db.prepare(`
      SELECT * FROM qr_tokens 
      ORDER BY id DESC 
      LIMIT ?
    `);
    return stmt.all(limit);
  },

  // Get statistics
  getStats() {
    const total = db.prepare(`SELECT COUNT(*) as count FROM qr_tokens`).get().count;
    const active = db.prepare(`SELECT COUNT(*) as count FROM qr_tokens WHERE status = 'ACTIVE'`).get().count;
    const used = db.prepare(`SELECT COUNT(*) as count FROM qr_tokens WHERE status = 'USED'`).get().count;
    const expired = db.prepare(`SELECT COUNT(*) as count FROM qr_tokens WHERE status = 'EXPIRED'`).get().count;
    return { total, active, used, expired };
  }
};

const AttendanceModel = {
  // Check if this device has already checked in on a given date
  hasDeviceAttended(deviceId, date) {
    const stmt = db.prepare(`
      SELECT id, name, time FROM attendance_records 
      WHERE device_id = ? AND date = ? 
      LIMIT 1
    `);
    return stmt.get(deviceId, date);
  },

  hasDeviceAttendedMasuk(deviceId, date) {
    const stmt = db.prepare(`
      SELECT id, name, time FROM attendance_records 
      WHERE device_id = ? AND date = ? AND type = 'MASUK'
      LIMIT 1
    `);
    return stmt.get(deviceId, date);
  },

  hasDeviceAttendedKeluar(deviceId, date) {
    const stmt = db.prepare(`
      SELECT id, name, time FROM attendance_records 
      WHERE device_id = ? AND date = ? AND type = 'KELUAR'
      LIMIT 1
    `);
    return stmt.get(deviceId, date);
  },

  getMasukRecord(deviceId, date) {
    const stmt = db.prepare(`
      SELECT id, name, time FROM attendance_records 
      WHERE device_id = ? AND date = ? AND type = 'MASUK'
      LIMIT 1
    `);
    return stmt.get(deviceId, date);
  },

  // Create attendance record
  createAttendance({ token, name, type = 'MASUK', date, day, time, deviceId, deviceInfo }) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO attendance_records 
      (token, name, type, date, day, time, device_id, device_info, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(token, name, type, date, day, time, deviceId, deviceInfo || '', now);
    return {
      id: info.lastInsertRowid,
      token,
      name,
      type,
      date,
      day,
      time,
      deviceId,
      deviceInfo,
      createdAt: now
    };
  },

  // Get all attendance records (with optional date filter)
  getAll(date = null, limit = 200) {
    if (date) {
      const stmt = db.prepare(`
        SELECT * FROM attendance_records 
        WHERE date = ? 
        ORDER BY id DESC 
        LIMIT ?
      `);
      return stmt.all(date, limit);
    }
    const stmt = db.prepare(`
      SELECT * FROM attendance_records 
      ORDER BY id DESC 
      LIMIT ?
    `);
    return stmt.all(limit);
  },

  // Get count stats
  getStats() {
    const totalRecords = db.prepare(`SELECT COUNT(*) as count FROM attendance_records`).get().count;
    const uniqueDevices = db.prepare(`SELECT COUNT(DISTINCT device_id) as count FROM attendance_records`).get().count;
    const today = new Date().toISOString().split('T')[0];
    const todayCount = db.prepare(`SELECT COUNT(*) as count FROM attendance_records WHERE date = ?`).get(today).count;
    return { totalRecords, uniqueDevices, todayCount };
  },

  // Clear all data (for admin reset if needed)
  clearAll() {
    db.exec(`DELETE FROM attendance_records; DELETE FROM qr_tokens;`);
  }
};

module.exports = {
  db,
  QRTokenModel,
  AttendanceModel
};
