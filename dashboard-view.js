function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function sourceRow(label, source, filename) {
  return `<div class="copy" data-obs-source="${source}"><b>${label}</b><code>/o/••••••••••••/${filename}</code><button type="button" class="copy-obs-url">Copy</button></div>`;
}

function renderDashboard({ tenant, theme, version }) {
  const themeJson = JSON.stringify(theme).replace(/</g, "\\u003c");
  return `
    <link rel="stylesheet" href="/dashboard-customizer.css">
    <link rel="stylesheet" href="/dashboard-shell.css">
    <link rel="stylesheet" href="/dashboard-setup.css">

    <div class="account">
      <span>Signed in as <b>${escapeHtml(tenant.channel_name)}</b></span>
      <span><a href="/about">Public page</a><form class="logout-form" method="post" action="/logout"><button type="submit">Log out</button></form></span>
    </div>
    <div class="maintenance"><b>✓ Updates active</b><span>Version ${escapeHtml(version)}</span></div>
    <div class="status">${tenant.kick_access_token ? "✓ Kick connected" : "○ Connect Kick to start"}</div>
    <a class="button" href="/auth/kick">${tenant.kick_access_token ? "Reconnect Kick" : "Connect Kick"}</a>

    <h2>OBS sources</h2>
    ${sourceRow("Game overlay", "overlay", "overlay.html")}
    ${sourceRow("Scoreboard", "scoreboard", "scoreboard.html")}
    <button type="button" class="secondary" id="copy-both-obs">Copy both URLs</button>
    <p>Add both at 1920 × 1080 and keep Scoreboard above Overlay.</p>
    <a class="button" id="open-overlay-preview" href="#" target="_blank" rel="noopener noreferrer">Open overlay preview</a>

    <section class="guide customizer" id="overlay-customizer">
      <span class="pill">OVERLAY CUSTOMIZER</span>
      <h2>Overlay appearance</h2>
      <p class="muted">Saved changes automatically appear in your existing OBS sources—no links need replacing.</p>
      <div class="theme-layout">
        <div>
          <div class="templates" role="group" aria-label="Colour templates">
            <button type="button" data-preset="kick">Kick Green</button>
            <button type="button" data-preset="purple">Neon Purple</button>
            <button type="button" data-preset="ice">Ice Blue</button>
            <button type="button" data-preset="fire">Fire</button>
            <button type="button" data-preset="gold">Gold</button>
            <button type="button" data-preset="minimal">Minimal</button>
          </div>
          <div class="theme-fields">
            <label>Primary colour<input type="color" name="primary"></label>
            <label>Secondary colour<input type="color" name="secondary"></label>
            <label>Background<input type="color" name="background"></label>
            <label>Text colour<input type="color" name="text"></label>
            <label>Position<select name="position"><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="center">Centre</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option></select></label>
            <label>Font<select name="font"><option value="system">System</option><option value="rounded">Rounded</option><option value="condensed">Condensed</option><option value="mono">Monospace</option></select></label>
            <label>Scale <output data-for="scale"></output><input type="range" name="scale" min="60" max="140"></label>
            <label>Card opacity <output data-for="opacity"></output><input type="range" name="opacity" min="40" max="100"></label>
            <label>Border radius <output data-for="radius"></output><input type="range" name="radius" min="0" max="48"></label>
            <label>Glow <output data-for="glow"></output><input type="range" name="glow" min="0" max="80"></label>
          </div>
          <details>
            <summary>Advanced custom CSS</summary>
            <p class="muted">Rules must begin with <code>#stage</code> or <code>#scoreboard</code>. Imports and remote URLs are blocked.</p>
            <textarea name="customCss" maxlength="4000" spellcheck="false" placeholder="#stage .popup { border-width: 3px; }"></textarea>
            <small><span id="css-count">0</span> / 4000 characters</small>
          </details>
          <div class="customizer-actions"><button type="button" id="save-theme">Save changes</button><button type="button" class="secondary" id="reset-theme">Reset</button><button type="button" class="secondary" id="copy-css">Copy CSS</button></div>
          <p id="theme-status" role="status"></p>
        </div>
        <div class="preview-wrap">
          <span>LIVE PREVIEW</span>
          <div class="theme-preview" id="theme-preview">
            <div class="preview-popup"><small>MOVIE · MEDIUM</small><b>🦁 👑</b><strong>THE LION KING</strong><p>🏆 LunaPlays wins · +218</p></div>
            <div class="preview-board"><b>#1 LunaPlays</b><span>1,240</span></div>
          </div>
        </div>
      </div>
    </section>

    <section class="guide resource-guide">
      <span class="pill">CLOUD SETUP</span>
      <details class="resource-details"><summary>OBS setup guide</summary>
      <ol><li>In OBS, add a <b>Browser Source</b> to your streaming scene.</li><li>Paste the <b>Game overlay</b> URL and set it to <b>1920 × 1080</b>.</li><li>Add the <b>Scoreboard</b> URL as a second Browser Source above it.</li><li>Use <b>Live Control</b> above to run a private visual check.</li></ol></details>
    </section>
    <section class="guide resource-guide">
      <span class="pill">VIEWER GUIDE</span>
      <details class="resource-details"><summary>Viewer commands</summary>
      <div class="commands"><div><code>!commands</code><span>Show commands</span></div><div><code>!rank season</code><span>Season position</span></div><div><code>!profile</code><span>Points, wins and streak</span></div><div><code>!scoreboard season</code><span>Season leaderboard</span></div><div><code>!challenge</code><span>Daily and weekly goals</span></div><div><code>!badges</code><span>Achievements</span></div><div><code>!jackpot</code><span>Current jackpot</span></div></div>
      <button type="button" id="copy-command-list">Copy command list</button></details>
    </section>

    <script type="application/json" id="dashboard-theme-data">${themeJson}</script>
    <script src="/dashboard-customizer.js"></script>
    <script src="/dashboard-live.js"></script>
    <script src="/dashboard-sources.js"></script>
    <script src="/dashboard-puzzles.js"></script>
    <script src="/dashboard-mode.js"></script>
    <script src="/dashboard-setup.js"></script>
    <script src="/dashboard-dirty.js"></script>
  `;
}

module.exports = { renderDashboard };
