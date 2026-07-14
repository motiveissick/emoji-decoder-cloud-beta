(() => {
  let liveState = null,
    step = 0,
    busy = false,
    autoHandled = false,
    attempts = 0;

  function init() {
    const main = document.querySelector(".dashboard-main"),
      settingsHeader = document.querySelector(".dashboard-settings-header");
    if (!main || !settingsHeader) {
      if (attempts++ < 80) setTimeout(init, 50);
      return;
    }
    if (document.querySelector("#dashboard-setup-dialog")) return;
    createDialog();
    createReopenButton(settingsHeader);
    document.addEventListener("emoji:live-state", (event) => {
      liveState = event.detail;
      updateFromState();
    });
    fetch("/dashboard/live-state")
      .then((response) => response.json())
      .then((body) => {
        liveState = body;
        updateFromState();
      })
      .catch(() => {});
  }

  function createReopenButton(header) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = "reopen-setup-wizard";
    button.className = "secondary setup-reopen";
    button.textContent = "Review setup";
    button.addEventListener("click", reopen);
    const returnButton = header.querySelector("[data-dashboard-return-live]");
    if (returnButton) {
      let actions = header.querySelector(".dashboard-settings-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "dashboard-settings-actions";
        returnButton.before(actions);
        actions.append(returnButton);
      }
      actions.prepend(button);
    } else header.append(button);
  }

  function createDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = "dashboard-setup-dialog";
    dialog.className = "dashboard-setup-dialog";
    dialog.setAttribute("aria-labelledby", "setup-wizard-title");
    dialog.innerHTML = `
      <div class="setup-wizard-shell">
        <header class="setup-wizard-header"><div><span aria-hidden="true">⚡</span><div><small>QUICK SETUP</small><h2 id="setup-wizard-title" tabindex="-1">Get stream-ready</h2></div></div><button type="button" class="setup-close" aria-label="Skip setup for now">×</button></header>
        <ol class="setup-steps" aria-label="Setup progress"><li data-setup-step-dot="0"><span>1</span>Kick</li><li data-setup-step-dot="1"><span>2</span>OBS</li><li data-setup-step-dot="2"><span>3</span>Test</li></ol>
        <div class="setup-wizard-content">
          <section data-setup-step="0" aria-labelledby="setup-kick-title"><span class="setup-step-icon" aria-hidden="true">🟢</span><small>STEP 1 OF 3</small><h3 id="setup-kick-title">Connect Kick chat</h3><p>Emoji Decoder needs your Kick connection to read guesses and post viewer cards.</p><div id="setup-kick-checks" class="setup-check-list"></div><a class="button" href="/auth/kick" id="setup-connect-kick">Connect Kick</a></section>
          <section data-setup-step="1" aria-labelledby="setup-obs-title" hidden><span class="setup-step-icon" aria-hidden="true">◫</span><small>STEP 2 OF 3</small><h3 id="setup-obs-title">Add both OBS sources</h3><p>Use 1920 × 1080 for both, with Scoreboard above Game Overlay in your scene.</p><div id="setup-obs-checks" class="setup-check-list"></div><div class="setup-step-actions"><button type="button" id="setup-copy-sources">Copy both source URLs</button><button type="button" class="secondary" id="setup-open-preview">Open overlay preview</button></div><p class="setup-private-note">Your private source URLs remain masked in this wizard.</p></section>
          <section data-setup-step="2" aria-labelledby="setup-test-title" hidden><span class="setup-step-icon" aria-hidden="true">🧪</span><small>STEP 3 OF 3</small><h3 id="setup-test-title">Run an isolated test</h3><p>Create a 24-hour Guest Test Lab to check answers, results and overlays without touching your live leaderboard.</p><div id="setup-final-checks" class="setup-check-list"></div><button type="button" class="secondary" id="setup-open-testing">Open Guest Testing settings</button><p class="setup-warning"><b>Live Control is real.</b> Starting a manual round from Broadcast sends it to your connected overlay. Use Guest Testing for an isolated rehearsal.</p></section>
        </div>
        <p id="setup-wizard-status" class="setup-wizard-status" role="status"></p>
        <footer class="setup-wizard-footer"><button type="button" class="setup-skip">Skip for now</button><div><button type="button" class="secondary setup-back">Back</button><button type="button" class="setup-next">Continue</button></div></footer>
      </div>`;
    document.body.append(dialog);
    dialog.querySelector(".setup-close").addEventListener("click", dismiss);
    dialog.querySelector(".setup-skip").addEventListener("click", dismiss);
    dialog.querySelector(".setup-back").addEventListener("click", () => {
      if (step > 0) {
        step--;
        render();
      }
    });
    dialog.querySelector(".setup-next").addEventListener("click", () => {
      if (step < 2) {
        step++;
        render();
      } else complete();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dismiss();
    });
    dialog
      .querySelector("#setup-copy-sources")
      .addEventListener("click", () => {
        const sourceButton = document.querySelector("#copy-both-obs");
        if (sourceButton) {
          sourceButton.click();
          status("✓ Both private source URLs copied.");
        } else status("OBS sources are still loading. Try again in a moment.");
      });
    dialog
      .querySelector("#setup-open-preview")
      .addEventListener("click", () => {
        const preview = document.querySelector("#open-overlay-preview");
        if (preview?.href && preview.href !== "#") {
          preview.click();
          status("Overlay preview opened in a new tab.");
        } else status("Overlay preview is still loading.");
      });
    dialog
      .querySelector("#setup-open-testing")
      .addEventListener("click", () => {
        window.dashboardSetMode?.("settings");
        history.replaceState(null, "", `${location.pathname}#testing`);
        closeDialog();
        requestAnimationFrame(() =>
          document.querySelector("#testing")?.scrollIntoView({ block: "start" }),
        );
      });
    dialog.querySelector("#setup-connect-kick").addEventListener("click", (event) => {
      if (liveState?.kick?.connected) event.preventDefault();
    });
  }

  function check(id) {
    return liveState?.readiness?.checks?.find((item) => item.id === id) || null;
  }

  function checkMarkup(items) {
    return items
      .filter(Boolean)
      .map(
        (item) =>
          `<div class="setup-check ${item.state}"><span aria-hidden="true">${item.state === "ready" ? "✓" : item.state === "warning" ? "!" : "○"}</span><div><b>${escapeText(item.label)}</b><small>${escapeText(item.detail)}</small></div></div>`,
      )
      .join("");
  }

  function escapeText(value) {
    return String(value ?? "").replace(
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
  }

  function updateFromState() {
    const setup = liveState?.setup;
    document.querySelector("#reopen-setup-wizard").textContent = setup?.completed
      ? "Review setup"
      : "Finish setup";
    render();
    if (!autoHandled && setup) {
      autoHandled = true;
      if (setup.shouldOpen) openDialog();
    }
  }

  function render() {
    const dialog = document.querySelector("#dashboard-setup-dialog");
    if (!dialog) return;
    dialog.querySelectorAll("[data-setup-step]").forEach((panel) => {
      panel.hidden = Number(panel.dataset.setupStep) !== step;
    });
    dialog.querySelectorAll("[data-setup-step-dot]").forEach((item) => {
      const index = Number(item.dataset.setupStepDot);
      item.classList.toggle("active", index === step);
      item.classList.toggle("complete", index < step);
      if (index === step) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    dialog.querySelector(".setup-back").disabled = step === 0 || busy;
    dialog.querySelector(".setup-next").disabled = busy;
    dialog.querySelector(".setup-next").textContent =
      step === 2 ? "Finish setup" : "Continue";
    const kickChecks = [check("kick"), check("subscription")],
      obsChecks = [check("overlay"), check("scoreboard")],
      finalChecks = [check("automatic")];
    dialog.querySelector("#setup-kick-checks").innerHTML =
      checkMarkup(kickChecks) || "<p>Checking Kick connection…</p>";
    dialog.querySelector("#setup-obs-checks").innerHTML =
      checkMarkup(obsChecks) || "<p>Checking OBS sources…</p>";
    dialog.querySelector("#setup-final-checks").innerHTML =
      checkMarkup(finalChecks) || "<p>Checking round schedule…</p>";
    const connect = dialog.querySelector("#setup-connect-kick");
    connect.textContent = liveState?.kick?.connected
      ? "✓ Kick connected"
      : "Connect Kick";
    connect.classList.toggle("secondary", Boolean(liveState?.kick?.connected));
    connect.setAttribute(
      "aria-disabled",
      String(Boolean(liveState?.kick?.connected)),
    );
  }

  function openDialog() {
    const dialog = document.querySelector("#dashboard-setup-dialog");
    step = 0;
    render();
    status("");
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    requestAnimationFrame(() =>
      dialog.querySelector("#setup-wizard-title")?.focus(),
    );
  }

  function closeDialog() {
    const dialog = document.querySelector("#dashboard-setup-dialog");
    if (dialog.close) dialog.close();
    else dialog.removeAttribute("open");
  }

  function status(message) {
    const node = document.querySelector("#setup-wizard-status");
    if (node) node.textContent = message;
  }

  async function action(name) {
    const response = await fetch("/dashboard/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name }),
      }),
      body = await response.json().catch(() => ({ error: "Setup request failed." }));
    if (!response.ok) throw new Error(body.error || "Setup request failed.");
    return body;
  }

  async function dismiss() {
    if (busy) return;
    busy = true;
    render();
    status("Saving your choice…");
    try {
      const body = await action("dismiss");
      if (liveState) liveState.setup = body.setup;
      closeDialog();
      window.dashboardToast?.("Setup can be reopened from Settings", "info");
    } catch (error) {
      status(`⚠ ${error.message}`);
    } finally {
      busy = false;
      render();
    }
  }

  async function complete() {
    if (busy) return;
    busy = true;
    render();
    status("Finishing setup…");
    try {
      const body = await action("complete");
      if (liveState) liveState.setup = body.setup;
      closeDialog();
      document.querySelector("#reopen-setup-wizard").textContent = "Review setup";
      window.dashboardToast?.("Stream setup walkthrough complete", "success");
    } catch (error) {
      status(`⚠ ${error.message}`);
    } finally {
      busy = false;
      render();
    }
  }

  async function reopen() {
    if (busy) return;
    try {
      await action("reopen");
      openDialog();
    } catch (error) {
      window.dashboardToast?.(error.message, "error");
    }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0));
  else setTimeout(init, 0);
})();
