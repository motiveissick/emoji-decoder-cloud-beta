(() => {
  let data = null;
  const safe = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const sourceUrl = (source) =>
    source === "scoreboard" ? data?.scoreboardUrl : data?.overlayUrl;
  const mask = (url) =>
    String(url || "").replace(/\/o\/[^/]+\//, "/o/••••••••••••/");
  const relativeTime = (value) => {
    if (!value) return "Never connected";
    const seconds = Math.max(1, Math.round((Date.now() - value) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return `${hours}h ago`;
  };

  function init() {
    const panel = document.querySelector(".obs-sources");
    if (!panel) {
      setTimeout(init, 50);
      return;
    }
    if (panel.dataset.sourcesEnhanced) return;
    panel.dataset.sourcesEnhanced = "true";
    panel.querySelectorAll(".copy").forEach((row) => {
      row.dataset.revealed = "false";
      const copy = row.querySelector(".copy-obs-url,button:last-child");
      copy.classList.add("copy-obs-url");
      copy.removeAttribute("onclick");
      copy.onclick = null;
      copy.addEventListener("click", () => copyOne(row, copy));
      const reveal = document.createElement("button");
      reveal.type = "button";
      reveal.className = "secondary reveal-obs-url";
      reveal.textContent = "Reveal";
      reveal.addEventListener("click", () => {
        row.dataset.revealed = String(row.dataset.revealed !== "true");
        renderRow(row);
      });
      const health = document.createElement("span");
      health.className = "source-health";
      row.append(reveal, health);
    });
    const actions = panel.querySelector(".source-actions"),
      copyBoth = actions?.querySelector("button.secondary");
    if (copyBoth) {
      copyBoth.removeAttribute("onclick");
      copyBoth.onclick = null;
      copyBoth.addEventListener("click", () => copyAll(copyBoth));
    }
    const preview = actions?.querySelector("a.button");
    if (preview) {
      preview.textContent = "Open overlay preview";
      preview.rel = "noopener noreferrer";
    }
    const rotate = document.createElement("button");
    rotate.type = "button";
    rotate.className = "danger rotate-obs-links";
    rotate.textContent = "Regenerate private links";
    rotate.addEventListener("click", openRotateDialog);
    actions?.append(rotate);
    const note = document.createElement("p");
    note.className = "source-security-note";
    note.innerHTML =
      "<b>Keep these URLs private.</b> Regenerating them immediately disconnects every old OBS source.";
    panel.append(note);
    createDialog();
    document.addEventListener("emoji:live-state", (event) => {
      if (data) {
        data.sources = event.detail.sources;
        renderHealth();
      }
    });
    load();
  }

  async function request(url, options) {
    const response = await fetch(url, options),
      body = await response
        .json()
        .catch(() => ({ error: "Could not read OBS source details." }));
    if (!response.ok)
      throw new Error(body.error || "OBS source request failed.");
    return body;
  }

  async function load() {
    try {
      data = await request("/dashboard/obs-sources");
      render();
    } catch (error) {
      const panel = document.querySelector(".obs-sources");
      panel?.classList.add("source-error");
      const note = panel?.querySelector(".source-security-note");
      if (note) note.textContent = `⚠ ${error.message}`;
    }
  }

  function render() {
    document.querySelectorAll(".copy[data-obs-source]").forEach(renderRow);
    const preview = document.querySelector(
      ".obs-sources .source-actions a.button",
    );
    if (preview) preview.href = data.overlayUrl;
    renderHealth();
  }

  function renderRow(row) {
    const url = sourceUrl(row.dataset.obsSource),
      revealed = row.dataset.revealed === "true";
    row.querySelector("code").textContent = revealed ? url : mask(url);
    const button = row.querySelector(".reveal-obs-url");
    if (button) button.textContent = revealed ? "Hide" : "Reveal";
  }

  function renderHealth() {
    document.querySelectorAll(".copy[data-obs-source]").forEach((row) => {
      const health = data?.sources?.[row.dataset.obsSource] || {},
        element = row.querySelector(".source-health");
      if (!element) return;
      element.className = `source-health ${health.connected ? "connected" : health.lastConnectedAt ? "offline" : "missing"}`;
      element.innerHTML = health.connected
        ? `<i></i>${health.connections} connected`
        : `<i></i>${safe(relativeTime(health.lastConnectedAt))}`;
    });
  }

  async function copyText(value, button, success) {
    try {
      await navigator.clipboard.writeText(value);
      const previous = button.textContent;
      button.textContent = success;
      setTimeout(() => (button.textContent = previous), 1600);
    } catch {
      button.textContent = "Copy failed";
      setTimeout(() => (button.textContent = "Copy"), 1600);
    }
  }

  function copyOne(row, button) {
    const url = sourceUrl(row.dataset.obsSource);
    if (url) copyText(url, button, "✓ Copied");
  }
  function copyAll(button) {
    if (!data) return;
    copyText(
      `Game overlay: ${data.overlayUrl}\nScoreboard: ${data.scoreboardUrl}`,
      button,
      "✓ Both copied",
    );
  }

  function createDialog() {
    if (document.querySelector("#rotate-sources-dialog")) return;
    const dialog = document.createElement("dialog");
    dialog.id = "rotate-sources-dialog";
    dialog.className = "dashboard-dialog";
    dialog.setAttribute("aria-labelledby", "rotate-sources-title");
    dialog.innerHTML =
      '<form method="dialog"><span class="pill">SECURITY ACTION</span><h2 id="rotate-sources-title">Regenerate private OBS links?</h2><p>The current game overlay and scoreboard URLs will stop working immediately. You must replace both URLs in OBS.</p><label>Type <b>ROTATE</b> to continue<input id="rotate-confirmation" autocomplete="off" spellcheck="false"></label><div><button value="cancel" class="secondary">Cancel</button><button type="button" id="confirm-source-rotation" class="danger" disabled>Regenerate links</button></div><p id="rotate-source-status" role="status"></p></form>';
    document.body.append(dialog);
    const input = dialog.querySelector("#rotate-confirmation"),
      confirm = dialog.querySelector("#confirm-source-rotation");
    input.addEventListener(
      "input",
      () => (confirm.disabled = input.value !== "ROTATE"),
    );
    confirm.addEventListener("click", rotate);
  }

  function openRotateDialog() {
    const dialog = document.querySelector("#rotate-sources-dialog"),
      input = dialog.querySelector("#rotate-confirmation");
    input.value = "";
    dialog.querySelector("#confirm-source-rotation").disabled = true;
    dialog.querySelector("#rotate-source-status").textContent = "";
    dialog.showModal ? dialog.showModal() : dialog.setAttribute("open", "");
    input.focus();
  }

  async function rotate() {
    const dialog = document.querySelector("#rotate-sources-dialog"),
      input = dialog.querySelector("#rotate-confirmation"),
      button = dialog.querySelector("#confirm-source-rotation"),
      status = dialog.querySelector("#rotate-source-status");
    button.disabled = true;
    status.textContent = "Regenerating secure links…";
    try {
      data = await request("/dashboard/obs-sources/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: input.value }),
      });
      document
        .querySelectorAll(".copy[data-obs-source]")
        .forEach((row) => (row.dataset.revealed = "false"));
      render();
      status.textContent = "✓ New links created. Replace both URLs in OBS.";
      setTimeout(() => dialog.close?.(), 1800);
      window.dashboardLiveRefresh?.();
    } catch (error) {
      status.textContent = `⚠ ${error.message}`;
      button.disabled = false;
    }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0));
  else setTimeout(init, 0);
})();
