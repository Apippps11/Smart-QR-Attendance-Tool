/**
 * Device Fingerprint Utility
 * Menggabungkan Persistent LocalStorage UUID dengan Tanda Tangan Karakteristik Hardware/Browser
 * untuk memastikan setiap perangkat fisik teridentifikasi secara konsisten (1x Scan per Device).
 */

(function (window) {
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }

  function getPersistentUuid() {
    const STORAGE_KEY = '_qr_attendance_device_uuid';
    let uuid = null;
    try {
      uuid = localStorage.getItem(STORAGE_KEY);
      if (!uuid) {
        uuid = 'dev-' + ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
          (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
        localStorage.setItem(STORAGE_KEY, uuid);
      }
    } catch (e) {
      uuid = 'dev-fallback-' + Math.random().toString(36).substring(2, 10);
    }
    return uuid;
  }

  function getCanvasSignature() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 'no-canvas';

      ctx.textBaseline = 'top';
      ctx.font = "14px 'Arial', sans-serif";
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('SmartQR-Att-2026', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('SmartQR-Att-2026', 4, 17);

      return hashString(canvas.toDataURL());
    } catch (e) {
      return 'canvas-error';
    }
  }

  function getDeviceSummary() {
    const ua = navigator.userAgent;
    let os = 'Unknown OS';
    if (/android/i.test(ua)) os = 'Android';
    else if (/iPad|iPhone|iPod/.test(ua)) os = 'iOS (Apple)';
    else if (/Windows NT/i.test(ua)) os = 'Windows';
    else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    let browser = 'Browser';
    if (/chrome|crios/i.test(ua) && !/edge|opr\//i.test(ua)) browser = 'Chrome';
    else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = 'Safari';
    else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
    else if (/edg/i.test(ua)) browser = 'Edge';
    else if (/opr\//i.test(ua)) browser = 'Opera';

    const isMobile = /Mobi|Android|iPhone/i.test(ua);
    const screenRes = `${window.screen.width}x${window.screen.height}`;

    return {
      os,
      browser,
      isMobile,
      screenRes,
      label: `${isMobile ? '📱' : '💻'} ${os} - ${browser} (${screenRes})`
    };
  }

  function getDeviceInfo() {
    const persistentUuid = getPersistentUuid();
    const canvasSig = getCanvasSignature();
    const nav = window.navigator;

    const rawHardwareSignature = [
      nav.userAgent || '',
      nav.language || '',
      nav.platform || '',
      nav.hardwareConcurrency || 'x',
      nav.deviceMemory || 'x',
      screen.colorDepth || '',
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      canvasSig
    ].join('###');

    const hardwareHash = hashString(rawHardwareSignature);
    const summary = getDeviceSummary();
    const deviceId = `${persistentUuid}-${hardwareHash.substring(0, 8)}`;

    return {
      deviceId,
      deviceInfo: `${summary.label} [sig:${hardwareHash.substring(0, 6)}]`,
      summary
    };
  }

  window.DeviceFingerprint = {
    getDeviceInfo,
    getDeviceSummary
  };
})(window);
