/**
 * Admin Dashboard & Gate Controller (admin.js)
 * Fitur:
 * 1. Gate Pop-up Awal (Admin Login vs Absensi)
 * 2. Pilihan Jenis Presensi (Absensi Masuk & Absensi Keluar)
 * 3. Kunci Layar Admin (Username: Admin1118, Password: AFIFweb18)
 * 4. In-Browser Camera Scanner dengan 1 Tombol Upload Foto QR di border kamera
 * 5. Validasi Ketat Absensi Keluar: Wajib sudah absen masuk dengan nama & device yang sama
 * 6. Kunci Tanggal Regional & Single-Use Dynamic QR Rotation
 * 7. Tampilan Data Presensi Multi-Tab: Absensi Utama (Masuk + Keluar), Absensi Masuk, Absensi Keluar
 * 8. Real-time Multi-Provider Cloud Sync (MQTT WSS) & Integrasi Google Calendar
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- GATE & AUTH ELEMENTS ---
  const gateModal = document.getElementById('gateModal');
  const btnOpenAdminLogin = document.getElementById('btnOpenAdminLogin');
  const btnOpenScan = document.getElementById('btnOpenScan');
  const inputQrFile = document.getElementById('inputQrFile');

  // --- ABSENSI CHOICE ELEMENTS (MASUK / KELUAR) ---
  const absensiChoiceModal = document.getElementById('absensiChoiceModal');
  const btnChoiceMasuk = document.getElementById('btnChoiceMasuk');
  const btnChoiceKeluar = document.getElementById('btnChoiceKeluar');
  const btnCancelChoice = document.getElementById('btnCancelChoice');

  // --- ADMIN LOGIN ELEMENTS ---
  const adminLoginModal = document.getElementById('adminLoginModal');
  const formAdminLogin = document.getElementById('formAdminLogin');
  const inputUsername = document.getElementById('inputUsername');
  const inputPassword = document.getElementById('inputPassword');
  const btnTogglePassword = document.getElementById('btnTogglePassword');
  const eyeIcon = document.getElementById('eyeIcon');
  const loginError = document.getElementById('loginError');
  const loginErrorText = document.getElementById('loginErrorText');
  const btnCancelLogin = document.getElementById('btnCancelLogin');

  const adminDashboardWrapper = document.getElementById('adminDashboardWrapper');
  const btnLogoutAdmin = document.getElementById('btnLogoutAdmin');

  // --- SCANNER MODAL ELEMENTS ---
  const cameraScanModal = document.getElementById('cameraScanModal');
  const cameraModalTitle = document.getElementById('cameraModalTitle');
  const btnCloseCamera = document.getElementById('btnCloseCamera');
  const btnUploadFromScanner = document.getElementById('btnUploadFromScanner');
  const cameraViewContainer = document.getElementById('cameraViewContainer');
  const scanStatusBadge = document.getElementById('scanStatusBadge');
  const scanStatusText = document.getElementById('scanStatusText');
  const scannerStabilizeOverlay = document.getElementById('scannerStabilizeOverlay');
  const stabilizedTokenText = document.getElementById('stabilizedTokenText');

  // --- INLINE ATTENDANCE FORM ELEMENTS ---
  const attendInlineModal = document.getElementById('attendInlineModal');
  const inlineTypeBadge = document.getElementById('inlineTypeBadge');
  const inlineTokenBadge = document.getElementById('inlineTokenBadge');
  const inlineFormWrapper = document.getElementById('inlineFormWrapper');
  const inlineFormTitle = document.getElementById('inlineFormTitle');
  const inlineFormSubtitle = document.getElementById('inlineFormSubtitle');
  const inlineKeluarNotice = document.getElementById('inlineKeluarNotice');
  const inlineSuccessWrapper = document.getElementById('inlineSuccessWrapper');
  const inlineAttendForm = document.getElementById('inlineAttendForm');
  const inlineInputName = document.getElementById('inlineInputName');
  const inlineInputDate = document.getElementById('inlineInputDate');
  const inlineInputDay = document.getElementById('inlineInputDay');
  const inlineDeviceLabel = document.getElementById('inlineDeviceLabel');
  const btnCancelInline = document.getElementById('btnCancelInline');
  const btnSubmitInline = document.getElementById('btnSubmitInline');

  const inlineSuccName = document.getElementById('inlineSuccName');
  const inlineSuccDate = document.getElementById('inlineSuccDate');
  const inlineSuccTime = document.getElementById('inlineSuccTime');
  const inlineBtnGCal = document.getElementById('inlineBtnGCal');
  const inlineBtnIcs = document.getElementById('inlineBtnIcs');
  const btnFinishInline = document.getElementById('btnFinishInline');

  // --- ADMIN DASHBOARD ELEMENTS ---
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

  const auditMetricTotal = document.getElementById('auditMetricTotal');
  const auditMetricActive = document.getElementById('auditMetricActive');
  const auditMetricUsed = document.getElementById('auditMetricUsed');
  const auditMetricExpired = document.getElementById('auditMetricExpired');
  const auditTableBody = document.getElementById('auditTableBody');
  const btnRefreshAudit = document.getElementById('btnRefreshAudit');

  // Metric Cards for Attendance View
  const metricMasukToday = document.getElementById('metricMasukToday');
  const metricKeluarToday = document.getElementById('metricKeluarToday');
  const metricLengkapToday = document.getElementById('metricLengkapToday');
  const metricTotalRecords = document.getElementById('metricTotalRecords');

  // Sub-tabs for Attendance View
  const subTabUtama = document.getElementById('subTabUtama');
  const subTabMasuk = document.getElementById('subTabMasuk');
  const subTabKeluar = document.getElementById('subTabKeluar');
  const attendanceTableHead = document.getElementById('attendanceTableHead');
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
  const STORAGE_AUTH = 'sqr_admin_authenticated';

  let currentActiveToken = null;
  let currentAttendanceType = 'MASUK'; // 'MASUK' | 'KELUAR'
  let activeSubTab = 'UTAMA'; // 'UTAMA' | 'MASUK' | 'KELUAR'
  let mqttClient = null;
  let html5QrScanner = null;
  let activeScannedToken = null;
  let activeScannedSession = null;

  const broadcast = ('BroadcastChannel' in window) ? new BroadcastChannel('smart_qr_channel') : null;

  // Persistent Admin Session ID (for MQTT cross-device sync)
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

  function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getIndonesianDayName(dateObj = new Date()) {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    return days[dateObj.getDay()];
  }

  // --- AUDIO CHIME ---
  function playSuccessChime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') ctx.resume();

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.15);
      osc1.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.35);

      osc2.frequency.setValueAtTime(659.25, ctx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.25);

      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(ctx.currentTime);
      osc2.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.6);
      osc2.stop(ctx.currentTime + 0.6);
    } catch (e) {}
  }

  // --- 1. GATE & AUTHENTICATION CONTROLLER ---
  function checkAuthStatus() {
    const isAuth = sessionStorage.getItem(STORAGE_AUTH) === 'true';
    if (isAuth) {
      gateModal.classList.add('hidden');
      if (absensiChoiceModal) absensiChoiceModal.classList.add('hidden');
      adminLoginModal.classList.add('hidden');
      adminDashboardWrapper.classList.remove('hidden');
      initAdminDashboard();
    } else {
      adminDashboardWrapper.classList.add('hidden');
      gateModal.classList.remove('hidden');
      if (absensiChoiceModal) absensiChoiceModal.classList.add('hidden');
      adminLoginModal.classList.add('hidden');
    }
  }

  btnOpenAdminLogin.addEventListener('click', () => {
    gateModal.classList.add('hidden');
    adminLoginModal.classList.remove('hidden');
    loginError.classList.add('hidden');
    inputUsername.value = '';
    inputPassword.value = '';
    setTimeout(() => inputUsername.focus(), 150);
  });

  btnCancelLogin.addEventListener('click', () => {
    adminLoginModal.classList.add('hidden');
    gateModal.classList.remove('hidden');
  });

  btnTogglePassword.addEventListener('click', () => {
    if (inputPassword.type === 'password') {
      inputPassword.type = 'text';
      eyeIcon.setAttribute('data-lucide', 'eye-off');
    } else {
      inputPassword.type = 'password';
      eyeIcon.setAttribute('data-lucide', 'eye');
    }
    lucide.createIcons();
  });

  formAdminLogin.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = inputUsername.value.trim();
    const pass = inputPassword.value;

    // Kredensial Admin Sesuai Permintaan
    if (user === 'Admin1118' && pass === 'AFIFweb18') {
      sessionStorage.setItem(STORAGE_AUTH, 'true');
      adminLoginModal.classList.add('hidden');
      gateModal.classList.add('hidden');
      if (absensiChoiceModal) absensiChoiceModal.classList.add('hidden');
      adminDashboardWrapper.classList.remove('hidden');
      initAdminDashboard();
      showToast('Login Berhasil', 'Selamat datang di Layar Admin.');
    } else {
      loginError.classList.remove('hidden');
      loginErrorText.textContent = 'Username atau password salah!';
      inputPassword.value = '';
      inputPassword.focus();
    }
  });

  btnLogoutAdmin.addEventListener('click', () => {
    if (confirm('Apakah Anda yakin ingin mengunci layar admin?')) {
      sessionStorage.removeItem(STORAGE_AUTH);
      adminDashboardWrapper.classList.add('hidden');
      gateModal.classList.remove('hidden');
    }
  });

  // --- 2. ALUR PILIHAN ABSENSI (MASUK & KELUAR) ---
  btnOpenScan.addEventListener('click', () => {
    gateModal.classList.add('hidden');
    absensiChoiceModal.classList.remove('hidden');
    lucide.createIcons();
  });

  if (btnCancelChoice) {
    btnCancelChoice.addEventListener('click', () => {
      absensiChoiceModal.classList.add('hidden');
      gateModal.classList.remove('hidden');
    });
  }

  if (btnChoiceMasuk) {
    btnChoiceMasuk.addEventListener('click', () => {
      currentAttendanceType = 'MASUK';
      absensiChoiceModal.classList.add('hidden');
      if (cameraModalTitle) cameraModalTitle.textContent = 'Absensi Masuk - Scan QR';
      cameraScanModal.classList.remove('hidden');
      startInAppCameraScanner();
      lucide.createIcons();
    });
  }

  if (btnChoiceKeluar) {
    btnChoiceKeluar.addEventListener('click', () => {
      currentAttendanceType = 'KELUAR';
      absensiChoiceModal.classList.add('hidden');
      if (cameraModalTitle) cameraModalTitle.textContent = 'Absensi Keluar - Scan QR';
      cameraScanModal.classList.remove('hidden');
      startInAppCameraScanner();
      lucide.createIcons();
    });
  }

  // --- 3. CAMERA SCANNER & SINGLE PHOTO UPLOAD BUTTON ---
  let isStabilizing = false;

  function extractQrData(text) {
    if (!text || typeof text !== 'string') return null;
    let token = null;
    let session = null;

    if (text.startsWith('http://') || text.startsWith('https://')) {
      try {
        const urlObj = new URL(text);
        token = urlObj.searchParams.get('token');
        session = urlObj.searchParams.get('session');
      } catch (e) {}
    }

    if (!token) {
      const match = text.match(/(QR-[A-Z0-9]{4,10})/i);
      if (match) {
        token = match[1].toUpperCase();
      }
    }

    if (!token || !token.startsWith('QR-')) {
      return null;
    }

    return { token: token.toUpperCase(), session: session || null };
  }

  // Tombol Buka File Foto dari Border Kamera (Satu-satunya Tombol Upload)
  if (btnUploadFromScanner) {
    btnUploadFromScanner.addEventListener('click', () => {
      inputQrFile.click();
    });
  }

  // Handler Upload Foto dari Galeri / Storage / Drive
  if (inputQrFile) {
    inputQrFile.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      if (!html5QrScanner) {
        html5QrScanner = new Html5Qrcode("qrScannerView");
      }

      scanStatusText.textContent = 'Menganalisis QR dari gambar...';

      try {
        const decodedText = await html5QrScanner.scanFile(file, false);
        const qrData = extractQrData(decodedText);

        if (!qrData) {
          alert('Gambar terdeteksi, namun bukan merupakan QR Code Presensi yang sah. Pastikan foto memuat QR code presensi.');
          scanStatusText.textContent = 'Arahkan kamera ke QR code proyektor...';
          return;
        }

        playSuccessChime();
        stopInAppCameraScanner();
        cameraScanModal.classList.add('hidden');
        gateModal.classList.add('hidden');
        if (absensiChoiceModal) absensiChoiceModal.classList.add('hidden');

        activeScannedToken = qrData.token;
        activeScannedSession = qrData.session;
        openInlineAttendanceModal(qrData.token);
      } catch (err) {
        console.error('Scan file error:', err);
        alert('Gagal mendeteksi QR Code dari gambar yang dipilih.\n\nTips:\n- Pastikan foto memiliki pencahayaan cukup\n- Pastikan QR Code tidak terpotong atau blur\n- Coba ambil foto lebih dekat ke layar QR');
        scanStatusText.textContent = 'Arahkan kamera ke QR code proyektor...';
      } finally {
        inputQrFile.value = '';
      }
    });
  }

  btnCloseCamera.addEventListener('click', () => {
    stopInAppCameraScanner();
    cameraScanModal.classList.add('hidden');
    absensiChoiceModal.classList.remove('hidden');
  });

  function startInAppCameraScanner() {
    isStabilizing = false;
    scannerStabilizeOverlay.classList.add('hidden');
    cameraViewContainer.classList.remove('border-emerald-500', 'ring-4', 'ring-emerald-500/30');
    scanStatusText.textContent = 'Arahkan kamera ke QR code proyektor...';

    if (typeof Html5Qrcode === 'undefined') {
      alert('Library scanner kamera sedang dimuat, silakan coba lagi sesaat lagi.');
      return;
    }

    if (!html5QrScanner) {
      html5QrScanner = new Html5Qrcode("qrScannerView");
    }

    const config = {
      fps: 12,
      qrbox: { width: 240, height: 240 },
      aspectRatio: 1.0
    };

    html5QrScanner.start(
      { facingMode: "environment" },
      config,
      onQrCodeSuccess,
      () => {}
    ).catch(err => {
      console.error('Camera error:', err);
      alert('Gagal mengakses kamera!\n\nPastikan Anda mengizinkan izin akses kamera pada browser Anda.');
      stopInAppCameraScanner();
      cameraScanModal.classList.add('hidden');
      absensiChoiceModal.classList.remove('hidden');
    });
  }

  function stopInAppCameraScanner() {
    isStabilizing = false;
    if (html5QrScanner && html5QrScanner.isScanning) {
      html5QrScanner.stop().catch(() => {});
    }
  }

  async function onQrCodeSuccess(decodedText) {
    if (isStabilizing) return;

    const qrData = extractQrData(decodedText);
    if (!qrData) {
      return;
    }

    isStabilizing = true;
    playSuccessChime();

    cameraViewContainer.classList.add('border-emerald-500', 'ring-4', 'ring-emerald-500/30');
    stabilizedTokenText.textContent = qrData.token;
    scannerStabilizeOverlay.classList.remove('hidden');
    scanStatusText.textContent = '✅ QR Divalidasi: ' + qrData.token;

    try {
      if (html5QrScanner && html5QrScanner.isScanning) {
        html5QrScanner.pause(true);
      }
    } catch (e) {}

    await new Promise(res => setTimeout(res, 650));

    stopInAppCameraScanner();
    cameraScanModal.classList.add('hidden');

    activeScannedToken = qrData.token;
    activeScannedSession = qrData.session;

    openInlineAttendanceModal(qrData.token);
  }

  function openInlineAttendanceModal(token) {
    inlineTokenBadge.textContent = token;
    inlineFormWrapper.classList.remove('hidden');
    inlineSuccessWrapper.classList.add('hidden');
    attendInlineModal.classList.remove('hidden');

    const today = new Date();
    const todayStr = getLocalDateString(today);
    inlineInputDate.value = todayStr;
    inlineInputDay.value = getIndonesianDayName(today);

    // Setup Type Badge & Notices for MASUK vs KELUAR
    if (inlineTypeBadge) {
      if (currentAttendanceType === 'KELUAR') {
        inlineTypeBadge.textContent = 'KELUAR';
        inlineTypeBadge.className = 'text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 uppercase';
        if (inlineFormTitle) inlineFormTitle.textContent = 'Presensi Keluar (Pulang)';
        if (inlineFormSubtitle) inlineFormSubtitle.textContent = 'Masukkan nama yang sama persis saat Anda Absensi Masuk.';
        if (inlineKeluarNotice) inlineKeluarNotice.classList.remove('hidden');
      } else {
        inlineTypeBadge.textContent = 'MASUK';
        inlineTypeBadge.className = 'text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase';
        if (inlineFormTitle) inlineFormTitle.textContent = 'Isi Identitas Kehadiran';
        if (inlineFormSubtitle) inlineFormSubtitle.textContent = 'Lengkapi nama Anda untuk mencatat kehadiran masuk.';
        if (inlineKeluarNotice) inlineKeluarNotice.classList.add('hidden');
      }
    }

    // Get Device info
    if (window.DeviceFingerprint) {
      const dev = window.DeviceFingerprint.getDeviceInfo();
      inlineDeviceLabel.textContent = dev.deviceInfo;
    }

    inlineInputName.value = '';
    setTimeout(() => inlineInputName.focus(), 150);
    lucide.createIcons();
  }

  btnCancelInline.addEventListener('click', () => {
    attendInlineModal.classList.add('hidden');
    absensiChoiceModal.classList.remove('hidden');
  });

  btnFinishInline.addEventListener('click', () => {
    attendInlineModal.classList.add('hidden');
    gateModal.classList.remove('hidden');
  });

  // Handle Form Presensi Submit (Dengan Dukungan Cloud MQTT & Validasi Absensi Keluar)
  inlineAttendForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = inlineInputName.value.trim();
    const todayStr = getLocalDateString(new Date());
    const dayStr = getIndonesianDayName(new Date());
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour12: false });

    if (!name) {
      alert('Mohon masukkan nama lengkap Anda.');
      return;
    }

    let devId = 'device_client';
    let devInfo = 'Web Client';
    if (window.DeviceFingerprint) {
      const dev = window.DeviceFingerprint.getDeviceInfo();
      devId = dev.deviceId;
      devInfo = dev.deviceInfo;
    }

    btnSubmitInline.disabled = true;
    const origText = btnSubmitInline.innerHTML;
    btnSubmitInline.innerHTML = `
      <div class="inline-block animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
      <span>Memverifikasi Presensi...</span>
    `;

    const reqId = 'req_' + Math.random().toString(36).substring(2, 9);
    const payload = {
      token: activeScannedToken,
      name,
      type: currentAttendanceType || 'MASUK',
      date: todayStr,
      day: dayStr,
      time: timeStr,
      deviceId: devId,
      deviceInfo: devInfo,
      reqId
    };

    // 1. Jika mode server Node.js lokal
    try {
      const res = await fetch('/api/attendance/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok || res.status === 400 || res.status === 403 || res.status === 409) {
        const data = await res.json();
        btnSubmitInline.disabled = false;
        btnSubmitInline.innerHTML = origText;
        if (!data.success) {
          alert('Presensi Ditolak:\n\n' + data.error);
          return;
        }
        renderInlineSuccess(data.attendance);
        return;
      }
    } catch (e) {}

    // 2. Jika ada session ID (Scan dari HP peserta ke proyektor laptop via Cloud MQTT)
    if (activeScannedSession && typeof mqtt !== 'undefined') {
      const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
      const userClientId = 'sqr_usr_' + Math.random().toString(16).substring(2, 8);
      let userMqtt = null;
      let handled = false;

      try {
        userMqtt = mqtt.connect(brokerUrl, {
          clientId: userClientId,
          clean: true,
          connectTimeout: 5000,
          reconnectPeriod: 2000
        });

        const submitTopic = `smartqr/${activeScannedSession}/submit`;
        const respTopic = `smartqr/${activeScannedSession}/resp/${reqId}`;

        userMqtt.on('connect', () => {
          userMqtt.subscribe(respTopic, () => {
            userMqtt.publish(submitTopic, JSON.stringify(payload));
          });
        });

        userMqtt.on('message', (topic, message) => {
          if (topic === respTopic && !handled) {
            handled = true;
            btnSubmitInline.disabled = false;
            btnSubmitInline.innerHTML = origText;
            try {
              const res = JSON.parse(message.toString());
              if (!res.success) {
                alert('Presensi Ditolak:\n\n' + res.error);
                return;
              }
              renderInlineSuccess(res.attendance);
            } catch (err) {
              alert('Gagal memproses jawaban dari admin.');
            } finally {
              try { userMqtt.end(); } catch(e) {}
            }
          }
        });

        setTimeout(() => {
          if (!handled) {
            handled = true;
            try { userMqtt.end(); } catch(e) {}
            const fallbackResult = processAttendanceSubmission(payload);
            btnSubmitInline.disabled = false;
            btnSubmitInline.innerHTML = origText;
            if (!fallbackResult.success) {
              alert('Presensi Ditolak:\n\n' + fallbackResult.error);
              return;
            }
            renderInlineSuccess(fallbackResult.attendance);
          }
        }, 6500);

        return;
      } catch (err) {
        console.warn('MQTT user submit failed, fallback to local:', err);
      }
    }

    // 3. Fallback: Local Engine (Satu browser / device yang sama)
    const result = processAttendanceSubmission(payload);
    btnSubmitInline.disabled = false;
    btnSubmitInline.innerHTML = origText;

    if (!result.success) {
      alert('Presensi Ditolak:\n\n' + result.error);
      return;
    }

    renderInlineSuccess(result.attendance);
  });

  function renderInlineSuccess(record) {
    inlineFormWrapper.classList.add('hidden');
    inlineSuccessWrapper.classList.remove('hidden');

    inlineSuccName.textContent = record.name;
    inlineSuccDate.textContent = `${record.day}, ${record.date}`;
    inlineSuccTime.textContent = `${record.time} WIB (${record.type || 'MASUK'})`;

    setupInlineGoogleCalendar(record);
    lucide.createIcons();
  }

  function setupInlineGoogleCalendar({ name, date, day, time, token, type }) {
    const isKeluar = (type || currentAttendanceType) === 'KELUAR';
    const [year, month, dayNum] = date.split('-');
    const [hour, minute, second] = (time || '08:00:00').split(':');

    const startDate = new Date(year, month - 1, dayNum, parseInt(hour || 0), parseInt(minute || 0), parseInt(second || 0));
    const endDate = new Date(startDate.getTime() + (60 * 60 * 1000));

    function formatGCalDateTime(d) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    const startFormatted = formatGCalDateTime(startDate);
    const endFormatted = formatGCalDateTime(endDate);

    const title = `Presensi ${isKeluar ? 'Keluar (Pulang)' : 'Masuk'}: ${name}`;
    const description = `Bukti Kehadiran Resmi Smart QR Attendance.\n\nJenis: Presensi ${isKeluar ? 'Keluar (Pulang)' : 'Masuk (Kehadiran)'}\nNama: ${name}\nHari: ${day}\nTanggal: ${date}\nJam: ${time} WIB\nKode Token: ${token}\nStatus: Hadir Terverifikasi`;
    const location = `Sistem Presensi Smart QR`;

    const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startFormatted}/${endFormatted}&details=${encodeURIComponent(description)}&location=${encodeURIComponent(location)}`;
    inlineBtnGCal.href = gcalUrl;

    inlineBtnIcs.onclick = () => {
      const nowIso = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Smart QR Attendance Tool//ID',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${token}-${Date.now()}@smartqr.local`,
        `DTSTAMP:${nowIso}`,
        `DTSTART:${startFormatted}`,
        `DTEND:${endFormatted}`,
        `SUMMARY:${title}`,
        `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
        `LOCATION:${location}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.setAttribute('download', `Presensi_${isKeluar ? 'Keluar' : 'Masuk'}-${name.replace(/\s+/g, '_')}-${date}.ics`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };
  }

  // --- 4. ADMIN DASHBOARD ENGINE ---
  let adminInitialized = false;
  function initAdminDashboard() {
    if (adminInitialized) return;
    adminInitialized = true;

    initTabs();
    initSubTabs();
    initClock();
    initCloudMqtt();
    bootAdminQr();
    loadAuditData();
    loadAttendanceData();
    lucide.createIcons();
  }

  function initTabs() {
    const tabs = [
      { btn: tabBtnProjector, view: viewProjector },
      { btn: tabBtnAudit, view: viewAudit, onShow: loadAuditData },
      { btn: tabBtnAttendance, view: viewAttendance, onShow: loadAttendanceData }
    ];

    tabs.forEach(t => {
      t.btn.addEventListener('click', () => {
        tabs.forEach(item => {
          item.btn.classList.remove('active', 'bg-indigo-600', 'text-white', 'shadow');
          item.btn.classList.add('text-slate-400');
          item.view.classList.add('hidden');
        });

        t.btn.classList.add('active', 'bg-indigo-600', 'text-white', 'shadow');
        t.btn.classList.remove('text-slate-400');
        t.view.classList.remove('hidden');

        if (t.onShow) t.onShow();
        lucide.createIcons();
      });
    });
  }

  function initSubTabs() {
    function updateSubTabButtons() {
      [subTabUtama, subTabMasuk, subTabKeluar].forEach(btn => {
        if (!btn) return;
        btn.classList.remove('active', 'bg-indigo-600', 'bg-emerald-600', 'bg-rose-600', 'text-white', 'shadow-lg');
        btn.classList.add('text-slate-400', 'bg-slate-900', 'border', 'border-slate-800');
      });

      if (activeSubTab === 'UTAMA' && subTabUtama) {
        subTabUtama.classList.add('active', 'bg-indigo-600', 'text-white', 'shadow-lg');
        subTabUtama.classList.remove('text-slate-400', 'bg-slate-900');
      } else if (activeSubTab === 'MASUK' && subTabMasuk) {
        subTabMasuk.classList.add('active', 'bg-emerald-600', 'text-white', 'shadow-lg');
        subTabMasuk.classList.remove('text-slate-400', 'bg-slate-900');
      } else if (activeSubTab === 'KELUAR' && subTabKeluar) {
        subTabKeluar.classList.add('active', 'bg-rose-600', 'text-white', 'shadow-lg');
        subTabKeluar.classList.remove('text-slate-400', 'bg-slate-900');
      }
    }

    if (subTabUtama) {
      subTabUtama.addEventListener('click', () => {
        activeSubTab = 'UTAMA';
        updateSubTabButtons();
        loadAttendanceData();
      });
    }

    if (subTabMasuk) {
      subTabMasuk.addEventListener('click', () => {
        activeSubTab = 'MASUK';
        updateSubTabButtons();
        loadAttendanceData();
      });
    }

    if (subTabKeluar) {
      subTabKeluar.addEventListener('click', () => {
        activeSubTab = 'KELUAR';
        updateSubTabButtons();
        loadAttendanceData();
      });
    }
  }

  function initClock() {
    function update() {
      const now = new Date();
      if (liveClock) {
        liveClock.textContent = now.toLocaleTimeString('id-ID', { hour12: false });
      }
      if (liveDate) {
        liveDate.textContent = now.toLocaleDateString('id-ID', {
          weekday: 'long',
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
      }
    }
    update();
    setInterval(update, 1000);
  }

  function generateRandomToken() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `QR-${code}`;
  }

  function renderActiveQrCode(token) {
    currentActiveToken = token;
    activeTokenText.textContent = token;

    const currentUrl = new URL(window.location.href);
    let basePath = currentUrl.pathname;
    if (basePath.endsWith('index.html')) {
      basePath = basePath.replace(/index\.html$/, 'attend.html');
    } else if (basePath.endsWith('/')) {
      basePath = basePath + 'attend.html';
    } else {
      basePath = basePath + '/attend.html';
    }

    const attendUrl = `${currentUrl.origin}${basePath}?token=${encodeURIComponent(token)}&session=${encodeURIComponent(adminSessionId)}`;
    mobileAccessUrl.textContent = attendUrl;

    qrOverlayLoading.classList.remove('hidden');
    qrImage.classList.remove('hidden');
    qrCanvasContainer.classList.add('hidden');

    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(attendUrl)}`;
    qrImage.src = qrApiUrl;

    qrImage.onload = () => {
      qrOverlayLoading.classList.add('hidden');
    };

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

  // --- ATTENDANCE VERIFICATION & RECORD ENGINE ---
  function processAttendanceSubmission({ token, name, date, day, time, deviceId, deviceInfo, type }) {
    const attendType = (type || currentAttendanceType || 'MASUK').toUpperCase();
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

    // Regional Time Lock Validation (Must be today)
    const localNow = new Date();
    const todayRegional = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
    if (date && date !== todayRegional) {
      return {
        success: false,
        error: `Kunci Waktu Regional Aktif: Presensi hanya berlaku untuk tanggal hari ini (${todayRegional}). Anda tidak dapat melakukan presensi untuk tanggal sebelum atau sesudah!`
      };
    }

    const attendances = getStoredAttendances();
    const targetDate = todayRegional;

    // 1. VALIDASI ABSENSI MASUK
    if (attendType === 'MASUK') {
      const existingMasuk = attendances.find(a => a.device_id === deviceId && a.date === targetDate && (a.type === 'MASUK' || !a.type));
      if (existingMasuk) {
        return {
          success: false,
          error: `Perangkat ini sudah tercatat melakukan Absensi Masuk hari ini atas nama "${existingMasuk.name}" pada pukul ${existingMasuk.time} WIB. 1 perangkat hanya bisa absen masuk 1 kali per hari!`
        };
      }
    }

    // 2. VALIDASI KHUSUS ABSENSI KELUAR
    if (attendType === 'KELUAR') {
      // a. Wajib sudah tercatat di Absensi Masuk hari ini
      const masukRecord = attendances.find(a => a.device_id === deviceId && a.date === targetDate && (a.type === 'MASUK' || !a.type));
      if (!masukRecord) {
        return {
          success: false,
          error: `Presensi Keluar Ditolak:\n\nPerangkat Anda belum tercatat melakukan Absensi Masuk hari ini. Silakan lakukan Absensi Masuk terlebih dahulu!`
        };
      }

      // b. Nama wajib sama dengan nama saat Absensi Masuk
      if (masukRecord.name.trim().toLowerCase() !== name.trim().toLowerCase()) {
        return {
          success: false,
          error: `Presensi Keluar Ditolak:\n\nNama ("${name}") tidak cocok dengan data nama saat Absensi Masuk ("${masukRecord.name}"). Harap gunakan nama yang sama persis!`
        };
      }

      // c. Tidak boleh double keluar
      const existingKeluar = attendances.find(a => a.device_id === deviceId && a.date === targetDate && a.type === 'KELUAR');
      if (existingKeluar) {
        return {
          success: false,
          error: `Perangkat ini sudah tercatat melakukan Absensi Keluar hari ini pada pukul ${existingKeluar.time} WIB. 1 perangkat hanya bisa absen keluar 1 kali!`
        };
      }
    }

    // Mark token as USED
    const now = new Date().toISOString();
    targetToken.status = 'USED';
    targetToken.used_at = now;
    targetToken.used_by_name = name;
    targetToken.device_id = deviceId;
    targetToken.type = attendType;
    saveTokens(tokens);

    // Save Attendance Record
    const record = {
      id: Date.now(),
      token,
      name,
      type: attendType,
      date: targetDate,
      day: day || getIndonesianDayName(localNow),
      time: time || localNow.toLocaleTimeString('id-ID', { hour12: false }),
      device_id: deviceId,
      device_info: deviceInfo || 'Perangkat Pengguna',
      created_at: now
    };
    attendances.unshift(record);
    saveAttendances(attendances);

    // Rotate to new active token immediately!
    createNewActiveToken();

    // Trigger Success Audio & Visuals
    playSuccessChime();
    triggerScanFlash();
    showToast(`Presensi ${attendType === 'KELUAR' ? 'Keluar' : 'Masuk'} Berhasil!`, `${name} telah diabsen.`);
    addLiveActivity(record);
    loadAuditData();
    loadAttendanceData();

    return { success: true, attendance: record };
  }

  // --- 5. CLOUD MQTT OVER WSS ---
  function initCloudMqtt() {
    if (typeof mqtt === 'undefined') return;

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
        syncBadgeText.textContent = 'Cloud Sync Aktif';
        const submitTopic = `smartqr/${adminSessionId}/submit`;
        mqttClient.subscribe(submitTopic);
      });

      mqttClient.on('message', (topic, message) => {
        try {
          const payload = JSON.parse(message.toString());
          if (topic === `smartqr/${adminSessionId}/submit`) {
            const result = processAttendanceSubmission(payload);
            if (payload.reqId) {
              const respTopic = `smartqr/${adminSessionId}/resp/${payload.reqId}`;
              mqttClient.publish(respTopic, JSON.stringify(result));
            }
          }
        } catch (e) {}
      });

      mqttClient.on('error', () => {
        syncBadgeText.textContent = 'Offline (Lokal Aktif)';
      });
    } catch (e) {
      syncBadgeText.textContent = 'Offline (Lokal Aktif)';
    }
  }

  function triggerScanFlash() {
    qrCardBox.classList.add('scan-flash');
    setTimeout(() => qrCardBox.classList.remove('scan-flash'), 600);
  }

  function showToast(title, desc) {
    if (!toastNotification) return;
    toastText.textContent = title;
    toastDetail.textContent = desc;
    toastNotification.classList.remove('translate-x-full', 'pointer-events-none');
    setTimeout(() => {
      toastNotification.classList.add('translate-x-full', 'pointer-events-none');
    }, 4500);
  }

  function addLiveActivity(record) {
    const emptyState = liveActivityList.querySelector('.text-center');
    if (emptyState) emptyState.remove();

    const isKeluar = record.type === 'KELUAR';
    const typeBadge = isKeluar
      ? '<span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">KELUAR</span>'
      : '<span class="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">MASUK</span>';

    const item = document.createElement('div');
    item.className = 'p-3 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between text-xs animate-fadeIn';
    item.innerHTML = `
      <div class="flex items-center gap-2.5">
        <div class="w-7 h-7 rounded-lg ${isKeluar ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'} flex items-center justify-center font-bold text-xs">
          ${escapeHtml(record.name.charAt(0).toUpperCase())}
        </div>
        <div>
          <div class="font-bold text-white text-xs flex items-center gap-1.5">
            <span>${escapeHtml(record.name)}</span>
            ${typeBadge}
          </div>
          <div class="text-[10px] text-slate-400 font-mono">${escapeHtml(record.token)}</div>
        </div>
      </div>
      <div class="text-right">
        <div class="${isKeluar ? 'text-rose-400' : 'text-emerald-400'} font-mono font-semibold">${escapeHtml(record.time)}</div>
        <div class="text-[10px] text-slate-500">${escapeHtml(record.device_info || 'Mobile')}</div>
      </div>
    `;

    liveActivityList.insertBefore(item, liveActivityList.firstChild);
    const count = liveActivityList.children.length;
    liveFeedCount.textContent = `${count} aktivitas`;
  }

  function loadAuditData() {
    const tokens = getStoredTokens();
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

    auditTableBody.innerHTML = tokens.slice(0, 50).map(t => {
      let badge = '';
      if (t.status === 'ACTIVE') {
        badge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">AKTIF</span>';
      } else if (t.status === 'USED') {
        badge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">TERPAKAI</span>';
      } else {
        badge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">KEDALUWARSA</span>';
      }

      const typeLabel = t.type ? ` <span class="text-[9px] font-mono px-1 rounded ${t.type === 'KELUAR' ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'}">${t.type}</span>` : '';

      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="py-3 px-4">${badge}${typeLabel}</td>
          <td class="py-3 px-4 font-mono text-indigo-300 font-bold">${escapeHtml(t.token)}</td>
          <td class="py-3 px-4 font-semibold text-white">${escapeHtml(t.used_by_name || '-')}</td>
          <td class="py-3 px-4 font-mono text-[11px] text-slate-400 truncate max-w-[150px]">${escapeHtml(t.device_id || '-')}</td>
          <td class="py-3 px-4 text-slate-400 text-[11px]">${t.created_at ? new Date(t.created_at).toLocaleTimeString('id-ID') : '-'}</td>
          <td class="py-3 px-4 text-slate-400 text-[11px]">${t.used_at ? new Date(t.used_at).toLocaleTimeString('id-ID') : '-'}</td>
        </tr>
      `;
    }).join('');
  }

  // --- 6. MULTI-TAB ATTENDANCE DATA LOADER (UTAMA, MASUK, KELUAR) ---
  function loadAttendanceData() {
    const all = getStoredAttendances();
    const todayStr = getLocalDateString(new Date());

    // Calculate metrics
    const masukToday = all.filter(a => a.date === todayStr && (a.type === 'MASUK' || !a.type));
    const keluarToday = all.filter(a => a.date === todayStr && a.type === 'KELUAR');

    // Kehadiran lengkap: device yang sudah masuk dan keluar pada hari ini
    const masukDevices = new Set(masukToday.map(a => a.device_id));
    const lengkapToday = keluarToday.filter(k => masukDevices.has(k.device_id)).length;

    if (metricMasukToday) metricMasukToday.textContent = masukToday.length;
    if (metricKeluarToday) metricKeluarToday.textContent = keluarToday.length;
    if (metricLengkapToday) metricLengkapToday.textContent = lengkapToday;
    if (metricTotalRecords) metricTotalRecords.textContent = all.length;

    const sTerm = (filterSearch.value || '').toLowerCase();
    const fDate = filterDate.value || '';

    let records = all.filter(a => {
      const matchSearch = !sTerm || a.name.toLowerCase().includes(sTerm) || (a.device_info || '').toLowerCase().includes(sTerm) || a.token.toLowerCase().includes(sTerm);
      const matchDate = !fDate || a.date === fDate;
      return matchSearch && matchDate;
    });

    if (activeSubTab === 'MASUK') {
      // TAB 2: ABSENSI MASUK
      attendanceTableHead.innerHTML = `
        <tr>
          <th class="py-3 px-4 w-12 text-center">#</th>
          <th class="py-3 px-4">Nama Lengkap</th>
          <th class="py-3 px-4">Hari & Tanggal</th>
          <th class="py-3 px-4">Jam Masuk</th>
          <th class="py-3 px-4">Token QR</th>
          <th class="py-3 px-4">Perangkat</th>
        </tr>
      `;
      const filtered = records.filter(a => a.type === 'MASUK' || !a.type);
      if (filtered.length === 0) {
        attendanceTableBody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-500">Tidak ada data Absensi Masuk.</td></tr>`;
        return;
      }
      attendanceTableBody.innerHTML = filtered.map((a, idx) => `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="py-3 px-4 text-center text-slate-500 font-mono">${idx + 1}</td>
          <td class="py-3 px-4 font-bold text-white flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>${escapeHtml(a.name)}</span>
          </td>
          <td class="py-3 px-4 text-slate-300">${escapeHtml(a.day)}, ${escapeHtml(a.date)}</td>
          <td class="py-3 px-4 font-mono text-emerald-400 font-semibold">${escapeHtml(a.time)} WIB</td>
          <td class="py-3 px-4 font-mono text-indigo-300 text-xs">${escapeHtml(a.token)}</td>
          <td class="py-3 px-4 text-slate-400 text-xs">${escapeHtml(a.device_info || 'Perangkat')}</td>
        </tr>
      `).join('');

    } else if (activeSubTab === 'KELUAR') {
      // TAB 3: ABSENSI KELUAR
      attendanceTableHead.innerHTML = `
        <tr>
          <th class="py-3 px-4 w-12 text-center">#</th>
          <th class="py-3 px-4">Nama Lengkap</th>
          <th class="py-3 px-4">Hari & Tanggal</th>
          <th class="py-3 px-4">Jam Keluar</th>
          <th class="py-3 px-4">Token QR</th>
          <th class="py-3 px-4">Perangkat</th>
        </tr>
      `;
      const filtered = records.filter(a => a.type === 'KELUAR');
      if (filtered.length === 0) {
        attendanceTableBody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-500">Tidak ada data Absensi Keluar.</td></tr>`;
        return;
      }
      attendanceTableBody.innerHTML = filtered.map((a, idx) => `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="py-3 px-4 text-center text-slate-500 font-mono">${idx + 1}</td>
          <td class="py-3 px-4 font-bold text-white flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-rose-400"></span>
            <span>${escapeHtml(a.name)}</span>
          </td>
          <td class="py-3 px-4 text-slate-300">${escapeHtml(a.day)}, ${escapeHtml(a.date)}</td>
          <td class="py-3 px-4 font-mono text-rose-400 font-semibold">${escapeHtml(a.time)} WIB</td>
          <td class="py-3 px-4 font-mono text-indigo-300 text-xs">${escapeHtml(a.token)}</td>
          <td class="py-3 px-4 text-slate-400 text-xs">${escapeHtml(a.device_info || 'Perangkat')}</td>
        </tr>
      `).join('');

    } else {
      // TAB 1: ABSENSI UTAMA (REKAP TERPADU MASUK + KELUAR)
      attendanceTableHead.innerHTML = `
        <tr>
          <th class="py-3 px-4 w-12 text-center">#</th>
          <th class="py-3 px-4">Nama Lengkap</th>
          <th class="py-3 px-4">Hari & Tanggal</th>
          <th class="py-3 px-4">Jam Masuk</th>
          <th class="py-3 px-4">Jam Keluar</th>
          <th class="py-3 px-4">Status</th>
          <th class="py-3 px-4">Perangkat</th>
        </tr>
      `;

      // Kelompokkan berdasarkan device_id dan tanggal
      const groupMap = new Map();
      records.forEach(rec => {
        const key = `${rec.device_id}_${rec.date}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            name: rec.name,
            day: rec.day,
            date: rec.date,
            device_info: rec.device_info,
            device_id: rec.device_id,
            masuk: null,
            keluar: null
          });
        }
        const item = groupMap.get(key);
        if (rec.type === 'KELUAR') {
          item.keluar = rec;
        } else {
          item.masuk = rec;
          item.name = rec.name; // prioritaskan nama saat absen masuk
        }
      });

      const paired = Array.from(groupMap.values());
      if (paired.length === 0) {
        attendanceTableBody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-500">Belum ada data absensi utama.</td></tr>`;
        return;
      }

      attendanceTableBody.innerHTML = paired.map((p, idx) => {
        const hasMasuk = !!p.masuk;
        const hasKeluar = !!p.keluar;
        let badgeStatus = '';

        if (hasMasuk && hasKeluar) {
          badgeStatus = '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">LENGKAP</span>';
        } else if (hasMasuk) {
          badgeStatus = '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">BELUM KELUAR</span>';
        } else {
          badgeStatus = '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">HANYA KELUAR</span>';
        }

        return `
          <tr class="hover:bg-slate-800/40 transition">
            <td class="py-3 px-4 text-center text-slate-500 font-mono">${idx + 1}</td>
            <td class="py-3 px-4 font-bold text-white">${escapeHtml(p.name)}</td>
            <td class="py-3 px-4 text-slate-300">${escapeHtml(p.day)}, ${escapeHtml(p.date)}</td>
            <td class="py-3 px-4 font-mono text-emerald-400 font-semibold">${hasMasuk ? escapeHtml(p.masuk.time) + ' WIB' : '<span class="text-slate-500">-</span>'}</td>
            <td class="py-3 px-4 font-mono text-rose-400 font-semibold">${hasKeluar ? escapeHtml(p.keluar.time) + ' WIB' : '<span class="text-slate-500">-</span>'}</td>
            <td class="py-3 px-4">${badgeStatus}</td>
            <td class="py-3 px-4 text-slate-400 text-xs">${escapeHtml(p.device_info || 'Perangkat')}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // Copy URL & Buttons
  btnCopyUrl.addEventListener('click', () => {
    const url = mobileAccessUrl.textContent;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Link Disalin', 'URL presensi siap dibagikan.');
    });
  });

  btnRefreshQr.addEventListener('click', () => {
    createNewActiveToken();
    showToast('QR Diperbarui', 'Kode QR baru telah dibuat.');
  });

  btnRefreshAudit.addEventListener('click', () => {
    loadAuditData();
    showToast('Log Disinkronkan', 'Data riwayat QR terbaru dimuat.');
  });

  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  filterSearch.addEventListener('input', loadAttendanceData);
  filterDate.addEventListener('change', loadAttendanceData);
  btnResetFilter.addEventListener('click', () => {
    filterSearch.value = '';
    filterDate.value = '';
    loadAttendanceData();
  });

  // Export CSV dengan dukungan format multi-tab (Utama / Masuk / Keluar)
  btnExportCsv.addEventListener('click', () => {
    const records = getStoredAttendances();
    if (records.length === 0) {
      alert('Belum ada data presensi untuk diekspor!');
      return;
    }

    const dateStr = new Date().toISOString().split('T')[0];

    if (activeSubTab === 'UTAMA') {
      const headers = ['No', 'Nama Lengkap', 'Hari', 'Tanggal', 'Jam Masuk', 'Jam Keluar', 'Status', 'Device ID', 'Device Info'];
      const groupMap = new Map();
      records.forEach(rec => {
        const key = `${rec.device_id}_${rec.date}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            name: rec.name,
            day: rec.day,
            date: rec.date,
            device_info: rec.device_info,
            device_id: rec.device_id,
            masuk: null,
            keluar: null
          });
        }
        const item = groupMap.get(key);
        if (rec.type === 'KELUAR') item.keluar = rec;
        else item.masuk = rec;
      });

      const paired = Array.from(groupMap.values());
      const rows = paired.map((p, idx) => [
        idx + 1,
        `"${p.name.replace(/"/g, '""')}"`,
        `"${p.day}"`,
        `"${p.date}"`,
        `"${p.masuk ? p.masuk.time : '-'}"`,
        `"${p.keluar ? p.keluar.time : '-'}"`,
        `"${(p.masuk && p.keluar) ? 'LENGKAP' : (p.masuk ? 'BELUM KELUAR' : 'HANYA KELUAR')}"`,
        `"${p.device_id}"`,
        `"${(p.device_info || '').replace(/"/g, '""')}"`
      ]);
      downloadCsv(headers, rows, `Rekap_Presensi_Utama_${dateStr}.csv`);
    } else {
      const typeFilter = activeSubTab;
      const filtered = records.filter(a => typeFilter === 'KELUAR' ? a.type === 'KELUAR' : (a.type === 'MASUK' || !a.type));
      const headers = ['No', 'Jenis Presensi', 'Nama Lengkap', 'Hari', 'Tanggal', 'Jam', 'Token QR', 'Device ID', 'Device Info'];
      const rows = filtered.map((att, idx) => [
        idx + 1,
        `"${att.type || 'MASUK'}"`,
        `"${att.name.replace(/"/g, '""')}"`,
        `"${att.day}"`,
        `"${att.date}"`,
        `"${att.time}"`,
        `"${att.token}"`,
        `"${att.device_id}"`,
        `"${(att.device_info || '').replace(/"/g, '""')}"`
      ]);
      downloadCsv(headers, rows, `Rekap_Presensi_${typeFilter}_${dateStr}.csv`);
    }
  });

  function downloadCsv(headers, rows, filename) {
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Reset Data
  btnResetData.addEventListener('click', async () => {
    const confirmation = confirm('PERINGATAN:\n\nApakah Anda yakin ingin MENGHAPUS SEMUA data presensi dan riwayat QR?\nTindakan ini tidak dapat dibatalkan.');
    if (!confirmation) return;

    saveTokens([]);
    saveAttendances([]);
    createNewActiveToken();
    loadAuditData();
    loadAttendanceData();
    showToast('Data Direset', 'Semua data telah dikosongkan.');
  });

  function bootAdminQr() {
    const tokens = getStoredTokens();
    const active = tokens.find(t => t.status === 'ACTIVE');
    if (active) {
      renderActiveQrCode(active.token);
    } else {
      createNewActiveToken();
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- BOOT ENTRYPOINT ---
  checkAuthStatus();
});
