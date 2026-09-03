/**
 * Admin Dashboard Controller (admin.js)
 * Mendukung:
 * 1. Multi-layered QR Generator (Anti-blank: QRServer API + QRCodeJS Canvas Fallback)
 * 2. Real-time Multi-Provider Cloud Sync (MQTT WSS over SSL: bisa beda provider / beda Wi-Fi / kuota 4G)
 * 3. LocalStorage Persistence + Node.js Server Mode
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const tabBtnProjector = document.getElementById('tabBtnProjector');
  const tabBtnAudit = document.getElementById('tabBtnAudit');
  const tabBtnAttendance = document.getElementById('tabBtnAttendance');

  const viewProjector = document.getElementById('viewProjector');
  const viewAudit = document.getElementById('viewAudit');
  const viewAttendance = document.getElementById('viewAttendance');

  const qrImage = document.getElementById('qrImage');
  const qrCanvasContainer = document.getElementById('qrCanvasContainer');
  const qrCardBox = document.getElementById('qrCardBox');
  const qrOverlayLoading = document.getElementById('qrOverlayLoading');
  const activeTokenText = document.getElementById('activeTokenText');
  const mobileAccessUrl = document.getElementById('mobileAccessUrl');
  const btnCopyUrl = document.getElementById('btnCopyUrl');
  const btnRefreshQr = document.getElementById('btnRefreshQr');
  const btnFullscreen = document.getElementById('btnFullscreen');
  const syncBadgeText = document.getElementById('syncBadgeText');

  const liveClock = document.getElementById('liveClock');
  const liveDate = document.getElementById('liveDate');
  const liveActivityList = document.getElementById('liveActivityList');
  const liveFeedCount = document.getElementById('liveFeedCount');

  const toastNotification = document.getElementById('toastNotification');
  const toastText = document.getElementById('toastText');
  const toastDetail = document.getElementById('toastDetail');

  // Audit Elements
  const auditMetricTotal = document.getElementById('auditMetricTotal');
  const auditMetricActive = document.getElementById('auditMetricActive');
  const auditMetricUsed = document.getElementById('auditMetricUsed');
  const auditMetricExpired = document.getElementById('auditMetricExpired');
  const auditTableBody = document.getElementById('auditTableBody');
  const btnRefreshAudit = document.getElementById('btnRefreshAudit');

  // Attendance Elements
  const metricToday = document.getElementById('metricToday');
  const metricTotalRecords = document.getElementById('metricTotalRecords');
  const metricUniqueDevices = document.getElementById('metricUniqueDevices');
  const attendanceTableBody = document.getElementById('attendanceTableBody');
  const filterSearch = document.getElementById('filterSearch');
  const filterDate = document.getElementById('filterDate');
  const btnResetFilter = document.getElementById('btnResetFilter');
  const btnExportCsv = document.getElementById('btnExportCsv');
  const btnResetData = document.getElementById('btnResetData');

  // Storage Keys
  const STORAGE_QR_TOKENS = 'sqr_qr_tokens';
  const STORAGE_ATTENDANCES = 'sqr_attendances';
  const STORAGE_SESSION = 'sqr_admin_session_id';

  // Persistent Admin Session ID (so QR link stays valid)
  let adminSessionId = localStorage.getItem(STORAGE_SESSION);
  if (!adminSessionId) {
    adminSessionId = 'ses_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).substring(4);
    localStorage.setItem(STORAGE_SESSION, adminSessionId);
  }

  function getStoredTokens() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_QR_TOKENS)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveTokens(tokens) {
    localStorage.setItem(STORAGE_QR_TOKENS, JSON.stringify(tokens));
  }

  function getStoredAttendances() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_ATTENDANCES)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveAttendances(records) {
    localStorage.setItem(STORAGE_ATTENDANCES, JSON.stringify(records));
  }

  let currentActiveToken = null;
  let isServerMode = false;
  let mqttClient = null;
  const broadcast = ('BroadcastChannel' in window) ? new BroadcastChannel('smart_qr_channel') : null;

  // --- 1. WEB AUDIO API CHIME ---
  function playSuccessChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880, now + 0.15); // A5
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.35); // D6

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now + 0.15);
      osc1.stop(now + 0.45);
      osc2.stop(now + 0.45);
    } catch (e) {
      console.warn('Audio chime warning:', e);
    }
  }

  // --- 2. DIGITAL CLOCK ---
  function updateClock() {
    const now = new Date();
    liveClock.textContent = now.toLocaleTimeString('id-ID', { hour12: false });
    liveDate.textContent = now.toLocaleDateString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
  setInterval(updateClock, 1000);
  updateClock();

  // --- 3. BULLETPROOF MULTI-LAYERED QR GENERATION (ANTI-BLANK) ---
  function generateRandomToken() {
    return 'QR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 7).toUpperCase();
  }

  function getBaseAppUrl() {
    let path = window.location.pathname;
    if (path.endsWith('index.html')) {
      path = path.substring(0, path.length - 'index.html'.length);
    }
    if (!path.endsWith('/')) {
      path += '/';
    }
    return window.location.origin + path;
  }

  function renderActiveQrCode(token) {
    const base = getBaseAppUrl();
    const attendUrl = `${base}attend.html?token=${encodeURIComponent(token)}&session=${encodeURIComponent(adminSessionId)}`;

    currentActiveToken = token;
    activeTokenText.textContent = token;
    mobileAccessUrl.textContent = attendUrl;
    mobileAccessUrl.dataset.url = attendUrl;

    qrOverlayLoading.classList.remove('hidden');

    // 1. Primary: High-speed QR Server Generator (Never fails, zero js dependencies)
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(attendUrl)}`;
    qrImage.src = qrApiUrl;
    qrImage.classList.remove('hidden');
    qrCanvasContainer.classList.add('hidden');

    qrImage.onload = () => {
      qrOverlayLoading.classList.add('hidden');
    };

    // 2. Fallback: If external image is blocked/offline, render via QRCode.js canvas
    qrImage.onerror = () => {
      if (typeof QRCode !== 'undefined') {
        qrCanvasContainer.innerHTML = '';
        new QRCode(qrCanvasContainer, {
          text: attendUrl,
          width: 280,
          height: 280,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
        qrImage.classList.add('hidden');
        qrCanvasContainer.classList.remove('hidden');
      }
      qrOverlayLoading.classList.add('hidden');
    };

    // Broadcast update to any open tabs
    if (broadcast) {
      broadcast.postMessage({ type: 'ACTIVE_TOKEN_UPDATED', token, sessionId: adminSessionId });
    }
  }

  function createNewActiveToken() {
    const newToken = generateRandomToken();
    const now = new Date().toISOString();

    const tokens = getStoredTokens();
    tokens.forEach(t => {
      if (t.status === 'ACTIVE') t.status = 'EXPIRED';
    });

    tokens.unshift({
      token: newToken,
      status: 'ACTIVE',
      created_at: now,
      used_at: null,
      used_by_name: null,
      device_id: null
    });
    saveTokens(tokens);

    renderActiveQrCode(newToken);
    return newToken;
  }

  // --- 4. ATTENDANCE VERIFICATION & RECORD ENGINE ---
  function processAttendanceSubmission({ token, name, date, day, time, deviceId, deviceInfo }) {
    const tokens = getStoredTokens();
    const targetToken = tokens.find(t => t.token === token);

    if (!targetToken) {
      return { success: false, error: 'QR Code tidak terdaftar dalam sistem!' };
    }

    if (targetToken.status === 'USED') {
      return {
        success: false,
        error: `QR Code ini sudah pernah digunakan oleh "${targetToken.used_by_name || 'pengguna lain'}". Setiap QR Code hanya berlaku 1 kali!`
      };
    }

    if (targetToken.status === 'EXPIRED') {
      return {
        success: false,
        error: 'QR Code sudah kedaluwarsa karena admin telah me-refresh kode QR.'
      };
    }

    // Check Device Lock (1 attendance per device per day)
    const attendances = getStoredAttendances();
    const targetDate = date || new Date().toISOString().split('T')[0];
    const existingDeviceRecord = attendances.find(a => a.device_id === deviceId && a.date === targetDate);

    if (existingDeviceRecord) {
      return {
        success: false,
        error: `Perangkat ini sudah tercatat melakukan absensi hari ini atas nama "${existingDeviceRecord.name}" pada pukul ${existingDeviceRecord.time}. Setiap perangkat fisik hanya diperbolehkan absen 1 kali per hari!`
      };
    }

    // Mark token as USED
    const now = new Date().toISOString();
    targetToken.status = 'USED';
    targetToken.used_at = now;
    targetToken.used_by_name = name;
    targetToken.device_id = deviceId;
    saveTokens(tokens);

    // Record attendance
    const newRecord = {
      id: Date.now(),
      token,
      name,
      date: targetDate,
      day: day || 'Hari Ini',
      time: time || new Date().toLocaleTimeString('id-ID', { hour12: false }),
      device_id: deviceId,
      device_info: deviceInfo || 'Perangkat Web',
      created_at: now
    };

    attendances.unshift(newRecord);
    saveAttendances(attendances);

    // Trigger Admin Events: Sound, Toast, Flash, and ROTATE QR!
    handleAttendanceSuccessEvent(newRecord);

    // Auto rotate to NEW QR immediately!
    createNewActiveToken();

    return {
      success: true,
      message: 'Presensi berhasil diverifikasi!',
      attendance: newRecord
    };
  }

  function handleAttendanceSuccessEvent(record) {
    playSuccessChime();
    triggerVisualFlash();
    showToast(record.name, `Presensi pukul ${record.time} WIB. QR baru otomatis aktif!`);
    addLiveActivityItem(record);

    if (!viewAudit.classList.contains('hidden')) loadAuditData();
    if (!viewAttendance.classList.contains('hidden')) loadAttendanceData();

    if (broadcast) {
      broadcast.postMessage({ type: 'ATTENDANCE_RECORDED', attendance: record });
    }
  }

  // --- 5. CLOUD MULTI-PROVIDER REAL-TIME SYNC VIA MQTT WSS ---
  function initCloudMqtt() {
    if (typeof mqtt === 'undefined') {
      console.warn('MQTT library not available, using local sync.');
      return;
    }

    const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
    const clientId = 'sqr_admin_' + Math.random().toString(16).substring(2, 10);

    try {
      mqttClient = mqtt.connect(brokerUrl, {
        clientId,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 3000
      });

      mqttClient.on('connect', () => {
        console.log('Connected to Cloud Real-time MQTT Broker via WSS!');
        syncBadgeText.textContent = 'Cloud Sync (Beda Provider Aktif)';

        // Subscribe to submission channel for this admin session
        const submitTopic = `smartqr/${adminSessionId}/submit`;
        const checkTopic = `smartqr/${adminSessionId}/check`;

        mqttClient.subscribe([submitTopic, checkTopic], (err) => {
          if (!err) {
            console.log(`Subscribed to ${submitTopic}`);
          }
        });
      });

      mqttClient.on('message', (topic, message) => {
        try {
          const payload = JSON.parse(message.toString());
          if (topic.endsWith('/submit')) {
            const result = processAttendanceSubmission(payload);
            // Send acknowledgement back to attendee
            const respTopic = `smartqr/${adminSessionId}/resp/${payload.reqId}`;
            mqttClient.publish(respTopic, JSON.stringify(result));
          } else if (topic.endsWith('/check')) {
            const tokens = getStoredTokens();
            const t = tokens.find(item => item.token === payload.token);
            let resp = { valid: true, status: 'ACTIVE', token: payload.token };
            if (!t) {
              resp = { valid: false, status: 'NOT_FOUND', message: 'QR Code tidak terdaftar.' };
            } else if (t.status === 'USED') {
              resp = { valid: false, status: 'USED', message: `QR Code ini sudah pernah digunakan oleh ${t.used_by_name || 'pengguna lain'}.` };
            } else if (t.status === 'EXPIRED') {
              resp = { valid: false, status: 'EXPIRED', message: 'QR Code sudah kedaluwarsa.' };
            }
            mqttClient.publish(`smartqr/${adminSessionId}/check_resp/${payload.reqId}`, JSON.stringify(resp));
          }
        } catch (e) {
          console.error('Error handling MQTT message:', e);
        }
      });

      mqttClient.on('error', (err) => {
        console.warn('MQTT connection error:', err);
      });
    } catch (e) {
      console.warn('Failed to start MQTT client:', e);
    }
  }

  // BroadcastChannel listener (same-browser testing)
  if (broadcast) {
    broadcast.onmessage = (event) => {
      const data = event.data;
      if (data && data.type === 'SUBMIT_FROM_TAB') {
        const result = processAttendanceSubmission(data.payload);
        broadcast.postMessage({ type: 'SUBMIT_RESPONSE_TAB', targetRequestId: data.requestId, result });
      }
    };
  }

  // --- 6. SERVER FALLBACK (Local Node.js) ---
  async function checkForNodeServer() {
    try {
      const res = await fetch('/api/system/info');
      if (res.ok) {
        isServerMode = true;
        syncBadgeText.textContent = 'Node Server Sync';
        if (window.hasSocketIo && window.io) {
          const socket = io();
          socket.on('connect', () => {
            socket.emit('request_active_qr', { host: window.location.host });
          });
          socket.on('active_qr_updated', (qrData) => {
            if (qrData && qrData.qrImage) {
              qrImage.src = qrData.qrImage;
              activeTokenText.textContent = qrData.token;
              mobileAccessUrl.textContent = qrData.url;
              mobileAccessUrl.dataset.url = qrData.url;
              currentActiveToken = qrData.token;
              qrOverlayLoading.classList.add('hidden');
            }
          });
          socket.on('attendance_recorded', (data) => {
            playSuccessChime();
            triggerVisualFlash();
            showToast(data.attendance.name, `Presensi pukul ${data.attendance.time} WIB. QR baru telah dibuat!`);
            addLiveActivityItem(data.attendance);
            if (!viewAudit.classList.contains('hidden')) loadAuditData();
            if (!viewAttendance.classList.contains('hidden')) loadAttendanceData();
          });
        }
      }
    } catch (e) {
      isServerMode = false;
    }
  }

  // Visual Effects
  function triggerVisualFlash() {
    qrCardBox.classList.remove('scan-flash');
    void qrCardBox.offsetWidth;
    qrCardBox.classList.add('scan-flash');
  }

  function showToast(name, detail) {
    toastText.textContent = name;
    toastDetail.textContent = detail;
    toastNotification.classList.remove('translate-x-full');
    setTimeout(() => {
      toastNotification.classList.add('translate-x-full');
    }, 4500);
  }

  function addLiveActivityItem(att) {
    const item = document.createElement('div');
    item.className = 'p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs animate-fade-in';
    item.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
        <strong class="text-white">${escapeHtml(att.name)}</strong>
      </div>
      <span class="text-slate-400 font-mono text-[11px]">${att.time} WIB</span>
    `;

    if (liveActivityList.querySelector('.text-slate-500')) {
      liveActivityList.innerHTML = '';
    }
    liveActivityList.prepend(item);

    const currentCount = parseInt(liveFeedCount.dataset.count || '0') + 1;
    liveFeedCount.dataset.count = currentCount;
    liveFeedCount.textContent = `${currentCount} hadir`;
  }

  // Copy Mobile URL
  btnCopyUrl.addEventListener('click', () => {
    const url = mobileAccessUrl.dataset.url || mobileAccessUrl.textContent;
    navigator.clipboard.writeText(url).then(() => {
      btnCopyUrl.innerHTML = `<i data-lucide="check" class="w-4 h-4 text-emerald-400"></i>`;
      lucide.createIcons();
      setTimeout(() => {
        btnCopyUrl.innerHTML = `<i data-lucide="copy" class="w-4 h-4"></i>`;
        lucide.createIcons();
      }, 2000);
    });
  });

  // Manual QR Refresh
  btnRefreshQr.addEventListener('click', async () => {
    qrOverlayLoading.classList.remove('hidden');
    if (isServerMode) {
      try {
        await fetch('/api/qr/refresh', { method: 'POST' });
        showToast('QR Diperbarui', 'Token QR baru berhasil diaktifkan.');
      } catch (e) {
        alert('Gagal merefresh QR server.');
      }
    } else {
      createNewActiveToken();
      showToast('QR Diperbarui', 'Token QR lama hangus dan token baru aktif.');
    }
  });

  // Fullscreen
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => alert(`Fullscreen error: ${err.message}`));
    } else {
      document.exitFullscreen();
    }
  });

  // Tab Navigation
  function setActiveTab(tabName) {
    [tabBtnProjector, tabBtnAudit, tabBtnAttendance].forEach((btn) => {
      btn.className = 'tab-btn px-3.5 py-2 rounded-lg transition flex items-center gap-2 text-slate-400 hover:text-slate-200';
    });

    viewProjector.classList.add('hidden');
    viewAudit.classList.add('hidden');
    viewAttendance.classList.add('hidden');

    if (tabName === 'projector') {
      tabBtnProjector.className = 'tab-btn active px-3.5 py-2 rounded-lg transition flex items-center gap-2 bg-indigo-600 text-white shadow';
      viewProjector.classList.remove('hidden');
    } else if (tabName === 'audit') {
      tabBtnAudit.className = 'tab-btn active px-3.5 py-2 rounded-lg transition flex items-center gap-2 bg-indigo-600 text-white shadow';
      viewAudit.classList.remove('hidden');
      loadAuditData();
    } else if (tabName === 'attendance') {
      tabBtnAttendance.className = 'tab-btn active px-3.5 py-2 rounded-lg transition flex items-center gap-2 bg-indigo-600 text-white shadow';
      viewAttendance.classList.remove('hidden');
      loadAttendanceData();
    }
    lucide.createIcons();
  }

  tabBtnProjector.addEventListener('click', () => setActiveTab('projector'));
  tabBtnAudit.addEventListener('click', () => setActiveTab('audit'));
  tabBtnAttendance.addEventListener('click', () => setActiveTab('attendance'));

  // --- 7. TAB 2: AUDIT LOG DATA ---
  async function loadAuditData() {
    let tokens = [];
    if (isServerMode) {
      try {
        const res = await fetch('/api/qr/audit?limit=100');
        const data = await res.json();
        tokens = data.history || [];
      } catch (e) {
        tokens = getStoredTokens();
      }
    } else {
      tokens = getStoredTokens();
    }

    const total = tokens.length;
    const active = tokens.filter(t => t.status === 'ACTIVE').length;
    const used = tokens.filter(t => t.status === 'USED').length;
    const expired = tokens.filter(t => t.status === 'EXPIRED').length;

    auditMetricTotal.textContent = total;
    auditMetricActive.textContent = active;
    auditMetricUsed.textContent = used;
    auditMetricExpired.textContent = expired;

    if (tokens.length === 0) {
      auditTableBody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-500">Belum ada riwayat QR token.</td></tr>`;
      return;
    }

    auditTableBody.innerHTML = tokens.map((item) => {
      let statusBadge = '';
      if (item.status === 'ACTIVE') {
        statusBadge = `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span> AKTIF
        </span>`;
      } else if (item.status === 'USED') {
        statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
          <i data-lucide="check" class="w-3 h-3"></i> 1x TERPAKAI
        </span>`;
      } else {
        statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
          HANGUS / EXPIRED
        </span>`;
      }

      const usedName = item.used_by_name ? `<span class="font-bold text-white">${escapeHtml(item.used_by_name)}</span>` : '<span class="text-slate-500 italic">Belum digunakan</span>';
      const device = item.device_id ? `<span class="font-mono text-slate-400" title="${escapeHtml(item.device_id)}">${escapeHtml(item.device_id.substring(0, 16))}...</span>` : '<span class="text-slate-500">-</span>';
      const usedAtTime = item.used_at ? new Date(item.used_at).toLocaleTimeString('id-ID') + ' WIB' : '<span class="text-slate-500">-</span>';
      const createdAtTime = new Date(item.created_at).toLocaleTimeString('id-ID') + ' WIB';

      return `
        <tr class="hover:bg-slate-900/60 transition">
          <td class="py-3 px-4">${statusBadge}</td>
          <td class="py-3 px-4 font-mono font-bold text-indigo-300">${escapeHtml(item.token)}</td>
          <td class="py-3 px-4">${usedName}</td>
          <td class="py-3 px-4">${device}</td>
          <td class="py-3 px-4 text-slate-400">${createdAtTime}</td>
          <td class="py-3 px-4 text-emerald-400">${usedAtTime}</td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  }

  btnRefreshAudit.addEventListener('click', loadAuditData);

  // --- 8. TAB 3: ATTENDANCE RECORDS ---
  let cachedAttendances = [];

  async function loadAttendanceData() {
    if (isServerMode) {
      try {
        const dateVal = filterDate.value;
        let url = '/api/attendance/list?limit=500';
        if (dateVal) url += `&date=${encodeURIComponent(dateVal)}`;
        const res = await fetch(url);
        const data = await res.json();
        cachedAttendances = data.records || [];
      } catch (e) {
        cachedAttendances = getStoredAttendances();
      }
    } else {
      cachedAttendances = getStoredAttendances();
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const todayCount = cachedAttendances.filter(a => a.date === todayStr).length;
    const uniqueDevs = new Set(cachedAttendances.map(a => a.device_id)).size;

    metricToday.textContent = todayCount;
    metricTotalRecords.textContent = cachedAttendances.length;
    metricUniqueDevices.textContent = uniqueDevs;

    renderAttendanceTable();
  }

  function renderAttendanceTable() {
    const searchTerm = (filterSearch.value || '').toLowerCase().trim();
    const dateFilter = filterDate.value;

    const filtered = cachedAttendances.filter((att) => {
      const matchName = (att.name || '').toLowerCase().includes(searchTerm);
      const matchDevice = (att.device_info || '').toLowerCase().includes(searchTerm) || (att.device_id || '').toLowerCase().includes(searchTerm);
      const matchToken = (att.token || '').toLowerCase().includes(searchTerm);
      const matchDate = !dateFilter || att.date === dateFilter;
      return (matchName || matchDevice || matchToken) && matchDate;
    });

    if (filtered.length === 0) {
      attendanceTableBody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-500">Tidak ada data kehadiran yang sesuai.</td></tr>`;
      return;
    }

    attendanceTableBody.innerHTML = filtered.map((att, idx) => {
      return `
        <tr class="hover:bg-slate-900/60 transition">
          <td class="py-3 px-4 text-center text-slate-500 font-mono">${idx + 1}</td>
          <td class="py-3 px-4 font-bold text-white">${escapeHtml(att.name)}</td>
          <td class="py-3 px-4 text-indigo-300 font-medium">${escapeHtml(att.day)}, ${escapeHtml(att.date)}</td>
          <td class="py-3 px-4 text-emerald-400 font-mono">${escapeHtml(att.time)} WIB</td>
          <td class="py-3 px-4 font-mono text-slate-400 text-[11px]">${escapeHtml(att.token)}</td>
          <td class="py-3 px-4 text-slate-400 text-[11px]">
            <div class="truncate max-w-xs" title="${escapeHtml(att.device_info || '')}">${escapeHtml(att.device_info || '-')}</div>
            <div class="text-[10px] text-slate-500 font-mono truncate" title="${escapeHtml(att.device_id)}">${escapeHtml(att.device_id)}</div>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  }

  filterSearch.addEventListener('input', renderAttendanceTable);
  filterDate.addEventListener('change', renderAttendanceTable);
  btnResetFilter.addEventListener('click', () => {
    filterSearch.value = '';
    filterDate.value = '';
    renderAttendanceTable();
  });

  // Export CSV
  btnExportCsv.addEventListener('click', () => {
    if (!cachedAttendances || cachedAttendances.length === 0) {
      alert('Belum ada data presensi untuk diexport.');
      return;
    }

    const headers = ['No', 'Nama Lengkap', 'Hari', 'Tanggal', 'Jam Masuk', 'Token QR', 'Device ID', 'Info Perangkat'];
    const rows = cachedAttendances.map((att, index) => [
      index + 1,
      `"${att.name.replace(/"/g, '""')}"`,
      `"${att.day}"`,
      `"${att.date}"`,
      `"${att.time}"`,
      `"${att.token}"`,
      `"${att.device_id}"`,
      `"${(att.device_info || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `Rekap_Presensi_QR_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // Reset Data
  btnResetData.addEventListener('click', async () => {
    const confirmation = confirm('PERINGATAN:\n\nApakah Anda yakin ingin MENGHAPUS SEMUA data presensi dan riwayat QR?\nTindakan ini tidak dapat dibatalkan.');
    if (!confirmation) return;

    if (isServerMode) {
      try {
        await fetch('/api/admin/reset', { method: 'POST' });
      } catch (e) {}
    }

    saveTokens([]);
    saveAttendances([]);
    createNewActiveToken();
    loadAuditData();
    loadAttendanceData();
    showToast('Data Direset', 'Semua data telah dikosongkan.');
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initial Boot
  async function init() {
    await checkForNodeServer();

    if (!isServerMode) {
      initCloudMqtt();
      const tokens = getStoredTokens();
      const active = tokens.find(t => t.status === 'ACTIVE');
      if (active) {
        renderActiveQrCode(active.token);
      } else {
        createNewActiveToken();
      }
    }
  }

  init();
});
