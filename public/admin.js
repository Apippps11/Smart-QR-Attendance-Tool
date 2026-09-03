/**
 * Admin Dashboard & Projector Controller (admin.js)
 * Menangani Socket.io real-time update, pergantian QR otomatis,
 * log audit anti-double, dan rekapan presensi.
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
  const qrCardBox = document.getElementById('qrCardBox');
  const qrOverlayLoading = document.getElementById('qrOverlayLoading');
  const activeTokenText = document.getElementById('activeTokenText');
  const mobileAccessUrl = document.getElementById('mobileAccessUrl');
  const btnCopyUrl = document.getElementById('btnCopyUrl');
  const btnRefreshQr = document.getElementById('btnRefreshQr');
  const btnFullscreen = document.getElementById('btnFullscreen');

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

  let currentAttendances = [];
  let currentActiveToken = null;

  // --- 1. WEB AUDIO API CHIME (Sound Notification on Scan) ---
  function playSuccessChime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

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
      console.warn('Audio chime error:', e);
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

  // --- 3. SOCKET.IO REALTIME CONNECTION ---
  const socket = io();

  socket.on('connect', () => {
    console.log('Connected to real-time sync server');
    socket.emit('request_active_qr', { host: window.location.host });
  });

  // Saat server mengirim QR aktif terbaru
  socket.on('active_qr_updated', (qrData) => {
    updateQrDisplay(qrData);
  });

  // Saat ada peserta yang berhasil absen!
  socket.on('attendance_recorded', (data) => {
    playSuccessChime();
    triggerVisualFlash();
    showToast(data.attendance.name, `Presensi pukul ${data.attendance.time} WIB. QR baru telah dibuat!`);
    addLiveActivityItem(data.attendance);

    // Refresh tabel jika tab sedang aktif
    if (!viewAudit.classList.contains('hidden')) {
      loadAuditData();
    }
    if (!viewAttendance.classList.contains('hidden')) {
      loadAttendanceData();
    }
  });

  socket.on('data_reset', () => {
    showToast('Data Direset', 'Seluruh data presensi dan QR telah dibersihkan.');
    loadAuditData();
    loadAttendanceData();
    socket.emit('request_active_qr', { host: window.location.host });
  });

  // --- 4. QR DISPLAY LOGIC ---
  function updateQrDisplay(qrData) {
    if (!qrData || !qrData.qrImage) return;
    currentActiveToken = qrData.token;

    qrImage.src = qrData.qrImage;
    activeTokenText.textContent = qrData.token;
    mobileAccessUrl.textContent = qrData.url;
    mobileAccessUrl.dataset.url = qrData.url;

    qrOverlayLoading.classList.add('hidden');
  }

  function triggerVisualFlash() {
    qrCardBox.classList.remove('scan-flash');
    void qrCardBox.offsetWidth; // trigger reflow
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

    // Hilangkan teks placeholder jika ada
    if (liveActivityList.querySelector('.text-slate-500')) {
      liveActivityList.innerHTML = '';
    }

    liveActivityList.prepend(item);

    // Update counter
    const currentCount = parseInt(liveFeedCount.dataset.count || '0') + 1;
    liveFeedCount.dataset.count = currentCount;
    liveFeedCount.textContent = `${currentCount} hadir`;
  }

  // Copy Mobile URL to Clipboard
  btnCopyUrl.addEventListener('click', () => {
    const url = mobileAccessUrl.dataset.url || mobileAccessUrl.textContent;
    navigator.clipboard.writeText(url).then(() => {
      const originalTitle = btnCopyUrl.title;
      btnCopyUrl.innerHTML = `<i data-lucide="check" class="w-4 h-4 text-emerald-400"></i>`;
      lucide.createIcons();
      setTimeout(() => {
        btnCopyUrl.innerHTML = `<i data-lucide="copy" class="w-4 h-4"></i>`;
        lucide.createIcons();
      }, 2000);
    });
  });

  // Manual QR Refresh Button
  btnRefreshQr.addEventListener('click', async () => {
    qrOverlayLoading.classList.remove('hidden');
    try {
      const res = await fetch('/api/qr/refresh', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('QR Code Diperbarui', 'Token lama telah kedaluwarsa dan token baru aktif.');
      }
    } catch (e) {
      console.error(e);
      alert('Gagal merefresh QR Code.');
      qrOverlayLoading.classList.add('hidden');
    }
  });

  // Fullscreen Button
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        alert(`Error attempt full-screen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  });

  // --- 5. TAB SWITCHING ---
  function setActiveTab(tabName) {
    // Reset buttons
    [tabBtnProjector, tabBtnAudit, tabBtnAttendance].forEach((btn) => {
      btn.className = 'tab-btn px-3.5 py-2 rounded-lg transition flex items-center gap-2 text-slate-400 hover:text-slate-200';
    });

    // Hide views
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

  // --- 6. TAB 2: AUDIT QR ANTI-DOUBLE LOGIC ---
  async function loadAuditData() {
    try {
      const res = await fetch('/api/qr/audit?limit=100');
      const data = await res.json();

      auditMetricTotal.textContent = data.stats.total;
      auditMetricActive.textContent = data.stats.active;
      auditMetricUsed.textContent = data.stats.used;
      auditMetricExpired.textContent = data.stats.expired;

      if (!data.history || data.history.length === 0) {
        auditTableBody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-500">Belum ada riwayat QR token.</td></tr>`;
        return;
      }

      auditTableBody.innerHTML = data.history.map((item) => {
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
    } catch (e) {
      console.error('Error loading audit data:', e);
    }
  }

  btnRefreshAudit.addEventListener('click', loadAuditData);

  // --- 7. TAB 3: ATTENDANCE RECORDS LOGIC ---
  async function loadAttendanceData() {
    try {
      const dateVal = filterDate.value;
      let url = '/api/attendance/list?limit=500';
      if (dateVal) {
        url += `&date=${encodeURIComponent(dateVal)}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      metricToday.textContent = data.stats.todayCount;
      metricTotalRecords.textContent = data.stats.totalRecords;
      metricUniqueDevices.textContent = data.stats.uniqueDevices;

      currentAttendances = data.records || [];
      renderAttendanceTable();
    } catch (e) {
      console.error('Error loading attendance data:', e);
    }
  }

  function renderAttendanceTable() {
    const searchTerm = (filterSearch.value || '').toLowerCase().trim();

    const filtered = currentAttendances.filter((att) => {
      const matchName = att.name.toLowerCase().includes(searchTerm);
      const matchDevice = (att.device_info || '').toLowerCase().includes(searchTerm) || (att.device_id || '').toLowerCase().includes(searchTerm);
      const matchToken = att.token.toLowerCase().includes(searchTerm);
      return matchName || matchDevice || matchToken;
    });

    if (filtered.length === 0) {
      attendanceTableBody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-500">Tidak ada data kehadiran yang sesuai filter.</td></tr>`;
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
            <div class="text-[10px] text-slate-500 font-mono truncate" title="Device ID: ${escapeHtml(att.device_id)}">${escapeHtml(att.device_id)}</div>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  }

  filterSearch.addEventListener('input', renderAttendanceTable);
  filterDate.addEventListener('change', loadAttendanceData);
  btnResetFilter.addEventListener('click', () => {
    filterSearch.value = '';
    filterDate.value = '';
    loadAttendanceData();
  });

  // --- 8. EXPORT CSV / EXCEL ---
  btnExportCsv.addEventListener('click', () => {
    if (!currentAttendances || currentAttendances.length === 0) {
      alert('Tidak ada data presensi untuk diexport.');
      return;
    }

    const headers = ['No', 'Nama Lengkap', 'Hari', 'Tanggal', 'Jam Masuk', 'Token QR', 'Device ID', 'Info Perangkat'];
    const rows = currentAttendances.map((att, index) => [
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

  // --- 9. RESET DATA MODAL / CONFIRMATION ---
  btnResetData.addEventListener('click', async () => {
    const confirmation = confirm('PERINGATAN:\n\nApakah Anda yakin ingin MENGHAPUS SELURUH data presensi dan riwayat QR?\nTindakan ini tidak dapat dibatalkan.');
    if (!confirmation) return;

    try {
      const res = await fetch('/api/admin/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Data Direset', 'Semua data telah dikosongkan.');
      }
    } catch (e) {
      alert('Gagal mereset data.');
    }
  });

  // Utility HTML Escape
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

});
