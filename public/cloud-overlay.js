const token = location.pathname.split("/")[2];
const routeBase = location.pathname.startsWith("/g/") ? "/g" : "/o";
const stage = document.querySelector("#stage");
const safe = (value) =>
  String(value).replace(
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

function promptText(round) {
  const correct = round.correctAnswers?.length || 0,
    progress = `Clue ${round.clueCount}/${round.totalClues}`,
    next = round.nextRevealAt
      ? `Next emoji in ${Math.max(1, Math.ceil((round.nextRevealAt - Date.now()) / 1000))}s`
      : "All emojis revealed",
    bonus =
      round.clueMultiplier > 1
        ? `${Math.round((round.clueMultiplier - 1) * 100)}% early bonus`
        : "Full clue";
  return `${correct ? `${correct} correct · ` : ""}${progress} · ${next} · ${bonus}`;
}

function renderBadgeAlert(alert) {
  const root = document.querySelector("#badge-alert");
  if (!root) return;
  const visible = Boolean(
    alert?.visible && Number(alert.hideAt || 0) > Date.now(),
  );
  root.classList.toggle("hidden", !visible);
  if (!visible) return;
  document.querySelector("#badge-user").textContent =
    alert.username || "Viewer";
  document.querySelector("#badge-names").textContent = (alert.badges || [])
    .map((badge) => `${badge.icon} ${badge.name}`)
    .join(" · ");
}

function renderCommunity(challenge) {
  const root = document.querySelector("#community"),
    active = Number(challenge?.doublePointsUntil || 0) > Date.now(),
    configured = Boolean(challenge?.configured ?? challenge?.enabled);
  if (!challenge || (!configured && !active)) {
    root.classList.add("off");
    root.classList.remove("boost");
    return;
  }
  root.classList.remove("off");
  const remaining = Math.max(0, challenge.doublePointsUntil - Date.now()),
    minutes = Math.floor(remaining / 60000),
    seconds = Math.floor((remaining % 60000) / 1000);
  root.classList.toggle("boost", active);
  document.querySelector("#community-label").textContent = active
    ? "⚡ DOUBLE POINTS ACTIVE"
    : "COMMUNITY GOAL";
  document.querySelector("#community-value").textContent = active
    ? `${minutes}:${String(seconds).padStart(2, "0")}`
    : `${challenge.progress} / ${challenge.target}`;
  document.querySelector("#community-fill").style.width =
    `${active ? 100 : Math.min(100, (challenge.progress / challenge.target) * 100)}%`;
}

function render(next) {
  if (shouldReload(next)) return;
  state = next;
  window.applyWidgetTheme?.(next.theme);
  renderBadgeAlert(next.badgeAlert);
  const round = next.round;
  stage.classList.toggle("hidden", !round);
  if (!round) return;
  document.querySelector("#category").textContent =
    `${round.category || ""} · ${round.difficulty || ""}`.toUpperCase();
  document.querySelector("#emojis").textContent = round.emojis || "";
  const done = round.status === "finished",
    correct = round.correctAnswers || [];
  stage.classList.toggle("results", done);
  document.querySelector("#label").textContent = done
    ? "ROUND RESULTS"
    : round.isJackpot
      ? `JACKPOT ROUND · ${next.jackpot.points} POINTS`
      : "EMOJI DECODER";
  document.querySelector("#prompt").textContent = done
    ? round.answer
    : promptText(round);
  renderCommunity(next.challenge);
  const winner = document.querySelector("#winner");
  winner.classList.toggle("show", done);
  winner.textContent = done
    ? round.winner
      ? `🏆 ${round.winner.username} wins · ${correct.length} correct viewers`
      : "Time up"
    : "";
  const highscores = document.querySelector("#highscores");
  highscores.classList.toggle("show", done);
  highscores.innerHTML = done
    ? correct
        .slice(0, 5)
        .map(
          (answer) =>
            `<div class="highscore"><b>#${answer.placement}</b><span>${safe(answer.username)}</span><b>${answer.doublePointsMultiplier === 2 ? "⚡ " : ""}+${answer.points}</b></div>`,
        )
        .join("")
    : "";
  document.querySelector("#board").innerHTML = done
    ? next.scores
        .slice(0, 3)
        .map(
          (score, index) =>
            `<div class="rank">#${index + 1} ${safe(score.username)} <b>${score.points}</b></div>`,
        )
        .join("")
    : correct
        .slice(0, 5)
        .map(
          (answer) =>
            `<div class="rank">#${answer.placement} ${safe(answer.username)} <b>${answer.doublePointsMultiplier === 2 ? "⚡ " : ""}+${answer.points}</b></div>`,
        )
        .join("");
}

new EventSource(`${routeBase}/${token}/events?source=overlay`).onmessage = (
  event,
) => render(JSON.parse(event.data));
setInterval(() => {
  const round = state?.round;
  if (round?.status === "open") {
    document.querySelector("#timer").textContent = (
      Math.max(0, round.endsAt - Date.now()) / 1000
    ).toFixed(1);
    document.querySelector("#prompt").textContent = promptText(round);
  }
  if (state?.challenge) renderCommunity(state.challenge);
  if (state?.badgeAlert) renderBadgeAlert(state.badgeAlert);
}, 100);
