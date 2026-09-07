function buildLinkDisabledPage({ title, badgeText, message, frontendUrl }) {
  const safeTitle = (title || "Link Unavailable").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeBadge = (badgeText || "Deactivated").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeMsg = (message || "This link has been disabled by the owner.").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeHome = (frontendUrl || "/").replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle} - Curtio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  body {
    min-height: 100vh;
    background-color: #F8FAFC;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    color: #0F172A;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }
  .card {
    width: 100%;
    max-width: 440px;
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 24px;
    padding: 2.5rem 2rem;
    text-align: center;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);
    animation: fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .icon-box {
    width: 64px;
    height: 64px;
    margin: 0 auto 1.25rem;
    background: #FEF2F2;
    border: 1px solid #FEE2E2;
    border-radius: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #EF4444;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.35rem 0.85rem;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #DC2626;
    background: #FEF2F2;
    border: 1px solid #FEE2E2;
    border-radius: 9999px;
    margin-bottom: 1.25rem;
  }
  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #EF4444;
  }
  h1 {
    font-size: 1.625rem;
    font-weight: 800;
    color: #0F172A;
    letter-spacing: -0.025em;
    margin-bottom: 0.625rem;
  }
  p {
    font-size: 0.925rem;
    line-height: 1.6;
    color: #64748B;
    margin-bottom: 2rem;
  }
  .btn-group {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    border-radius: 12px;
    text-decoration: none;
    transition: all 0.2s ease;
    cursor: pointer;
  }
  .btn-primary {
    background-color: #4F46E5;
    color: #FFFFFF;
    box-shadow: 0 1px 2px 0 rgba(79, 70, 229, 0.3);
  }
  .btn-primary:hover {
    background-color: #4338CA;
    box-shadow: 0 4px 12px 0 rgba(79, 70, 229, 0.35);
  }
  .footer-brand {
    margin-top: 2rem;
    font-size: 0.8rem;
    color: #94A3B8;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
  }
  .footer-brand strong {
    color: #475569;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="icon-box">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
    </div>

    <span class="badge">
      <span class="badge-dot"></span>
      ${safeBadge}
    </span>
    <h1>${safeTitle}</h1>
    <p>${safeMsg}</p>

    <div class="btn-group">
      <a href="${safeHome}" class="btn btn-primary">
        Go to Curtio Homepage
      </a>
    </div>

    <div class="footer-brand">
      Powered by <strong>Curtio Link Platform</strong>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { buildLinkDisabledPage };
