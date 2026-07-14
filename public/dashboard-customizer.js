(() => {
  const shellHref = "/dashboard-shell.css";
  if (!document.querySelector('link[href="' + shellHref + '"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = shellHref;
    document.head.append(link);
  }
  try {
    window.INITIAL_THEME = JSON.parse(
      document.querySelector("#dashboard-theme-data")?.textContent || "{}",
    );
  } catch {
    window.INITIAL_THEME = {};
  }

  queueMicrotask(() => {
    const main = document.querySelector("main");
    const account = main?.querySelector(":scope > .account");
    if (!main || !account || main.dataset.dashboardEnhanced) return;

    main.dataset.dashboardEnhanced = "true";
    main.id = "top";
    main.classList.add("dashboard-main");

    const signedIn = account.querySelector(":scope > span:first-child");
    const accountLinks = account.querySelector(":scope > span:last-child");
    signedIn?.classList.add("account-user");
    accountLinks?.classList.add("account-actions");

    const brand = document.createElement("a");
    brand.className = "dashboard-brand";
    brand.href = "/dashboard";
    brand.setAttribute("aria-label", "Emoji Decoder dashboard home");
    brand.innerHTML =
      '<span aria-hidden="true">⚡</span><strong>Emoji Decoder</strong>';
    account.prepend(brand);
    main.prepend(account);

    const sections = {
      insights: document.querySelector(".round-insights"),
      game: document.querySelector(".game-settings"),
      testing: document.querySelector(".guest-manager"),
      appearance: document.querySelector("#overlay-customizer"),
    };
    Object.entries(sections).forEach(([id, section]) => {
      if (!section) return;
      section.id = id;
      section.classList.add("dashboard-panel");
    });

    const nav = document.createElement("nav");
    nav.className = "dashboard-nav";
    nav.setAttribute("aria-label", "Dashboard sections");
    nav.innerHTML =
      '<a href="#live-control" aria-current="page"><span aria-hidden="true">●</span>Broadcast</a><span class="dashboard-nav-divider" aria-hidden="true"></span><span class="dashboard-nav-label">Settings</span><a href="#sources"><span aria-hidden="true">◫</span>OBS</a><a href="#game"><span aria-hidden="true">⚙</span>Game</a><a href="#community"><span aria-hidden="true">◎</span>Community</a><a href="#appearance"><span aria-hidden="true">✦</span>Appearance</a>';
    account.after(nav);

    const eyebrow = main.querySelector(":scope > small");
    const title = main.querySelector(":scope > h1");
    const maintenance = main.querySelector(":scope > .maintenance");
    const connectionStatus = main.querySelector(":scope > .status");
    const connectionButton = connectionStatus?.nextElementSibling?.matches(
      ".button",
    )
      ? connectionStatus.nextElementSibling
      : null;

    const overview = document.createElement("section");
    overview.className = "dashboard-overview";
    overview.setAttribute("aria-labelledby", "dashboard-title");

    const intro = document.createElement("div");
    intro.className = "dashboard-intro";
    eyebrow?.remove();
    if (title) {
      title.id = "dashboard-title";
      intro.append(title);
    }
    const introCopy = document.createElement("p");
    introCopy.textContent =
      "Run the game, check OBS and adjust what viewers see.";
    intro.append(introCopy);

    const health = document.createElement("article");
    health.className = "dashboard-health";
    health.innerHTML =
      '<div class="dashboard-card-heading"><span class="live-dot" aria-hidden="true"></span><div><small>STREAM STATUS</small><h2>Ready for your next show</h2></div></div>';
    const connectionRow = document.createElement("div");
    connectionRow.className = "connection-row";
    if (connectionStatus) connectionRow.append(connectionStatus);
    if (connectionButton) connectionRow.append(connectionButton);
    health.append(connectionRow);
    if (maintenance) health.append(maintenance);

    overview.append(intro, health);
    nav.after(overview);

    const sourcesHeading = [...main.querySelectorAll(":scope > h2")].find(
      (node) => node.textContent.trim() === "OBS sources",
    );
    if (sourcesHeading) {
      const copies = [...main.querySelectorAll(":scope > .copy")];
      const copyBoth = copies
        .at(-1)
        ?.nextElementSibling?.matches("button.secondary")
        ? copies.at(-1).nextElementSibling
        : null;
      const sourceNote = copyBoth?.nextElementSibling?.matches("p")
        ? copyBoth.nextElementSibling
        : null;
      const testLink = sourceNote?.nextElementSibling?.matches("a.button")
        ? sourceNote.nextElementSibling
        : null;
      const sourcesPanel = document.createElement("section");
      sourcesPanel.className = "guide dashboard-panel obs-sources";
      sourcesPanel.id = "sources";

      const sourceHead = document.createElement("div");
      sourceHead.className = "panel-heading-row";
      const sourceTitle = document.createElement("div");
      sourceTitle.className = "panel-title";
      const sourceKicker = document.createElement("span");
      sourceKicker.className = "pill";
      sourceKicker.textContent = "OBS SETUP";
      sourceTitle.append(sourceKicker, sourcesHeading);
      const privateBadge = document.createElement("span");
      privateBadge.className = "private-badge";
      privateBadge.innerHTML =
        '<span aria-hidden="true">●</span> Private links';
      sourceHead.append(sourceTitle, privateBadge);

      const sourceGrid = document.createElement("div");
      sourceGrid.className = "source-grid";
      copies.forEach((copy) => sourceGrid.append(copy));

      const sourceActions = document.createElement("div");
      sourceActions.className = "source-actions";
      if (copyBoth) sourceActions.append(copyBoth);
      if (testLink) sourceActions.append(testLink);

      sourcesPanel.append(sourceHead, sourceGrid);
      if (sourceNote) {
        sourceNote.classList.add("source-note");
        sourcesPanel.append(sourceNote);
      }
      sourcesPanel.append(sourceActions);
      overview.after(sourcesPanel);
    }

    if (sections.insights && sections.testing) {
      const operations = document.createElement("div");
      operations.className = "dashboard-operations";
      const first =
        sections.testing.compareDocumentPosition(sections.insights) &
        Node.DOCUMENT_POSITION_FOLLOWING
          ? sections.testing
          : sections.insights;
      first.before(operations);
      operations.append(sections.insights, sections.testing);
    }

    const resourceGuides = [...main.querySelectorAll(":scope > .guide")].filter(
      (section) => {
        const label = section
          .querySelector(":scope > .pill")
          ?.textContent.trim();
        return label === "CLOUD SETUP" || label === "VIEWER GUIDE";
      },
    );
    if (resourceGuides.length) {
      const resources = document.createElement("div");
      resources.className = "dashboard-resources";
      resourceGuides[0].before(resources);
      resourceGuides.forEach((section) => {
        const label = section
          .querySelector(":scope > .pill")
          ?.textContent.trim();
        section.id = label === "CLOUD SETUP" ? "setup" : "commands";
        section.classList.add("dashboard-panel", "resource-panel");
        resources.append(section);
      });
    }

    const preview = document.querySelector("#theme-preview");
    const popup = preview?.querySelector(":scope > .preview-popup");
    if (preview && popup) {
      const slot = document.createElement("div");
      slot.className = "preview-popup-slot";
      popup.before(slot);
      slot.append(popup);
    }

    document
      .querySelector("#copy-command-list")
      ?.addEventListener("click", async (event) => {
        const button = event.currentTarget,
          commands =
            "!commands · !rank season · !profile\n!scoreboard season · !scoreboard daily · !scoreboard alltime\n!challenge · !badges · !jackpot";
        try {
          await navigator.clipboard.writeText(commands);
          button.textContent = "✓ Commands copied";
        } catch {
          button.textContent = "Copy failed";
        }
        setTimeout(() => (button.textContent = "Copy command list"), 1600);
      });

    const navLinks = [...nav.querySelectorAll("a")];
    navLinks.forEach((link) =>
      link.addEventListener("click", () => {
        navLinks.forEach((item) => item.removeAttribute("aria-current"));
        link.setAttribute("aria-current", "page");
      }),
    );

    if ("IntersectionObserver" in window) {
      const targets = navLinks
        .map((link) => document.querySelector(link.getAttribute("href")))
        .filter(Boolean);
      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
          if (!visible) return;
          navLinks.forEach((link) => link.removeAttribute("aria-current"));
          nav
            .querySelector('a[href="#' + visible.target.id + '"]')
            ?.setAttribute("aria-current", "page");
        },
        { rootMargin: "-18% 0px -68% 0px", threshold: [0, 0.1, 0.35] },
      );
      targets.forEach((target) => observer.observe(target));
    }
  });
})();
(() => {
  const presets = {
      kick: {
        primary: "#53fc18",
        secondary: "#00c96b",
        background: "#07120b",
        text: "#ffffff",
      },
      purple: {
        primary: "#c45cff",
        secondary: "#6b4bff",
        background: "#12091a",
        text: "#ffffff",
      },
      ice: {
        primary: "#4de8ff",
        secondary: "#3d7bff",
        background: "#07131b",
        text: "#f5fdff",
      },
      fire: {
        primary: "#ff5a36",
        secondary: "#ffb21c",
        background: "#1a0905",
        text: "#fff8ed",
      },
      gold: {
        primary: "#ffd84d",
        secondary: "#d99b19",
        background: "#171205",
        text: "#fffbed",
      },
      minimal: {
        primary: "#ffffff",
        secondary: "#a7ada9",
        background: "#101211",
        text: "#ffffff",
      },
    },
    defaults = {
      preset: "kick",
      ...presets.kick,
      position: "center",
      scale: 100,
      opacity: 94,
      radius: 24,
      glow: 35,
      font: "system",
      customCss: "",
    };
  const root = document.querySelector("#overlay-customizer");
  if (!root) return;
  const presetInput = document.createElement("input");
  presetInput.type = "hidden";
  presetInput.name = "preset";
  presetInput.value = window.INITIAL_THEME?.preset || "kick";
  root.append(presetInput);
  const preview = root.querySelector("#theme-preview"),
    status = root.querySelector("#theme-status"),
    fonts = {
      system: "Inter,system-ui,sans-serif",
      rounded: '"Arial Rounded MT Bold",Nunito,system-ui,sans-serif',
      condensed: 'Impact,"Arial Narrow",sans-serif',
      mono: "Consolas,monospace",
    };
  const field = (name) => root.querySelector(`[name="${name}"]`),
    read = () => ({
      preset: presetInput.value,
      ...Object.fromEntries(
        [
          "primary",
          "secondary",
          "background",
          "text",
          "position",
          "font",
          "customCss",
        ]
          .map((k) => [k, field(k).value])
          .concat(
            ["scale", "opacity", "radius", "glow"].map((k) => [
              k,
              Number(field(k).value),
            ]),
          ),
      ),
    });
  function fill(theme) {
    presetInput.value = theme.preset || presetInput.value;
    Object.entries({ ...defaults, ...theme }).forEach(([k, v]) => {
      const el = field(k);
      if (el) el.value = v;
    });
    update();
  }
  function update() {
    const t = read();
    preview.style.setProperty("--p", t.primary);
    preview.style.setProperty("--s", t.secondary);
    preview.style.setProperty("--bg", t.background);
    preview.style.setProperty("--tx", t.text);
    preview.style.setProperty("--alpha", `${t.opacity}%`);
    preview.style.setProperty("--radius", `${t.radius}px`);
    preview.style.setProperty("--glow", `${t.glow}px`);
    preview.style.setProperty("--scale", t.scale / 100);
    preview.style.fontFamily = fonts[t.font] || fonts.system;
    preview.dataset.position = t.position;
    root.querySelectorAll("[data-preset]").forEach((button) => {
      const active = button.dataset.preset === t.preset;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    ["scale", "opacity", "radius", "glow"].forEach(
      (k) =>
        (root.querySelector(`[data-for="${k}"]`).textContent =
          `${t[k]}${["scale", "opacity"].includes(k) ? "%" : "px"}`),
    );
    root.querySelector("#css-count").textContent = t.customCss.length;
  }
  root.addEventListener("input", update);
  root.querySelectorAll("[data-preset]").forEach((button) =>
    button.addEventListener("click", () => {
      const selectedPreset = button.dataset.preset;
      fill({ ...read(), ...presets[selectedPreset], preset: selectedPreset });
      root.dispatchEvent(new Event("input", { bubbles: true }));
      status.textContent = `${button.textContent} preview applied. Save to update OBS.`;
    }),
  );
  root.querySelector("#save-theme").addEventListener("click", async () => {
    status.textContent = "Saving…";
    const response = await fetch("/dashboard/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(read()),
      }),
      body = await response
        .json()
        .catch(() => ({ error: "Could not save theme." }));
    status.textContent = response.ok
      ? "✓ Saved. Existing OBS sources updated automatically."
      : `⚠ ${body.error}`;
    if (response.ok) fill(body.theme);
  });
  root.querySelector("#reset-theme").addEventListener("click", () => {
    fill(defaults);
    root.dispatchEvent(new Event("input", { bubbles: true }));
    status.textContent =
      "Default theme restored in preview. Press Save changes to apply it.";
  });
  root.querySelector("#copy-css").addEventListener("click", async () => {
    const t = read(),
      css = `:root {\n  --theme-primary: ${t.primary};\n  --theme-secondary: ${t.secondary};\n  --theme-background: ${t.background};\n  --theme-text: ${t.text};\n  --theme-scale: ${t.scale / 100};\n  --theme-radius: ${t.radius}px;\n}\n${t.customCss}`;
    try {
      await navigator.clipboard.writeText(css);
      status.textContent = "✓ CSS copied.";
    } catch {
      status.textContent = "⚠ Copy failed. Select and copy the CSS manually.";
    }
  });
  fill(window.INITIAL_THEME || defaults);
})();
document.addEventListener("DOMContentLoaded", () =>
  setTimeout(() => {
    const section = document.querySelector(".community-settings");
    if (!section) return;
    section.id = "community";
    section.classList.add("dashboard-panel");
    const nav = document.querySelector(".dashboard-nav");
    if (!nav) return;
    let link = nav.querySelector('[href="#community"]');
    if (!link) {
      link = document.createElement("a");
      link.href = "#community";
      link.innerHTML = '<span aria-hidden="true">◎</span>Community goal';
      const appearance = nav.querySelector('[href="#appearance"]');
      appearance ? appearance.before(link) : nav.append(link);
    }
    link.addEventListener("click", () => {
      nav
        .querySelectorAll("a")
        .forEach((item) => item.removeAttribute("aria-current"));
      link.setAttribute("aria-current", "page");
    });
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          nav
            .querySelectorAll("a")
            .forEach((item) => item.removeAttribute("aria-current"));
          link.setAttribute("aria-current", "page");
        },
        { rootMargin: "-18% 0px -68% 0px", threshold: [0, 0.1, 0.35] },
      );
      observer.observe(section);
    }
  }, 0),
);
document.addEventListener("DOMContentLoaded", () => {
  const game = document.querySelector(".game-settings");
  if (!game) return;
  const section = document.createElement("section");
  section.className = "guide community-settings";
  section.innerHTML = `<span class="pill">COMMUNITY GOAL</span><h2>Community goal</h2><p class="muted">Each correct viewer adds progress. Reaching the target activates double points for everyone.</p><div class="community-dashboard-grid"><label class="switch-row"><span><b>Enable community goal</b><small>Keep shared progress between rounds</small></span><input type="checkbox" name="communityEnabled"></label><label>Correct answers needed <output data-community-output="target"></output><input type="range" name="communityTarget" min="5" max="250" step="5"></label><label>Double-points duration <output data-community-output="reward"></output><input type="range" name="communityRewardMinutes" min="1" max="15" step="1"></label></div><div class="community-preview"><div><b id="community-preview-label">Community progress</b><span id="community-preview-value">0 / 25</span></div><div><i id="community-preview-fill"></i></div><small id="community-completions">0 goals completed</small></div><button type="button" id="save-community">Save community goal</button><p id="community-status" role="status"></p>`;
  game.after(section);
  const enabled = section.querySelector('[name="communityEnabled"]'),
    target = section.querySelector('[name="communityTarget"]'),
    reward = section.querySelector('[name="communityRewardMinutes"]'),
    save = section.querySelector("#save-community"),
    status = section.querySelector("#community-status");
  let community = { progress: 0, completions: 0, doublePointsUntil: 0 };
  function read() {
    return {
      communityEnabled: enabled.checked,
      communityTarget: Number(target.value),
      communityRewardMinutes: Number(reward.value),
    };
  }
  function update() {
    const value = read(),
      active = community.doublePointsUntil > Date.now(),
      remaining = Math.max(0, community.doublePointsUntil - Date.now());
    target.disabled = reward.disabled = !value.communityEnabled;
    section.querySelector('[data-community-output="target"]').textContent =
      `${value.communityTarget} answers`;
    section.querySelector('[data-community-output="reward"]').textContent =
      `${value.communityRewardMinutes} min`;
    section.querySelector("#community-preview-label").textContent = active
      ? "⚡ Double points active"
      : "Community progress";
    section.querySelector("#community-preview-value").textContent = active
      ? `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`
      : `${community.progress} / ${value.communityTarget}`;
    section.querySelector("#community-preview-fill").style.width =
      `${active ? 100 : Math.min(100, (community.progress / value.communityTarget) * 100)}%`;
    section
      .querySelector(".community-preview")
      .classList.toggle("active", active);
    section.querySelector("#community-completions").textContent =
      `${community.completions} goal${community.completions === 1 ? "" : "s"} completed`;
  }
  function fill(body) {
    const settings = body.settings;
    enabled.checked = settings.communityEnabled;
    target.value = settings.communityTarget;
    reward.value = settings.communityRewardMinutes;
    community = body.community || community;
    update();
  }
  async function request(url, options) {
    const response = await fetch(url, options),
      body = await response.json().catch(() => ({ error: "Request failed." }));
    if (!response.ok) throw new Error(body.error || "Request failed.");
    return body;
  }
  async function load() {
    try {
      fill(await request("/dashboard/game-settings"));
    } catch (error) {
      status.textContent = `⚠ ${error.message}`;
    }
  }
  section.addEventListener("input", update);
  save.addEventListener("click", async () => {
    save.disabled = true;
    status.textContent = "Saving…";
    try {
      fill(
        await request("/dashboard/community-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(read()),
        }),
      );
      status.textContent =
        "✓ Community goal saved. Existing OBS sources updated.";
    } catch (error) {
      status.textContent = `⚠ ${error.message}`;
    } finally {
      save.disabled = false;
    }
  });
  const gameStatus = document.querySelector("#game-settings-status");
  if (gameStatus)
    new MutationObserver(() => {
      if (gameStatus.textContent.startsWith("✓ Saved")) load();
    }).observe(gameStatus, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  setInterval(update, 1000);
  load();
});
(() => {
  const customizer = document.querySelector("#overlay-customizer");
  if (!customizer) return;
  const section = document.createElement("section");
  section.className = "guide guest-manager";
  section.innerHTML =
    '<span class="pill">GUEST TEST MODE</span><h2>Guest testing</h2><p class="muted">Create a private 24-hour Test Lab with isolated scores and temporary OBS links.</p><div id="guest-sessions"><p class="muted">Loading guest sessions…</p></div><button type="button" id="create-guest">Create 24-hour guest test</button><p id="guest-manager-status" role="status"></p>';
  customizer.before(section);
  const list = section.querySelector("#guest-sessions"),
    status = section.querySelector("#guest-manager-status"),
    create = section.querySelector("#create-guest");
  const safe = (value) =>
    String(value).replace(
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
  async function request(url, options) {
    const response = await fetch(url, options),
      body = await response.json().catch(() => ({ error: "Request failed." }));
    if (!response.ok) throw new Error(body.error || "Request failed.");
    return body;
  }
  function draw(sessions) {
    list.innerHTML = sessions.length
      ? sessions
          .map(
            (session) =>
              `<article class="guest-session" data-id="${session.id}"><div><b>Active guest test</b><span>Expires ${new Date(session.expiresAt).toLocaleString()}</span></div><div class="guest-links"><button type="button" data-copy="${safe(session.labUrl)}">Copy Test Lab</button><button type="button" class="secondary" data-copy="${safe(session.overlayUrl)}">Copy overlay</button><button type="button" class="secondary" data-copy="${safe(session.scoreboardUrl)}">Copy scoreboard</button><a class="button secondary" target="_blank" href="${safe(session.labUrl)}">Open Lab</a><button type="button" class="danger" data-revoke="${session.id}">Revoke</button></div></article>`,
          )
          .join("")
      : '<p class="muted">No active guest tests. Create one when a friend is ready.</p>';
    list.querySelectorAll("[data-copy]").forEach((button) =>
      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(button.dataset.copy);
        button.textContent = "✓ Copied";
      }),
    );
    list.querySelectorAll("[data-revoke]").forEach((button) =>
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await request(`/dashboard/guest-sessions/${button.dataset.revoke}`, {
            method: "DELETE",
          });
          await load();
          status.textContent = "✓ Guest link revoked immediately.";
        } catch (error) {
          status.textContent = error.message;
          button.disabled = false;
        }
      }),
    );
  }
  async function load() {
    try {
      draw((await request("/dashboard/guest-sessions")).sessions);
    } catch (error) {
      list.innerHTML = "";
      status.textContent = error.message;
    }
  }
  create.addEventListener("click", async () => {
    create.disabled = true;
    status.textContent = "Creating secure guest test…";
    try {
      await request("/dashboard/guest-sessions", { method: "POST" });
      await load();
      status.textContent =
        "✓ Guest Test Lab created. Copy and send only the Test Lab link.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      create.disabled = false;
    }
  });
  load();
})();
(() => {
  const customizer = document.querySelector("#overlay-customizer");
  if (!customizer) return;
  const section = document.createElement("section");
  section.className = "guide game-settings";
  section.innerHTML = `<span class="pill">GAME CONTROLS</span><h2>Game settings</h2><p class="muted">Choose a preset or tune future rounds. Existing OBS sources update automatically.</p><input type="hidden" name="preset" value="custom"><div class="game-presets" role="group" aria-label="Game presets"><button type="button" data-game-preset="casual">Casual</button><button type="button" data-game-preset="competitive">Competitive</button><button type="button" data-game-preset="fast">Fast-paced</button><button type="button" data-game-preset="large">Large audience</button><button type="button" class="secondary" data-game-preset="custom">Custom</button></div><div class="game-grid"><label class="switch-row"><span><b>Automatic rounds</b><small>Start without streamer commands</small></span><input type="checkbox" name="automatic"></label><label>Round frequency <output data-game-output="frequencyMinutes"></output><input type="range" name="frequencyMinutes" min="5" max="60" step="1"></label><label>Time to answer <output data-game-output="roundSeconds"></output><input type="range" name="roundSeconds" min="30" max="90" step="5"></label><label>Jackpot chance <output data-game-output="jackpotChance"></output><input type="range" name="jackpotChance" min="0" max="50" step="5"></label><label>Minimum difficulty<select name="minDifficulty"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="expert">Expert</option></select></label><label>Maximum difficulty<select name="maxDifficulty"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="expert">Expert</option></select></label><label class="switch-row"><span><b>Progressive clues</b><small>Reveal more emojis as time passes</small></span><input type="checkbox" name="progressiveReveals"></label></div><fieldset class="category-picker"><legend>Puzzle categories</legend><div id="game-categories"></div></fieldset><div class="game-summary" id="game-summary">Loading settings…</div><button type="button" id="save-game-settings">Save game settings</button><p id="game-settings-status" role="status"></p>`;
  customizer.before(section);
  const status = section.querySelector("#game-settings-status"),
    summary = section.querySelector("#game-summary"),
    save = section.querySelector("#save-game-settings");
  let presets = {},
    selectedPreset = "custom",
    loading = true;
  const field = (name) => section.querySelector(`[name="${name}"]`);
  function read() {
    return {
      preset: field("preset").value,
      automatic: field("automatic").checked,
      frequencyMinutes: Number(field("frequencyMinutes").value),
      roundSeconds: Number(field("roundSeconds").value),
      jackpotChance: Number(field("jackpotChance").value),
      minDifficulty: field("minDifficulty").value,
      maxDifficulty: field("maxDifficulty").value,
      progressiveReveals: field("progressiveReveals").checked,
      categories: [
        ...section.querySelectorAll('[name="gameCategory"]:checked'),
      ].map((input) => input.value),
    };
  }
  function update() {
    const value = read();
    section.querySelector('[data-game-output="frequencyMinutes"]').textContent =
      `Every ${value.frequencyMinutes} min`;
    section.querySelector('[data-game-output="roundSeconds"]').textContent =
      `${value.roundSeconds} sec`;
    section.querySelector('[data-game-output="jackpotChance"]').textContent =
      `${value.jackpotChance}%`;
    summary.innerHTML = value.automatic
      ? `Next rounds run automatically every <b>${value.frequencyMinutes} minutes</b>, with <b>${value.roundSeconds} seconds</b> to answer.`
      : "<b>Automatic rounds are paused.</b> No new games will start until you turn them back on.";
    section.querySelectorAll("[data-game-preset]").forEach((button) => {
      const active = button.dataset.gamePreset === selectedPreset;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
  function fill(value) {
    selectedPreset = value.preset || "custom";
    field("preset").value = selectedPreset;
    [
      "frequencyMinutes",
      "roundSeconds",
      "jackpotChance",
      "minDifficulty",
      "maxDifficulty",
    ].forEach((name) => (field(name).value = value[name]));
    field("automatic").checked = value.automatic;
    field("progressiveReveals").checked = value.progressiveReveals;
    section
      .querySelectorAll('[name="gameCategory"]')
      .forEach(
        (input) => (input.checked = value.categories.includes(input.value)),
      );
    update();
  }
  async function request(url, options) {
    const response = await fetch(url, options),
      body = await response.json().catch(() => ({ error: "Request failed." }));
    if (!response.ok) throw new Error(body.error || "Request failed.");
    return body;
  }
  section.addEventListener("input", (event) => {
    if (event.target === section) selectedPreset = field("preset").value;
    else if (!loading && event.target !== field("preset")) {
      selectedPreset = "custom";
      field("preset").value = selectedPreset;
    }
    update();
  });
  section.querySelectorAll("[data-game-preset]").forEach((button) =>
    button.addEventListener("click", () => {
      const name = button.dataset.gamePreset;
      if (name === "custom") {
        selectedPreset = "custom";
        field("preset").value = selectedPreset;
        update();
        section.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      fill({ preset: name, ...presets[name] });
      section.dispatchEvent(new Event("input", { bubbles: true }));
      status.textContent = `${button.textContent} preset ready. Press Save game settings to apply it.`;
    }),
  );
  save.addEventListener("click", async () => {
    if (!read().categories.length) {
      status.textContent = "⚠ Select at least one puzzle category.";
      return;
    }
    save.disabled = true;
    status.textContent = "Saving…";
    try {
      const body = await request("/dashboard/game-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(read()),
      });
      fill(body.settings);
      window.dashboardPuzzlesRefresh?.();
      window.dashboardLiveRefresh?.();
      status.textContent = body.settings.automatic
        ? "✓ Saved. The new schedule and game rules are active."
        : "✓ Saved. Automatic rounds are paused.";
    } catch (error) {
      status.textContent = `⚠ ${error.message}`;
    } finally {
      save.disabled = false;
    }
  });
  (async () => {
    try {
      const body = await request("/dashboard/game-settings");
      presets = body.presets;
      section.querySelector("#game-categories").innerHTML = body.categories
        .map(
          (category) =>
            `<label><input type="checkbox" name="gameCategory" value="${category}"><span>${category}</span></label>`,
        )
        .join("");
      fill(body.settings);
    } catch (error) {
      status.textContent = `⚠ ${error.message}`;
    } finally {
      loading = false;
      document.dispatchEvent(
        new CustomEvent("emoji:settings-ready", {
          detail: { section: "game" },
        }),
      );
    }
  })();
})();
(() => {
  const game = document.querySelector(".game-settings");
  if (!game) return;
  const section = document.createElement("section");
  section.className = "guide round-insights";
  section.innerHTML =
    '<span class="pill">ROUND INSIGHTS</span><h2>Round insights</h2><p class="muted">A private 30-day view of participation, speed and difficulty.</p><div id="insight-content"><p class="muted">Loading round history…</p></div>';
  game.before(section);
  const content = section.querySelector("#insight-content"),
    safe = (value) =>
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
      ),
    time = (ms) => (ms ? `${(ms / 1000).toFixed(1)}s` : "—"),
    percent = (item) =>
      Number.isFinite(Number(item?.solveRate))
        ? Number(item.solveRate)
        : Number(item?.rounds)
          ? Math.round((Number(item.solved) / Number(item.rounds)) * 100)
          : 0,
    breakdown = (title, items, key) =>
      `<section><h4>${title}</h4><div class="insight-breakdown-list">${items.length ? items.slice(0, 6).map((item) => { const rate = Math.max(0, Math.min(100, percent(item))); return `<div><span><b>${safe(item[key])}</b><small>${item.solved}/${item.rounds} solved</small></span><progress aria-label="${rate}% solved" value="${rate}" max="100"></progress><strong>${rate}%</strong></div>`; }).join("") : '<p class="muted">Complete more rounds to see this breakdown.</p>'}</div></section>`;
  fetch("/dashboard/insights")
    .then(async (response) => {
      const body = await response
        .json()
        .catch(() => ({ error: "Could not load insights." }));
      if (!response.ok)
        throw new Error(body.error || "Could not load insights.");
      return body;
    })
    .then((body) => {
      const s = body.summary || {},
        recent = body.trends?.recent || {},
        previous = body.trends?.previous || {},
        previousRounds = Number(previous.rounds || 0),
        change = Number(body.trends?.solveRateChange || 0),
        changeLabel = previousRounds
          ? `${change > 0 ? "+" : ""}${change} pts vs previous 7 days`
          : "No rounds in the previous 7 days",
        audience = body.audience || {},
        recommendations = body.recommendations || [],
        recommendationMarkup = recommendations.length
          ? `<section class="insight-recommendations" aria-labelledby="insight-next-heading"><div class="insight-section-head"><div><span>RECOMMENDED NEXT STEPS</span><h3 id="insight-next-heading">What to try next</h3></div><small>Based only on your private round history</small></div><div>${recommendations.map((item) => `<article class="${safe(item.tone || "neutral")}"><span aria-hidden="true">${item.tone === "positive" ? "✓" : item.tone === "attention" ? "!" : "→"}</span><div><b>${safe(item.title)}</b><p>${safe(item.detail)}</p><a href="${safe(item.target || "#game")}">${safe(item.action)} <span aria-hidden="true">→</span></a></div></article>`).join("")}</div></section>`
          : "";
      content.innerHTML = `<div class="insight-cards"><article><span>ROUNDS</span><b>${Number(s.rounds || 0)}</b><small>last 30 days</small></article><article><span>SOLVE RATE</span><b>${Number(s.solveRate || 0)}%</b><small>${Number(s.solved || 0)} solved</small></article><article><span>WINNING SPEED</span><b>${time(s.averageResponseMs)}</b><small>average first answer</small></article><article><span>CORRECT VIEWERS</span><b>${Number(s.averageParticipants || 0)}</b><small>average per round</small></article></div><div class="insight-signals"><article><span>LAST 7 DAYS</span><b>${Number(recent.solveRate || 0)}% solved</b><small class="${previousRounds ? (change > 0 ? "up" : change < 0 ? "down" : "") : ""}">${changeLabel}</small></article><article><span>VIEWER RETURN</span><b>${Number(audience.repeatRate || 0)}%</b><small>${Number(audience.repeatSolvers || 0)} of ${Number(audience.uniqueSolvers || 0)} solvers answered correctly again</small></article></div>${recommendationMarkup}<details class="insight-breakdowns"><summary>Performance by category and difficulty</summary><div>${breakdown("Categories", body.categories || [], "category")}${breakdown("Difficulty", body.difficulties || [], "difficulty")}</div></details><div class="history-head"><h3>Recent rounds</h3><span>${Number(s.jackpotsWon || 0)}/${Number(s.jackpots || 0)} jackpots won</span></div><div class="round-list">${body.recent?.length ? body.recent.map((round) => `<article><div class="round-emoji">${safe(round.emojis)}</div><div><b>${safe(round.answer)}</b><span>${safe(round.category)} · ${safe(round.difficulty)}</span></div><div class="round-result ${round.solved ? "solved" : "unsolved"}"><b>${round.solved ? `🏆 ${safe(round.winner)}` : "Not solved"}</b><span>${round.solved ? `${time(round.responseMs)} · ${round.participants} correct` : `${round.participants} correct`}${round.jackpot ? " · 💰 Jackpot" : ""}</span></div><time>${new Date(round.finishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></article>`).join("") : '<p class="muted empty-history">No completed cloud rounds yet. Your first finished round will appear here.</p>'}</div>`;
    })
    .catch((error) => {
      content.innerHTML = `<p class="insight-error">⚠ ${safe(error.message)}</p>`;
    });
})();
