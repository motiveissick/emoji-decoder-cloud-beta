const token = location.pathname.split("/")[2];
const routeBase = location.pathname.startsWith("/g/") ? "/g" : "/o";
const panel = document.querySelector("#scoreboard");
const card = document.querySelector("#rank-card");
const challengeList = document.querySelector("#rank-challenges");
const safe = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
let state, loadedVersion, reloading;

function shouldReload(next) {
  if (reloading) return true;
  if (!next.version) return false;
  if (loadedVersion && loadedVersion !== next.version) {
    reloading = true;
    location.reload();
    return true;
  }
  loadedVersion = next.version;
  return false;
}

function stat(value, label) {
  return `<span><b>${safe(value)}</b>${safe(label)}</span>`;
}

function seasonName(value, fallback = "Current Season") {
  if (typeof value === "string") return value || fallback;
  return value?.name || fallback;
}

function showCard(label, name, position, stats, next) {
  card.classList.remove("challenges-mode");
  if (challengeList) {
    challengeList.hidden = true;
    challengeList.innerHTML = "";
  }
  document.querySelector("#rank-label").textContent = label;
  document.querySelector("#rank-name").textContent = name;
  document.querySelector("#rank-position").textContent = position;
  document.querySelector("#rank-stats").innerHTML = stats;
  document.querySelector("#rank-next").textContent = next;
}

function renderChallenges(next, value) {
  const challenges = Array.isArray(value.challenges) ? value.challenges : [],
    completed = challenges.filter((challenge) => {
      const target = Math.max(1, Number(challenge.target) || 1),
        progress = Math.max(0, Number(challenge.progress) || 0);
      return Boolean(challenge.completed || progress >= target);
    }).length,
    visible = challenges.slice(0, 3),
    season = seasonName(value.season || next.season);
  showCard(
    "SEASON CHALLENGES",
    value.username || "Viewer",
    season,
    stat(`${completed}/${challenges.length}`, "complete") +
      stat(Math.max(0, challenges.length - completed), "remaining") +
      stat(challenges.length, "available"),
    challenges.length
      ? `Daily and weekly challenges refresh automatically${challenges.length > visible.length ? ` · ${challenges.length - visible.length} more available` : ""}.`
      : "No challenges are active right now.",
  );
  card.classList.add("challenges-mode");
  if (!challengeList) return;
  challengeList.hidden = false;
  challengeList.innerHTML =
    visible
      .map((challenge) => {
        const target = Math.max(1, Number(challenge.target) || 1),
          progress = Math.max(0, Number(challenge.progress) || 0),
          complete = Boolean(challenge.completed || progress >= target),
          percent = Math.min(100, Math.round((progress / target) * 100)),
          period = String(challenge.period || "season").toUpperCase();
        return `<article class="challenge-item${complete ? " complete" : ""}">
          <span class="challenge-icon" aria-hidden="true">${safe(challenge.icon || (complete ? "✓" : "🎯"))}</span>
          <div class="challenge-copy">
            <div><b>${safe(challenge.name || "Viewer challenge")}</b><small>${safe(period)}</small></div>
            <p>${safe(challenge.description || "Keep playing to make progress.")}</p>
            <span class="challenge-track" aria-label="${safe(percent)} percent complete"><i style="--challenge-progress:${percent}%"></i></span>
          </div>
          <strong>${complete ? "DONE" : `${safe(Math.min(progress, target))}/${safe(target)}`}</strong>
        </article>`;
      })
      .join("") || '<p class="challenge-empty">New challenges will appear here.</p>';
}

