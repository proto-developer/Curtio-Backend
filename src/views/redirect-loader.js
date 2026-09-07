const { REDIRECT_DELAY_MS } = require("../config/redirectTiming");

function buildRedirectPage(destinationUrl, shortCode, utmSource, apiBase, originalReferer) {
  const safeUrl = destinationUrl.replace(/"/g, "&quot;");
  const safeCode = (shortCode || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const safeUtm = (utmSource || "").replace(/"/g, "&quot;");
  const safeApi = (apiBase || "").replace(/"/g, "&quot;");
  const safeReferer = (originalReferer || "").replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Redirecting…</title>
<style>
  body {
    margin: 0;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #F9FAFB;
    font-family: 'Inter', sans-serif;
  }
  .loader-wrap {
    text-align: center;
  }
  .spinner {
    width: 48px;
    height: 48px;
    margin: 0 auto 16px;
    border: 4px solid #E5E7EB;
    border-top: 4px solid #2563EB;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .redirect-text {
    font-size: 15px;
    color: #374151;
    font-weight: 500;
  }
  .dots::after {
    content: '';
    animation: dots 1.2s steps(4, end) infinite;
  }
  @keyframes dots {
    0% { content: ''; }
    25% { content: '.'; }
    50% { content: '..'; }
    75% { content: '...'; }
    100% { content: ''; }
  }
</style>
</head>
<body>
  <div class="loader-wrap">
    <div class="spinner"></div>
  </div>

<script>
  (function () {
    var visitId = 'v_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    var apiHost = "${safeApi}" || window.location.origin;
    var preClickUrl = apiHost + "/api/preclick/${safeCode}";
    var preClickPayload = JSON.stringify({ visitId: visitId, utmSource: "${safeUtm}", originalReferer: "${safeReferer}" });

    if (navigator.sendBeacon) {
      var preClickBlob = new Blob([preClickPayload], { type: 'application/json' });
      navigator.sendBeacon(preClickUrl, preClickBlob);
    } else {
      var preClickXhr = new XMLHttpRequest();
      preClickXhr.open('POST', preClickUrl, true);
      preClickXhr.setRequestHeader('Content-Type', 'application/json');
      try { preClickXhr.send(preClickPayload); } catch(e) {}
    }

    // Track the click ONLY after the countdown fires.
    setTimeout(function () {
      var trackUrl = apiHost + "/api/track/${safeCode}";
      var payload = JSON.stringify({ visitId: visitId, utmSource: "${safeUtm}", originalReferer: "${safeReferer}" });

      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(trackUrl, blob);
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', trackUrl, false);
        xhr.setRequestHeader('Content-Type', 'application/json');
        try { xhr.send(payload); } catch(e) {}
      }

      window.location.replace("${safeUrl}");
    }, ${REDIRECT_DELAY_MS});
  })();
</script>
</body>
</html>`;
}

module.exports = { buildRedirectPage };
