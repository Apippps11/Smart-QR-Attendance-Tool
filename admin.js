/**
 * Smart QR Attendance System - Admin Dashboard & Controller (admin.js)
 * Fitur:
 * 1. Keamanan Layar Admin Multi-Browser & Anti-Bypass iOS Safari (BFCache Hard-Lock)
 * 2. Kunci Tanggal Regional Mutlak (Anti-Tamper di iOS/Android)
 * 3. Live Camera Scanning Murni (Upload Foto Dihapus)
 * 4. Riwayat Absensi Permanen (Data Hari Sebelumnya Tidak Pernah Hilang)
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
  const STORAGE_THEME = 'sqr_theme';

  // --- THEME MANAGEMENT (LIGHT & DARK) ---
  function applyTheme(theme) {
    const isLight = theme === 'light';
    const root = document.documentElement;
    if (isLight) {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }

    // Update Gate theme button UI
    const gateThemeIcon = document.getElementById('gateThemeIcon');
    const gateThemeLabel = document.getElementById('gateThemeLabel');
    if (gateThemeIcon) {
      gateThemeIcon.className = isLight ? 'hn hn-moon-solid text-zinc-800 text-sm' : 'hn hn-sun-solid text-white text-sm';
    }
    if (gateThemeLabel) {
      gateThemeLabel.textContent = isLight ? 'Dark' : 'Light';
    }

    // Update Admin theme button UI (inside Settings)
    const adminThemeIcon = document.getElementById('adminThemeIcon');
    const adminThemeLabel = document.getElementById('adminThemeLabel');
    if (adminThemeIcon) {
      adminThemeIcon.className = isLight ? 'hn hn-moon-solid text-zinc-800 text-xs' : 'hn hn-sun-solid text-white text-xs';
    }
    if (adminThemeLabel) {
      adminThemeLabel.textContent = isLight ? 'Dark Mode' : 'Light Mode';
    }

    try {
      localStorage.setItem(STORAGE_THEME, isLight ? 'light' : 'dark');
    } catch (e) {}
  }

  function getSavedTheme() {
    try {
      return localStorage.getItem(STORAGE_THEME) || 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  function toggleTheme() {
    const current = getSavedTheme();
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
  }

  // Admin Multi-Account Storage & Defaults
  const STORAGE_ADMIN_ACCOUNTS = 'sqr_admin_accounts';
  const DEFAULT_ADMIN_ACCOUNTS = [
    { username: 'Admin1118', password: 'AFIFweb18', role: 'Super Admin', createdAt: '2026-01-01', activeDeviceId: null, deviceInfo: null, isOnline: false, lastLoginAt: null },
    { username: 'Admin2', password: 'AFIFweb18', role: 'Admin', createdAt: '2026-01-01', activeDeviceId: null, deviceInfo: null, isOnline: false, lastLoginAt: null }
  ];

  function getAdminAccounts() {
    try {
      const raw = localStorage.getItem(STORAGE_ADMIN_ACCOUNTS);
      if (!raw) {
        localStorage.setItem(STORAGE_ADMIN_ACCOUNTS, JSON.stringify(DEFAULT_ADMIN_ACCOUNTS));
        return DEFAULT_ADMIN_ACCOUNTS;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        localStorage.setItem(STORAGE_ADMIN_ACCOUNTS, JSON.stringify(DEFAULT_ADMIN_ACCOUNTS));
        return DEFAULT_ADMIN_ACCOUNTS;
      }
      return parsed.map(acc => ({
        ...acc,
        activeDeviceId: acc.activeDeviceId || null,
        deviceInfo: acc.deviceInfo || null,
        isOnline: !!acc.isOnline,
        lastLoginAt: acc.lastLoginAt || null
      }));
    } catch (e) {
      return DEFAULT_ADMIN_ACCOUNTS;
    }
  }

  function saveAdminAccounts(accounts) {
    try {
      localStorage.setItem(STORAGE_ADMIN_ACCOUNTS, JSON.stringify(accounts));
    } catch (e) {}
  }

  // State
  let currentActiveToken = null;
  let currentActiveTokenMasuk = null;
  let currentActiveTokenKeluar = null;
  let currentAttendanceType = 'MASUK'; // 'MASUK' | 'KELUAR'
  let activeSubTab = 'UTAMA'; // 'UTAMA' | 'MASUK' | 'KELUAR'
  let mqttClient = null;
  let html5QrScanner = null;
  let activeScannedToken = null;
  let activeScannedSession = null;
  let adminInitialized = false;
  let returnCountdownTimer = null;
  let pendingNewAdmin = null;
  let pendingDeleteUsername = null;
  let pendingSwitchUsername = null;

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

  // Audio Error Buzzer (Untuk Peringatan QR Salah Tipe & Validasi Gagal)
  function playErrorBuzzer() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.setValueAtTime(160, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } catch (e) {}
  }

  // --- LOGOUT CONTROLLER ---
  function handleAdminLogout() {
    if (confirm('Keluar dari sesi admin (Log Out)?')) {
      try {
        const currentUsername = sessionStorage.getItem('sqr_admin_username');
        if (currentUsername) {
          const accounts = getAdminAccounts();
          const me = accounts.find(a => a.username.toLowerCase() === currentUsername.toLowerCase());
          if (me) {
            me.isOnline = false;
            me.activeDeviceId = null;
            saveAdminAccounts(accounts);
          }
        }
        sessionStorage.removeItem(STORAGE_AUTH);
        sessionStorage.removeItem('sqr_admin_username');
      } catch (err) {}
      const adminSidebarDrawer = document.getElementById('adminSidebarDrawer');
      if (adminSidebarDrawer) adminSidebarDrawer.classList.add('-translate-x-full');
      const adminSidebarBackdrop = document.getElementById('adminSidebarBackdrop');
      if (adminSidebarBackdrop) adminSidebarBackdrop.classList.add('hidden');
      checkAuthStatus();
      showToast('Logout Berhasil', 'Sesi admin telah ditutup.');
    }
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
      const adminSidebarDrawer = document.getElementById('adminSidebarDrawer');
      if (adminSidebarDrawer) adminSidebarDrawer.classList.add('-translate-x-full');
      const adminSidebarBackdrop = document.getElementById('adminSidebarBackdrop');
      if (adminSidebarBackdrop) adminSidebarBackdrop.classList.add('hidden');
    }
  }

  // Anti-Bypass for iOS Safari & Firefox (Back-Forward Cache / BFCache)
  window.addEventListener('pageshow', () => {
    checkAuthStatus();
  });

  // --- DOM READY INITIALIZER ---
  document.addEventListener('DOMContentLoaded', () => {
    // Apply saved theme immediately
    applyTheme(getSavedTheme());
    const btnThemeToggleGate = document.getElementById('btnThemeToggleGate');
    if (btnThemeToggleGate) {
      btnThemeToggleGate.addEventListener('click', toggleTheme);
    }

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

    // Universal Password Eye Toggle Helper (supports click and press-and-hold)
    function setupPasswordEyeToggle(btnEl, inputEl, openIconEl, closedIconEl) {
      if (!btnEl || !inputEl || btnEl._hasHoldListeners) return;
      btnEl._hasHoldListeners = true;

      let isDown = false;
      let startTime = 0;
      let wasText = false;
      let lastRelease = 0;

      function setVis(show) {
        inputEl.type = show ? 'text' : 'password';
        if (openIconEl && closedIconEl) {
          if (show) {
            openIconEl.classList.add('hidden');
            closedIconEl.classList.remove('hidden');
          } else {
            openIconEl.classList.remove('hidden');
            closedIconEl.classList.add('hidden');
          }
        }
        if (show) {
          btnEl.classList.add('text-indigo-400');
          btnEl.classList.remove('text-zinc-400');
        } else {
          btnEl.classList.remove('text-indigo-400');
          btnEl.classList.add('text-zinc-400');
        }
      }

      function onDown(e) {
        if (e.button && e.button !== 0) return;
        if (e.cancelable) e.preventDefault();
        isDown = true;
        startTime = Date.now();
        wasText = (inputEl.type === 'text');
        if (!wasText) setVis(true);
      }

      function onUp(e) {
        if (!isDown) return;
        isDown = false;
        lastRelease = Date.now();
        if (Date.now() - startTime >= 250) {
          setVis(wasText);
        } else {
          setVis(!wasText);
        }
        try { inputEl.focus(); } catch (err) {}
      }

      function onCancel() {
        if (!isDown) return;
        isDown = false;
        setVis(wasText);
      }

      btnEl.addEventListener('pointerdown', onDown);
      btnEl.addEventListener('pointerup', onUp);
      btnEl.addEventListener('pointercancel', onCancel);
      btnEl.addEventListener('pointerleave', onCancel);
      btnEl.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); return false; });
      btnEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (Date.now() - lastRelease > 350) {
          setVis(inputEl.type === 'password');
        }
      });

      if (!window.PointerEvent) {
        btnEl.addEventListener('mousedown', onDown);
        btnEl.addEventListener('mouseup', onUp);
        btnEl.addEventListener('mouseleave', onCancel);
        btnEl.addEventListener('touchstart', onDown, { passive: false });
        btnEl.addEventListener('touchend', onUp);
        btnEl.addEventListener('touchcancel', onCancel);
      }
    }

    // Connect eye toggles for all modals & forms
    setupPasswordEyeToggle(
      document.getElementById('btnToggleNewAdminPass'),
      document.getElementById('newAdminPass'),
      document.getElementById('eyeNewAdminOpen'),
      document.getElementById('eyeNewAdminClosed')
    );
    setupPasswordEyeToggle(
      document.getElementById('btnToggleConfirmAddAdminPass'),
      document.getElementById('inputConfirmAddAdminPass'),
      document.getElementById('eyeConfirmAddOpen'),
      document.getElementById('eyeConfirmAddClosed')
    );
    setupPasswordEyeToggle(
      document.getElementById('btnToggleDeleteAdminPass'),
      document.getElementById('inputDeleteAdminPass'),
      document.getElementById('eyeDeleteAdminOpen'),
      document.getElementById('eyeDeleteAdminClosed')
    );
    setupPasswordEyeToggle(
      document.getElementById('btnToggleSwitchAdminPass'),
      document.getElementById('inputSwitchAdminPass'),
      document.getElementById('eyeSwitchAdminOpen'),
      document.getElementById('eyeSwitchAdminClosed')
    );

    // Gate modal actions
    if (btnOpenAdminLogin) {
      btnOpenAdminLogin.addEventListener('click', () => {
        gateModal.classList.add('hidden');
        adminLoginModal.classList.remove('hidden');
        loginError.classList.add('hidden');
        loginError.textContent = 'Username atau password salah!';
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
      const user = inputUsername ? inputUsername.value.trim() : '';
      const pass = inputPassword ? inputPassword.value : '';

      const accounts = getAdminAccounts();
      const matched = accounts.find(a => a.username.trim().toLowerCase() === user.toLowerCase() && a.password === pass);

      if (matched) {
        const currentDev = window.DeviceFingerprint ? window.DeviceFingerprint.getDeviceInfo() : { deviceId: 'dev_local', deviceInfo: 'Perangkat Ini' };

        // Requirement 5: Single device enforcement
        if (matched.isOnline && matched.activeDeviceId && matched.activeDeviceId !== currentDev.deviceId) {
          loginError.textContent = `Akun "${matched.username}" sedang aktif di perangkat lain (${matched.deviceInfo || 'Perangkat Lain'}). Satu akun admin hanya boleh login di 1 perangkat pada waktu yang sama.`;
          loginError.classList.remove('hidden');
          return;
        }

        matched.isOnline = true;
        matched.activeDeviceId = currentDev.deviceId;
        matched.deviceInfo = currentDev.deviceInfo;
        matched.lastLoginAt = new Date().toISOString();
        saveAdminAccounts(accounts);

        setPasswordVisibility(false);
        try {
          sessionStorage.setItem(STORAGE_AUTH, 'true');
          sessionStorage.setItem('sqr_admin_username', matched.username);
        } catch (err) {}
        checkAuthStatus();
        showToast('Login Berhasil', `Akses dibuka. Selamat datang ${matched.username}.`);
      } else {
        loginError.textContent = 'Username atau password salah!';
        loginError.classList.remove('hidden');
        if (inputPassword) {
          inputPassword.value = '';
          inputPassword.focus();
        }
      }
    });

    if (btnLogoutAdmin) {
      btnLogoutAdmin.addEventListener('click', handleAdminLogout);
    }

    // Modal Confirmation: Add New Admin (Task 4)
    const modalConfirmAddAdmin = document.getElementById('modalConfirmAddAdmin');
    const formConfirmAddAdmin = document.getElementById('formConfirmAddAdmin');
    const inputConfirmAddAdminPass = document.getElementById('inputConfirmAddAdminPass');
    const confirmAddAdminError = document.getElementById('confirmAddAdminError');
    const btnCancelConfirmAddAdmin = document.getElementById('btnCancelConfirmAddAdmin');

    if (btnCancelConfirmAddAdmin && modalConfirmAddAdmin) {
      btnCancelConfirmAddAdmin.addEventListener('click', () => {
        modalConfirmAddAdmin.classList.add('hidden');
        pendingNewAdmin = null;
      });
    }

    if (formConfirmAddAdmin) {
      formConfirmAddAdmin.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!pendingNewAdmin) return;
        const retyped = inputConfirmAddAdminPass ? inputConfirmAddAdminPass.value : '';
        if (retyped !== pendingNewAdmin.password) {
          if (confirmAddAdminError) confirmAddAdminError.classList.remove('hidden');
          if (inputConfirmAddAdminPass) inputConfirmAddAdminPass.focus();
          return;
        }

        const accounts = getAdminAccounts();
        accounts.push({
          username: pendingNewAdmin.username,
          password: pendingNewAdmin.password,
          role: 'Admin',
          createdAt: getLocalDateString(),
          activeDeviceId: null,
          deviceInfo: null,
          isOnline: false,
          lastLoginAt: null
        });
        saveAdminAccounts(accounts);

        if (modalConfirmAddAdmin) modalConfirmAddAdmin.classList.add('hidden');
        const newAdminUser = document.getElementById('newAdminUser');
        const newAdminPass = document.getElementById('newAdminPass');
        if (newAdminUser) newAdminUser.value = '';
        if (newAdminPass) newAdminPass.value = '';

        renderAdminAccountsList();
        renderSwitchAdminList();
        showToast('Admin Ditambahkan', `Akun admin "${pendingNewAdmin.username}" berhasil dibuat dan siap digunakan.`);
        pendingNewAdmin = null;
      });
    }

    // Modal Confirmation: Delete Admin (Task 6)
    const modalConfirmDeleteAdmin = document.getElementById('modalConfirmDeleteAdmin');
    const formConfirmDeleteAdmin = document.getElementById('formConfirmDeleteAdmin');
    const inputDeleteAdminPass = document.getElementById('inputDeleteAdminPass');
    const deleteAdminError = document.getElementById('deleteAdminError');
    const btnCancelDeleteAdmin = document.getElementById('btnCancelDeleteAdmin');

    if (btnCancelDeleteAdmin && modalConfirmDeleteAdmin) {
      btnCancelDeleteAdmin.addEventListener('click', () => {
        modalConfirmDeleteAdmin.classList.add('hidden');
        pendingDeleteUsername = null;
      });
    }

    if (formConfirmDeleteAdmin) {
      formConfirmDeleteAdmin.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!pendingDeleteUsername) return;
        const accounts = getAdminAccounts();
        const target = accounts.find(a => a.username.toLowerCase() === pendingDeleteUsername.toLowerCase());
        const passEntered = inputDeleteAdminPass ? inputDeleteAdminPass.value : '';

        if (!target || passEntered !== target.password) {
          if (deleteAdminError) deleteAdminError.classList.remove('hidden');
          if (inputDeleteAdminPass) inputDeleteAdminPass.focus();
          return;
        }

        const updated = accounts.filter(a => a.username.toLowerCase() !== pendingDeleteUsername.toLowerCase());
        saveAdminAccounts(updated);

        if (modalConfirmDeleteAdmin) modalConfirmDeleteAdmin.classList.add('hidden');
        renderAdminAccountsList();
        renderSwitchAdminList();
        showToast('Admin Dihapus', `Akun "${pendingDeleteUsername}" telah dihapus dari seluruh sistem.`);

        const activeUser = sessionStorage.getItem('sqr_admin_username');
        if (activeUser && activeUser.toLowerCase() === pendingDeleteUsername.toLowerCase()) {
          handleAdminLogout();
        }
        pendingDeleteUsername = null;
      });
    }

    // Modal Confirmation: Switch Admin Account (Task 8)
    const modalConfirmSwitchAdmin = document.getElementById('modalConfirmSwitchAdmin');
    const formConfirmSwitchAdmin = document.getElementById('formConfirmSwitchAdmin');
    const inputSwitchAdminPass = document.getElementById('inputSwitchAdminPass');
    const switchAdminError = document.getElementById('switchAdminError');
    const btnCancelSwitchAdmin = document.getElementById('btnCancelSwitchAdmin');

    if (btnCancelSwitchAdmin && modalConfirmSwitchAdmin) {
      btnCancelSwitchAdmin.addEventListener('click', () => {
        modalConfirmSwitchAdmin.classList.add('hidden');
        pendingSwitchUsername = null;
      });
    }

    if (formConfirmSwitchAdmin) {
      formConfirmSwitchAdmin.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!pendingSwitchUsername) return;
        const accounts = getAdminAccounts();
        const target = accounts.find(a => a.username.toLowerCase() === pendingSwitchUsername.toLowerCase());
        const passEntered = inputSwitchAdminPass ? inputSwitchAdminPass.value : '';

        if (!target || passEntered !== target.password) {
          if (switchAdminError) switchAdminError.classList.remove('hidden');
          if (inputSwitchAdminPass) inputSwitchAdminPass.focus();
          return;
        }

        const currentDev = window.DeviceFingerprint ? window.DeviceFingerprint.getDeviceInfo() : { deviceId: 'dev_local', deviceInfo: 'Perangkat Ini' };
        if (target.isOnline && target.activeDeviceId && target.activeDeviceId !== currentDev.deviceId) {
          alert(`Akun "${target.username}" sedang aktif di perangkat lain (${target.deviceInfo || 'Perangkat Lain'}).`);
          if (modalConfirmSwitchAdmin) modalConfirmSwitchAdmin.classList.add('hidden');
          return;
        }

        // Deactivate old active admin
        const activeUser = sessionStorage.getItem('sqr_admin_username');
        if (activeUser) {
          const old = accounts.find(a => a.username.toLowerCase() === activeUser.toLowerCase());
          if (old) {
            old.isOnline = false;
            old.activeDeviceId = null;
          }
        }

        // Activate target account on this device
        target.isOnline = true;
        target.activeDeviceId = currentDev.deviceId;
        target.deviceInfo = currentDev.deviceInfo;
        target.lastLoginAt = new Date().toISOString();
        saveAdminAccounts(accounts);

        sessionStorage.setItem('sqr_admin_username', target.username);
        if (modalConfirmSwitchAdmin) modalConfirmSwitchAdmin.classList.add('hidden');
        renderAdminAccountsList();
        renderSwitchAdminList();
        showToast('Beralih Akun', `Sesi dialihkan ke akun "${target.username}".`);
        pendingSwitchUsername = null;
      });
    }

    // Modal: QR Code Type Mismatch Controller (Task 9)
    const modalWrongQrType = document.getElementById('modalWrongQrType');
    const btnReturnWrongQr = document.getElementById('btnReturnWrongQr');
    const btnRescanWrongQr = document.getElementById('btnRescanWrongQr');

    if (btnReturnWrongQr) {
      btnReturnWrongQr.addEventListener('click', () => {
        if (modalWrongQrType) modalWrongQrType.classList.add('hidden');
        if (absensiChoiceModal) absensiChoiceModal.classList.remove('hidden');
        lucide.createIcons();
      });
    }

    if (btnRescanWrongQr) {
      btnRescanWrongQr.addEventListener('click', () => {
        if (modalWrongQrType) modalWrongQrType.classList.add('hidden');
        if (cameraScanModal) cameraScanModal.classList.remove('hidden');
        startInAppCameraScanner();
        lucide.createIcons();
      });
    }

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
        if (token.includes('-OUT-') || token.startsWith('QR-OUT-') || token.includes('OUT')) type = 'KELUAR';
        else if (token.includes('-IN-') || token.startsWith('QR-IN-') || token.includes('IN')) type = 'MASUK';
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

      // REQUIREMENT: Validasi Kesesuaian Tipe QR (Masuk vs Keluar) Seketika (Task 9)
      const scannedType = qrData.type ? qrData.type.toUpperCase() : null;
      if (scannedType && currentAttendanceType && scannedType !== currentAttendanceType) {
        // Mainkan nada buzzer peringatan dan segera hentikan scanner
        playErrorBuzzer();
        stopInAppCameraScanner();
        cameraScanModal.classList.add('hidden');

        const modalWrongQrType = document.getElementById('modalWrongQrType');
        const wrongQrExpectedType = document.getElementById('wrongQrExpectedType');
        const wrongQrScannedType = document.getElementById('wrongQrScannedType');
        const wrongQrTypeMessage = document.getElementById('wrongQrTypeMessage');

        const expectedText = currentAttendanceType === 'MASUK' ? 'ABSENSI MASUK' : 'ABSENSI KELUAR';
        const scannedText = scannedType === 'MASUK' ? 'ABSENSI MASUK' : 'ABSENSI KELUAR';

        if (wrongQrExpectedType) {
          wrongQrExpectedType.textContent = expectedText;
          wrongQrExpectedType.className = currentAttendanceType === 'MASUK' ? 'font-bold text-emerald-400' : 'font-bold text-rose-400';
        }
        if (wrongQrScannedType) {
          wrongQrScannedType.textContent = scannedText;
          wrongQrScannedType.className = scannedType === 'MASUK' ? 'font-bold text-emerald-400' : 'font-bold text-rose-400';
        }
        if (wrongQrTypeMessage) {
          if (currentAttendanceType === 'MASUK' && scannedType === 'KELUAR') {
            wrongQrTypeMessage.textContent = 'Anda sedang berada di sesi Absensi Masuk, namun QR Code yang Anda scan adalah QR Absensi Keluar. Silakan scan QR Absensi Masuk yang berwarna hijau di layar admin!';
          } else if (currentAttendanceType === 'KELUAR' && scannedType === 'MASUK') {
            wrongQrTypeMessage.textContent = 'Anda sedang berada di sesi Absensi Keluar, namun QR Code yang Anda scan adalah QR Absensi Masuk. Silakan scan QR Absensi Keluar yang berwarna merah/rose di layar admin!';
          } else {
            wrongQrTypeMessage.textContent = `Anda sedang berada di menu ${expectedText}, namun QR Code yang Anda scan adalah ${scannedText}.`;
          }
        }

        if (modalWrongQrType) {
          modalWrongQrType.classList.remove('hidden');
          lucide.createIcons();
        }
        return;
      }

      // Tipe QR sesuai: Lanjutkan dengan feedback sukses
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
          inlineFormTitle.textContent = 'Absen Keluar (Pulang)';
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
            alert('Absen Ditolak:\n\n' + data.error);
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
                  alert('Absen Ditolak:\n\n' + res.error);
                  return;
                }
                renderInlineSuccess(res.attendance);
              } catch (err) {
                alert('Gagal memproses respon absensi.');
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
                alert('Absen Ditolak:\n\n' + fallbackResult.error);
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
        alert('Absen Ditolak:\n\n' + result.error);
        return;
      }

      renderInlineSuccess(result.attendance);
    });

    function startReturnCountdown(targetEl, callback, seconds = 30) {
      if (returnCountdownTimer) clearInterval(returnCountdownTimer);
      let remaining = seconds;
      if (targetEl) targetEl.textContent = `Kembali otomatis dalam ${remaining} detik...`;
      returnCountdownTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(returnCountdownTimer);
          returnCountdownTimer = null;
          callback();
        } else {
          if (targetEl) targetEl.textContent = `Kembali otomatis dalam ${remaining} detik...`;
        }
      }, 1000);
    }

    function stopReturnCountdown() {
      if (returnCountdownTimer) {
        clearInterval(returnCountdownTimer);
        returnCountdownTimer = null;
      }
    }

    function returnToGate() {
      stopReturnCountdown();
      const motivationalModal = document.getElementById('motivationalModal');
      if (motivationalModal) motivationalModal.classList.add('hidden');
      if (attendInlineModal) attendInlineModal.classList.add('hidden');
      if (gateModal) gateModal.classList.remove('hidden');
      if (inlineFormWrapper) inlineFormWrapper.classList.remove('hidden');
      if (inlineSuccessWrapper) inlineSuccessWrapper.classList.add('hidden');
      if (inlineInputName) inlineInputName.value = '';
      lucide.createIcons();
    }

    const btnReturnFromMotivation = document.getElementById('btnReturnFromMotivation');
    if (btnReturnFromMotivation) {
      btnReturnFromMotivation.addEventListener('click', returnToGate);
    }

    if (btnFinishInline) {
      btnFinishInline.addEventListener('click', returnToGate);
    }

    function renderInlineSuccess(record) {
      const isKeluar = (record.type || currentAttendanceType) === 'KELUAR';
      const motivationalModal = document.getElementById('motivationalModal');
      const motivationCountdownText = document.getElementById('motivationCountdownText');
      const inlineCountdownText = document.getElementById('inlineCountdownText');

      if (isKeluar && motivationalModal) {
        if (attendInlineModal) attendInlineModal.classList.add('hidden');
        motivationalModal.classList.remove('hidden');
        startReturnCountdown(motivationCountdownText, returnToGate, 30);
      } else {
        inlineFormWrapper.classList.add('hidden');
        inlineSuccessWrapper.classList.remove('hidden');

        inlineSuccName.textContent = record.name;
        inlineSuccDate.textContent = `${record.day}, ${record.date}`;
        inlineSuccTime.textContent = `${record.time} WIB (${record.type || 'MASUK'})`;

        setupInlineGoogleCalendar(record);
        startReturnCountdown(inlineCountdownText, returnToGate, 30);
      }
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

      const title = `Absen ${isKeluar ? 'Keluar' : 'Masuk'}: ${name}`;
      const description = `Bukti Kehadiran Resmi Smart QR Attendance.\n\nJenis: Absen ${isKeluar ? 'Keluar' : 'Masuk'}\nNama: ${name}\nHari: ${day}\nTanggal: ${date}\nJam: ${time} WIB\nToken: ${token}`;
      const location = `Sistem Absensi Smart QR`;

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
        link.setAttribute('download', `Absen_${isKeluar ? 'Keluar' : 'Masuk'}-${name.replace(/\s+/g, '_')}-${date}.ics`);
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
        error: `Kunci Waktu Regional Aktif: Absen hanya berlaku untuk hari ini (${todayRegional}).`
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
          error: `Perangkat ini sudah tercatat melakukan Absen Masuk hari ini atas nama "${existingMasuk.name}" pada pukul ${existingMasuk.time} WIB. 1 perangkat hanya bisa absen masuk 1 kali per hari!`
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
          error: 'Absen Keluar Ditolak: Perangkat Anda belum tercatat melakukan Absen Masuk hari ini. Silakan lakukan Absen Masuk terlebih dahulu!'
        };
      }

      // 2. Nama wajib sama persis
      if (masukRecord.name.trim().toLowerCase() !== name.trim().toLowerCase()) {
        return {
          success: false,
          error: `Absen Keluar Ditolak: Nama ("${name}") tidak cocok dengan data saat Absen Masuk ("${masukRecord.name}"). Harap gunakan nama yang sama persis!`
        };
      }

      // 3. Tidak boleh double keluar
      const existingKeluar = attendances.find(a => a.device_id === deviceId && a.date === targetDate && a.type === 'KELUAR');
      if (existingKeluar) {
        return {
          success: false,
          error: `Perangkat ini sudah tercatat melakukan Absen Keluar hari ini pada pukul ${existingKeluar.time} WIB.`
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
    showToast(`Absen ${attendType === 'KELUAR' ? 'Keluar' : 'Masuk'} Berhasil`, `${name} telah dicatat.`);
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
    initSidebarAndSettings();
    initClock();
    initCloudMqtt();
    bootAdminQr();
    loadAttendanceData();
    lucide.createIcons();
  }

  function switchAdminView(viewName) {
    const viewProjector = document.getElementById('viewProjector');
    const viewAttendance = document.getElementById('viewAttendance');
    const viewSettings = document.getElementById('viewSettings');

    const tabBtnProjector = document.getElementById('tabBtnProjector');
    const tabBtnAttendance = document.getElementById('tabBtnAttendance');
    const tabBtnSettings = document.getElementById('tabBtnSettings');

    const sidebarBtnProjector = document.getElementById('sidebarBtnProjector');
    const sidebarBtnAttendance = document.getElementById('sidebarBtnAttendance');
    const sidebarBtnSettings = document.getElementById('sidebarBtnSettings');

    const adminHeaderTitle = document.getElementById('adminHeaderTitle');

    // 1. Client-side View-Out (Hide inactive sections, show active section)
    if (viewProjector) {
      if (viewName === 'projector') viewProjector.classList.remove('hidden');
      else viewProjector.classList.add('hidden');
    }
    if (viewAttendance) {
      if (viewName === 'attendance') {
        viewAttendance.classList.remove('hidden');
        populateYearFilter();
        loadAttendanceData();
      } else {
        viewAttendance.classList.add('hidden');
      }
    }
    if (viewSettings) {
      if (viewName === 'settings') {
        viewSettings.classList.remove('hidden');
        renderAdminAccountsList();
        renderSwitchAdminList();
      } else {
        viewSettings.classList.add('hidden');
      }
    }

    // 2. Dynamic Header Title
    if (adminHeaderTitle) {
      if (viewName === 'projector') adminHeaderTitle.textContent = 'Administration Dashboard';
      else if (viewName === 'attendance') adminHeaderTitle.textContent = 'Database';
      else if (viewName === 'settings') adminHeaderTitle.textContent = 'Settings';
    }

    // 3. Desktop Tabs styling sync
    const desktopTabs = [
      { el: tabBtnProjector, name: 'projector' },
      { el: tabBtnAttendance, name: 'attendance' },
      { el: tabBtnSettings, name: 'settings' }
    ];
    desktopTabs.forEach(t => {
      if (!t.el) return;
      if (t.name === viewName) {
        t.el.classList.add('active', 'bg-zinc-800', 'text-white', 'shadow-sm', 'border-zinc-700');
        t.el.classList.remove('text-zinc-400', 'bg-transparent', 'border-transparent');
      } else {
        t.el.classList.remove('active', 'bg-zinc-800', 'text-white', 'shadow-sm', 'border-zinc-700');
        t.el.classList.add('text-zinc-400', 'bg-transparent', 'border-transparent');
      }
    });

    // 4. Sidebar Drawer Buttons styling sync (Requirement 6: identical active/inactive styles)
    const sidebarBtns = [
      { el: sidebarBtnProjector, name: 'projector' },
      { el: sidebarBtnAttendance, name: 'attendance' },
      { el: sidebarBtnSettings, name: 'settings' }
    ];
    sidebarBtns.forEach(b => {
      if (!b.el) return;
      if (b.name === viewName) {
        b.el.classList.add('active', 'bg-zinc-800', 'text-white', 'font-bold', 'border', 'border-zinc-700/60', 'shadow-sm');
        b.el.classList.remove('text-zinc-300', 'bg-transparent', 'font-medium', 'border-transparent');
      } else {
        b.el.classList.remove('active', 'bg-zinc-800', 'text-white', 'font-bold', 'border', 'border-zinc-700/60', 'shadow-sm');
        b.el.classList.add('text-zinc-300', 'bg-transparent', 'font-medium', 'border-transparent');
      }
    });

    // 5. Close sidebar drawer
    const adminSidebarDrawer = document.getElementById('adminSidebarDrawer');
    const adminSidebarBackdrop = document.getElementById('adminSidebarBackdrop');
    if (adminSidebarDrawer) adminSidebarDrawer.classList.add('-translate-x-full');
    if (adminSidebarBackdrop) adminSidebarBackdrop.classList.add('hidden');

    lucide.createIcons();
  }

  function initTabs() {
    const tabBtnProjector = document.getElementById('tabBtnProjector');
    const tabBtnAttendance = document.getElementById('tabBtnAttendance');
    const tabBtnSettings = document.getElementById('tabBtnSettings');

    if (tabBtnProjector) tabBtnProjector.addEventListener('click', () => switchAdminView('projector'));
    if (tabBtnAttendance) tabBtnAttendance.addEventListener('click', () => switchAdminView('attendance'));
    if (tabBtnSettings) tabBtnSettings.addEventListener('click', () => switchAdminView('settings'));
  }

  function renderAdminAccountsList() {
    const listEl = document.getElementById('adminAccountsList');
    if (!listEl) return;
    const accounts = getAdminAccounts();
    const canDelete = accounts.length > 1;
    const currentDev = window.DeviceFingerprint ? window.DeviceFingerprint.getDeviceInfo() : { deviceId: 'dev_local', deviceInfo: 'Perangkat Ini' };

    listEl.innerHTML = accounts.map(acc => {
      let statusBadge = '';
      if (acc.isOnline) {
        if (acc.activeDeviceId === currentDev.deviceId) {
          statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Online • ${escapeHtml(acc.deviceInfo || 'Perangkat Ini')} (Perangkat Ini)</span>`;
        } else {
          statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">Online • ${escapeHtml(acc.deviceInfo || 'Perangkat Lain')}</span>`;
        }
      } else {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">Offline</span>`;
      }

      return `
        <div class="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full ${acc.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}"></span>
            <div>
              <div class="font-bold text-white font-mono flex items-center gap-2">
                <span>${escapeHtml(acc.username)}</span>
                <span class="text-[10px] font-normal text-zinc-400">(${acc.role || 'Admin'})</span>
              </div>
              <div class="mt-0.5">${statusBadge}</div>
            </div>
          </div>
          <div class="flex items-center gap-1.5">
            ${canDelete ? `
              <button type="button" data-del-user="${escapeHtml(acc.username)}"
                class="btn-delete-admin px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-[11px] font-bold transition flex items-center gap-1 cursor-pointer active:scale-95">
                <i data-lucide="trash-2" class="w-3 h-3"></i>
                <span>Hapus</span>
              </button>
            ` : `
              <span class="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-semibold text-indigo-300">Admin Utama</span>
            `}
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.btn-delete-admin').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = btn.getAttribute('data-del-user');
        if (!u) return;
        const current = getAdminAccounts();
        if (current.length <= 1) {
          alert('Tidak dapat menghapus akun admin terakhir. Minimal harus ada 1 akun admin aktif di sistem.');
          return;
        }

        pendingDeleteUsername = u;
        const modal = document.getElementById('modalConfirmDeleteAdmin');
        const userText = document.getElementById('confirmDeleteAdminUserText');
        const passInput = document.getElementById('inputDeleteAdminPass');
        const errText = document.getElementById('deleteAdminError');
        if (userText) userText.textContent = u;
        if (passInput) passInput.value = '';
        if (errText) errText.classList.add('hidden');
        if (modal) modal.classList.remove('hidden');
        if (passInput) passInput.focus();
        lucide.createIcons();
      });
    });

    lucide.createIcons();
  }

  function initAdminAccountManagement() {
    const formAddAdmin = document.getElementById('formAddAdmin');
    const newAdminUser = document.getElementById('newAdminUser');
    const newAdminPass = document.getElementById('newAdminPass');

    if (formAddAdmin) {
      formAddAdmin.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = newAdminUser ? newAdminUser.value.trim() : '';
        const password = newAdminPass ? newAdminPass.value.trim() : '';

        if (!username || !password) {
          alert('Harap isi username dan password admin.');
          return;
        }

        const accounts = getAdminAccounts();
        if (accounts.some(a => a.username.toLowerCase() === username.toLowerCase())) {
          alert(`Username "${username}" sudah digunakan. Silakan gunakan username lain.`);
          return;
        }

        pendingNewAdmin = { username, password };
        const modal = document.getElementById('modalConfirmAddAdmin');
        const userText = document.getElementById('confirmAddAdminUserText');
        const passInput = document.getElementById('inputConfirmAddAdminPass');
        const errText = document.getElementById('confirmAddAdminError');
        if (userText) userText.textContent = username;
        if (passInput) passInput.value = '';
        if (errText) errText.classList.add('hidden');
        if (modal) modal.classList.remove('hidden');
        if (passInput) passInput.focus();
        lucide.createIcons();
      });
    }
  }

  function renderSwitchAdminList() {
    const listEl = document.getElementById('switchAdminList');
    const badgeEl = document.getElementById('currentAdminBadge');
    const activeUsername = sessionStorage.getItem('sqr_admin_username') || 'Admin1118';
    if (badgeEl) badgeEl.textContent = activeUsername;
    if (!listEl) return;

    const accounts = getAdminAccounts();
    const currentDev = window.DeviceFingerprint ? window.DeviceFingerprint.getDeviceInfo() : { deviceId: 'dev_local', deviceInfo: 'Perangkat Ini' };

    listEl.innerHTML = accounts.map(acc => {
      const isCurrentActive = acc.username.toLowerCase() === activeUsername.toLowerCase();
      const isOnlineOtherDevice = acc.isOnline && acc.activeDeviceId && acc.activeDeviceId !== currentDev.deviceId;

      if (isCurrentActive) {
        return `
          <div class="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2 relative">
            <div class="flex items-center justify-between">
              <span class="font-bold text-white text-xs font-mono">${escapeHtml(acc.username)}</span>
              <span class="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/30">Aktif Saat Ini</span>
            </div>
            <div class="text-[11px] text-zinc-400 flex items-center gap-1.5">
              <i data-lucide="laptop" class="w-3.5 h-3.5 text-emerald-400"></i>
              <span class="truncate">${escapeHtml(acc.deviceInfo || 'Perangkat Ini')}</span>
            </div>
            <div class="pt-1">
              <span class="block w-full py-1.5 text-center rounded-lg bg-emerald-500/20 text-emerald-300 font-semibold text-[11px]">
                Sedang Digunakan
              </span>
            </div>
          </div>
        `;
      } else if (isOnlineOtherDevice) {
        return `
          <div class="p-3.5 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-2 opacity-80">
            <div class="flex items-center justify-between">
              <span class="font-bold text-white text-xs font-mono">${escapeHtml(acc.username)}</span>
              <span class="text-[10px] font-bold text-rose-400 bg-rose-500/20 px-2 py-0.5 rounded border border-rose-500/30">Dipakai di Perangkat Lain</span>
            </div>
            <div class="text-[11px] text-zinc-400 flex items-center gap-1.5">
              <i data-lucide="shield-alert" class="w-3.5 h-3.5 text-rose-400"></i>
              <span class="truncate">${escapeHtml(acc.deviceInfo || 'Perangkat Lain')}</span>
            </div>
            <div class="pt-1">
              <button type="button" disabled
                class="w-full py-1.5 rounded-lg bg-zinc-800 text-zinc-500 text-[11px] font-semibold cursor-not-allowed">
                Tidak Dapat Dipilih
              </button>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 hover:border-indigo-500/50 transition space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-bold text-white text-xs font-mono">${escapeHtml(acc.username)}</span>
              <span class="text-[10px] font-medium text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700">Tersedia</span>
            </div>
            <div class="text-[11px] text-zinc-400 flex items-center gap-1.5">
              <i data-lucide="user-check" class="w-3.5 h-3.5 text-indigo-400"></i>
              <span>${acc.role || 'Admin'}</span>
            </div>
            <div class="pt-1">
              <button type="button" data-switch-user="${escapeHtml(acc.username)}"
                class="btn-switch-admin w-full py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-400 hover:to-blue-500 text-white text-[11px] font-bold transition shadow cursor-pointer active:scale-98">
                Beralih ke Akun Ini
              </button>
            </div>
          </div>
        `;
      }
    }).join('');

    listEl.querySelectorAll('.btn-switch-admin').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = btn.getAttribute('data-switch-user');
        if (!u) return;
        pendingSwitchUsername = u;
        const modal = document.getElementById('modalConfirmSwitchAdmin');
        const userText = document.getElementById('confirmSwitchAdminUserText');
        const passInput = document.getElementById('inputSwitchAdminPass');
        const errText = document.getElementById('switchAdminError');
        if (userText) userText.textContent = u;
        if (passInput) passInput.value = '';
        if (errText) errText.classList.add('hidden');
        if (modal) modal.classList.remove('hidden');
        if (passInput) passInput.focus();
        lucide.createIcons();
      });
    });

    lucide.createIcons();
  }

  function initSidebarAndSettings() {
    const btnOpenSidebar = document.getElementById('btnOpenSidebar');
    const btnCloseSidebar = document.getElementById('btnCloseSidebar');
    const adminSidebarDrawer = document.getElementById('adminSidebarDrawer');
    const adminSidebarBackdrop = document.getElementById('adminSidebarBackdrop');

    const sidebarBtnProjector = document.getElementById('sidebarBtnProjector');
    const sidebarBtnAttendance = document.getElementById('sidebarBtnAttendance');
    const sidebarBtnSettings = document.getElementById('sidebarBtnSettings');

    const btnAdminThemeToggle = document.getElementById('btnAdminThemeToggle');
    const btnFullscreenSetting = document.getElementById('btnFullscreenSetting');
    const btnLogoutAdmin = document.getElementById('btnLogoutAdmin');

    function openSidebar() {
      if (adminSidebarDrawer) adminSidebarDrawer.classList.remove('-translate-x-full');
      if (adminSidebarBackdrop) adminSidebarBackdrop.classList.remove('hidden');
      lucide.createIcons();
    }

    function closeSidebar() {
      if (adminSidebarDrawer) adminSidebarDrawer.classList.add('-translate-x-full');
      if (adminSidebarBackdrop) adminSidebarBackdrop.classList.add('hidden');
    }

    if (btnOpenSidebar) btnOpenSidebar.addEventListener('click', openSidebar);
    if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', closeSidebar);
    if (adminSidebarBackdrop) adminSidebarBackdrop.addEventListener('click', closeSidebar);

    if (sidebarBtnProjector) {
      sidebarBtnProjector.addEventListener('click', () => {
        closeSidebar();
        switchAdminView('projector');
      });
    }

    if (sidebarBtnAttendance) {
      sidebarBtnAttendance.addEventListener('click', () => {
        closeSidebar();
        switchAdminView('attendance');
      });
    }

    if (sidebarBtnSettings) {
      sidebarBtnSettings.addEventListener('click', () => {
        closeSidebar();
        switchAdminView('settings');
      });
    }

    if (btnAdminThemeToggle) {
      btnAdminThemeToggle.addEventListener('click', () => {
        toggleTheme();
      });
    }

    if (btnFullscreenSetting) {
      btnFullscreenSetting.addEventListener('click', () => {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else if (document.documentElement.webkitRequestFullscreen) {
            document.documentElement.webkitRequestFullscreen();
          }
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          }
        }
      });
    }

    if (btnLogoutAdmin) {
      btnLogoutAdmin.addEventListener('click', handleAdminLogout);
    }

    // Dynamic Fullscreen Button Label & Icon with standard and webkit support
    function updateFullscreenUI() {
      const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
      const fullscreenLabel = document.getElementById('fullscreenLabel');
      const fullscreenIcon = document.getElementById('fullscreenIcon');
      if (fullscreenLabel) {
        fullscreenLabel.textContent = isFull ? 'Keluar Layar Penuh' : 'Layar Penuh';
      }
      if (fullscreenIcon) {
        fullscreenIcon.setAttribute('data-lucide', isFull ? 'minimize' : 'maximize');
        lucide.createIcons();
      }
    }
    document.addEventListener('fullscreenchange', updateFullscreenUI);
    document.addEventListener('webkitfullscreenchange', updateFullscreenUI);

    initAdminAccountManagement();
    renderAdminAccountsList();
    renderSwitchAdminList();
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

  // --- DATABASE FILTER ENGINE (COMPACT DROPDOWN WITH CONDITIONAL MONTH REVEAL) ---
  function populateYearFilter() {
    const selectFilterYear = document.getElementById('selectFilterYear');
    if (!selectFilterYear) return;

    const attendances = getStoredAttendances();
    const currentYear = new Date().getFullYear();
    const yearSet = new Set();
    yearSet.add(2026);
    if (currentYear > 2026) yearSet.add(currentYear);
    attendances.forEach(a => {
      if (a.date) {
        const yr = parseInt(a.date.split('-')[0], 10);
        if (!isNaN(yr) && yr >= 2026) yearSet.add(yr);
      }
    });

    const prevVal = selectFilterYear.value;
    selectFilterYear.innerHTML = '<option value="ALL">Semua Tahun</option>';
    Array.from(yearSet).sort((a, b) => a - b).forEach(y => {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = `Tahun ${y}`;
      selectFilterYear.appendChild(opt);
    });

    if (prevVal && Array.from(yearSet).map(String).includes(prevVal)) {
      selectFilterYear.value = prevVal;
    } else {
      selectFilterYear.value = 'ALL';
    }

    const labelDropdownYear = document.getElementById('labelDropdownYear');
    if (labelDropdownYear) {
      const cur = selectFilterYear.options[selectFilterYear.selectedIndex];
      labelDropdownYear.textContent = cur ? cur.textContent : 'Semua Tahun';
    }
  }

  function populateDayFilter(year, month) {
    const selectFilterDay = document.getElementById('selectFilterDay');
    if (!selectFilterDay) return;

    const prevVal = selectFilterDay.value;
    selectFilterDay.innerHTML = '<option value="ALL">Semua Tanggal</option>';

    if (!month || month === 'ALL') {
      const labelDropdownDay = document.getElementById('labelDropdownDay');
      if (labelDropdownDay) labelDropdownDay.textContent = 'Semua Tanggal';
      return;
    }

    const y = (year && year !== 'ALL') ? parseInt(year, 10) : new Date().getFullYear();
    const m = parseInt(month, 10);
    const daysInMonth = new Date(y, m, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = String(d).padStart(2, '0');
      const opt = document.createElement('option');
      opt.value = dayStr;
      opt.textContent = `Tanggal ${dayStr}`;
      selectFilterDay.appendChild(opt);
    }

    if (prevVal && prevVal !== 'ALL' && parseInt(prevVal, 10) <= daysInMonth) {
      selectFilterDay.value = prevVal;
    } else {
      selectFilterDay.value = 'ALL';
    }

    const labelDropdownDay = document.getElementById('labelDropdownDay');
    if (labelDropdownDay) {
      const cur = selectFilterDay.options[selectFilterDay.selectedIndex];
      labelDropdownDay.textContent = cur ? cur.textContent : 'Semua Tanggal';
    }
  }

  // Custom Downward Dropdown Controller (Task 1: downward direction, omit active choice, compact 2/6 column grid)
  function initCustomDropdowns() {
    const configs = [
      {
        type: 'year',
        btnId: 'btnDropdownYear',
        menuId: 'menuDropdownYear',
        labelId: 'labelDropdownYear',
        selectId: 'selectFilterYear',
        getOptions: () => {
          const sel = document.getElementById('selectFilterYear');
          if (!sel) return [];
          return Array.from(sel.options).map(o => ({ value: o.value, label: o.textContent }));
        },
        render: (menu, options, currentVal, onSelect) => {
          const displayOpts = options.filter(o => o.value !== currentVal);
          menu.innerHTML = `
            <div class="py-1">
              ${displayOpts.map(opt => `
                <div class="px-3 py-1.5 text-xs text-zinc-200 hover:bg-indigo-600 hover:text-white cursor-pointer transition flex items-center justify-between" data-val="${opt.value}">
                  <span>${escapeHtml(opt.label)}</span>
                </div>
              `).join('')}
            </div>
          `;
          menu.querySelectorAll('[data-val]').forEach(item => {
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              onSelect(item.getAttribute('data-val'));
            });
          });
        }
      },
      {
        type: 'month',
        btnId: 'btnDropdownMonth',
        menuId: 'menuDropdownMonth',
        labelId: 'labelDropdownMonth',
        selectId: 'selectFilterMonth',
        getOptions: () => [
          { value: 'ALL', label: 'Semua Bulan' },
          { value: '01', label: 'Januari' },
          { value: '02', label: 'Februari' },
          { value: '03', label: 'Maret' },
          { value: '04', label: 'April' },
          { value: '05', label: 'Mei' },
          { value: '06', label: 'Juni' },
          { value: '07', label: 'Juli' },
          { value: '08', label: 'Agustus' },
          { value: '09', label: 'September' },
          { value: '10', label: 'Oktober' },
          { value: '11', label: 'November' },
          { value: '12', label: 'Desember' }
        ],
        render: (menu, options, currentVal, onSelect) => {
          const isAllSelected = currentVal === 'ALL';
          const monthOpts = options.filter(o => o.value !== 'ALL' && o.value !== currentVal);

          let html = '';
          if (!isAllSelected) {
            html += `
              <div class="w-full pb-1">
                <button type="button" data-val="ALL"
                  class="w-full py-1.5 px-3 rounded-lg bg-indigo-500/15 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/25 font-bold text-xs transition cursor-pointer text-center">
                  Semua Bulan
                </button>
              </div>
            `;
          }

          html += `
            <div class="grid grid-cols-2 gap-1 pt-0.5">
              ${monthOpts.map(m => `
                <button type="button" data-val="${m.value}"
                  class="py-1.5 px-2 rounded-lg bg-white/5 hover:bg-indigo-600 hover:text-white text-zinc-300 text-xs font-medium transition cursor-pointer text-center truncate">
                  ${m.label}
                </button>
              `).join('')}
            </div>
          `;
          menu.innerHTML = html;
          menu.querySelectorAll('[data-val]').forEach(item => {
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              onSelect(item.getAttribute('data-val'));
            });
          });
        }
      },
      {
        type: 'week',
        btnId: 'btnDropdownWeek',
        menuId: 'menuDropdownWeek',
        labelId: 'labelDropdownWeek',
        selectId: 'selectFilterWeek',
        getOptions: () => [
          { value: 'ALL', label: 'Semua Minggu' },
          { value: 'W1', label: 'Minggu 1' },
          { value: 'W2', label: 'Minggu 2' },
          { value: 'W3', label: 'Minggu 3' },
          { value: 'W4', label: 'Minggu 4' }
        ],
        render: (menu, options, currentVal, onSelect) => {
          const displayOpts = options.filter(o => o.value !== currentVal);
          menu.innerHTML = `
            <div class="py-1">
              ${displayOpts.map(opt => `
                <div class="px-3 py-1.5 text-xs text-zinc-200 hover:bg-indigo-600 hover:text-white cursor-pointer transition flex items-center justify-between" data-val="${opt.value}">
                  <span>${escapeHtml(opt.label)}</span>
                </div>
              `).join('')}
            </div>
          `;
          menu.querySelectorAll('[data-val]').forEach(item => {
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              onSelect(item.getAttribute('data-val'));
            });
          });
        }
      },
      {
        type: 'day',
        btnId: 'btnDropdownDay',
        menuId: 'menuDropdownDay',
        labelId: 'labelDropdownDay',
        selectId: 'selectFilterDay',
        getOptions: () => {
          const sel = document.getElementById('selectFilterDay');
          if (!sel) return [];
          return Array.from(sel.options).map(o => ({ value: o.value, label: o.textContent }));
        },
        render: (menu, options, currentVal, onSelect) => {
          const isAllSelected = currentVal === 'ALL';
          const dayOpts = options.filter(o => o.value !== 'ALL' && o.value !== currentVal);

          let html = '';
          if (!isAllSelected) {
            html += `
              <div class="w-full pb-1">
                <button type="button" data-val="ALL"
                  class="w-full py-1.5 px-3 rounded-lg bg-indigo-500/15 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/25 font-bold text-xs transition cursor-pointer text-center">
                  Semua Tanggal
                </button>
              </div>
            `;
          }

          html += `
            <div class="grid grid-cols-6 gap-1 pt-0.5">
              ${dayOpts.map(d => `
                <button type="button" data-val="${d.value}"
                  class="py-1 rounded bg-white/5 hover:bg-indigo-600 hover:text-white text-zinc-300 font-mono text-[11px] font-semibold transition cursor-pointer text-center">
                  ${d.value}
                </button>
              `).join('')}
            </div>
          `;
          menu.innerHTML = html;
          menu.querySelectorAll('[data-val]').forEach(item => {
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              onSelect(item.getAttribute('data-val'));
            });
          });
        }
      }
    ];

    function closeAllMenus() {
      configs.forEach(cfg => {
        const menu = document.getElementById(cfg.menuId);
        if (menu) menu.classList.add('hidden');
      });
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.filter-dropdown-group')) {
        closeAllMenus();
      }
    });

    configs.forEach(cfg => {
      const btn = document.getElementById(cfg.btnId);
      const menu = document.getElementById(cfg.menuId);
      const label = document.getElementById(cfg.labelId);
      const select = document.getElementById(cfg.selectId);
      if (!btn || !menu || !label || !select) return;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = menu.classList.contains('hidden');
        closeAllMenus();
        if (willOpen) {
          const currentVal = select.value || 'ALL';
          const opts = cfg.getOptions();
          cfg.render(menu, opts, currentVal, (chosenVal) => {
            select.value = chosenVal;
            const chosenOpt = opts.find(o => o.value === chosenVal);
            label.textContent = chosenOpt ? chosenOpt.label : chosenVal;
            menu.classList.add('hidden');
            select.dispatchEvent(new Event('change'));
          });
          menu.classList.remove('hidden');
        }
      });
    });
  }

  function initPeriodFilters() {
    const filterSearch = document.getElementById('filterSearch');
    const selectFilterYear = document.getElementById('selectFilterYear');
    const selectFilterMonth = document.getElementById('selectFilterMonth');
    const selectFilterWeek = document.getElementById('selectFilterWeek');
    const selectFilterDay = document.getElementById('selectFilterDay');
    const containerFilterWeek = document.getElementById('containerFilterWeek');
    const containerFilterDay = document.getElementById('containerFilterDay');

    const btnResetFilter = document.getElementById('btnResetFilter');
    const btnExportCsv = document.getElementById('btnExportCsv');
    const btnResetData = document.getElementById('btnResetData');

    populateYearFilter();
    initCustomDropdowns();

    function updateMonthConditionalVisibility() {
      const monthVal = selectFilterMonth ? selectFilterMonth.value : 'ALL';
      const yearVal = selectFilterYear ? selectFilterYear.value : 'ALL';

      if (monthVal !== 'ALL') {
        if (containerFilterWeek) containerFilterWeek.classList.remove('hidden');
        if (containerFilterDay) containerFilterDay.classList.remove('hidden');
        populateDayFilter(yearVal, monthVal);
      } else {
        if (containerFilterWeek) containerFilterWeek.classList.add('hidden');
        if (containerFilterDay) containerFilterDay.classList.add('hidden');
        if (selectFilterWeek) selectFilterWeek.value = 'ALL';
        if (selectFilterDay) selectFilterDay.value = 'ALL';
        const labelWeek = document.getElementById('labelDropdownWeek');
        const labelDay = document.getElementById('labelDropdownDay');
        if (labelWeek) labelWeek.textContent = 'Semua Minggu';
        if (labelDay) labelDay.textContent = 'Semua Tanggal';
      }
    }

    if (selectFilterMonth) {
      selectFilterMonth.addEventListener('change', () => {
        updateMonthConditionalVisibility();
        loadAttendanceData();
      });
    }

    if (selectFilterYear) {
      selectFilterYear.addEventListener('change', () => {
        const monthVal = selectFilterMonth ? selectFilterMonth.value : 'ALL';
        if (monthVal !== 'ALL') {
          populateDayFilter(selectFilterYear.value, monthVal);
        }
        loadAttendanceData();
      });
    }

    if (selectFilterWeek) {
      selectFilterWeek.addEventListener('change', () => {
        loadAttendanceData();
      });
    }

    if (selectFilterDay) {
      selectFilterDay.addEventListener('change', () => {
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
        if (filterSearch) filterSearch.value = '';
        if (selectFilterYear) selectFilterYear.value = 'ALL';
        if (selectFilterMonth) selectFilterMonth.value = 'ALL';
        if (selectFilterWeek) selectFilterWeek.value = 'ALL';
        if (selectFilterDay) selectFilterDay.value = 'ALL';
        const labelYear = document.getElementById('labelDropdownYear');
        const labelMonth = document.getElementById('labelDropdownMonth');
        const labelWeek = document.getElementById('labelDropdownWeek');
        const labelDay = document.getElementById('labelDropdownDay');
        if (labelYear) labelYear.textContent = 'Semua Tahun';
        if (labelMonth) labelMonth.textContent = 'Semua Bulan';
        if (labelWeek) labelWeek.textContent = 'Semua Minggu';
        if (labelDay) labelDay.textContent = 'Semua Tanggal';
        updateMonthConditionalVisibility();
        loadAttendanceData();
        showToast('Filter Direset', 'Semua filter dikembalikan ke Semua Waktu.');
      });
    }

    // Export CSV
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', exportCsvData);
    }

    // Reset Data
    if (btnResetData) {
      btnResetData.addEventListener('click', () => {
        const conf = confirm('PERINGATAN:\n\nApakah Anda yakin ingin MENGHAPUS SEMUA riwayat data absensi dan token?\nTindakan ini bersifat permanen.');
        if (!conf) return;

        saveAttendances([]);
        saveTokens([]);
        createNewActiveToken('MASUK');
        createNewActiveToken('KELUAR');
        if (filterSearch) filterSearch.value = '';
        if (selectFilterYear) selectFilterYear.value = 'ALL';
        if (selectFilterMonth) selectFilterMonth.value = 'ALL';
        if (selectFilterWeek) selectFilterWeek.value = 'ALL';
        if (selectFilterDay) selectFilterDay.value = 'ALL';
        const labelYear = document.getElementById('labelDropdownYear');
        const labelMonth = document.getElementById('labelDropdownMonth');
        const labelWeek = document.getElementById('labelDropdownWeek');
        const labelDay = document.getElementById('labelDropdownDay');
        if (labelYear) labelYear.textContent = 'Semua Tahun';
        if (labelMonth) labelMonth.textContent = 'Semua Bulan';
        if (labelWeek) labelWeek.textContent = 'Semua Minggu';
        if (labelDay) labelDay.textContent = 'Semua Tanggal';
        updateMonthConditionalVisibility();
        loadAttendanceData();
        showToast('Data Direset', 'Seluruh data absensi telah dikosongkan.');
      });
    }
  }

  // --- 7. LOAD ATTENDANCE DATA & COMPREHENSIVE FILTER ENGINE ---
  function getFilteredAttendanceRecords() {
    const all = getStoredAttendances();
    const selectFilterYear = document.getElementById('selectFilterYear');
    const selectFilterMonth = document.getElementById('selectFilterMonth');
    const selectFilterWeek = document.getElementById('selectFilterWeek');
    const selectFilterDay = document.getElementById('selectFilterDay');
    const filterSearch = document.getElementById('filterSearch');

    const selectedYear = selectFilterYear ? selectFilterYear.value : 'ALL';
    const selectedMonth = selectFilterMonth ? selectFilterMonth.value : 'ALL';
    const selectedWeek = (selectFilterWeek && selectFilterMonth && selectFilterMonth.value !== 'ALL') ? selectFilterWeek.value : 'ALL';
    const selectedDay = (selectFilterDay && selectFilterMonth && selectFilterMonth.value !== 'ALL') ? selectFilterDay.value : 'ALL';
    const searchTerm = filterSearch ? filterSearch.value.trim().toLowerCase() : '';

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

      // 4. Week filter (4 Minggu: W1: 1-7, W2: 8-14, W3: 15-21, W4: 22-end)
      if (selectedWeek !== 'ALL') {
        const dayNum = parseInt((item.date || '').split('-')[2], 10);
        if (!isNaN(dayNum)) {
          if (selectedWeek === 'W1' && (dayNum < 1 || dayNum > 7)) return false;
          if (selectedWeek === 'W2' && (dayNum < 8 || dayNum > 14)) return false;
          if (selectedWeek === 'W3' && (dayNum < 15 || dayNum > 21)) return false;
          if (selectedWeek === 'W4' && dayNum < 22) return false;
        }
      }

      // 5. Day filter (Tanggal 01 - 31)
      if (selectedDay !== 'ALL') {
        const itemDay = (item.date || '').split('-')[2];
        if (itemDay !== selectedDay) return false;
      }

      return true;
    });

    return {
      filtered,
      selectedYear,
      selectedMonth,
      selectedWeek,
      selectedDay,
      searchTerm
    };
  }

  function loadAttendanceData() {
    const attendanceTableHead = document.getElementById('attendanceTableHead');
    const attendanceTableBody = document.getElementById('attendanceTableBody');
    const metricFilteredCount = document.getElementById('metricFilteredCount');
    const metricMasukCount = document.getElementById('metricMasukCount');
    const metricKeluarCount = document.getElementById('metricKeluarCount');
    const metricTotalAllTime = document.getElementById('metricTotalAllTime');

    if (!attendanceTableBody) return;

    const { filtered } = getFilteredAttendanceRecords();

    // Update Metrics (Requirement 8)
    const masukCount = filtered.filter(a => a.type === 'MASUK' || !a.type).length;
    const keluarCount = filtered.filter(a => a.type === 'KELUAR').length;

    if (metricFilteredCount) metricFilteredCount.textContent = filtered.length;
    if (metricMasukCount) metricMasukCount.textContent = masukCount;
    if (metricKeluarCount) metricKeluarCount.textContent = keluarCount;
    if (metricTotalAllTime) metricTotalAllTime.textContent = filtered.length;

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
        attendanceTableBody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-zinc-500 font-medium text-xs">Belum ada data absensi.</td></tr>`;
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
        attendanceTableBody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-zinc-500 font-medium text-xs">Belum ada data absensi.</td></tr>`;
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
        attendanceTableBody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-zinc-500 font-medium text-xs">Belum ada data absensi.</td></tr>`;
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

  // --- CSV EXPORT (Task 2: rapi, sesuai kategori dan filter aktif) ---
  function exportCsvData() {
    const { filtered, selectedYear, selectedMonth, selectedWeek, selectedDay, searchTerm } = getFilteredAttendanceRecords();

    if (filtered.length === 0) {
      alert('Tidak ada data absensi yang sesuai dengan filter saat ini untuk diekspor.');
      return;
    }

    const now = new Date();
    const dateStr = getLocalDateString(now);
    const exportTime = `${getIndonesianDayName(now)}, ${now.getDate()} ${getIndonesianMonthName(now.getMonth())} ${now.getFullYear()} - ${now.toLocaleTimeString('id-ID', { hour12: false })} WIB`;
    const catLabel = activeSubTab === 'UTAMA' ? 'Absensi Utama (Rekap Terpadu Masuk & Keluar)' : (activeSubTab === 'MASUK' ? 'Absensi Masuk' : 'Absensi Keluar');
    const yearLabel = selectedYear === 'ALL' ? 'Semua Tahun' : `Tahun ${selectedYear}`;
    const monthLabel = selectedMonth === 'ALL' ? 'Semua Bulan' : getIndonesianMonthName(parseInt(selectedMonth, 10) - 1);
    const weekLabel = selectedWeek === 'ALL' ? 'Semua Minggu' : `Minggu ${selectedWeek.replace('W', '')}`;
    const dayLabel = selectedDay === 'ALL' ? 'Semua Tanggal' : `Tanggal ${selectedDay}`;

    const lines = [];
    // Report Header Metadata Block
    lines.push(['"LAPORAN REKAPITULASI DATA ABSENSI"']);
    lines.push(['"Kategori Laporan"', `"${catLabel}"`]);
    lines.push(['"Filter Tahun"', `"${yearLabel}"`]);
    lines.push(['"Filter Bulan"', `"${monthLabel}"`]);
    lines.push(['"Filter Minggu"', `"${weekLabel}"`]);
    lines.push(['"Filter Tanggal"', `"${dayLabel}"`]);
    lines.push(['"Kata Kunci Pencarian"', `"${searchTerm || '-'}"`]);
    lines.push(['"Waktu Ekspor"', `"${exportTime}"`]);
    lines.push(['"Total Data Terfilter"', `"${filtered.length} Baris"`]);
    lines.push(['""']); // Spacer

    if (activeSubTab === 'UTAMA') {
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
        if (rec.type === 'KELUAR') item.keluar = rec;
        else item.masuk = rec;
      });

      const paired = Array.from(groupMap.values());
      lines.push(['"No"', '"Nama Lengkap"', '"Hari"', '"Tanggal"', '"Jam Masuk"', '"Jam Keluar"', '"Status Kehadiran"', '"ID Perangkat"', '"Info Perangkat"']);
      paired.forEach((p, idx) => {
        const statusStr = (p.masuk && p.keluar) ? 'LENGKAP' : (p.masuk ? 'BELUM KELUAR' : 'HANYA KELUAR');
        lines.push([
          idx + 1,
          `"${(p.name || '').replace(/"/g, '""')}"`,
          `"${p.day || ''}"`,
          `"${p.date || ''}"`,
          `"${p.masuk ? p.masuk.time + ' WIB' : '-'}"`,
          `"${p.keluar ? p.keluar.time + ' WIB' : '-'}"`,
          `"${statusStr}"`,
          `"${(p.device_id || '').replace(/"/g, '""')}"`,
          `"${(p.device_info || '').replace(/"/g, '""')}"`
        ]);
      });
      downloadCsv(lines, `Rekap_Absensi_Utama_${dateStr}.csv`);
    } else {
      const isKel = activeSubTab === 'KELUAR';
      const records = filtered.filter(a => isKel ? a.type === 'KELUAR' : (a.type === 'MASUK' || !a.type));
      lines.push(['"No"', '"Tipe Absen"', '"Nama Lengkap"', '"Hari"', '"Tanggal"', '"Jam"', '"Token QR"', '"ID Perangkat"', '"Info Perangkat"']);
      records.forEach((a, idx) => {
        lines.push([
          idx + 1,
          `"${a.type || 'MASUK'}"`,
          `"${(a.name || '').replace(/"/g, '""')}"`,
          `"${a.day || ''}"`,
          `"${a.date || ''}"`,
          `"${a.time || ''} WIB"`,
          `"${(a.token || '').replace(/"/g, '""')}"`,
          `"${(a.device_id || '').replace(/"/g, '""')}"`,
          `"${(a.device_info || '').replace(/"/g, '""')}"`
        ]);
      });
      downloadCsv(lines, `Rekap_Absensi_${activeSubTab}_${dateStr}.csv`);
    }
  }

  function downloadCsv(lines, filename) {
    const csvContent = '\uFEFF' + lines.map(row => row.join(',')).join('\r\n');
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

    // 1. PRIMARY: Synchronous client-side QRCode rendering via qrcode.min.js (works offline, zero spinner delay)
    let renderedLocally = false;
    if (typeof QRCode !== 'undefined' && qrCanvasContainer) {
      try {
        qrCanvasContainer.innerHTML = '';
        new QRCode(qrCanvasContainer, {
          text: attendUrl,
          width: 240,
          height: 240,
          colorDark: '#090a0f',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
        qrCanvasContainer.classList.remove('hidden');
        if (qrImage) qrImage.classList.add('hidden');
        if (qrOverlayLoading) qrOverlayLoading.classList.add('hidden');
        renderedLocally = true;
      } catch (err) {
        console.warn('QRCode JS local render error:', err);
      }
    }

    // 2. FALLBACK: Network QR API with strict 1.5s timeout if QRCode library is absent
    if (!renderedLocally) {
      if (qrCanvasContainer) qrCanvasContainer.classList.add('hidden');
      if (qrImage) {
        qrImage.classList.remove('hidden');
        if (qrOverlayLoading) qrOverlayLoading.classList.remove('hidden');
        
        const safetyTimer = setTimeout(() => {
          if (qrOverlayLoading) qrOverlayLoading.classList.add('hidden');
        }, 1500);

        qrImage.onload = () => {
          clearTimeout(safetyTimer);
          if (qrOverlayLoading) qrOverlayLoading.classList.add('hidden');
        };
        qrImage.onerror = () => {
          clearTimeout(safetyTimer);
          if (qrOverlayLoading) qrOverlayLoading.classList.add('hidden');
        };
        qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(attendUrl)}`;
      } else {
        if (qrOverlayLoading) qrOverlayLoading.classList.add('hidden');
      }
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
          showToast('Tautan Masuk Disalin', 'URL absen masuk siap dibagikan.');
        });
      });
    }

    if (btnCopyUrlKeluar && mobileAccessUrlKeluar) {
      btnCopyUrlKeluar.addEventListener('click', () => {
        navigator.clipboard.writeText(mobileAccessUrlKeluar.textContent).then(() => {
          showToast('Tautan Keluar Disalin', 'URL absen keluar siap dibagikan.');
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
