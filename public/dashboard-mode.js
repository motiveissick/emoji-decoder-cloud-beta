(() => {
  const settingsHashes = new Set([
      "#settings",
      "#sources",
      "#game",
      "#puzzles",
      "#community",
      "#appearance",
      "#insights",
      "#testing",
      "#setup",
      "#commands",
    ]),
    maxAttempts = 60;
  let attempts = 0;

  function init() {
    const main = document.querySelector(".dashboard-main"),
      nav = document.querySelector(".dashboard-nav"),
      overview = document.querySelector(".dashboard-overview"),
      live = document.querySelector("#live-control"),
      sources = document.querySelector("#sources"),
      game = document.querySelector("#game, .game-settings"),
      community = document.querySelector("#community, .community-settings"),
      appearance = document.querySelector("#appearance");
    if (
      !main ||
      !nav ||
      !overview ||
      !live ||
      !sources ||
      !game ||
      !community ||
      !appearance
    ) {
      if (attempts++ < maxAttempts) setTimeout(init, 50);
      return;
    }
    if (main.dataset.modeReady) return;
    main.dataset.modeReady = "true";

    const broadcast = document.createElement("div"),
      settings = document.createElement("div"),
      settingsHeader = document.createElement("header");
    broadcast.className = "dashboard-view dashboard-broadcast-view";
    broadcast.dataset.dashboardView = "broadcast";
    broadcast.setAttribute("aria-label", "Broadcast controls");
    settings.className = "dashboard-view dashboard-settings-view";
    settings.dataset.dashboardView = "settings";
    settings.id = "settings";
    settings.setAttribute("aria-label", "Dashboard settings");
    settingsHeader.className = "dashboard-settings-header";
    settingsHeader.innerHTML =
      '<div><small>DASHBOARD SETTINGS</small><h1>Settings</h1><p>Configure OBS, game rules, community tools and viewer-facing appearance.</p></div><button type="button" class="secondary" data-dashboard-return-live>← Return to Broadcast</button>';

    broadcast.append(overview, live);
    settings.append(settingsHeader);
    [
      sources,
      game,
      document.querySelector("#puzzles, .puzzle-library"),
      community,
      appearance,
      document.querySelector(".dashboard-operations"),
      document.querySelector(".dashboard-resources"),
    ].forEach((panel) => {
      if (panel && !settings.contains(panel)) settings.append(panel);
    });
    nav.after(broadcast, settings);

    const broadcastLink = nav.querySelector('a[href="#live-control"]'),
      settingsLinks = [
        ...nav.querySelectorAll('a[href]:not([href="#live-control"])'),
      ];

    function setMode(
      mode,
      { focus = false, activeHash = location.hash } = {},
    ) {
      const next = mode === "settings" ? "settings" : "broadcast";
      main.dataset.dashboardMode = next;
      broadcast.hidden = next !== "broadcast";
      settings.hidden = next !== "settings";
      broadcast.setAttribute("aria-hidden", String(next !== "broadcast"));
      settings.setAttribute("aria-hidden", String(next !== "settings"));
      nav.classList.toggle("show-settings-nav", next === "settings");
      nav
        .querySelectorAll("a")
        .forEach((link) => link.removeAttribute("aria-current"));
      if (next === "broadcast") {
        broadcastLink?.setAttribute("aria-current", "page");
      } else {
        [...nav.querySelectorAll("a[href]")]
          .find((link) => link.getAttribute("href") === activeHash)
          ?.setAttribute("aria-current", "page");
      }
      if (focus) {
        const target = next === "settings" ? settingsHeader : live;
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
      document.dispatchEvent(
        new CustomEvent("emoji:dashboard-mode", { detail: { mode: next } }),
      );
    }

    broadcastLink?.addEventListener("click", () => setMode("broadcast"));
    settingsLinks.forEach((link) =>
      link.addEventListener("click", () =>
        setMode("settings", { activeHash: link.getAttribute("href") }),
      ),
    );
    settingsHeader
      .querySelector("[data-dashboard-return-live]")
      .addEventListener("click", () => {
        history.replaceState(null, "", `${location.pathname}#live-control`);
        setMode("broadcast", { focus: true });
      });
    window.addEventListener("hashchange", () => {
      if (settingsHashes.has(location.hash)) setMode("settings");
      else if (location.hash === "#live-control") setMode("broadcast");
    });
    window.dashboardSetMode = setMode;
    window.dashboardSettingsView = settings;
    setMode(settingsHashes.has(location.hash) ? "settings" : "broadcast");
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0));
  else setTimeout(init, 0);
})();
