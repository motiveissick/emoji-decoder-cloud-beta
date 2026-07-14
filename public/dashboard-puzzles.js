(() => {
  let state = null,
    section = null,
    busy = false,
    visibleLimit = 18,
    attempts = 0;
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

  function init() {
    const game = document.querySelector("#game, .game-settings"),
      nav = document.querySelector(".dashboard-nav");
    if (!game || !nav) {
      if (attempts++ < 60) setTimeout(init, 50);
      return;
    }
    if (document.querySelector("#puzzles")) return;
    section = document.createElement("section");
    section.id = "puzzles";
    section.className = "guide dashboard-panel puzzle-library";
    section.innerHTML = `
      <div class="panel-heading-row">
        <div class="panel-title"><span class="pill">PUZZLE LIBRARY</span><h2>Puzzle library</h2></div>
        <span class="private-badge"><span aria-hidden="true">●</span> Private answers</span>
      </div>
      <p class="muted">Choose what can appear next, add accepted answer aliases and hide puzzles that do not fit your stream.</p>
      <div id="puzzle-next-preview" class="puzzle-next-preview"><span aria-hidden="true">🎲</span><div><small>UP NEXT</small><b>Loading puzzle queue…</b></div></div>
      <div class="puzzle-toolbar">
        <label><span>Search puzzles</span><input type="search" id="puzzle-search" placeholder="Answer, emoji or category"></label>
        <label><span>Category</span><select id="puzzle-category"><option value="">All categories</option></select></label>
        <label><span>Show</span><select id="puzzle-state"><option value="eligible">Current game filters</option><option value="all">All puzzles</option><option value="disabled">Disabled only</option><option value="aliases">With aliases</option></select></label>
        <button type="button" class="secondary" id="enable-all-puzzles">Enable all</button>
      </div>
      <div class="puzzle-summary" id="puzzle-summary">Loading the built-in puzzle library…</div>
      <div class="puzzle-catalog" id="puzzle-catalog" aria-live="polite"></div>
      <button type="button" class="secondary puzzle-load-more" id="puzzle-load-more" hidden>Show more puzzles</button>
      <p id="puzzle-status" role="status"></p>`;
    game.after(section);

    const gameLink = nav.querySelector('a[href="#game"]'),
      link = document.createElement("a");
    link.href = "#puzzles";
    link.innerHTML = '<span aria-hidden="true">◇</span>Puzzles';
    gameLink?.after(link);
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

    section
      .querySelector("#puzzle-search")
      .addEventListener("input", resetAndRender);
    section
      .querySelector("#puzzle-category")
      .addEventListener("change", resetAndRender);
    section
      .querySelector("#puzzle-state")
      .addEventListener("change", resetAndRender);
    section
      .querySelector("#enable-all-puzzles")
      .addEventListener("click", () => mutate({ action: "enable-all" }));
    section
      .querySelector("#puzzle-load-more")
      .addEventListener("click", () => {
        visibleLimit += 18;
        renderCatalog();
      });
    section.addEventListener("change", (event) => {
      const toggle = event.target.closest("[data-puzzle-toggle]");
      if (!toggle) return;
      mutate({
        action: "toggle",
        id: toggle.dataset.puzzleToggle,
        enabled: toggle.checked,
      });
    });
    section.addEventListener("click", (event) => {
      const queue = event.target.closest("[data-puzzle-queue]"),
        aliases = event.target.closest("[data-puzzle-aliases]"),
        shuffle = event.target.closest("[data-puzzle-shuffle]");
      if (queue)
        mutate({ action: "queue", id: queue.dataset.puzzleQueue });
      else if (aliases) {
        const id = aliases.dataset.puzzleAliases,
          value = section.querySelector(
            `[data-puzzle-alias-input="${CSS.escape(id)}"]`,
          )?.value;
        mutate({
          action: "aliases",
          id,
          aliases: String(value || "")
            .split(/[,\n]/)
            .map((item) => item.trim())
            .filter(Boolean),
        });
      } else if (shuffle) mutate({ action: "shuffle" });
    });
    window.dashboardPuzzlesRefresh = load;
    load();
  }

  function resetAndRender() {
    visibleLimit = 18;
    renderCatalog();
  }

  async function request(url, options) {
    const response = await fetch(url, options),
      body = await response.json().catch(() => ({ error: "Request failed." }));
    if (!response.ok) throw new Error(body.error || "Request failed.");
    return body;
  }

  async function load() {
    try {
      state = await request("/dashboard/puzzles");
      const categories = [
          ...new Set(state.puzzles.map((puzzle) => puzzle.category)),
        ],
        select = section.querySelector("#puzzle-category");
      select.innerHTML =
        '<option value="">All categories</option>' +
        categories
          .map(
            (category) =>
              `<option value="${safe(category)}">${safe(category)}</option>`,
          )
          .join("");
      render();
    } catch (error) {
      section.querySelector("#puzzle-status").textContent = `⚠ ${error.message}`;
    }
  }

  async function mutate(payload) {
    if (busy) return;
    busy = true;
    section.classList.add("busy");
    const status = section.querySelector("#puzzle-status");
    status.textContent = "Saving puzzle library…";
    try {
      state = await request("/dashboard/puzzle-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      status.textContent =
        payload.action === "queue" || payload.action === "shuffle"
          ? "✓ Next puzzle updated."
          : "✓ Puzzle library saved.";
      render();
      window.dashboardLiveRefresh?.();
      document.dispatchEvent(
        new CustomEvent("emoji:puzzles-updated", { detail: state }),
      );
    } catch (error) {
      status.textContent = `⚠ ${error.message}`;
      render();
    } finally {
      busy = false;
      section.classList.remove("busy");
    }
  }

  function render() {
    if (!state) return;
    const next = state.nextRound,
      preview = section.querySelector("#puzzle-next-preview");
    preview.innerHTML = `<span aria-hidden="true">${safe(next.emojis)}</span><div><small>UP NEXT · ${safe(next.category)} · ${safe(next.difficulty)}</small><b>${safe(next.answer)}</b><p>${next.acceptedAnswers} accepted answer${next.acceptedAnswers === 1 ? "" : "s"}</p></div><button type="button" class="secondary" data-puzzle-shuffle>Shuffle next</button>`;
    section.querySelector("#puzzle-summary").innerHTML =
      `<b>${state.summary.eligible}</b> available with current game filters · <b>${state.summary.enabled}</b> enabled overall · <b>${state.summary.customAliases}</b> custom aliases`;
    renderCatalog();
  }

  function filteredPuzzles() {
    if (!state) return [];
    const search = section
        .querySelector("#puzzle-search")
        .value.trim()
        .toLowerCase(),
      category = section.querySelector("#puzzle-category").value,
      filter = section.querySelector("#puzzle-state").value;
    return state.puzzles.filter((puzzle) => {
      const matchesSearch =
          !search ||
          `${puzzle.answer} ${puzzle.emojis} ${puzzle.category} ${puzzle.difficulty}`
            .toLowerCase()
            .includes(search),
        matchesCategory = !category || puzzle.category === category,
        matchesState =
          filter === "all" ||
          (filter === "eligible" && puzzle.eligible) ||
          (filter === "disabled" && !puzzle.enabled) ||
          (filter === "aliases" && puzzle.aliases.length);
      return matchesSearch && matchesCategory && matchesState;
    });
  }

  function renderCatalog() {
    if (!state) return;
    const matches = filteredPuzzles(),
      visible = matches.slice(0, visibleLimit),
      catalog = section.querySelector("#puzzle-catalog"),
      more = section.querySelector("#puzzle-load-more");
    catalog.innerHTML = visible.length
      ? visible.map(puzzleCard).join("")
      : '<p class="puzzle-empty">No puzzles match these filters.</p>';
    more.hidden = matches.length <= visible.length;
    more.textContent = `Show more puzzles (${matches.length - visible.length} remaining)`;
  }

  function puzzleCard(puzzle) {
    const unavailable = !puzzle.enabled || !puzzle.eligible,
      aliasText = puzzle.aliases.join(", ");
    return `<article class="puzzle-card${puzzle.enabled ? "" : " disabled"}${puzzle.queued ? " queued" : ""}">
      <div class="puzzle-card-main"><span class="puzzle-card-emoji" aria-hidden="true">${safe(puzzle.emojis)}</span><div><b>${safe(puzzle.answer)}</b><small>${safe(puzzle.category)} · ${safe(puzzle.difficulty)}</small></div><label class="puzzle-enable"><span>${puzzle.enabled ? "Enabled" : "Disabled"}</span><input type="checkbox" data-puzzle-toggle="${safe(puzzle.id)}" ${puzzle.enabled ? "checked" : ""}></label></div>
      <div class="puzzle-card-actions"><button type="button" class="secondary" data-puzzle-queue="${safe(puzzle.id)}" ${unavailable || puzzle.queued ? "disabled" : ""}>${puzzle.queued ? "Queued next" : puzzle.eligible ? "Queue next" : "Outside filters"}</button><details><summary>Answer aliases (${puzzle.aliases.length})</summary><label>Comma-separated accepted answers<textarea rows="2" maxlength="320" data-puzzle-alias-input="${safe(puzzle.id)}" placeholder="Add another accepted answer">${safe(aliasText)}</textarea></label><button type="button" class="secondary" data-puzzle-aliases="${safe(puzzle.id)}">Save aliases</button></details></div>
    </article>`;
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0));
  else setTimeout(init, 0);
})();
