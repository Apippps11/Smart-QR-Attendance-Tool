/**
 * Absensi Kehadiran Peserta (attend.js)
 * Fitur:
 * 1. Verifikasi Token QR 1x Pakai
 * 2. Kunci Tanggal Regional Otomatis (Anti-Ubah di iOS / Safari / Android)
 * 3. Live Camera Scanning Saja (Foto Upload Dihapus)
 * 4. MQTT WSS Cloud Sync & Local Storage Fallback
 * 5. Integrasi Google Calendar & .ics
 */

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const sessionId = urlParams.get('session');

  const checkingSection = document.getElementById('checkingSection');
  const scannerSection = document.getElementById('scannerSection');
  const formSection = document.getElementById('formSection');
  const errorSection = document.getElementById('errorSection');
  const successSection = document.getElementById('successSection');

  const errorTitle = document.getElementById('errorTitle');
  const errorMessage = document.getElementById('errorMessage');
  const badgeToken = document.getElementById('badgeToken');

  const attendanceForm = document.getElementById('attendanceForm');
  const inputName = document.getElementById('inputName');
  const displayDate = document.getElementById('displayDate');
  const deviceLabel = document.getElementById('deviceLabel');
  const btnSubmit = document.getElementById('btnSubmit');

  const summaryName = document.getElementById('summaryName');
  const summaryDate = document.getElementById('summaryDate');
  const summaryTime = document.getElementById('summaryTime');
  const summaryToken = document.getElementById('summaryToken');
  const btnGoogleCalendar = document.getElementById('btnGoogleCalendar');
  const btnDownloadIcs = document.getElementById('btnDownloadIcs');

  function getIndonesianDayName(dateObj) {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    return days[dateObj.getDay()];
  }

  function getIndonesianMonthName(monthIdx) {
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return months[monthIdx];
  }

  function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Generate Device Fingerprint
  const { deviceId, deviceInfo } = window.DeviceFingerprint ? window.DeviceFingerprint.getDeviceInfo() : { deviceId: 'dev_client', deviceInfo: 'Mobile Device' };
  if (deviceLabel) {
    deviceLabel.textContent = deviceInfo;
  }

  let mqttClient = null;

  // Inisialisasi Cloud MQTT Client jika ada session
  if (typeof mqtt !== 'undefined' && sessionId) {
    const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
    const clientId = 'sqr_user_' + Math.random().toString(16).substring(2, 10);
    try {
      mqttClient = mqtt.connect(brokerUrl, {
        clientId,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 3000
      });
    } catch (e) {
      console.warn('MQTT init failed:', e);
    }
  }

  // Format Tanggal Regional Indonesia (WIB)
  const today = new Date();
  const fullRegionalDate = `${getIndonesianDayName(today)}, ${today.getDate()} ${getIndonesianMonthName(today.getMonth())} ${today.getFullYear()}`;
  const scannerRegionalDate = document.getElementById('scannerRegionalDate');
  if (scannerRegionalDate) {
    scannerRegionalDate.textContent = fullRegionalDate;
  }

  // JIKA TIDAK ADA TOKEN -> Tampilkan Scanner Kamera Langsung
  if (!token) {
    checkingSection.classList.add('hidden');
    scannerSection.classList.remove('hidden');

    if (typeof Html5QrcodeScanner !== 'undefined') {
      const scanner = new Html5QrcodeScanner("qr-reader", { fps: 12, qrbox: { width: 240, height: 240 } }, false);
      scanner.render((decodedText) => {
        scanner.clear();
        if (decodedText.startsWith('http://') || decodedText.startsWith('https://')) {
          window.location.href = decodedText;
        } else {
          window.location.href = `attend.html?token=${encodeURIComponent(decodedText)}`;
        }
      });
    }
    return;
  }

  // JIKA ADA TOKEN -> Set UI Token & Format Tanggal Terkunci
  badgeToken.textContent = token;

  // Validasi kecocokan tipe QR code (Task 9)
  const expectedTypeParam = (urlParams.get('type') || '').toUpperCase();
  let tokenType = null;
  if (token.includes('-OUT-') || token.startsWith('QR-OUT-')) tokenType = 'KELUAR';
  else if (token.includes('-IN-') || token.startsWith('QR-IN-')) tokenType = 'MASUK';

  if (expectedTypeParam && tokenType && expectedTypeParam !== tokenType) {
    checkingSection.classList.add('hidden');
    errorSection.classList.remove('hidden');
    errorTitle.textContent = 'QR Code Tidak Sesuai';
    errorMessage.textContent = `Anda sedang membuka absensi ${expectedTypeParam === 'MASUK' ? 'Masuk' : 'Keluar'}, namun QR Code yang discan adalah untuk Absensi ${tokenType === 'MASUK' ? 'Masuk' : 'Keluar'}.`;
    lucide.createIcons();
    return;
  }

  if (displayDate) {
    displayDate.textContent = fullRegionalDate;
  }

  // Verifikasi cepat status token
  async function performQuickCheck() {
    try {
      const res = await fetch(`/api/qr/check/${encodeURIComponent(token)}`);
      if (res.ok) {
        return { valid: true };
      } else if (res.status === 409 || res.status === 410 || res.status === 404) {
        const d = await res.json();
        return { valid: false, status: d.status, message: d.message };
      }
    } catch (e) {}

    try {
      const tokens = JSON.parse(localStorage.getItem('sqr_qr_tokens')) || [];
      const target = tokens.find(t => t.token === token);
      if (target && target.status === 'USED') {
        return { valid: false, status: 'USED', message: `QR Code ini sudah pernah digunakan oleh ${target.used_by_name || 'pengguna lain'}.` };
      }
      if (target && target.status === 'EXPIRED') {
        return { valid: false, status: 'EXPIRED', message: 'QR Code ini sudah kedaluwarsa.' };
      }
    } catch (e) {}

    return { valid: true };
  }

  const check = await performQuickCheck();
  checkingSection.classList.add('hidden');

  if (!check.valid) {
    errorSection.classList.remove('hidden');
    if (check.status === 'USED') {
      errorTitle.textContent = 'QR Code Sudah Digunakan';
      errorMessage.textContent = check.message || 'QR Code ini sudah pernah digunakan. Setiap QR Code hanya berlaku 1 kali.';
    } else if (check.status === 'EXPIRED') {
      errorTitle.textContent = 'QR Code Kedaluwarsa';
      errorMessage.textContent = check.message || 'QR Code ini sudah kedaluwarsa. Silakan scan QR code yang baru di layar proyektor.';
    } else {
      errorTitle.textContent = 'QR Code Tidak Sah';
      errorMessage.textContent = check.message || 'Token QR tidak terdaftar dalam sistem.';
    }
    lucide.createIcons();
    return;
  }

  // Token valid -> tampilkan form
  formSection.classList.remove('hidden');
  lucide.createIcons();
  setTimeout(() => inputName.focus(), 200);

  // --- SUBMIT ABSENSI (Sistem Waktu Mutlak - Anti-Ubah Tanggal) ---
  attendanceForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = inputName.value.trim();
    const now = new Date();
    const date = getLocalDateString(now);
    const day = getIndonesianDayName(now);
    const time = now.toLocaleTimeString('id-ID', { hour12: false });

    if (!name) {
      alert('Mohon masukkan nama lengkap Anda.');
      return;
    }

    btnSubmit.disabled = true;
    const originalBtnText = btnSubmit.innerHTML;
    btnSubmit.innerHTML = `
      <div class="inline-block animate-spin w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full mr-2"></div>
      <span>Memverifikasi...</span>
    `;

    const attendType = (urlParams.get('type') || 'MASUK').toUpperCase();
    const reqId = 'req_' + Math.random().toString(36).substring(2, 10);
    const payload = {
      token,
      name,
      type: attendType,
      date,
      day,
      time,
      deviceId,
      deviceInfo,
      reqId
    };

    // 1. Coba kirim via server Node.js jika tersedia
    try {
      const response = await fetch('/api/attendance/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok || response.status === 409 || response.status === 403 || response.status === 400) {
        const result = await response.json();
        if (!response.ok || !result.success) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = originalBtnText;
          alert('Absen Ditolak:\n\n' + (result.error || 'Terjadi kesalahan sistem.'));
          if (response.status === 409) {
            formSection.classList.add('hidden');
            errorSection.classList.remove('hidden');
            errorTitle.textContent = 'QR Code Sudah Digunakan';
            errorMessage.textContent = result.error;
            lucide.createIcons();
          }
          return;
        }

        renderSuccessScreen(result.attendance);
        return;
      }
    } catch (err) {}

    // 2. Kirim via Cloud MQTT WSS (Beda Provider / Wi-Fi)
    if (mqttClient && sessionId) {
      const submitTopic = `smartqr/${sessionId}/submit`;
      const respTopic = `smartqr/${sessionId}/resp/${reqId}`;
      let answered = false;

      mqttClient.subscribe(respTopic, (err) => {
        if (!err) {
          mqttClient.publish(submitTopic, JSON.stringify(payload));
        }
      });

      mqttClient.on('message', (topic, message) => {
        if (topic === respTopic && !answered) {
          answered = true;
          try {
            const res = JSON.parse(message.toString());
            if (!res.success) {
              btnSubmit.disabled = false;
              btnSubmit.innerHTML = originalBtnText;
              alert('Absen Ditolak:\n\n' + res.error);
              return;
            }
            renderSuccessScreen(res.attendance);
          } catch (e) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalBtnText;
            alert('Gagal memproses respon absensi.');
          }
        }
      });

      setTimeout(() => {
        if (!answered) {
          attemptLocalFallback(payload, originalBtnText);
        }
      }, 7000);
      return;
    }

    // 3. Fallback ke Local Storage Engine
    attemptLocalFallback(payload, originalBtnText);
  });

  function attemptLocalFallback(payload, originalBtnText) {
    try {
      const attendances = JSON.parse(localStorage.getItem('sqr_attendances')) || [];
      const currentType = (payload.type || 'MASUK').toUpperCase();

      if (currentType === 'MASUK') {
        const existing = attendances.find(a => a.device_id === deviceId && a.date === payload.date && (a.type === 'MASUK' || !a.type));
        if (existing) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = originalBtnText;
          alert(`Absen Masuk Ditolak:\n\nPerangkat ini sudah tercatat melakukan Absen Masuk hari ini atas nama "${existing.name}". 1 perangkat hanya bisa absen masuk 1 kali per hari.`);
          return;
        }
      } else if (currentType === 'KELUAR') {
        const masukRecord = attendances.find(a => a.device_id === deviceId && a.date === payload.date && (a.type === 'MASUK' || !a.type));
        if (!masukRecord) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = originalBtnText;
          alert('Absen Keluar Ditolak:\n\nPerangkat Anda belum tercatat melakukan Absen Masuk hari ini. Silakan lakukan Absen Masuk terlebih dahulu.');
          return;
        }
        if (masukRecord.name.trim().toLowerCase() !== payload.name.trim().toLowerCase()) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = originalBtnText;
          alert(`Absen Keluar Ditolak:\n\nNama ("${payload.name}") tidak cocok dengan data saat Absen Masuk ("${masukRecord.name}").`);
          return;
        }
        const existingKeluar = attendances.find(a => a.device_id === deviceId && a.date === payload.date && a.type === 'KELUAR');
        if (existingKeluar) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = originalBtnText;
          alert(`Absen Keluar Ditolak:\n\nPerangkat ini sudah tercatat melakukan Absen Keluar hari ini pada pukul ${existingKeluar.time} WIB.`);
          return;
        }
      }

      const tokens = JSON.parse(localStorage.getItem('sqr_qr_tokens')) || [];
      const targetToken = tokens.find(t => t.token === payload.token);

      if (!targetToken || targetToken.status !== 'ACTIVE') {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalBtnText;
        alert('Absen Ditolak:\n\nQR Code tidak valid atau baru saja digunakan oleh pengguna lain.');
        return;
      }

      // Mark Used & Save
      const nowIso = new Date().toISOString();
      targetToken.status = 'USED';
      targetToken.used_at = nowIso;
      targetToken.used_by_name = payload.name;
      targetToken.device_id = deviceId;
      targetToken.type = currentType;
      localStorage.setItem('sqr_qr_tokens', JSON.stringify(tokens));

      const record = {
        id: Date.now(),
        token: payload.token,
        name: payload.name,
        type: currentType,
        date: payload.date,
        day: payload.day,
        time: payload.time,
        device_id: deviceId,
        device_info: deviceInfo,
        created_at: nowIso
      };
      attendances.unshift(record);
      localStorage.setItem('sqr_attendances', JSON.stringify(attendances));

      renderSuccessScreen(record);
    } catch (e) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = originalBtnText;
      alert('Gagal menyimpan absensi lokal.');
    }
  }

  let returnCountdownTimer = null;

  function startReturnCountdown(targetEl, seconds = 30) {
    if (returnCountdownTimer) clearInterval(returnCountdownTimer);
    let remaining = seconds;
    if (targetEl) targetEl.textContent = `Kembali otomatis dalam ${remaining} detik...`;
    returnCountdownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(returnCountdownTimer);
        window.location.href = 'index.html';
      } else {
        if (targetEl) targetEl.textContent = `Kembali otomatis dalam ${remaining} detik...`;
      }
    }, 1000);
  }

  function renderSuccessScreen(record) {
    formSection.classList.add('hidden');
    const isKeluar = (record.type || '').toUpperCase() === 'KELUAR';
    const motivationalSection = document.getElementById('motivationalSection');

    if (isKeluar && motivationalSection) {
      motivationalSection.classList.remove('hidden');
      const motivationCountdownText = document.getElementById('motivationCountdownText');
      startReturnCountdown(motivationCountdownText, 30);
    } else {
      successSection.classList.remove('hidden');
      summaryName.textContent = record.name;
      summaryDate.textContent = `${record.day}, ${record.date}`;
      summaryTime.textContent = `${record.time} WIB (${record.type || 'MASUK'})`;
      summaryToken.textContent = record.token;
      setupGoogleCalendar(record);

      const successCountdownText = document.getElementById('successCountdownText');
      startReturnCountdown(successCountdownText, 30);
    }

    lucide.createIcons();
  }

  function setupGoogleCalendar({ name, date, day, time, token, type }) {
    const isKeluar = (type || '').toUpperCase() === 'KELUAR';
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
    const location = 'Sistem Absensi Smart QR';

    btnGoogleCalendar.href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startFormatted}/${endFormatted}&details=${encodeURIComponent(description)}&location=${encodeURIComponent(location)}`;

    btnDownloadIcs.onclick = () => {
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
