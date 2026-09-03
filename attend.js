/**
 * Logika Halaman Presensi Peserta (attend.js)
 * Mendukung:
 * 1. Cloud MQTT WSS over SSL (Bisa beda provider seluler / beda Wi-Fi / kuota 4G)
 * 2. Express Server API (Localhost / VPS Node.js)
 * 3. BroadcastChannel (Same-device local testing)
 * 4. Integrasi Google Calendar 1-Klik & Unduh .ics
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
  const inputDate = document.getElementById('inputDate');
  const inputDay = document.getElementById('inputDay');
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

  function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Generate Device Fingerprint
  const { deviceId, deviceInfo } = window.DeviceFingerprint.getDeviceInfo();
  if (deviceLabel) {
    deviceLabel.textContent = deviceInfo;
  }

  const broadcast = ('BroadcastChannel' in window) ? new BroadcastChannel('smart_qr_channel') : null;
  let mqttClient = null;

  // Inisialisasi Cloud MQTT Client
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

  // JIKA TIDAK ADA TOKEN -> Tampilkan Scanner Kamera & Opsi Foto
  if (!token) {
    checkingSection.classList.add('hidden');
    scannerSection.classList.remove('hidden');

    const inputAttendPhoto = document.getElementById('inputAttendPhoto');
    const btnUploadAttendPhoto = document.getElementById('btnUploadAttendPhoto');

    if (btnUploadAttendPhoto && inputAttendPhoto) {
      btnUploadAttendPhoto.addEventListener('click', () => {
        inputAttendPhoto.click();
      });

      inputAttendPhoto.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        if (typeof Html5Qrcode !== 'undefined') {
          const tempScanner = new Html5Qrcode("qr-reader");
          try {
            const decodedText = await tempScanner.scanFile(file, false);
            if (decodedText.startsWith('http://') || decodedText.startsWith('https://')) {
              window.location.href = decodedText;
            } else {
              window.location.href = `attend.html?token=${encodeURIComponent(decodedText)}`;
            }
          } catch (err) {
            alert('Tidak dapat menemukan QR Code pada foto yang dipilih.\n\nPastikan foto jelas, tidak buram, dan QR code tidak terpotong.');
          } finally {
            inputAttendPhoto.value = '';
          }
        }
      });
    }

    if (typeof Html5QrcodeScanner !== 'undefined') {
      const scanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
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

  // JIKA ADA TOKEN -> Set UI Token & Tampilkan Form
  badgeToken.textContent = token;

  // Setup Tanggal & Hari (Regional Time Lock - Strictly Today Only)
  const today = new Date();
  const todayDateString = getLocalDateString(today);
  inputDate.value = todayDateString;
  inputDate.min = todayDateString;
  inputDate.max = todayDateString;
  inputDate.readOnly = true;
  inputDay.value = getIndonesianDayName(today);
  inputDay.readOnly = true;

  // Verifikasi cepat status token
  async function performQuickCheck() {
    // 1. Cek via backend jika ada
    try {
      const res = await fetch(`/api/qr/check/${encodeURIComponent(token)}`);
      if (res.ok) {
        return { valid: true };
      } else if (res.status === 409 || res.status === 410 || res.status === 404) {
        const d = await res.json();
        return { valid: false, status: d.status, message: d.message };
      }
    } catch (e) {
      // Backend tidak ada (Mode GitHub Pages)
    }

    // 2. Cek via LocalStorage jika satu browser
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
      errorTitle.textContent = '❌ QR Code Sudah Digunakan!';
      errorMessage.textContent = check.message || 'QR Code ini sudah pernah digunakan. Setiap QR Code hanya bisa dipakai 1 kali!';
    } else if (check.status === 'EXPIRED') {
      errorTitle.textContent = '⏱️ QR Code Kedaluwarsa';
      errorMessage.textContent = check.message || 'QR Code ini sudah kedaluwarsa. Silakan scan QR code yang baru.';
    } else {
      errorTitle.textContent = '⚠️ QR Code Tidak Valid';
      errorMessage.textContent = check.message || 'Token QR tidak terdaftar.';
    }
    lucide.createIcons();
    return;
  }

  // Token valid -> tampilkan form
  formSection.classList.remove('hidden');
  lucide.createIcons();
  setTimeout(() => inputName.focus(), 200);

  // --- SUBMIT PRESENSI ---
  attendanceForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = inputName.value.trim();
    const date = inputDate.value;
    const day = inputDay.value;
    const now = new Date();
    const time = now.toLocaleTimeString('id-ID', { hour12: false });

    if (!name) {
      alert('Mohon masukkan nama lengkap Anda.');
      return;
    }

    // REGIONAL TIME LOCK VALIDATION
    const expectedToday = getLocalDateString(new Date());
    if (date !== expectedToday) {
      alert(`Kunci Waktu Regional Aktif:\n\nPresensi hanya dapat dilakukan pada tanggal hari ini (${expectedToday}). Anda tidak dapat melakukan presensi untuk hari sebelum atau sesudah!`);
      return;
    }

    btnSubmit.disabled = true;
    const originalBtnText = btnSubmit.innerHTML;
    btnSubmit.innerHTML = `
      <div class="inline-block animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
      <span>Memverifikasi Presensi...</span>
    `;

    const reqId = 'req_' + Math.random().toString(36).substring(2, 10);
    const payload = {
      token,
      name,
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

      if (response.ok || response.status === 409 || response.status === 403) {
        const result = await response.json();
        if (!response.ok || !result.success) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = originalBtnText;
          alert('Presensi Ditolak:\n\n' + (result.error || 'Terjadi kesalahan sistem.'));
          if (response.status === 409) {
            formSection.classList.add('hidden');
            errorSection.classList.remove('hidden');
            errorTitle.textContent = '❌ QR Code Baru Saja Digunakan';
            errorMessage.textContent = result.error;
            lucide.createIcons();
          }
          return;
        }

        renderSuccessScreen(result.attendance);
        return;
      }
    } catch (err) {
      // Server Node.js tidak ada -> Gunakan Cloud MQTT
    }

    // 2. Kirim via Cloud Real-time MQTT (Beda Provider / Beda Wi-Fi)
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
              alert('Presensi Ditolak:\n\n' + res.error);
              return;
            }
            renderSuccessScreen(res.attendance);
          } catch (e) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalBtnText;
            alert('Gagal memproses respon presensi.');
          }
        }
      });

      // Timeout safety: jika dalam 8 detik tidak ada balasan dari admin
      setTimeout(() => {
        if (!answered) {
          // Coba fallback ke Local / Same-Device Storage
          attemptLocalFallback(payload, originalBtnText);
        }
      }, 7000);
      return;
    }

    // 3. Fallback: Same-Device Local Engine
    attemptLocalFallback(payload, originalBtnText);
  });

  function attemptLocalFallback(payload, originalBtnText) {
    try {
      const attendances = JSON.parse(localStorage.getItem('sqr_attendances')) || [];
      const existing = attendances.find(a => a.device_id === deviceId && a.date === payload.date);
      if (existing) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalBtnText;
        alert(`Presensi Ditolak:\n\nPerangkat ini sudah tercatat melakukan absensi hari ini atas nama "${existing.name}". 1 perangkat hanya bisa absen 1 kali per hari!`);
        return;
      }

      const tokens = JSON.parse(localStorage.getItem('sqr_qr_tokens')) || [];
      const targetToken = tokens.find(t => t.token === payload.token);
      if (targetToken && targetToken.status === 'USED') {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalBtnText;
        alert('Presensi Ditolak:\n\nQR Code ini sudah pernah digunakan oleh pengguna lain!');
        return;
      }

      if (targetToken) {
        targetToken.status = 'USED';
        targetToken.used_by_name = payload.name;
        targetToken.used_at = new Date().toISOString();
        targetToken.device_id = deviceId;
        localStorage.setItem('sqr_qr_tokens', JSON.stringify(tokens));
      }

      const record = {
        id: Date.now(),
        token: payload.token,
        name: payload.name,
        date: payload.date,
        day: payload.day,
        time: payload.time,
        device_id: deviceId,
        device_info: deviceInfo,
        created_at: new Date().toISOString()
      };
      attendances.unshift(record);
      localStorage.setItem('sqr_attendances', JSON.stringify(attendances));

      if (broadcast) {
        broadcast.postMessage({ type: 'SUBMIT_FROM_TAB', payload });
      }

      renderSuccessScreen(record);
    } catch (e) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = originalBtnText;
      alert('Gagal menghubungi layar admin. Pastikan layar admin sedang terbuka dan aktif.');
    }
  }

  function renderSuccessScreen(attendance) {
    formSection.classList.add('hidden');
    successSection.classList.remove('hidden');

    summaryName.textContent = attendance.name;
    summaryDate.textContent = `${attendance.day}, ${attendance.date}`;
    summaryTime.textContent = `${attendance.time} WIB`;
    summaryToken.textContent = attendance.token;

    setupGoogleCalendarIntegration({
      name: attendance.name,
      date: attendance.date,
      day: attendance.day,
      time: attendance.time,
      token: attendance.token
    });

    lucide.createIcons();
  }

  function setupGoogleCalendarIntegration({ name, date, day, time, token }) {
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

    const title = `Presensi: ${name}`;
    const description = `Bukti Kehadiran Resmi Smart QR Attendance Tool.\n\nNama: ${name}\nHari: ${day}\nTanggal: ${date}\nJam Masuk: ${time} WIB\nKode Token: ${token}\nStatus: Hadir Terverifikasi (1x Device Lock)`;
    const location = `Sistem Presensi Smart QR`;

    // Direct Google Calendar Web Intent URL
    const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startFormatted}/${endFormatted}&details=${encodeURIComponent(description)}&location=${encodeURIComponent(location)}`;
    btnGoogleCalendar.href = gcalUrl;

    // Download .ics file
    btnDownloadIcs.addEventListener('click', () => {
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
      link.setAttribute('download', `Presensi-${name.replace(/\s+/g, '_')}-${date}.ics`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

});
