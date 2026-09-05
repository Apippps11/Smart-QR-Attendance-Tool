/**
 * Smart QR Attendance System - Admin Dashboard & Controller (admin.js)
 * Fitur:
 * 1. Keamanan Layar Admin Multi-Browser & Anti-Bypass iOS Safari (BFCache Hard-Lock)
 * 2. Kunci Tanggal Regional Mutlak (Anti-Tamper di iOS/Android)
 * 3. Live Camera Scanning Murni (Upload Foto Dihapus)
 * 4. Riwayat Presensi Permanen (Data Hari Sebelumnya Tidak Pernah Hilang)
 * 5. Filter Riwayat Lengkap: Semua Waktu, Tahun, Bulan, Mingguan, Harian, dan Pencarian
 * 6. Tampilan Data Multi-Tab: Absensi Utama (Rekap Masuk & Keluar), Masuk, Keluar
 * 7. Real-time Multi-Provider Cloud Sync (MQTT WSS) & Export CSV
 */

(function () {
  'use strict';

  // Storage Keys
  const STORAGE_QR_TOKENS = 'sqr_qr_tokens';
  const STORAGE_ATTENDANCES = 'sqr_attendances';
  const STORAGE_SESSION = 'sqr_admin_session_id';
  const STORAGE_AUTH = 'sqr_admin_authenticated';

  // Admin Credentials
  const ADMIN_USER = 'Admin1118';
  const ADMIN_PASS = 'AFIFweb18';

  // State
  let currentActiveToken = null;
  let currentAttendanceType = 'MASUK'; // 'MASUK' | 'KELUAR'
  let activeSubTab = 'UTAMA'; // 'UTAMA' | 'MASUK' | 'KELUAR'
  let activePeriodFilter = 'ALL'; // 'ALL' | 'TODAY' | 'WEEK' | 'MONTH'
  let mqttClient = null;
  let html5QrScanner = null;
  let activeScannedToken = null;
  let activeScannedSession = null;
  let adminInitialized = false;

  // Session ID for MQTT Sync
  let adminSessionId = localStorage.getItem(STORAGE_SESSION);
  if (!adminSessionId) {
    adminSessionId = 'ses_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).substring(4);
    localStorage.setItem(STORAGE_SESSION, adminSessionId);
  }

  // --- STORAGE HELPERS ---
  function getStoredTokens() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_QR_TOKENS)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveTokens(tokens) {
    try {
      localStorage.setItem(STORAGE_QR_TOKENS, JSON.stringify(tokens));
    } catch (e) {}
  }

  function getStoredAttendances() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_ATTENDANCES)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveAttendances(records) {
    try {
      localStorage.setItem(STORAGE_ATTENDANCES, JSON.stringify(records));
    } catch (e) {}
  }

  // --- DATE & TIME HELPERS ---
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

  function getIndonesianMonthName(monthIdx) {
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return months[monthIdx];
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

  // Audio Chime
  function playSuccessChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.45);
    } catch (e) {}
  }

  // --- HARD AUTHENTICATION & SECURITY CONTROLLER ---
  function checkAuthStatus() {
    const gateModal = document.getElementById('gateModal');
    const adminLoginModal = document.getElementById('adminLoginModal');
    const absensiChoiceModal = document.getElementById('absensiChoiceModal');
    const cameraScanModal = document.getElementById('cameraScanModal');
    const attendInlineModal = document.getElementById('attendInlineModal');
    const adminDashboardWrapper = document.getElementById('adminDashboardWrapper');

    if (!adminDashboardWrapper) return;

    let isAuth = false;
    try {
      isAuth = sessionStorage.getItem(STORAGE_AUTH) === 'true';
    } catch (e) {
      isAuth = false;
    }

    if (isAuth) {
      // Authenticated Admin -> Reveal Dashboard
      adminDashboardWrapper.classList.remove('locked', 'hidden');
      adminDashboardWrapper.style.removeProperty('display');
      if (gateModal) gateModal.classList.add('hidden');
      if (adminLoginModal) adminLoginModal.classList.add('hidden');
      if (absensiChoiceModal) absensiChoiceModal.classList.add('hidden');
      if (cameraScanModal) cameraScanModal.classList.add('hidden');
      if (attendInlineModal) attendInlineModal.classList.add('hidden');
      initAdminDashboard();
    } else {
      // Unauthenticated -> Hard Lock Dashboard & Show Gate Modal
      adminDashboardWrapper.classList.add('locked', 'hidden');
      adminDashboardWrapper.style.setProperty('display', 'none', 'important');
      if (gateModal) gateModal.classList.remove('hidden');
      if (adminLoginModal) adminLoginModal.classList.add('hidden');
      if (absensiChoiceModal) absensiChoiceModal.classList.add('hidden');
      if (cameraScanModal) cameraScanModal.classList.add('hidden');
      if (attendInlineModal) attendInlineModal.classList.add('hidden');
    }
  }

  // Anti-Bypass for iOS Safari & Firefox (Back-Forward Cache / BFCache)
  window.addEventListener('pageshow', () => {
    checkAuthStatus();
  });

  // --- DOM READY INITIALIZER ---
  document.addEventListener('DOMContentLoaded', () => {
    // Run auth check immediately
    checkAuthStatus();

    // Set Regional Date for Gate & Choice modals immediately
    const today = new Date();
    const fullDateText = `${getIndonesianDayName(today)}, ${today.getDate()} ${getIndonesianMonthName(today.getMonth())} ${today.getFullYear()}`;
    const gateRegionalDate = document.getElementById('gateRegionalDate');
    const choiceRegionalDate = document.getElementById('choiceRegionalDate');
    if (gateRegionalDate) gateRegionalDate.textContent = fullDateText;
    if (choiceRegionalDate) choiceRegionalDate.textContent = fullDateText;

    // DOM Elements
    const gateModal = document.getElementById('gateModal');
    const btnOpenAdminLogin = document.getElementById('btnOpenAdminLogin');
    const btnOpenScan = document.getElementById('btnOpenScan');

    const absensiChoiceModal = document.getElementById('absensiChoiceModal');
    const btnChoiceMasuk = document.getElementById('btnChoiceMasuk');
    const btnChoiceKeluar = document.getElementById('btnChoiceKeluar');
    const btnCancelChoice = document.getElementById('btnCancelChoice');

    const adminLoginModal = document.getElementById('adminLoginModal');
    const formAdminLogin = document.getElementById('formAdminLogin');
    const inputUsername = document.getElementById('inputUsername');
    const inputPassword = document.getElementById('inputPassword');
    const btnTogglePassword = document.getElementById('btnTogglePassword');
    const eyeIcon = document.getElementById('eyeIcon');
    const loginError = document.getElementById('loginError');
    const btnCancelLogin = document.getElementById('btnCancelLogin');
    const btnLogoutAdmin = document.getElementById('btnLogoutAdmin');

    const cameraScanModal = document.getElementById('cameraScanModal');
    const cameraModalTitle = document.getElementById('cameraModalTitle');
    const btnCloseCamera = document.getElementById('btnCloseCamera');
    const cameraViewContainer = document.getElementById('cameraViewContainer');
    const scanStatusText = document.getElementById('scanStatusText');
    const scannerStabilizeOverlay = document.getElementById('scannerStabilizeOverlay');
    const stabilizedTokenText = document.getElementById('stabilizedTokenText');

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
    const inlineDisplayDate = document.getElementById('inlineDisplayDate');
    const inlineDeviceLabel = document.getElementById('inlineDeviceLabel');
    const btnCancelInline = document.getElementById('btnCancelInline');
    const btnSubmitInline = document.getElementById('btnSubmitInline');

    const inlineSuccName = document.getElementById('inlineSuccName');
    const inlineSuccDate = document.getElementById('inlineSuccDate');
    const inlineSuccTime = document.getElementById('inlineSuccTime');
    const inlineBtnGCal = document.getElementById('inlineBtnGCal');
    const inlineBtnIcs = document.getElementById('inlineBtnIcs');
    const btnFinishInline = document.getElementById('btnFinishInline');

    // Helper: Atur visibilitas karakter password
    function setPasswordVisibility(show) {
      if (!inputPassword) return;
      inputPassword.type = show ? 'text' : 'password';
      const eyeIconOpen = document.getElementById('eyeIconOpen');
      const eyeIconClosed = document.getElementById('eyeIconClosed');
      if (eyeIconOpen && eyeIconClosed) {
        if (show) {
          eyeIconOpen.classList.add('hidden');
          eyeIconClosed.classList.remove('hidden');
        } else {
          eyeIconOpen.classList.remove('hidden');
          eyeIconClosed.classList.add('hidden');
        }
      }
      if (btnTogglePassword) {
        if (show) {
          btnTogglePassword.classList.add('text-indigo-400', 'bg-indigo-500/20');
          btnTogglePassword.classList.remove('text-zinc-400');
          btnTogglePassword.setAttribute('title', 'Sembunyikan Password');
          btnTogglePassword.setAttribute('aria-label', 'Sembunyikan Password');
        } else {
          btnTogglePassword.classList.remove('text-indigo-400', 'bg-indigo-500/20');
          btnTogglePassword.classList.add('text-zinc-400');
          btnTogglePassword.setAttribute('title', 'Tekan atau tahan untuk melihat password');
          btnTogglePassword.setAttribute('aria-label', 'Tekan atau tahan untuk melihat password');
        }
      }
    }
    window.setPasswordVisibility = setPasswordVisibility;

    // Expose globally so inline onclick handler on button also works seamlessly
    window.toggleAdminPassword = function() {
      if (!inputPassword) return;
      const shouldShow = inputPassword.type === 'password';
      setPasswordVisibility(shouldShow);
      try { inputPassword.focus(); } catch (e) {}
    };

    // Press-and-hold (Peek) & Tap-to-toggle logic for password eye button
    let isEyePointerDown = false;
    let eyePressStartTime = 0;
    let eyeStateBeforePress = false;
    let lastEyeReleaseTime = 0;

    function handleEyePressStart(e) {
      if (e.button && e.button !== 0) return;
      if (e.cancelable) e.preventDefault();
      isEyePointerDown = true;
      eyePressStartTime = Date.now();
      eyeStateBeforePress = (inputPassword && inputPassword.type === 'text');
      // If currently masked, immediately reveal upon press down!
      if (!eyeStateBeforePress) {
        setPasswordVisibility(true);
      }
    }

    function handleEyePressEnd(e) {
      if (!isEyePointerDown) return;
      isEyePointerDown = false;
      lastEyeReleaseTime = Date.now();
      const holdDuration = Date.now() - eyePressStartTime;

      if (holdDuration >= 250) {
        // Held for 250ms or more -> Peek mode! Revert back upon release
        setPasswordVisibility(eyeStateBeforePress);
      } else {
        // Quick tap (< 250ms) -> Toggle mode!
        if (eyeStateBeforePress) {
          setPasswordVisibility(false);
        } else {
          setPasswordVisibility(true);
        }
      }
      try { inputPassword && inputPassword.focus(); } catch (err) {}
    }

    function handleEyePressCancel() {
      if (!isEyePointerDown) return;
      isEyePointerDown = false;
      setPasswordVisibility(eyeStateBeforePress);
    }

    if (btnTogglePassword && !btnTogglePassword._hasHoldListeners) {
      btnTogglePassword._hasHoldListeners = true;
      btnTogglePassword.addEventListener('pointerdown', handleEyePressStart);
      btnTogglePassword.addEventListener('pointerup', handleEyePressEnd);
      btnTogglePassword.addEventListener('pointercancel', handleEyePressCancel);
      btnTogglePassword.addEventListener('pointerleave', handleEyePressCancel);

      // Prevent context menu (long press callout / copy popup on iOS/Android)
      btnTogglePassword.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      });

      // Handle keyboard accessibility (Enter/Space on button) without synthetic click interference
      btnTogglePassword.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (Date.now() - lastEyeReleaseTime > 350) {
          window.toggleAdminPassword();
        }
      });

      // Fallback for browsers without Pointer Events
      if (!window.PointerEvent) {
        btnTogglePassword.addEventListener('mousedown', handleEyePressStart);
        btnTogglePassword.addEventListener('mouseup', handleEyePressEnd);
        btnTogglePassword.addEventListener('mouseleave', handleEyePressCancel);
        btnTogglePassword.addEventListener('touchstart', handleEyePressStart, { passive: false });
        btnTogglePassword.addEventListener('touchend', handleEyePressEnd);
        btnTogglePassword.addEventListener('touchcancel', handleEyePressCancel);
      }
    }

    // Gate modal actions
    if (btnOpenAdminLogin) {
      btnOpenAdminLogin.addEventListener('click', () => {
        gateModal.classList.add('hidden');
        adminLoginModal.classList.remove('hidden');
        loginError.classList.add('hidden');
        inputUsername.value = '';
        inputPassword.value = '';
        setPasswordVisibility(false);
        setTimeout(() => inputUsername.focus(), 150);
      });
    }

    if (btnCancelLogin) {
      btnCancelLogin.addEventListener('click', () => {
        adminLoginModal.classList.add('hidden');
        gateModal.classList.remove('hidden');
        setPasswordVisibility(false);
      });
    }

    formAdminLogin.addEventListener('submit', (e) => {
      e.preventDefault();
      const user = inputUsername.value.trim();
      const pass = inputPassword.value;

      if (user === ADMIN_USER && pass === ADMIN_PASS) {
        setPasswordVisibility(false);
        try {
          sessionStorage.setItem(STORAGE_AUTH, 'true');
        } catch (err) {}
        checkAuthStatus();
        showToast('Login Berhasil', 'Akses layar admin terbuka.');
      } else {
        loginError.classList.remove('hidden');
        inputPassword.value = '';
        inputPassword.focus();
      }
    });

    btnLogoutAdmin.addEventListener('click', () => {
      if (confirm('Kunci layar admin sekarang?')) {
        try {
          sessionStorage.removeItem(STORAGE_AUTH);
        } catch (err) {}
        checkAuthStatus();
      }
    });

    // 2. ABSENSI CHOICE ACTIONS
    btnOpenScan.addEventListener('click', () => {
      gateModal.classList.add('hidden');
      absensiChoiceModal.classList.remove('hidden');
      lucide.createIcons();
    });

    btnCancelChoice.addEventListener('click', () => {
      absensiChoiceModal.classList.add('hidden');
      gateModal.classList.remove('hidden');
    });

    btnChoiceMasuk.addEventListener('click', () => {
      currentAttendanceType = 'MASUK';
      absensiChoiceModal.classList.add('hidden');
      cameraModalTitle.textContent = 'Absensi Masuk - Scan QR';
      cameraScanModal.classList.remove('hidden');
      startInAppCameraScanner();
      lucide.createIcons();
    });

    btnChoiceKeluar.addEventListener('click', () => {
      currentAttendanceType = 'KELUAR';
      absensiChoiceModal.classList.add('hidden');
      cameraModalTitle.textContent = 'Absensi Keluar - Scan QR';
      cameraScanModal.classList.remove('hidden');
      startInAppCameraScanner();
      lucide.createIcons();
    });

    // 3. LIVE CAMERA SCANNER
    let isStabilizing = false;

    function extractQrData(text) {
      if (!text || typeof text !== 'string') return null;
      let token = null;
      let session = null;
      let type = null;

      if (text.startsWith('http://') || text.startsWith('https://')) {
        try {
          const urlObj = new URL(text);
          token = urlObj.searchParams.get('token');
          session = urlObj.searchParams.get('session');
          type = urlObj.searchParams.get('type');
        } catch (e) {}
      }

      if (!token) {
        const match = text.match(/(QR-(?:IN|OUT)?[A-Z0-9\-_]{3,15})/i);
        if (match) token = match[1].toUpperCase();
      }

      if (!token || !token.startsWith('QR-')) return null;

      if (!type) {
        if (token.includes('-OUT-')) type = 'KELUAR';
        else if (token.includes('-IN-')) type = 'MASUK';
      }

      return { 
        token: token.toUpperCase(), 
        session: session || null, 
        type: type ? type.toUpperCase() : null 
      };
    }

    btnCloseCamera.addEventListener('click', () => {
      stopInAppCameraScanner();
      cameraScanModal.classList.add('hidden');
      absensiChoiceModal.classList.remove('hidden');
    });

    function startInAppCameraScanner() {
      isStabilizing = false;
      scannerStabilizeOverlay.classList.add('hidden');
      cameraViewContainer.classList.remove('scan-highlight');
      scanStatusText.textContent = 'Arahkan kamera ke QR proyektor admin...';

      if (typeof Html5Qrcode === 'undefined') {
        alert('Library scanner kamera sedang dimuat, silakan coba sesaat lagi.');
        return;
      }

      if (!html5QrScanner) {
        html5QrScanner = new Html5Qrcode("qrScannerView");
      }

      const config = { fps: 12, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 };

      html5QrScanner.start(
        { facingMode: "environment" },
        config,
        onQrCodeSuccess,
        () => {}
      ).catch(err => {
        console.error('Camera error:', err);
        alert('Gagal mengakses kamera. Mohon izinkan akses kamera di browser Anda.');
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
      if (!qrData) return;

      isStabilizing = true;
      playSuccessChime();

      cameraViewContainer.classList.add('scan-highlight');
      stabilizedTokenText.textContent = qrData.token;
      scannerStabilizeOverlay.classList.remove('hidden');
      scanStatusText.textContent = 'QR Terverifikasi: ' + qrData.token;

      try {
        if (html5QrScanner && html5QrScanner.isScanning) {
          html5QrScanner.pause(true);
        }
      } catch (e) {}

      await new Promise(res => setTimeout(res, 500));

      stopInAppCameraScanner();
      cameraScanModal.classList.add('hidden');

      activeScannedToken = qrData.token;
      activeScannedSession = qrData.session;

      if (qrData.type) {
        currentAttendanceType = qrData.type.toUpperCase();
      }

      showScanDisclaimer(qrData.token, currentAttendanceType);
    }

    // 3.5. DISCLAIMER POP-UP SETELAH SCAN QR
    function showScanDisclaimer(token, type) {
      const scanDisclaimerModal = document.getElementById('scanDisclaimerModal');
      const disclaimerTypeBadge = document.getElementById('disclaimerTypeBadge');
      const disclaimerTokenText = document.getElementById('disclaimerTokenText');

      if (!scanDisclaimerModal) {
        openInlineAttendanceModal(token);
        return;
      }

      const isKeluar = (type || currentAttendanceType) === 'KELUAR';
      if (disclaimerTokenText) disclaimerTokenText.textContent = token;
      if (disclaimerTypeBadge) {
        disclaimerTypeBadge.textContent = isKeluar ? 'ABSENSI KELUAR' : 'ABSENSI MASUK';
        disclaimerTypeBadge.className = isKeluar 
          ? 'text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 uppercase'
          : 'text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase';
      }

      scanDisclaimerModal.classList.remove('hidden');
    }

    const scanDisclaimerModal = document.getElementById('scanDisclaimerModal');
    const btnConfirmDisclaimer = document.getElementById('btnConfirmDisclaimer');
    const btnCancelDisclaimer = document.getElementById('btnCancelDisclaimer');

    if (btnConfirmDisclaimer) {
      btnConfirmDisclaimer.addEventListener('click', () => {
        if (scanDisclaimerModal) scanDisclaimerModal.classList.add('hidden');
        openInlineAttendanceModal(activeScannedToken);
      });
    }

    if (btnCancelDisclaimer) {
      btnCancelDisclaimer.addEventListener('click', () => {
        if (scanDisclaimerModal) scanDisclaimerModal.classList.add('hidden');
        gateModal.classList.remove('hidden');
      });
    }

    // 4. INLINE ATTENDANCE FORM (TAMPER-PROOF DATE)
    function openInlineAttendanceModal(token) {
      inlineTokenBadge.textContent = token;
      inlineFormWrapper.classList.remove('hidden');
      inlineSuccessWrapper.classList.add('hidden');
      attendInlineModal.classList.remove('hidden');

      const today = new Date();
      if (inlineDisplayDate) {
        inlineDisplayDate.textContent = `${getIndonesianDayName(today)}, ${today.getDate()} ${getIndonesianMonthName(today.getMonth())} ${today.getFullYear()}`;
      }

      if (inlineTypeBadge) {
        if (currentAttendanceType === 'KELUAR') {
          inlineTypeBadge.textContent = 'KELUAR';
          inlineTypeBadge.className = 'text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 uppercase';
          inlineFormTitle.textContent = 'Presensi Keluar (Pulang)';
          inlineFormSubtitle.textContent = 'Masukkan nama yang sama persis saat Anda Absensi Masuk.';
          inlineKeluarNotice.classList.remove('hidden');
        } else {
          inlineTypeBadge.textContent = 'MASUK';
          inlineTypeBadge.className = 'text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase';
          inlineFormTitle.textContent = 'Konfirmasi Kehadiran';
          inlineFormSubtitle.textContent = 'Isi nama lengkap untuk merekam absensi masuk.';
          inlineKeluarNotice.classList.add('hidden');
        }
      }

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

    // Form Submit (Kunci Waktu Sistem Mutlak)
    inlineAttendForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = inlineInputName.value.trim();
      const now = new Date();
      const todayStr = getLocalDateString(now);
      const dayStr = getIndonesianDayName(now);
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
        <div class="inline-block animate-spin w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full mr-2"></div>
        <span>Memverifikasi...</span>
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

      // 1. Coba Server API lokal jika tersedia
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

      // 2. Kirim via Cloud MQTT WSS (Beda Jaringan / Kuota 4G)
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
                alert('Gagal memproses respon presensi.');
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
        } catch (err) {}
      }

      // 3. Fallback Local Storage
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

      const title = `Presensi ${isKeluar ? 'Keluar' : 'Masuk'}: ${name}`;
      const description = `Bukti Kehadiran Resmi Smart QR Attendance.\n\nJenis: Presensi ${isKeluar ? 'Keluar' : 'Masuk'}\nNama: ${name}\nHari: ${day}\nTanggal: ${date}\nJam: ${time} WIB\nToken: ${token}`;
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
  });

  // --- 5. ATTENDANCE SUBMISSION ENGINE & VALIDATION RULES ---
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
    const todayRegional = getLocalDateString(localNow);
    if (date && date !== todayRegional) {
      return {
        success: false,
        error: `Kunci Waktu Regional Aktif: Presensi hanya berlaku untuk hari ini (${todayRegional}).`
      };
    }

    const attendances = getStoredAttendances();
    const targetDate = todayRegional;

    // A. VALIDASI ABSENSI MASUK
    if (attendType === 'MASUK') {
      const existingMasuk = attendances.find(a => a.device_id === deviceId && a.date === targetDate && (a.type === 'MASUK' || !a.type));
      if (existingMasuk) {
        return {
          success: false,
          error: `Perangkat ini sudah tercatat melakukan Absensi Masuk hari ini atas nama "${existingMasuk.name}" pada pukul ${existingMasuk.time} WIB. 1 perangkat hanya bisa absen masuk 1 kali per hari!`
        };
      }
    }

    // B. VALIDASI KHUSUS ABSENSI KELUAR
    if (attendType === 'KELUAR') {
      // 1. Wajib sudah ada Absensi Masuk hari ini
      const masukRecord = attendances.find(a => a.device_id === deviceId && a.date === targetDate && (a.type === 'MASUK' || !a.type));
      if (!masukRecord) {
        return {
          success: false,
          error: 'Presensi Keluar Ditolak: Perangkat Anda belum tercatat melakukan Absensi Masuk hari ini. Silakan lakukan Absensi Masuk terlebih dahulu!'
        };
      }

      // 2. Nama wajib sama persis
      if (masukRecord.name.trim().toLowerCase() !== name.trim().toLowerCase()) {
        return {
          success: false,
          error: `Presensi Keluar Ditolak: Nama ("${name}") tidak cocok dengan data saat Absensi Masuk ("${masukRecord.name}"). Harap gunakan nama yang sama persis!`
        };
      }

      // 3. Tidak boleh double keluar
      const existingKeluar = attendances.find(a => a.device_id === deviceId && a.date === targetDate && a.type === 'KELUAR');
      if (existingKeluar) {
        return {
          success: false,
          error: `Perangkat ini sudah tercatat melakukan Absensi Keluar hari ini pada pukul ${existingKeluar.time} WIB.`
        };
      }
    }

    // Mark token as USED
    const nowIso = new Date().toISOString();
    targetToken.status = 'USED';
    targetToken.used_at = nowIso;
    targetToken.used_by_name = name;
    targetToken.device_id = deviceId;
    targetToken.type = attendType;
    saveTokens(tokens);

    // Save Attendance Record (Permanent)
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
      created_at: nowIso
    };
    attendances.unshift(record);
    saveAttendances(attendances);

    // Rotate to new active token for this attendance type immediately!
    createNewActiveToken(attendType);

    // Trigger Audio & Visuals
    playSuccessChime();
    showToast(`Presensi ${attendType === 'KELUAR' ? 'Keluar' : 'Masuk'} Berhasil`, `${name} telah dicatat.`);
    addLiveActivity(record);
    populateYearFilter();
    loadAttendanceData();

    return { success: true, attendance: record };
  }

  // --- 6. ADMIN DASHBOARD CONTROLLER ---
  function initAdminDashboard() {
    if (adminInitialized) return;
    adminInitialized = true;

    initTabs();
    initSubTabs();
    initPeriodFilters();
    initClock();
    initCloudMqtt();
    bootAdminQr();
    populateYearFilter();
    populateDayFilter();
    loadAttendanceData();
    lucide.createIcons();
  }

  function initTabs() {
    const tabBtnProjector = document.getElementById('tabBtnProjector');
    const tabBtnAttendance = document.getElementById('tabBtnAttendance');

    const viewProjector = document.getElementById('viewProjector');
    const viewAttendance = document.getElementById('viewAttendance');

    const tabs = [
      { btn: tabBtnProjector, view: viewProjector },
      { btn: tabBtnAttendance, view: viewAttendance, onShow: () => { populateYearFilter(); populateDayFilter(); loadAttendanceData(); } }
    ];

    tabs.forEach(t => {
      if (!t.btn) return;
      t.btn.addEventListener('click', () => {
        tabs.forEach(item => {
          if (!item.btn) return;
          item.btn.classList.remove('active', 'bg-zinc-800', 'text-white', 'shadow-sm');
          item.btn.classList.add('text-zinc-400');
          item.view.classList.add('hidden');
        });

        t.btn.classList.add('active', 'bg-zinc-800', 'text-white', 'shadow-sm');
        t.btn.classList.remove('text-zinc-400');
        t.view.classList.remove('hidden');

        if (t.onShow) t.onShow();
        lucide.createIcons();
      });
    });
  }

  function initSubTabs() {
    const subTabUtama = document.getElementById('subTabUtama');
    const subTabMasuk = document.getElementById('subTabMasuk');
    const subTabKeluar = document.getElementById('subTabKeluar');

    function updateSubTabButtons() {
      [subTabUtama, subTabMasuk, subTabKeluar].forEach(btn => {
        if (!btn) return;
        btn.classList.remove('active', 'bg-zinc-800', 'text-white', 'shadow-sm', 'border-zinc-700');
        btn.classList.add('text-zinc-400', 'bg-[#11131a]', 'border-zinc-800');
      });

      if (activeSubTab === 'UTAMA' && subTabUtama) {
        subTabUtama.classList.add('active', 'bg-zinc-800', 'text-white', 'shadow-sm', 'border-zinc-700');
        subTabUtama.classList.remove('text-zinc-400', 'bg-[#11131a]', 'border-zinc-800');
      } else if (activeSubTab === 'MASUK' && subTabMasuk) {
        subTabMasuk.classList.add('active', 'bg-zinc-800', 'text-white', 'shadow-sm', 'border-zinc-700');
        subTabMasuk.classList.remove('text-zinc-400', 'bg-[#11131a]', 'border-zinc-800');
      } else if (activeSubTab === 'KELUAR' && subTabKeluar) {
        subTabKeluar.classList.add('active', 'bg-zinc-800', 'text-white', 'shadow-sm', 'border-zinc-700');
        subTabKeluar.classList.remove('text-zinc-400', 'bg-[#11131a]', 'border-zinc-800');
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

  // --- FILTER PERIODE WAKTU (TAHUN, BULAN, MINGGUAN, HARIAN, SEMUA) ---
  function initPeriodFilters() {
    const btnPeriodAll = document.getElementById('btnPeriodAll');
    const btnPeriodToday = document.getElementById('btnPeriodToday');
    const btnPeriodWeek = document.getElementById('btnPeriodWeek');
    const btnPeriodMonth = document.getElementById('btnPeriodMonth');
    const selectFilterYear = document.getElementById('selectFilterYear');
    const selectFilterMonth = document.getElementById('selectFilterMonth');
    const selectFilterDay = document.getElementById('selectFilterDay');
    const filterSearch = document.getElementById('filterSearch');
    const btnResetFilter = document.getElementById('btnResetFilter');
    const btnExportCsv = document.getElementById('btnExportCsv');
    const btnResetData = document.getElementById('btnResetData');

    function updatePeriodButtons() {
      [btnPeriodAll, btnPeriodToday, btnPeriodWeek, btnPeriodMonth].forEach(btn => {
        if (!btn) return;
        btn.classList.remove('active', 'bg-zinc-800', 'text-white', 'border-zinc-700');
        btn.classList.add('bg-zinc-950', 'text-zinc-400', 'border-zinc-800');
      });

      let targetBtn = btnPeriodAll;
      if (activePeriodFilter === 'TODAY') targetBtn = btnPeriodToday;
      else if (activePeriodFilter === 'WEEK') targetBtn = btnPeriodWeek;
      else if (activePeriodFilter === 'MONTH') targetBtn = btnPeriodMonth;

      if (targetBtn && activePeriodFilter !== 'CUSTOM') {
        targetBtn.classList.add('active', 'bg-zinc-800', 'text-white', 'border-zinc-700');
        targetBtn.classList.remove('bg-zinc-950', 'text-zinc-400', 'border-zinc-800');
      }
    }

    if (btnPeriodAll) {
      btnPeriodAll.addEventListener('click', () => {
        activePeriodFilter = 'ALL';
        if (selectFilterDay) selectFilterDay.value = 'ALL';
        updatePeriodButtons();
        loadAttendanceData();
      });
    }

    if (btnPeriodToday) {
      btnPeriodToday.addEventListener('click', () => {
        activePeriodFilter = 'TODAY';
        if (selectFilterDay) selectFilterDay.value = 'ALL';
        updatePeriodButtons();
        loadAttendanceData();
      });
    }

    if (btnPeriodWeek) {
      btnPeriodWeek.addEventListener('click', () => {
        activePeriodFilter = 'WEEK';
        if (selectFilterDay) selectFilterDay.value = 'ALL';
        updatePeriodButtons();
        loadAttendanceData();
      });
    }

    if (btnPeriodMonth) {
      btnPeriodMonth.addEventListener('click', () => {
        activePeriodFilter = 'MONTH';
        if (selectFilterDay) selectFilterDay.value = 'ALL';
        updatePeriodButtons();
        loadAttendanceData();
      });
    }

    if (selectFilterYear) {
      selectFilterYear.addEventListener('change', () => {
        updateMonthOptions();
        loadAttendanceData();
      });
    }

    if (selectFilterMonth) {
      selectFilterMonth.addEventListener('change', () => {
        loadAttendanceData();
      });
    }

    if (selectFilterDay) {
      selectFilterDay.addEventListener('change', () => {
        if (selectFilterDay.value !== 'ALL') {
          activePeriodFilter = 'CUSTOM';
          updatePeriodButtons();
        }
        loadAttendanceData();
      });
    }

    if (filterSearch) {
      filterSearch.addEventListener('input', () => {
        loadAttendanceData();
      });
    }

    if (btnResetFilter) {
      btnResetFilter.addEventListener('click', () => {
        activePeriodFilter = 'ALL';
        if (selectFilterYear) selectFilterYear.value = 'ALL';
        updateMonthOptions();
        if (selectFilterMonth) selectFilterMonth.value = 'ALL';
        if (selectFilterDay) selectFilterDay.value = 'ALL';
        if (filterSearch) filterSearch.value = '';
        updatePeriodButtons();
        loadAttendanceData();
      });
    }

    // Export CSV
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', exportCsvData);
    }

    // Reset Data
    if (btnResetData) {
      btnResetData.addEventListener('click', () => {
        const conf = confirm('PERINGATAN:\n\nApakah Anda yakin ingin MENGHAPUS SEMUA riwayat data presensi dan token?\nTindakan ini bersifat permanen.');
        if (!conf) return;

        saveAttendances([]);
        saveTokens([]);
        createNewActiveToken('MASUK');
        createNewActiveToken('KELUAR');
        populateYearFilter();
        populateDayFilter();
        loadAttendanceData();
        showToast('Data Direset', 'Seluruh data presensi telah dikosongkan.');
      });
    }
  }

  // Populate dynamic Year selector starting strictly from 2026 onwards
  function populateYearFilter() {
    const selectFilterYear = document.getElementById('selectFilterYear');
    if (!selectFilterYear) return;

    const attendances = getStoredAttendances();
    const currentYear = new Date().getFullYear();
    const minYear = 2026;
    const yearSet = new Set();
    yearSet.add(2026);
    if (currentYear > 2026) {
      yearSet.add(currentYear);
    }

    attendances.forEach(a => {
      if (a.date) {
        const yr = parseInt(a.date.split('-')[0], 10);
        if (!isNaN(yr) && yr >= minYear) {
          yearSet.add(yr);
        }
      }
    });

    const years = Array.from(yearSet).sort((a, b) => a - b);
    const prevVal = selectFilterYear.value;

    selectFilterYear.innerHTML = '<option value="ALL">Semua Tahun (Mulai 2026)</option>';
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = `Tahun ${y}`;
      selectFilterYear.appendChild(opt);
    });

    if (prevVal && (prevVal === 'ALL' || years.map(String).includes(prevVal))) {
      selectFilterYear.value = prevVal;
    } else {
      selectFilterYear.value = 'ALL';
    }

    updateMonthOptions();
  }

  // Update Month options dynamically (For 2026, strictly August onwards)
  function updateMonthOptions() {
    const selectFilterYear = document.getElementById('selectFilterYear');
    const selectFilterMonth = document.getElementById('selectFilterMonth');
    if (!selectFilterMonth) return;

    const selectedYear = selectFilterYear ? selectFilterYear.value : 'ALL';
    const prevVal = selectFilterMonth.value;

    const allMonths = [
      { val: '01', name: 'Januari' },
      { val: '02', name: 'Februari' },
      { val: '03', name: 'Maret' },
      { val: '04', name: 'April' },
      { val: '05', name: 'Mei' },
      { val: '06', name: 'Juni' },
      { val: '07', name: 'Juli' },
      { val: '08', name: 'Agustus' },
      { val: '09', name: 'September' },
      { val: '10', name: 'Oktober' },
      { val: '11', name: 'November' },
      { val: '12', name: 'Desember' }
    ];

    // Constrain: Year 2026 starts strictly from August (08) onwards
    const availableMonths = (selectedYear === '2026')
      ? allMonths.filter(m => parseInt(m.val, 10) >= 8)
      : allMonths;

    selectFilterMonth.innerHTML = (selectedYear === '2026')
      ? '<option value="ALL">Semua Bulan (Mulai Ags)</option>'
      : '<option value="ALL">Semua Bulan</option>';

    availableMonths.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.val;
      opt.textContent = m.name;
      selectFilterMonth.appendChild(opt);
    });

    if (availableMonths.some(m => m.val === prevVal)) {
      selectFilterMonth.value = prevVal;
    } else {
      selectFilterMonth.value = 'ALL';
    }
  }

  // Populate Day selector dropdown (Tanggal 01 s/d 31 - no HTML datepicker)
  function populateDayFilter() {
    const selectFilterDay = document.getElementById('selectFilterDay');
    if (!selectFilterDay) return;

    const prevVal = selectFilterDay.value;
    selectFilterDay.innerHTML = '<option value="ALL">Semua Tanggal</option>';
    for (let d = 1; d <= 31; d++) {
      const dayStr = String(d).padStart(2, '0');
      const opt = document.createElement('option');
      opt.value = dayStr;
      opt.textContent = `Tanggal ${dayStr}`;
      selectFilterDay.appendChild(opt);
    }

    if (prevVal && prevVal !== 'ALL') {
      selectFilterDay.value = prevVal;
    } else {
      selectFilterDay.value = 'ALL';
    }
  }

  // --- 7. LOAD ATTENDANCE DATA & COMPREHENSIVE FILTER ENGINE ---
  function loadAttendanceData() {
    const attendanceTableHead = document.getElementById('attendanceTableHead');
    const attendanceTableBody = document.getElementById('attendanceTableBody');
    const metricFilteredCount = document.getElementById('metricFilteredCount');
    const metricMasukCount = document.getElementById('metricMasukCount');
    const metricKeluarCount = document.getElementById('metricKeluarCount');
    const metricTotalAllTime = document.getElementById('metricTotalAllTime');

    const selectFilterYear = document.getElementById('selectFilterYear');
    const selectFilterMonth = document.getElementById('selectFilterMonth');
    const selectFilterDay = document.getElementById('selectFilterDay');
    const filterSearch = document.getElementById('filterSearch');

    if (!attendanceTableBody) return;

    const all = getStoredAttendances();
    const now = new Date();
    const todayStr = getLocalDateString(now);

    // 7 Days ago cutoff
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekAgoStr = getLocalDateString(weekAgo);
    const thisMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const selectedYear = selectFilterYear ? selectFilterYear.value : 'ALL';
    const selectedMonth = selectFilterMonth ? selectFilterMonth.value : 'ALL';
    const selectedDay = selectFilterDay ? selectFilterDay.value : 'ALL';
    const searchTerm = filterSearch ? filterSearch.value.trim().toLowerCase() : '';

    // Apply combined filters (Strictly starting from August 2026)
    const filtered = all.filter(item => {
      // Data before August 2026 is strictly excluded
      if (item.date && item.date < '2026-08-01') return false;

      // 1. Search term filter
      if (searchTerm) {
        const match = (item.name || '').toLowerCase().includes(searchTerm) ||
                      (item.token || '').toLowerCase().includes(searchTerm) ||
                      (item.device_info || '').toLowerCase().includes(searchTerm);
        if (!match) return false;
      }

      // 2. Year filter (2026 onwards)
      if (selectedYear !== 'ALL') {
        if (!item.date || !item.date.startsWith(selectedYear)) return false;
      }

      // 3. Month filter
      if (selectedMonth !== 'ALL') {
        const itemMonth = (item.date || '').split('-')[1];
        if (itemMonth !== selectedMonth) return false;
      }

      // 4. Day Dropdown filter (Full tulisan Tanggal 01 - 31)
      if (selectedDay !== 'ALL') {
        const itemDay = (item.date || '').split('-')[2];
        if (itemDay !== selectedDay) return false;
      }

      // 5. Quick Period filter (Only when day is 'ALL')
      if (selectedDay === 'ALL') {
        if (activePeriodFilter === 'TODAY') {
          if (item.date !== todayStr) return false;
        } else if (activePeriodFilter === 'WEEK') {
          if (item.date < weekAgoStr || item.date > todayStr) return false;
        } else if (activePeriodFilter === 'MONTH') {
          if (!item.date.startsWith(thisMonthPrefix)) return false;
        }
      }

      return true;
    });

    // Update Metrics
    const masukCount = filtered.filter(a => a.type === 'MASUK' || !a.type).length;
    const keluarCount = filtered.filter(a => a.type === 'KELUAR').length;
    const validAll = all.filter(a => !a.date || a.date >= '2026-08-01');

    if (metricFilteredCount) metricFilteredCount.textContent = filtered.length;
    if (metricMasukCount) metricMasukCount.textContent = masukCount;
    if (metricKeluarCount) metricKeluarCount.textContent = keluarCount;
    if (metricTotalAllTime) metricTotalAllTime.textContent = validAll.length;

    // Render Table Based on Active SubTab with clean empty states
    if (activeSubTab === 'MASUK') {
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

      const records = filtered.filter(a => a.type === 'MASUK' || !a.type);
      if (records.length === 0) {
        attendanceTableBody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-zinc-500 font-medium text-xs">Belum ada data presensi.</td></tr>`;
        return;
      }

      attendanceTableBody.innerHTML = records.map((a, idx) => `
        <tr class="hover:bg-zinc-900/60 transition">
          <td class="py-3 px-4 text-center text-zinc-500 font-mono">${idx + 1}</td>
          <td class="py-3 px-4 font-bold text-white flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span>${escapeHtml(a.name)}</span>
          </td>
          <td class="py-3 px-4 text-zinc-300 font-mono">${escapeHtml(a.day)}, ${escapeHtml(a.date)}</td>
          <td class="py-3 px-4 font-mono text-emerald-400 font-semibold">${escapeHtml(a.time)} WIB</td>
          <td class="py-3 px-4 font-mono text-zinc-400 text-xs">${escapeHtml(a.token)}</td>
          <td class="py-3 px-4 text-zinc-400 text-xs">${escapeHtml(a.device_info || 'Perangkat')}</td>
        </tr>
      `).join('');

    } else if (activeSubTab === 'KELUAR') {
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

      const records = filtered.filter(a => a.type === 'KELUAR');
      if (records.length === 0) {
        attendanceTableBody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-zinc-500 font-medium text-xs">Belum ada data presensi.</td></tr>`;
        return;
      }

      attendanceTableBody.innerHTML = records.map((a, idx) => `
        <tr class="hover:bg-zinc-900/60 transition">
          <td class="py-3 px-4 text-center text-zinc-500 font-mono">${idx + 1}</td>
          <td class="py-3 px-4 font-bold text-white flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
            <span>${escapeHtml(a.name)}</span>
          </td>
          <td class="py-3 px-4 text-zinc-300 font-mono">${escapeHtml(a.day)}, ${escapeHtml(a.date)}</td>
          <td class="py-3 px-4 font-mono text-rose-400 font-semibold">${escapeHtml(a.time)} WIB</td>
          <td class="py-3 px-4 font-mono text-zinc-400 text-xs">${escapeHtml(a.token)}</td>
          <td class="py-3 px-4 text-zinc-400 text-xs">${escapeHtml(a.device_info || 'Perangkat')}</td>
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

      const groupMap = new Map();
      filtered.forEach(rec => {
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
          item.name = rec.name;
        }
      });

      const paired = Array.from(groupMap.values());
      if (paired.length === 0) {
        attendanceTableBody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-zinc-500 font-medium text-xs">Belum ada data presensi.</td></tr>`;
        return;
      }

      attendanceTableBody.innerHTML = paired.map((p, idx) => {
        const hasMasuk = !!p.masuk;
        const hasKeluar = !!p.keluar;
        let badgeStatus = '';

        if (hasMasuk && hasKeluar) {
          badgeStatus = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">LENGKAP</span>';
        } else if (hasMasuk) {
          badgeStatus = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">BELUM KELUAR</span>';
        } else {
          badgeStatus = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">HANYA KELUAR</span>';
        }

        return `
          <tr class="hover:bg-zinc-900/60 transition">
            <td class="py-3 px-4 text-center text-zinc-500 font-mono">${idx + 1}</td>
            <td class="py-3 px-4 font-bold text-white">${escapeHtml(p.name)}</td>
            <td class="py-3 px-4 text-zinc-300 font-mono">${escapeHtml(p.day)}, ${escapeHtml(p.date)}</td>
            <td class="py-3 px-4 font-mono text-emerald-400 font-semibold">${hasMasuk ? escapeHtml(p.masuk.time) + ' WIB' : '<span class="text-zinc-600">-</span>'}</td>
            <td class="py-3 px-4 font-mono text-rose-400 font-semibold">${hasKeluar ? escapeHtml(p.keluar.time) + ' WIB' : '<span class="text-zinc-600">-</span>'}</td>
            <td class="py-3 px-4">${badgeStatus}</td>
            <td class="py-3 px-4 text-zinc-400 text-xs">${escapeHtml(p.device_info || 'Perangkat')}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // --- CSV EXPORT ---
  function exportCsvData() {
    const all = getStoredAttendances();
    if (all.length === 0) {
      alert('Belum ada data presensi untuk diekspor.');
      return;
    }

    const dateStr = getLocalDateString(new Date());

    if (activeSubTab === 'UTAMA') {
      const headers = ['No', 'Nama Lengkap', 'Hari', 'Tanggal', 'Jam Masuk', 'Jam Keluar', 'Status', 'Device ID', 'Device Info'];
      const groupMap = new Map();
      all.forEach(rec => {
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

      const rows = Array.from(groupMap.values()).map((p, idx) => [
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
      const filtered = all.filter(a => typeFilter === 'KELUAR' ? a.type === 'KELUAR' : (a.type === 'MASUK' || !a.type));
      const headers = ['No', 'Tipe Presensi', 'Nama Lengkap', 'Hari', 'Tanggal', 'Jam', 'Token QR', 'Device ID', 'Device Info'];
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
  }

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

  // --- CLOCK & LIVE FEED ---
  function initClock() {
    const liveClock = document.getElementById('liveClock');
    const liveDate = document.getElementById('liveDate');
    const gateRegionalDate = document.getElementById('gateRegionalDate');
    const choiceRegionalDate = document.getElementById('choiceRegionalDate');

    function update() {
      const now = new Date();
      if (liveClock) liveClock.textContent = now.toLocaleTimeString('id-ID', { hour12: false });
      const fullDateStr = now.toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      if (liveDate) {
        liveDate.textContent = fullDateStr;
      }
      if (gateRegionalDate) {
        gateRegionalDate.textContent = fullDateStr;
      }
      if (choiceRegionalDate) {
        choiceRegionalDate.textContent = fullDateStr;
      }
    }
    update();
    setInterval(update, 1000);
  }

  function showToast(title, desc) {
    const toast = document.getElementById('toastNotification');
    const toastText = document.getElementById('toastText');
    const toastDetail = document.getElementById('toastDetail');
    if (!toast) return;

    toastText.textContent = title;
    toastDetail.textContent = desc;
    toast.classList.remove('translate-x-full');
    setTimeout(() => toast.classList.add('translate-x-full'), 4000);
  }

  function addLiveActivity(record) {
    const liveActivityList = document.getElementById('liveActivityList');
    const liveFeedCount = document.getElementById('liveFeedCount');
    if (!liveActivityList) return;

    const empty = liveActivityList.querySelector('.text-center');
    if (empty) empty.remove();

    const isKeluar = record.type === 'KELUAR';
    const typeBadge = isKeluar
      ? '<span class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">KELUAR</span>'
      : '<span class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">MASUK</span>';

    const item = document.createElement('div');
    item.className = 'p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between text-xs';
    item.innerHTML = `
      <div class="flex items-center gap-2.5">
        <div class="w-7 h-7 rounded-lg ${isKeluar ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'} flex items-center justify-center font-bold text-xs">
          ${escapeHtml(record.name.charAt(0).toUpperCase())}
        </div>
        <div>
          <div class="font-bold text-white text-xs flex items-center gap-1.5">
            <span>${escapeHtml(record.name)}</span>
            ${typeBadge}
          </div>
          <div class="text-[10px] text-zinc-500 font-mono">${escapeHtml(record.token)}</div>
        </div>
      </div>
      <div class="text-right">
        <div class="${isKeluar ? 'text-rose-400' : 'text-emerald-400'} font-mono font-semibold">${escapeHtml(record.time)}</div>
        <div class="text-[10px] text-zinc-500">${escapeHtml(record.device_info || 'Mobile')}</div>
      </div>
    `;

    liveActivityList.insertBefore(item, liveActivityList.firstChild);
    if (liveFeedCount) {
      liveFeedCount.textContent = `${liveActivityList.children.length} aktivitas`;
    }
  }

  // --- 8. QR ROTATION (MASUK & KELUAR) ---
  function generateRandomToken(prefix = 'IN') {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `QR-${prefix}-${code}`;
  }

  function renderActiveQrCode(token, type = 'MASUK') {
    const isKeluar = (type || '').toUpperCase() === 'KELUAR';
    const suffix = isKeluar ? 'Keluar' : 'Masuk';
    const typeParam = isKeluar ? 'KELUAR' : 'MASUK';

    const qrImage = document.getElementById(`qrImage${suffix}`);
    const qrCanvasContainer = document.getElementById(`qrCanvasContainer${suffix}`);
    const qrOverlayLoading = document.getElementById(`qrOverlayLoading${suffix}`);
    const activeTokenText = document.getElementById(`activeTokenText${suffix}`);
    const mobileAccessUrl = document.getElementById(`mobileAccessUrl${suffix}`);

    if (isKeluar) {
      currentActiveTokenKeluar = token;
    } else {
      currentActiveTokenMasuk = token;
    }
    currentActiveToken = token;

    if (activeTokenText) activeTokenText.textContent = token;

    const currentUrl = new URL(window.location.href);
    let basePath = currentUrl.pathname;
    if (basePath.endsWith('index.html')) {
      basePath = basePath.replace(/index\.html$/, 'attend.html');
    } else if (basePath.endsWith('/')) {
      basePath = basePath + 'attend.html';
    } else {
      basePath = basePath + '/attend.html';
    }

    const attendUrl = `${currentUrl.origin}${basePath}?token=${encodeURIComponent(token)}&type=${typeParam}&session=${encodeURIComponent(adminSessionId)}`;
    if (mobileAccessUrl) mobileAccessUrl.textContent = attendUrl;

    if (qrOverlayLoading) qrOverlayLoading.classList.remove('hidden');
    if (qrImage) qrImage.classList.remove('hidden');
    if (qrCanvasContainer) qrCanvasContainer.classList.add('hidden');

    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(attendUrl)}`;
    
    if (qrImage) {
      qrImage.src = qrApiUrl;
      qrImage.onload = () => {
        if (qrOverlayLoading) qrOverlayLoading.classList.add('hidden');
      };
      qrImage.onerror = () => {
        if (typeof QRCode !== 'undefined' && qrCanvasContainer) {
          qrCanvasContainer.innerHTML = '';
          new QRCode(qrCanvasContainer, {
            text: attendUrl,
            width: 250,
            height: 250,
            colorDark: '#090a0f',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
          });
          qrImage.classList.add('hidden');
          qrCanvasContainer.classList.remove('hidden');
        }
        if (qrOverlayLoading) qrOverlayLoading.classList.add('hidden');
      };
    }
  }

  function createNewActiveToken(type = 'MASUK') {
    const isKeluar = (type || '').toUpperCase() === 'KELUAR';
    const prefix = isKeluar ? 'OUT' : 'IN';
    const typeVal = isKeluar ? 'KELUAR' : 'MASUK';
    const newToken = generateRandomToken(prefix);
    const nowIso = new Date().toISOString();

    const tokens = getStoredTokens();
    tokens.forEach(t => {
      if (t.status === 'ACTIVE' && (t.type === typeVal || (!t.type && !isKeluar))) {
        t.status = 'EXPIRED';
      }
    });

    tokens.unshift({
      token: newToken,
      type: typeVal,
      status: 'ACTIVE',
      created_at: nowIso,
      used_at: null,
      used_by_name: null,
      device_id: null
    });
    saveTokens(tokens);

    renderActiveQrCode(newToken, typeVal);
    return newToken;
  }

  function bootAdminQr() {
    const btnCopyUrlMasuk = document.getElementById('btnCopyUrlMasuk');
    const btnCopyUrlKeluar = document.getElementById('btnCopyUrlKeluar');
    const mobileAccessUrlMasuk = document.getElementById('mobileAccessUrlMasuk');
    const mobileAccessUrlKeluar = document.getElementById('mobileAccessUrlKeluar');

    const btnRefreshQrMasuk = document.getElementById('btnRefreshQrMasuk');
    const btnRefreshQrKeluar = document.getElementById('btnRefreshQrKeluar');
    const btnRefreshQr = document.getElementById('btnRefreshQr');
    const btnFullscreen = document.getElementById('btnFullscreen');

    const tokens = getStoredTokens();
    const activeMasuk = tokens.find(t => t.status === 'ACTIVE' && (t.type === 'MASUK' || !t.type));
    if (activeMasuk) {
      renderActiveQrCode(activeMasuk.token, 'MASUK');
    } else {
      createNewActiveToken('MASUK');
    }

    const activeKeluar = tokens.find(t => t.status === 'ACTIVE' && t.type === 'KELUAR');
    if (activeKeluar) {
      renderActiveQrCode(activeKeluar.token, 'KELUAR');
    } else {
      createNewActiveToken('KELUAR');
    }

    if (btnCopyUrlMasuk && mobileAccessUrlMasuk) {
      btnCopyUrlMasuk.addEventListener('click', () => {
        navigator.clipboard.writeText(mobileAccessUrlMasuk.textContent).then(() => {
          showToast('Tautan Masuk Disalin', 'URL presensi masuk siap dibagikan.');
        });
      });
    }

    if (btnCopyUrlKeluar && mobileAccessUrlKeluar) {
      btnCopyUrlKeluar.addEventListener('click', () => {
        navigator.clipboard.writeText(mobileAccessUrlKeluar.textContent).then(() => {
          showToast('Tautan Keluar Disalin', 'URL presensi keluar siap dibagikan.');
        });
      });
    }

    if (btnRefreshQrMasuk) {
      btnRefreshQrMasuk.addEventListener('click', () => {
        createNewActiveToken('MASUK');
        showToast('QR Masuk Diperbarui', 'Token QR Masuk baru telah aktif.');
      });
    }

    if (btnRefreshQrKeluar) {
      btnRefreshQrKeluar.addEventListener('click', () => {
        createNewActiveToken('KELUAR');
        showToast('QR Keluar Diperbarui', 'Token QR Keluar baru telah aktif.');
      });
    }

    if (btnRefreshQr) {
      btnRefreshQr.addEventListener('click', () => {
        createNewActiveToken('MASUK');
        createNewActiveToken('KELUAR');
        showToast('Semua QR Diperbarui', 'Token QR Masuk & Keluar baru telah aktif.');
      });
    }

    if (btnFullscreen) {
      btnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }
  }

  // --- 9. CLOUD MQTT OVER WSS ---
  function initCloudMqtt() {
    if (typeof mqtt === 'undefined') return;

    const syncBadgeText = document.getElementById('syncBadgeText');
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
        if (syncBadgeText) syncBadgeText.textContent = 'Sync Aktif';
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
        if (syncBadgeText) syncBadgeText.textContent = 'Lokal';
      });
    } catch (e) {
      if (syncBadgeText) syncBadgeText.textContent = 'Lokal';
    }
  }

})();
