(() => {
  let current = null,
    busy = false,
    puzzleBusy = false,
    feedbackMessage = "",
    feedbackUntil = 0;
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
  const formatRemaining = (value) => {
    const seconds = Math.max(0, Math.ceil(value / 1000)),
      minutes = Math.floor(seconds / 60);
    return minutes
      ? `${minutes}:${String(seconds % 60).padStart(2, "0")}`
      : `${seconds}s`;
  };

  function init() {
    if (document.querySelector("#live-control")) return;
    const overview = document.querySelector(".dashboard-overview"),
      nav = document.querySelector(".dashboard-nav");
    if (!overview || !nav) {
      setTimeout(init, 50);
      return;
    }
    const section = document.createElement("section");
    section.id = "live-control";
    section.className = "guide dashboard-panel live-control";
    section.innerHTML = `
      <div class="panel-heading-row">
        <div class="panel-title"><span class="pill">LIVE CONTROL</span><h2>Live control</h2></div>
        <div class="live-control-head-status"><span id="live-control-status" class="live-control-status"><i></i> Loading live state…</span><span id="live-next-round" class="live-next-round">Checking schedule…</span></div>
      </div>
      <div class="live-control-grid">
        <article class="live-round-card" id="live-round-card">
          <div class="live-round-empty"><span aria-hidden="true">🎮</span><div><small>CURRENT ROUND</small><h3>No round is active</h3><p>Start whenever your scene and chat are ready.</p></div></div>
        </article>
        <div class="live-control-rail">
          <aside class="live-actions" aria-label="Broadcast actions">
            <div class="live-actions-primary"><button type="button" data-live-action="start" disabled>▶ Start round</button><button type="button" class="gold" data-live-action="jackpot" disabled>✦ Jackpot round</button></div>
            <div class="live-actions-secondary"><button type="button" class="secondary" data-live-action="end" disabled>End with results</button><button type="button" class="secondary" data-live-action="skip" disabled>Skip round</button></div>
            <div class="live-scoreboard-actions"><label>Scoreboard period<select id="live-scoreboard-period"><option value="season">Current season</option><option value="weekly">Weekly</option><option value="daily">Today</option><option value="alltime">All-time</option></select></label><button type="button" class="secondary" data-live-action="show-scoreboard" disabled>Show scoreboard</button><button type="button" class="secondary" data-live-action="hide-scoreboard" disabled>Hide</button></div>
            <button type="button" class="automatic-control secondary" data-live-action="set-automatic" disabled>Automatic rounds</button>
            <p id="live-action-message" role="status"></p>
          </aside>
          <aside class="live-activity" aria-label="Live viewer activity">
            <section class="live-next-puzzle"><div class="live-activity-heading"><h3>Up next</h3><a href="#puzzles" id="manage-live-puzzles">Manage puzzles</a></div><div id="live-next-puzzle-card" class="live-next-puzzle-card"><span aria-hidden="true">🎲</span><div><b>Loading next puzzle…</b><small>Private preview</small></div><button type="button" class="secondary" id="shuffle-next-round">Shuffle</button></div></section>
            <section><div class="live-activity-heading"><h3>Recent correct</h3><span id="live-correct-total">0 this round</span></div><ol id="live-correct-feed" class="live-correct-feed"><li class="empty">Correct viewers will appear here.</li></ol></section>
            <section><div class="live-activity-heading"><h3>Season leaders</h3><span id="live-leader-period">Top 3</span></div><ol id="live-leader-feed" class="live-leader-feed"><li class="empty">Scores will appear after viewers play.</li></ol></section>
          </aside>
        </div>
      </div>`;
    overview.after(section);
    const link = nav.querySelector('a[href="#live-control"]');
    link?.addEventListener("click", () => {
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
          link?.setAttribute("aria-current", "page");
        },
        { rootMargin: "-18% 0px -68% 0px", threshold: [0, 0.1, 0.35] },
      );
      observer.observe(section);
    }
    section
      .querySelectorAll("[data-live-action]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          perform(button.dataset.liveAction),
        ),
      );
    section
      .querySelector("#shuffle-next-round")
      ?.addEventListener("click", shuffleNext);
    section
      .querySelector("#manage-live-puzzles")
      ?.addEventListener("click", () => window.dashboardSetMode?.("settings"));
    window.dashboardLiveRefresh = load;
    renderButtons();
    load();
    setInterval(load, 5000);
    setInterval(tick, 250);
  }

  async function request(url, options) {
    const response = await fetch(url, options),
      body = await response.json().catch(() => ({
        error: "The dashboard could not read the server response.",
      }));
    if (!response.ok) throw new Error(body.error || "The live action failed.");
    return body;
  }

  async function load() {
    if (busy) return;
    try {
      current = await request("/dashboard/live-state");
      render();
      document.dispatchEvent(
        new CustomEvent("emoji:live-state", { detail: current }),
      );
    } catch (error) {
      const status = document.querySelector("#live-control-status");
      if (status) {
        status.classList.add("error");
        status.innerHTML = `<i></i> ${safe(error.message)}`;
      }
    }
  }

  async function perform(action) {
    if (busy || !current) return;
    busy = true;
    renderButtons();
    const message = document.querySelector("#live-action-message");
    feedbackMessage = "Updating live show…";
    feedbackUntil = Date.now() + 15000;
    if (message) message.textContent = feedbackMessage;
    try {
      const payload = { action };
      if (action === "show-scoreboard")
        payload.period = document.querySelector(
          "#live-scoreboard-period",
        ).value;
      if (action === "set-automatic")
        payload.enabled = !current?.schedule?.automatic;
      const body = await request("/dashboard/live-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      current = body.state;
      feedbackMessage = "✓ Live controls updated.";
      feedbackUntil = Date.now() + 2600;
      render();
      document.dispatchEvent(
        new CustomEvent("emoji:live-state", { detail: current }),
      );
    } catch (error) {
      feedbackMessage = `⚠ ${error.message}`;
      feedbackUntil = Date.now() + 6000;
      if (message) message.textContent = feedbackMessage;
    } finally {
      busy = false;
      renderButtons();
    }
  }

  async function shuffleNext() {
    if (puzzleBusy) return;
    puzzleBusy = true;
    feedbackMessage = "Choosing another puzzle…";
    feedbackUntil = Date.now() + 15000;
    renderButtons();
    renderActionMessage();
    try {
      await request("/dashboard/puzzle-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "shuffle" }),
      });
      feedbackMessage = "✓ Next puzzle changed.";
      feedbackUntil = Date.now() + 2600;
      await load();
    } catch (error) {
      feedbackMessage = `⚠ ${error.message}`;
      feedbackUntil = Date.now() + 6000;
      renderActionMessage();
    } finally {
      puzzleBusy = false;
      renderButtons();
    }
  }

  function render() {
    if (!current) return;
    const round = current.round,
      card = document.querySelector("#live-round-card"),
      status = document.querySelector("#live-control-status");
    renderReadiness();
    renderSchedule();
    status.classList.toggle("error", !current.readiness?.ready);
    status.innerHTML = current.readiness?.ready
      ? "<i></i> Stream systems connected"
      : "<i></i> Setup needs attention";
    if (round) {
      const result = round.status === "finished",
        remaining = formatRemaining(round.endsAt - Date.now());
      card.classList.toggle("active", !result);
      card.classList.toggle("finished", result);
      card.innerHTML = `<div class="live-round-head"><div><small>${safe(round.category)} · ${safe(round.difficulty)}</small><h3>${result ? "Round results" : round.isJackpot ? "Jackpot round" : "Round in progress"}</h3></div><b id="live-round-timer" role="timer" aria-live="off">${result ? "DONE" : remaining}</b></div><div class="live-round-emojis">${safe(round.emojis || "…")}</div><div class="live-round-answer"><span>Answer</span><strong>${safe(round.answer || "Not available")}</strong><small>Dashboard only</small></div><div class="live-round-metrics"><div><small>Correct</small><b>${round.correctCount}</b></div><div><small>Wrong tries</small><b>${round.wrongGuessCount || 0}</b></div><div><small>Clue</small><b>${round.totalClues ? `${round.clueCount}/${round.totalClues}` : "—"}</b></div></div><div class="live-round-meta"><span>${round.correctCount} correct viewer${round.correctCount === 1 ? "" : "s"}</span><span>${round.winner ? `Winner: ${safe(round.winner)}` : result ? "No winner yet" : "Accepting Kick chat answers"}</span></div>`;
    } else {
      card.className = "live-round-card";
      card.innerHTML =
        '<div class="live-round-empty"><span aria-hidden="true">🎮</span><div><small>CURRENT ROUND</small><h3>No round is active</h3><p>Start whenever your scene and chat are ready.</p></div></div>';
    }
    const auto = document.querySelector('[data-live-action="set-automatic"]'),
      scoreboard = current.scoreboard;
    auto.textContent = current.schedule.automatic
      ? "⏸ Pause automatic rounds"
      : "▶ Resume automatic rounds";
    auto.classList.toggle("active", current.schedule.automatic);
    renderActivity();
    renderActionMessage(scoreboard);
    renderButtons();
  }

  function renderSchedule() {
    const node = document.querySelector("#live-next-round");
    if (!node || !current) return;
    const round = current.round;
    if (round?.status === "open") {
      node.textContent = round.nextRevealAt
        ? `Next clue in ${formatRemaining(round.nextRevealAt - Date.now())}`
        : "All clues are visible";
      return;
    }
    node.textContent = current.schedule.automatic
      ? `Up next in ${formatRemaining(current.schedule.nextRoundAt - Date.now())}`
      : "Automatic rounds paused";
  }

  function renderActionMessage(scoreboard = current?.scoreboard) {
    const node = document.querySelector("#live-action-message");
    if (!node || !current) return;
    if (Date.now() < feedbackUntil) {
      node.textContent = feedbackMessage;
      return;
    }
    node.textContent = scoreboard?.visible
      ? `${scoreboard.period} scoreboard is on screen for ${formatRemaining(scoreboard.hideAt - Date.now())}.`
      : "Broadcast controls are ready.";
  }

  function renderActivity() {
    const correct = document.querySelector("#live-correct-feed"),
      leaders = document.querySelector("#live-leader-feed"),
      leaderPeriod = document.querySelector("#live-leader-period"),
      total = document.querySelector("#live-correct-total"),
      nextCard = document.querySelector("#live-next-puzzle-card"),
      answers = current?.round?.recentCorrectAnswers || [],
      entries = current?.leaderboard?.entries || [],
      next = current?.nextRound;
    if (leaderPeriod)
      leaderPeriod.textContent = current?.season?.name || "Current season";
    if (nextCard && next)
      nextCard.innerHTML = `<span aria-hidden="true">${safe(next.emojis)}</span><div><b>${safe(next.answer)}</b><small>${safe(next.category)} · ${safe(next.difficulty)} · ${next.acceptedAnswers} accepted</small></div><button type="button" class="secondary" id="shuffle-next-round" ${puzzleBusy ? "disabled" : ""}>Shuffle</button>`;
    nextCard
      ?.querySelector("#shuffle-next-round")
      ?.addEventListener("click", shuffleNext);
    if (total)
      total.textContent = `${current?.round?.correctCount || 0} this round`;
    if (correct)
      correct.innerHTML = answers.length
        ? answers
            .map(
              (answer) =>
                `<li><span class="live-place">#${answer.placement || "–"}</span><b>${safe(answer.username)}</b><span>${(Number(answer.responseMs || 0) / 1000).toFixed(1)}s</span><strong>+${Number(answer.points || 0).toLocaleString()}</strong></li>`,
            )
            .join("")
        : '<li class="empty">Correct viewers will appear here.</li>';
    if (leaders)
      leaders.innerHTML = entries.length
        ? entries
            .map(
              (entry) =>
                `<li><span class="live-place">#${entry.rank}</span><b>${safe(entry.username)}</b><strong>${Number(entry.points || 0).toLocaleString()} pts</strong></li>`,
            )
            .join("")
        : '<li class="empty">Scores will appear after viewers play.</li>';
  }

  function renderReadiness() {
    const health = document.querySelector(".dashboard-health");
    if (!health || !current.readiness) return;
    const heading = health.querySelector(".dashboard-card-heading h2"),
      label = health.querySelector(".dashboard-card-heading small"),
      dot = health.querySelector(".live-dot");
    if (label) label.textContent = "STREAM READINESS";
    if (heading)
      heading.textContent = current.readiness.ready
        ? "Ready for your next show"
        : "Finish your stream setup";
    dot?.classList.toggle("warning", !current.readiness.ready);
    let list = health.querySelector(".readiness-list");
    if (!list) {
      list = document.createElement("div");
      list.className = "readiness-list";
      health.querySelector(".connection-row")?.after(list);
    }
    list.innerHTML = current.readiness.checks
      .map(
        (check) =>
          `<div class="readiness-check ${safe(check.state)}"><span aria-hidden="true">${check.state === "ready" ? "✓" : check.state === "warning" ? "!" : "○"}</span><div><b>${safe(check.label)}</b><small>${safe(check.detail)}</small></div></div>`,
      )
      .join("");
    const connection = health.querySelector(".status");
    if (connection) {
      connection.textContent = current.kick.connected
        ? "✓ Kick connected"
        : "○ Kick connection required";
      connection.classList.toggle("warning", !current.kick.connected);
    }
  }

  function renderButtons() {
    if (!document.querySelector("#live-control")) return;
    if (!current) {
      document
        .querySelectorAll("[data-live-action]")
        .forEach((button) => (button.disabled = true));
      return;
    }
    const actions = current?.actions || {};
    document
      .querySelectorAll("[data-live-action]")
      .forEach((button) => (button.disabled = busy));
    const set = (action, enabled) => {
      const button = document.querySelector(`[data-live-action="${action}"]`);
      if (button) button.disabled = busy || !enabled;
    };
    set("start", actions.canStart !== false);
    set("jackpot", actions.canStart !== false);
    set("end", Boolean(actions.canEnd));
    set("skip", Boolean(actions.canSkip));
    set("show-scoreboard", actions.canShowScoreboard !== false);
    set("hide-scoreboard", Boolean(current?.scoreboard?.visible));
    const shuffle = document.querySelector("#shuffle-next-round");
    if (shuffle) shuffle.disabled = puzzleBusy;
  }

  function tick() {
    if (!current) return;
    const timer = document.querySelector("#live-round-timer");
    if (timer && current.round?.status === "open")
      timer.textContent = formatRemaining(current.round.endsAt - Date.now());
    renderSchedule();
    renderActionMessage();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0));
  else setTimeout(init, 0);
})();
