(() => {
  const sections = new Map(),
    dirty = new Set();
  const configs = [
    {
      id: "appearance",
      selector: ".customizer",
      save: "#save-theme",
      status: "#theme-status",
      label: "Appearance",
    },
    {
      id: "game",
      selector: ".game-settings",
      save: "#save-game-settings",
      status: "#game-settings-status",
      label: "Game settings",
    },
    {
      id: "community",
      selector: ".community-settings",
      save: "#save-community",
      status: "#community-status",
      label: "Community goal",
    },
  ];
  let bar,
    barMessage,
    savingAll = false,
    initAttempts = 0;

  function init() {
    if (document.querySelector("#dashboard-save-bar")) return;
    if (
      !document.querySelector("#game-categories")?.children.length &&
      initAttempts++ < 25
    ) {
      setTimeout(init, 200);
      return;
    }
    createBar();
    createToasts();
    configs.forEach(register);
    window.addEventListener("beforeunload", (event) => {
      if (!dirty.size) return;
      event.preventDefault();
      event.returnValue = "";
    });
    document.addEventListener("click", confirmDestructive, true);
    const readiness = document.querySelector(".readiness-list");
    if (readiness)
      new MutationObserver(decorateReadiness).observe(readiness, {
        childList: true,
      });
    document.addEventListener("emoji:live-state", () =>
      setTimeout(decorateReadiness, 0),
    );
    document.addEventListener("emoji:settings-ready", (event) => {
      const entry = sections.get(event.detail?.section);
      if (!entry || dirty.has(entry.id)) return;
      entry.saved = snapshot(entry.node);
      evaluate(entry);
    });
    decorateReadiness();
    updateUI();
  }

  function controls(node) {
    return [
      ...node.querySelectorAll("input[name],select[name],textarea[name]"),
    ];
  }
  function value(element) {
    return element.type === "checkbox" || element.type === "radio"
      ? Boolean(element.checked)
      : element.value;
  }
  function snapshot(node) {
    return controls(node).map((element) => ({
      element,
      value: value(element),
    }));
  }
  function equal(saved, node) {
    const current = controls(node);
    return (
      saved.length === current.length &&
      saved.every(
        (item, index) =>
          item.element === current[index] &&
          item.value === value(current[index]),
      )
    );
  }

  function register(config) {
    const node = document.querySelector(config.selector);
    if (!node) return;
    const entry = { ...config, node, saved: snapshot(node) };
    sections.set(config.id, entry);
    node.addEventListener("input", () => evaluate(entry));
    node.addEventListener("change", () => evaluate(entry));
    const status = node.querySelector(config.status);
    if (status)
      new MutationObserver(() => {
        if (status.textContent.trim().startsWith("✓")) commit(entry);
      }).observe(status, {
        childList: true,
        characterData: true,
        subtree: true,
      });
  }

  function evaluate(entry) {
    equal(entry.saved, entry.node)
      ? dirty.delete(entry.id)
      : dirty.add(entry.id);
    updateUI();
  }
  function commit(entry) {
    entry.saved = snapshot(entry.node);
    dirty.delete(entry.id);
    updateUI();
    if (!savingAll) toast(`${entry.label} saved`, "success");
  }

  function createBar() {
    bar = document.createElement("aside");
    bar.id = "dashboard-save-bar";
    bar.className = "dashboard-save-bar";
    bar.hidden = true;
    bar.innerHTML =
      '<div><span class="save-pulse" aria-hidden="true"></span><p><b>Unsaved dashboard changes</b><small id="dashboard-save-message">Review and save before your next stream.</small></p></div><div><button type="button" class="secondary" id="discard-dashboard-changes">Discard</button><button type="button" id="save-dashboard-changes">Save all changes</button></div>';
    document.body.append(bar);
    barMessage = bar.querySelector("#dashboard-save-message");
    bar
      .querySelector("#discard-dashboard-changes")
      .addEventListener("click", discardAll);
    bar
      .querySelector("#save-dashboard-changes")
      .addEventListener("click", saveAll);
  }

  function createToasts() {
    const root = document.createElement("div");
    root.id = "dashboard-toasts";
    root.className = "dashboard-toasts";
    root.setAttribute("aria-live", "polite");
    document.body.append(root);
    window.dashboardToast = toast;
  }
  function toast(message, type = "info") {
    const root = document.querySelector("#dashboard-toasts");
    if (!root) return;
    const item = document.createElement("div");
    item.className = `dashboard-toast ${type}`;
    item.textContent = message;
    root.append(item);
    requestAnimationFrame(() => item.classList.add("show"));
    setTimeout(() => {
      item.classList.remove("show");
      setTimeout(() => item.remove(), 250);
    }, 2600);
  }

  function updateUI() {
    if (!bar) return;
    bar.hidden = !dirty.size;
    document.body.classList.toggle(
      "has-dashboard-save-bar",
      Boolean(dirty.size),
    );
    if (!savingAll)
      barMessage.textContent = dirty.size
        ? `${dirty.size} section${dirty.size === 1 ? "" : "s"} changed. OBS still uses the last saved version.`
        : "All changes saved.";
    configs.forEach((config) => {
      const link = document.querySelector(
        `.dashboard-nav a[href="#${config.id}"]`,
      );
      if (!link) return;
      let dot = link.querySelector(".nav-dirty-dot");
      if (dirty.has(config.id)) {
        if (!dot) {
          dot = document.createElement("i");
          dot.className = "nav-dirty-dot";
          dot.title = "Unsaved changes";
          link.append(dot);
        }
      } else dot?.remove();
    });
    const settingsLabel = document.querySelector(".dashboard-nav-label");
    if (settingsLabel) {
      settingsLabel.classList.toggle("has-dirty", Boolean(dirty.size));
      settingsLabel.dataset.dirtyCount = String(dirty.size);
      settingsLabel.title = dirty.size
        ? `${dirty.size} settings section${dirty.size === 1 ? "" : "s"} changed`
        : "Settings";
    }
    decorateReadiness();
  }

  function restore(entry) {
    entry.saved.forEach((item) => {
      if (item.element.type === "checkbox" || item.element.type === "radio")
        item.element.checked = Boolean(item.value);
      else item.element.value = item.value;
    });
    entry.node.dispatchEvent(new Event("input", { bubbles: true }));
    entry.node.dispatchEvent(new Event("change", { bubbles: true }));
    entry.saved = snapshot(entry.node);
    dirty.delete(entry.id);
  }
  function discardAll() {
    for (const id of [...dirty]) {
      const entry = sections.get(id);
      if (entry) restore(entry);
    }
    updateUI();
    toast("Unsaved changes discarded", "info");
  }

  async function saveAll() {
    if (!dirty.size || savingAll) return;
    savingAll = true;
    barMessage.textContent = "Saving every changed section…";
    const saveButton = bar.querySelector("#save-dashboard-changes");
    saveButton.disabled = true;
    for (const id of [...dirty]) {
      const entry = sections.get(id),
        button = entry?.node.querySelector(entry.save);
      if (button && !button.disabled) button.click();
    }
    const started = Date.now();
    while (dirty.size && Date.now() - started < 12000)
      await new Promise((resolve) => setTimeout(resolve, 100));
    savingAll = false;
    saveButton.disabled = false;
    if (dirty.size) {
      barMessage.textContent =
        "Some sections could not be saved. Check the messages above.";
      toast("Some changes still need attention", "error");
    } else toast("All dashboard changes saved", "success");
    updateUI();
  }

  function decorateReadiness() {
    const list = document.querySelector(".readiness-list");
    if (!list) return;
    let row = list.querySelector('[data-client-readiness="settings"]');
    if (!row) {
      row = document.createElement("div");
      row.dataset.clientReadiness = "settings";
      list.append(row);
    }
    row.className = `readiness-check ${dirty.size ? "warning" : "ready"}`;
    row.innerHTML = `<span aria-hidden="true">${dirty.size ? "!" : "✓"}</span><div><b>Dashboard settings</b><small>${dirty.size ? `${dirty.size} section${dirty.size === 1 ? "" : "s"} not saved` : "All changes saved"}</small></div>`;
    if (dirty.size) {
      const heading = document.querySelector(".dashboard-health h2"),
        dot = document.querySelector(".dashboard-health .live-dot");
      if (heading) heading.textContent = "Save your dashboard changes";
      dot?.classList.add("warning");
    }
  }

  function confirmDestructive(event) {
    const button = event.target.closest("[data-revoke]");
    if (!button) return;
    if (
      !window.confirm(
        "Revoke this guest link now? Anyone using it will be disconnected immediately.",
      )
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0));
  else setTimeout(init, 0);
})();
