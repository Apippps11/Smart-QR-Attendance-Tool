/**
 * Logika Halaman Presensi Peserta (attend.js)
 * Menangani validasi token 1x pakai, device fingerprinting, submit form, dan integrasi Google Calendar
 */

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');

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

  // Helper konversi nama hari Indonesia
  function getIndonesianDayName(dateObj) {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    return days[dateObj.getDay()];
  }

  // Format YYYY-MM-DD lokal
  function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Dapatkan info device fingerprint
  const { deviceId, deviceInfo, summary: deviceSummary } = window.DeviceFingerprint.getDeviceInfo();
  if (deviceLabel) {
    deviceLabel.textContent = deviceInfo;
  }

  // JIKA TIDAK ADA TOKEN DI URL -> Tampilkan Camera Scanner
  if (!token) {
    checkingSection.classList.add('hidden');
    scannerSection.classList.remove('hidden');

    // Inisialisasi in-page QR scanner
    if (typeof Html5QrcodeScanner !== 'undefined') {
      const html5QrcodeScanner = new Html5QrcodeScanner(
        "qr-reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        /* verbose= */ false
      );

      html5QrcodeScanner.render((decodedText) => {
        html5QrcodeScanner.clear();
        // Cek jika decoded text adalah URL
        try {
          if (decodedText.startsWith('http://') || decodedText.startsWith('https://')) {
            window.location.href = decodedText;
          } else {
            window.location.href = `/attend.html?token=${encodeURIComponent(decodedText)}`;
          }
        } catch (e) {
          window.location.href = `/attend.html?token=${encodeURIComponent(decodedText)}`;
        }
      }, (error) => {
        // scan error ignore
      });
    }
    return;
  }

  // JIKA ADA TOKEN -> Cek Keabsahan Token ke Server
  badgeToken.textContent = token;
  try {
    const res = await fetch(`/api/qr/check/${encodeURIComponent(token)}`);
    const data = await res.json();

    checkingSection.classList.add('hidden');

    if (!res.ok || !data.valid) {
      errorSection.classList.remove('hidden');
      if (data.status === 'USED') {
        errorTitle.textContent = '❌ QR Code Sudah Digunakan!';
        errorMessage.textContent = data.message || 'QR Code ini sudah pernah digunakan oleh pengguna lain. Setiap QR code hanya dapat dipakai tepat 1 kali.';
      } else if (data.status === 'EXPIRED') {
        errorTitle.textContent = '⏱️ QR Code Kedaluwarsa';
        errorMessage.textContent = data.message || 'QR Code ini telah kedaluwarsa. Silakan scan QR code yang tampil saat ini di layar admin.';
      } else {
        errorTitle.textContent = '⚠️ QR Code Tidak Valid';
        errorMessage.textContent = data.message || 'Token QR tidak ditemukan dalam sistem presensi.';
      }
      lucide.createIcons();
      return;
    }

    // Token VALID & AKTIF -> Tampilkan Form Presensi
    formSection.classList.remove('hidden');
    lucide.createIcons();

    // Atur default tanggal hari ini & nama hari
    const today = new Date();
    inputDate.value = getLocalDateString(today);
    inputDay.value = getIndonesianDayName(today);

    // Sinkronisasi hari otomatis jika tanggal diubah
    inputDate.addEventListener('change', () => {
      if (inputDate.value) {
        const parts = inputDate.value.split('-');
        const selectedDate = new Date(parts[0], parts[1] - 1, parts[2]);
        inputDay.value = getIndonesianDayName(selectedDate);
      }
    });

    // Fokus ke nama
    setTimeout(() => inputName.focus(), 200);

  } catch (err) {
    checkingSection.classList.add('hidden');
    errorSection.classList.remove('hidden');
    errorTitle.textContent = 'Kesalahan Koneksi';
    errorMessage.textContent = 'Gagal menghubungi server presensi. Pastikan Anda terhubung ke jaringan yang sama dengan server.';
    lucide.createIcons();
    return;
  }

  // SUBMIT FORM PRESENSI
  attendanceForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = inputName.value.trim();
    const date = inputDate.value;
    const day = inputDay.value;
    const now = new Date();
    const time = now.toLocaleTimeString('id-ID', { hour12: false });

    if (!name) {
      alert('Mohon isi nama lengkap Anda.');
      return;
    }

    // UI Loading state
    btnSubmit.disabled = true;
    const originalBtnText = btnSubmit.innerHTML;
    btnSubmit.innerHTML = `
      <div class="inline-block animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
      <span>Memverifikasi Presensi...</span>
    `;

    try {
      const response = await fetch('/api/attendance/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token,
          name,
          date,
          day,
          time,
          deviceId,
          deviceInfo
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalBtnText;

        // Tampilkan pesan penolakan yang jelas
        alert('Gagal Absen:\n\n' + (result.error || 'Terjadi kesalahan saat memverifikasi absensi.'));
        
        // Jika karena QR sudah dipakai, alihkan ke status error
        if (response.status === 409 && result.error && result.error.includes('QR Code ini sudah pernah digunakan')) {
          formSection.classList.add('hidden');
          errorSection.classList.remove('hidden');
          errorTitle.textContent = '❌ QR Code Baru Saja Dipakai';
          errorMessage.textContent = result.error;
          lucide.createIcons();
        }
        return;
      }

      // BERHASIL ABSEN -> Tampilkan Layar Sukses
      formSection.classList.add('hidden');
      successSection.classList.remove('hidden');

      summaryName.textContent = result.attendance.name;
      summaryDate.textContent = `${result.attendance.day}, ${result.attendance.date}`;
      summaryTime.textContent = `${result.attendance.time} WIB`;
      summaryToken.textContent = result.attendance.token;

      // SIAPKAN LINK GOOGLE CALENDAR (Direct Web Intent)
      setupGoogleCalendarIntegration({
        name: result.attendance.name,
        date: result.attendance.date,
        day: result.attendance.day,
        time: result.attendance.time,
        token: result.attendance.token
      });

      lucide.createIcons();

    } catch (err) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = originalBtnText;
      alert('Terjadi kesalahan jaringan saat mengirim data. Silakan coba lagi.');
      console.error(err);
    }
  });

  // Fungsi Pembantu Konfigurasi Google Calendar & File .ics
  function setupGoogleCalendarIntegration({ name, date, day, time, token }) {
    // Siapkan rentang waktu: Mulai saat jam absen, durasi 1 jam
    // Format tanggal untuk Google Calendar URL: YYYYMMDDTHHmmSS
    const [year, month, dayNum] = date.split('-');
    const [hour, minute, second] = time.split(':');

    // Buat objek waktu lokal
    const startDate = new Date(year, month - 1, dayNum, parseInt(hour || 0), parseInt(minute || 0), parseInt(second || 0));
    const endDate = new Date(startDate.getTime() + (60 * 60 * 1000)); // +1 jam

    function formatGCalDateTime(d) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    const startFormatted = formatGCalDateTime(startDate);
    const endFormatted = formatGCalDateTime(endDate);

    const title = `Presensi: ${name}`;
    const description = `Bukti Kehadiran Resmi QR Attendance Tool.\n\nNama: ${name}\nHari: ${day}\nTanggal: ${date}\nJam Masuk: ${time} WIB\nKode Token: ${token}\nStatus: Hadir Terverifikasi (1x Scan Lock)`;
    const location = `Sistem Presensi Smart QR`;

    // 1. Direct Google Calendar Web Intent Link
    const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startFormatted}/${endFormatted}&details=${encodeURIComponent(description)}&location=${encodeURIComponent(location)}`;
    btnGoogleCalendar.href = gcalUrl;

    // 2. Unduh Kalender (.ics) Blob
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