function renderCard(next) {
  if (!card) return false;
  const value = next.rankCard || {},
    visible = Boolean(value.visible && Number(value.hideAt || 0) > Date.now());
  card.classList.toggle("hidden", !visible);
  if (!visible) return false;
  const mode = value.mode || "rank",
    names = (value.badges || [])
      .map((badge) => `${badge.icon} ${badge.name}`)
      .join(" · ");
  if (mode === "commands")
    showCard(
      "VIEWER COMMANDS",
      "Emoji Decoder",
      "HELP",
      stat("!rank", "position") +
        stat("!challenge", "progress") +
        stat("!profile", "statistics"),
      "!scoreboard season · !badges · !jackpot · !commands",
    );
  else if (mode === "jackpot")
    showCard(
      "COMMUNITY EMOJI JACKPOT",
      `${value.jackpot} POINTS`,
      "🏆",
      stat(value.jackpot, "current") +
        stat("+100", "per miss") +
        stat(`${value.chance}%`, "chance"),
      "Any viewer can win · Fastest correct answer takes it",
    );
  else if (mode === "challenges") renderChallenges(next, value);
  else if (mode === "profile")
    showCard(
      "EMOJI DECODER PROFILE",
      value.username,
      value.rank ? `#${value.rank}` : "UNRANKED",
      stat(value.points, "points") +
        stat(value.wins, "wins") +
        stat(`${value.accuracy}%`, "accuracy"),
      `${value.correct} correct · best streak ${value.bestStreak} · ${value.badges.length}/${value.badgeTotal} badges`,
    );
  else if (mode === "badges" || mode === "achievements")
    showCard(
      "YOUR ACHIEVEMENTS",
      value.username,
      `${value.badges.length}/${value.badgeTotal}`,
      stat(value.badges.length, "unlocked") +
        stat(value.badgeTotal - value.badges.length, "remaining") +
        stat(`${value.accuracy}%`, "accuracy"),
      names || "No badges yet — keep solving to unlock your first!",
    );
  else {
    const period =
      value.period === "alltime"
        ? "ALL-TIME"
        : value.period === "season"
          ? seasonName(value.season || next.season).toUpperCase()
          : String(value.period || "weekly").toUpperCase();
    showCard(
      `YOUR ${period} EMOJI DECODER RANK`,
      value.username,
      value.rank ? `#${value.rank}` : "UNRANKED",
      stat(value.points, "points") +
        stat(value.wins, "wins") +
        stat(value.bestStreak, "best streak"),
      value.rank === 1
        ? "You are leading the board!"
        : value.pointsToNext
          ? `${value.pointsToNext} more points to reach the next position`
          : "Score in a round to enter the leaderboard!",
    );
  }
  return true;
}

function render(next) {
  if (shouldReload(next)) return;
  state = next;
  window.applyWidgetTheme?.(next.theme);
  const cardVisible = renderCard(next),
    scoreboard = next.scoreboard || {},
    round = next.round;
  panel.classList.toggle(
    "hidden",
    cardVisible ||
      !scoreboard.visible ||
      Boolean(round && round.status !== "idle"),
  );
  const period = String(scoreboard.period || "weekly").toLowerCase();
  document.querySelector("#title").textContent =
    period === "season"
      ? `${seasonName(next.season)} High Scores`
      : `${period === "alltime" ? "All-time" : period[0].toUpperCase() + period.slice(1)} High Scores`;
  document.querySelector("#caller").textContent = scoreboard.shownBy
    ? `Requested by ${scoreboard.shownBy}`
    : "";
  document.querySelector("#rows").innerHTML =
    (next.scoreboardScores || [])
      .map(
        (row, index) =>
          `<div class="row"><b class="rank">#${index + 1}</b><span class="name">${safe(row.username)}<small class="meta">${row.wins} wins</small></span><b class="points">${row.points}</b></div>`,
      )
      .join("") || '<div class="row">No scores yet</div>';
}

new EventSource(`${routeBase}/${token}/events?source=scoreboard`).onmessage = (
  event,
) => render(JSON.parse(event.data));
setInterval(() => {
  if (
    card &&
    state?.rankCard?.visible &&
    Number(state.rankCard.hideAt || 0) <= Date.now()
  )
    card.classList.add("hidden");
  if (!state?.scoreboard?.visible) return;
  const remaining = Math.max(
    0,
    Math.ceil((Number(state.scoreboard.hideAt || 0) - Date.now()) / 1000),
  );
  document.querySelector("#timer").textContent = remaining;
  if (remaining === 0) panel.classList.add("hidden");
}, 200);
