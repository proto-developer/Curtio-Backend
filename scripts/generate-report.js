const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const jsonPath = path.join(repoRoot, "test-report.json");

if (!fs.existsSync(jsonPath)) {
  console.error("❌ test-report.json not found! Please run 'npm run test:report' first.");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const now = new Date();
const formattedDate = now.toLocaleString();
const timestampStr = now.toISOString().replace(/[:.]/g, "-");

// ── 1. Create reports directory if it doesn't exist ──
const reportsDir = path.join(repoRoot, "reports");
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

// ── 2. Build Plain Text Report Content ──
let txtContent = `====================================================\n`;
txtContent += `      CURTIO BACKEND TEST EXECUTION REPORT          \n`;
txtContent += `====================================================\n`;
txtContent += `Date/Time       : ${formattedDate}\n`;
txtContent += `Overall Status  : ${data.success ? "[PASS] ALL TESTS PASSED ✅" : "[FAIL] TESTS FAILED ❌"}\n`;
txtContent += `Total Suites    : ${data.numTotalTestSuites} (${data.numPassedTestSuites} Passed, ${data.numFailedTestSuites} Failed)\n`;
txtContent += `Total Tests     : ${data.numTotalTests}\n`;
txtContent += `Passed Tests    : ${data.numPassedTests} ✅\n`;
txtContent += `Failed Tests    : ${data.numFailedTests} ❌\n`;
txtContent += `Execution Time  : ${((data.testResults.reduce((acc, r) => acc + (r.endTime - r.startTime), 0)) / 1000).toFixed(2)} seconds\n`;
txtContent += `====================================================\n\n`;

txtContent += `DETAILED TEST RESULTS:\n`;
txtContent += `----------------------------------------------------\n`;

data.testResults.forEach((suite) => {
  const suiteName = path.basename(suite.name);
  const suiteStatus = suite.status === "passed" ? "[PASS] ✅" : "[FAIL] ❌";
  txtContent += `\nSUITE: ${suiteName}  --  ${suiteStatus}\n`;
  txtContent += `----------------------------------------------------\n`;

  suite.assertionResults.forEach((test) => {
    const mark = test.status === "passed" ? "[✓] PASS" : "[X] FAIL";
    txtContent += ` ${mark}  | ${test.title} (${test.duration}ms)\n`;
  });
});

txtContent += `\n====================================================\n`;
txtContent += `               END OF REPORT                        \n`;
txtContent += `====================================================\n`;

// Write latest text report in root
const txtPath = path.join(repoRoot, "test-report.txt");
fs.writeFileSync(txtPath, txtContent);

// Write timestamped text report in reports/ folder on every run
const newTxtReportPath = path.join(reportsDir, `test-report-${timestampStr}.txt`);
fs.writeFileSync(newTxtReportPath, txtContent);

// ── 3. Build Markdown Report Content ──
let mdContent = `# 🧪 Curtio Backend Test Execution Report\n\n`;
mdContent += `**Date:** ${formattedDate}\n`;
mdContent += `**Overall Status:** ${data.success ? "✅ PASSED" : "❌ FAILED"}\n\n`;

mdContent += `### Summary Overview\n\n`;
mdContent += `| Metric | Count |\n`;
mdContent += `| :--- | :--- |\n`;
mdContent += `| **Total Test Suites** | ${data.numTotalTestSuites} (${data.numPassedTestSuites} Passed, ${data.numFailedTestSuites} Failed) |\n`;
mdContent += `| **Total Tests** | ${data.numTotalTests} |\n`;
mdContent += `| **Passed Tests** | ✅ ${data.numPassedTests} |\n`;
mdContent += `| **Failed Tests** | ${data.numFailedTests} |\n`;
mdContent += `| **Execution Time** | ${((data.testResults.reduce((acc, r) => acc + (r.endTime - r.startTime), 0)) / 1000).toFixed(2)}s |\n\n`;

mdContent += `---\n\n## Test Results Detail\n\n`;

data.testResults.forEach((suite) => {
  const suiteName = path.basename(suite.name);
  const suiteStatus = suite.status === "passed" ? "✅ PASS" : "❌ FAIL";
  mdContent += `### ${suiteStatus} - \`${suiteName}\`\n\n`;
  mdContent += `| Status | Test Title | Duration |\n`;
  mdContent += `| :---: | :--- | :---: |\n`;

  suite.assertionResults.forEach((test) => {
    const icon = test.status === "passed" ? "✅" : "❌";
    mdContent += `| ${icon} | ${test.title} | ${test.duration}ms |\n`;
  });

  mdContent += `\n`;
});

fs.writeFileSync(path.join(repoRoot, "TEST_REPORT.md"), mdContent);

// ── 4. Build HTML Report Content ──
let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Curtio Test Execution Report</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 40px; }
    .container { max-width: 900px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { color: #38bdf8; margin-top: 0; display: flex; align-items: center; gap: 12px; }
    .status-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; text-transform: uppercase; }
    .status-badge.pass { background: #15803d; color: #dcfce7; }
    .status-badge.fail { background: #b91c1c; color: #fee2e2; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 24px 0; }
    .metric-card { background: #334155; padding: 16px; border-radius: 8px; text-align: center; }
    .metric-value { font-size: 28px; font-weight: bold; margin-top: 4px; color: #f1f5f9; }
    .metric-label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
    .suite-card { background: #334155; margin-bottom: 20px; border-radius: 8px; overflow: hidden; border: 1px solid #475569; }
    .suite-header { background: #475569; padding: 14px 20px; font-weight: bold; font-size: 16px; display: flex; justify-content: space-between; align-items: center; }
    .test-list { list-style: none; padding: 0; margin: 0; }
    .test-item { padding: 12px 20px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
    .test-item:last-child { border-bottom: none; }
    .test-title { display: flex; align-items: center; gap: 10px; }
    .tick { font-size: 16px; }
    .duration { color: #94a3b8; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧪 Curtio Backend Test Report</h1>
    <p style="color: #94a3b8; margin-bottom: 20px;">Generated on: ${formattedDate}</p>
    
    <div>
      <span class="status-badge ${data.success ? "pass" : "fail"}">${data.success ? "✅ ALL TESTS PASSED" : "❌ TESTS FAILED"}</span>
    </div>

    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Total Test Suites</div>
        <div class="metric-value">${data.numTotalTestSuites}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Passed Tests</div>
        <div class="metric-value" style="color: #4ade80;">✅ ${data.numPassedTests}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Failed Tests</div>
        <div class="metric-value" style="color: ${data.numFailedTests > 0 ? '#f87171' : '#94a3b8'};">${data.numFailedTests}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total Duration</div>
        <div class="metric-value">${((data.testResults.reduce((acc, r) => acc + (r.endTime - r.startTime), 0)) / 1000).toFixed(2)}s</div>
      </div>
    </div>

    <h2>Test Details</h2>
`;

data.testResults.forEach((suite) => {
  const suiteName = path.basename(suite.name);
  const isPass = suite.status === "passed";
  htmlContent += `
    <div class="suite-card">
      <div class="suite-header">
        <span>📄 ${suiteName}</span>
        <span style="color: ${isPass ? '#4ade80' : '#f87171'};">${isPass ? "✅ PASS" : "❌ FAIL"}</span>
      </div>
      <ul class="test-list">
  `;

  suite.assertionResults.forEach((test) => {
    const isTestPass = test.status === "passed";
    htmlContent += `
        <li class="test-item">
          <span class="test-title">
            <span class="tick">${isTestPass ? "✅" : "❌"}</span>
            <span>${test.title}</span>
          </span>
          <span class="duration">${test.duration} ms</span>
        </li>
    `;
  });

  htmlContent += `
      </ul>
    </div>
  `;
});

htmlContent += `
  </div>
</body>
</html>
`;

fs.writeFileSync(path.join(repoRoot, "test-report.html"), htmlContent);

console.log(`📄 Main Text report generated: test-report.txt`);
console.log(`📄 New timestamped Text report generated in reports/: ${path.basename(newTxtReportPath)}`);
console.log(`📄 Markdown report generated: TEST_REPORT.md`);
console.log(`📄 HTML report generated: test-report.html`);
