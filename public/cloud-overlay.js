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
let state, loadedVersion, reloading, renderedPodium = "";

const resultSteps = ["answer", "winner", "podium", "next"],
  resultBoundaries = [0, 0.22, 0.49, 0.76, 1],
  resultProgressItems = resultSteps.map(
    (_, index) => `#result-progress-${index + 1}`,
  );

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

function resultTiming(next, round, now = Date.now()) {
  const duration = Math.max(4000, Number(next.config?.resultsMs) || 10000),
    finishedAt = Number(round.finishedAt || round.endsAt || now),
    elapsed = Math.max(0, now - finishedAt),
    progress = Math.min(1, elapsed / duration),
    index = progress < 0.22 ? 0 : progress < 0.49 ? 1 : progress < 0.76 ? 2 : 3,
    segmentProgress = Math.min(
      1,
      Math.max(
        0,
        (progress - resultBoundaries[index]) /
          (resultBoundaries[index + 1] - resultBoundaries[index]),
      ),
    );
  return {
    duration,
    finishedAt,
    elapsed,
    progress,
    segmentProgress,
    index,
    name: resultSteps[index],
  };
}

function setText(selector, value) {
  const element = document.querySelector(selector),
    text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

function formatSpeed(milliseconds) {
  const seconds = Math.max(0, Number(milliseconds || 0)) / 1000;
  return seconds >= 10 ? `${seconds.toFixed(1)}s` : `${seconds.toFixed(2)}s`;
}

function nextRoundStatus(next, now) {
  const automatic = next.guest
      ? Boolean(next.guest.automatic)
      : Number(next.config?.autoChance || 0) > 0,
    nextAt = Number(next.auto?.nextRollAt || 0);
  if (!automatic)
    return {
      value: "Ready when you are",
      note: "Start the next round from Live Control",
    };
  if (!nextAt || nextAt <= now)
    return { value: "Starting soon", note: "Automatic rounds are on" };
  const seconds = Math.max(0, Math.ceil((nextAt - now) / 1000)),
    value =
      seconds >= 60
        ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
        : `${seconds}s`;
  return { value, note: "Automatic rounds are on" };
}

function renderPodium(correct) {
  const podium = document.querySelector("#result-podium"),
    top = correct.slice(0, 3),
    content = top.length
      ? top
          .map(
            (answer, index) =>
              `<div class="podium-place place-${index + 1}"><span>#${answer.placement || index + 1}</span><b>${safe(answer.username)}</b><strong>${answer.doublePointsMultiplier === 2 ? "⚡ " : ""}+${Number(answer.points || 0)}</strong></div>`,
          )
          .join("")
      : "<p>No correct answers this round</p>";
  podium.classList.toggle("empty", !top.length);
  if (renderedPodium !== content) {
    renderedPodium = content;
    podium.innerHTML = content;
  }
}

function renderResultSequence(next, round, correct, now = Date.now()) {
  const timing = resultTiming(next, round, now),
    sequence = document.querySelector("#result-sequence"),
    winner = round.winner,
    nextRound = nextRoundStatus(next, now);
  setText(
    "#timer",
    (Math.max(0, timing.duration - timing.elapsed) / 1000).toFixed(1),
  );
  sequence.classList.remove("off");
  if (stage.dataset.resultStage !== timing.name) {
    stage.dataset.resultStage = timing.name;
    resultProgressItems.forEach((selector, index) => {
      const item = document.querySelector(selector);
      item.classList.toggle("active", index === timing.index);
      item.classList.toggle("complete", index < timing.index);
    });
  }
  sequence.style.setProperty(
    "--result-progress",
    `${timing.segmentProgress * 100}%`,
  );
  setText("#result-answer", round.answer || "—");
  setText(
    "#result-winner-name",
    winner ? `🏆 ${winner.username}` : "No winner this round",
  );
  setText("#result-winner-speed", winner ? formatSpeed(winner.responseMs) : "—");
  setText("#result-winner-speed-label", winner ? " solve" : " time expired");
  setText(
    "#result-winner-points",
    winner ? `+${Number(winner.points || 0)}` : correct.length,
  );
  setText(
    "#result-winner-points-label",
    winner ? " points" : ` correct answer${correct.length === 1 ? "" : "s"}`,
  );
  renderPodium(correct);
  setText("#result-next-countdown", nextRound.value);
  setText("#result-next-note", nextRound.note);
}

function resetResultSequence() {
  delete stage.dataset.resultStage;
  const sequence = document.querySelector("#result-sequence");
  sequence.classList.add("off");
  sequence.style.setProperty("--result-progress", "0%");
  setText("#result-answer", "");
  setText("#result-winner-name", "");
  renderedPodium = "";
  document.querySelector("#result-podium").innerHTML = "";
  resultProgressItems.forEach((selector) =>
    document.querySelector(selector).classList.remove("active", "complete"),
  );
}

function render(next) {
  if (shouldReload(next)) return;
  state = next;
  window.applyWidgetTheme?.(next.theme);
  renderBadgeAlert(next.badgeAlert);
  const round = next.round;
  stage.classList.toggle("hidden", !round);
  if (!round) {
    stage.classList.remove("results");
    resetResultSequence();
    return;
  }
  document.querySelector("#category").textContent =
    `${round.category || ""} · ${round.difficulty || ""}`.toUpperCase();
  document.querySelector("#emojis").textContent = round.emojis || "";
  const done = round.status === "finished",
    correct = round.correctAnswers || [];
  stage.classList.toggle("results", done);
  document.querySelector("#label").textContent = done
    ? "ROUND COMPLETE"
    : round.isJackpot
      ? `JACKPOT ROUND · ${next.jackpot.points} POINTS`
      : "EMOJI DECODER";
  document.querySelector("#prompt").textContent = done
    ? ""
    : promptText(round);
  renderCommunity(next.challenge);
  const winner = document.querySelector("#winner");
  winner.classList.remove("show");
  winner.textContent = "";
  const highscores = document.querySelector("#highscores");
  highscores.classList.remove("show");
  highscores.innerHTML = "";
  if (done) renderResultSequence(next, round, correct);
  else resetResultSequence();
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
  if (round?.status === "finished")
    renderResultSequence(
      state,
      round,
      Array.isArray(round.correctAnswers) ? round.correctAnswers : [],
    );
  if (state?.challenge) renderCommunity(state.challenge);
  if (state?.badgeAlert) renderBadgeAlert(state.badgeAlert);
}, 100);
