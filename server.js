const express = require("express"),
  crypto = require("node:crypto"),
  path = require("node:path"),
  fs = require("node:fs");
const { Pool } = require("pg");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { renderDashboard } = require("./dashboard-view");
const app = express(),
  PORT = Number(process.env.PORT || 3000),
  BASE = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(
    /\/$/,
    "",
  ),
  VERSION = String(
    process.env.RENDER_GIT_COMMIT || process.env.APP_VERSION || "development",
  ).slice(0, 7),
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : undefined,
  });
const puzzles = require("./puzzles.json"),
  rounds = new Map(),
  roundStarts = new Set(),
  streams = new Map(),
  oauth = new Map(),
  commandTimes = new Map(),
  lastWebhookWrites = new Map(),
  subscriptionChecks = new Map(),
  guestRounds = new Map(),
  guestStreams = new Map(),
  messageQueues = new Map(),
  guestMessageQueues = new Map(),
  pushQueues = new Map(),
  guestPushQueues = new Map(),
  tenantSettingsQueues = new Map(),
  rankCards = new Map(),
  badgeAlerts = new Map(),
  scoreboardStates = new Map(),
  sourceConnections = new Map();
const KICK_KEY = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8\n6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2\nMZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ\nL/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY\n6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF\nBEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e\ntwIDAQAB\n-----END PUBLIC KEY-----`;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex"),
  token = (n = 32) => crypto.randomBytes(n).toString("base64url"),
  norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\b(the|a|an)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
const roundDurationMs = (round) =>
  Math.max(30, Math.min(90, Number(round.gameConfig?.roundSeconds) || 60)) *
  1000;
function encrypt(value) {
  if (!process.env.TOKEN_ENCRYPTION_KEY)
    throw new Error("TOKEN_ENCRYPTION_KEY is required");
  const key = crypto
      .createHash("sha256")
      .update(process.env.TOKEN_ENCRYPTION_KEY)
      .digest(),
    iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key, iv),
    data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
function decrypt(value) {
  if (!value || !process.env.TOKEN_ENCRYPTION_KEY) return null;
  const key = crypto
      .createHash("sha256")
      .update(process.env.TOKEN_ENCRYPTION_KEY)
      .digest(),
    raw = Buffer.from(value, "base64"),
    iv = raw.subarray(0, 12),
    tag = raw.subarray(12, 28),
    data = raw.subarray(28),
    decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim().split("=").map(decodeURIComponent))
      .filter((x) => x.length === 2),
  );
}
function sessionCookie(value, maxAge = 2592000) {
  return `emoji_session=${value}; HttpOnly; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
function kickAuthorize(flow, tenant = null) {
  const verifier = token(48),
    challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url"),
    s = token(24);
  oauth.set(s, { flow, tenant, verifier, expires: Date.now() + 600000 });
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.KICK_CLIENT_ID,
    redirect_uri: `${BASE}/auth/kick/callback`,
    scope: "user:read events:subscribe",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: s,
  });
  return `https://id.kick.com/oauth/authorize?${q}`;
}
async function tenantBySession(req) {
  const t = cookies(req).emoji_session;
  if (!t) return null;
  return (
    (
      await pool.query("SELECT * FROM tenants WHERE session_token_hash=$1", [
        hash(t),
      ])
    ).rows[0] || null
  );
}
async function tenantByOverlay(value) {
  return (
    (await pool.query("SELECT * FROM tenants WHERE overlay_token=$1", [value]))
      .rows[0] || null
  );
}
async function tenantById(value) {
  return (
    (await pool.query("SELECT * FROM tenants WHERE id=$1", [value])).rows[0] ||
    null
  );
}
async function queuedTenantSettings(tenant, mutation) {
  const previous = tenantSettingsQueues.get(tenant.id) || Promise.resolve(),
    current = previous
      .catch(() => {})
      .then(async () => {
        const fresh = await tenantById(tenant.id);
        if (!fresh) throw new Error("Account not found.");
        return mutation(fresh);
      });
  tenantSettingsQueues.set(tenant.id, current);
  try {
    return await current;
  } finally {
    if (tenantSettingsQueues.get(tenant.id) === current)
      tenantSettingsQueues.delete(tenant.id);
  }
}
const defaultTheme = {
  preset: "kick",
  primary: "#53fc18",
  secondary: "#00c96b",
  background: "#07120b",
  text: "#ffffff",
  position: "center",
  scale: 100,
  opacity: 94,
  radius: 24,
  glow: 35,
  font: "system",
  customCss: "",
};
const themePresets = {
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
};
function color(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
}
function validateCustomCss(css) {
  css = String(css || "").trim();
  if (css.length > 4000) return "Custom CSS must be 4,000 characters or fewer.";
  if (
    /@import|@charset|@namespace|url\s*\(|expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding/i.test(
      css,
    )
  )
    return "Imports, URLs and executable CSS are not allowed.";
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@/i.test(stripped)) return "CSS at-rules are not allowed.";
  for (const match of stripped.matchAll(/([^{}]+)\{/g)) {
    const selectors = match[1].split(",").map((x) => x.trim());
    if (
      selectors.some(
        (x) => !/^#(?:stage|scoreboard)(?:\b|[\s>+~.#:[\]])/.test(x),
      )
    )
      return "Every selector must begin with #stage or #scoreboard.";
  }
  if (
    (stripped.match(/{/g) || []).length !== (stripped.match(/}/g) || []).length
  )
    return "CSS braces are not balanced.";
  return null;
}
function normalizeTheme(input = {}) {
  const preset = themePresets[input.preset] ? input.preset : "kick",
    base = themePresets[preset],
    customCss = String(input.customCss || "").slice(0, 4000);
  return {
    preset,
    primary: color(input.primary, base.primary),
    secondary: color(input.secondary, base.secondary),
    background: color(input.background, base.background),
    text: color(input.text, base.text),
    position: [
      "top-left",
      "top-right",
      "center",
      "bottom-left",
      "bottom-right",
    ].includes(input.position)
      ? input.position
      : "center",
    scale: Math.max(60, Math.min(140, Number(input.scale) || 100)),
    opacity: Math.max(40, Math.min(100, Number(input.opacity) || 94)),
    radius: Math.max(0, Math.min(48, Number(input.radius) || 24)),
    glow: Math.max(0, Math.min(80, Number(input.glow) || 35)),
    font: ["system", "rounded", "condensed", "mono"].includes(input.font)
      ? input.font
      : "system",
    customCss,
  };
}
function tenantTheme(tenant) {
  return normalizeTheme(tenant.settings?.theme || defaultTheme);
}
const BADGES = {
  quick_draw: {
    icon: "⚡",
    name: "Quick Draw",
    description: "Answer correctly within 3 seconds",
  },
  hot_streak: {
    icon: "🔥",
    name: "Hot Streak",
    description: "Reach a 5-answer streak",
  },
  perfect: {
    icon: "🎯",
    name: "Perfect",
    description: "Answer correctly without a wrong guess",
  },
  first_place: {
    icon: "🥇",
    name: "First Place",
    description: "Finish first in a round",
  },
  jackpot_winner: {
    icon: "💰",
    name: "Jackpot Winner",
    description: "Win a jackpot round",
  },
  expert_solver: {
    icon: "🧠",
    name: "Expert Solver",
    description: "Solve an expert puzzle",
  },
  regular: {
    icon: "🌙",
    name: "Regular",
    description: "Score on 7 different days",
  },
  century_club: {
    icon: "💯",
    name: "Century Club",
    description: "Reach 100 correct answers",
  },
};
async function backfillBadges() {
  await pool.query(
    `INSERT INTO user_badges(tenant_id,user_key,badge_key,username) SELECT tenant_id,user_key,'first_place',username FROM scores WHERE wins>0 ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO user_badges(tenant_id,user_key,badge_key,username) SELECT tenant_id,user_key,'century_club',username FROM scores WHERE correct>=100 ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO user_badges(tenant_id,user_key,badge_key,username) SELECT tenant_id,user_key,'regular',(ARRAY_AGG(username ORDER BY won_at DESC))[1] FROM score_events GROUP BY tenant_id,user_key HAVING COUNT(DISTINCT won_at::date)>=7 ON CONFLICT DO NOTHING`,
  );
}
function normalizePeriod(value) {
  const period = String(value || "weekly")
    .toLowerCase()
    .replace(/[-_]/g, "");
  if (period === "daily" || period === "today") return "daily";
  if (["alltime", "all", "lifetime"].includes(period)) return "alltime";
  return "weekly";
}
async function badgesFor(tenantId, userKey, username, db = pool) {
  const result = await db.query(
    'SELECT badge_key AS key,unlocked_at AS "unlockedAt" FROM user_badges WHERE tenant_id=$1 AND (user_key=$2 OR LOWER(username)=LOWER($3)) ORDER BY unlocked_at DESC',
    [tenantId, userKey, username],
  );
  return result.rows
    .map((row) => ({ ...row, ...BADGES[row.key] }))
    .filter((badge) => badge.name);
}
async function unlockBadges(db, tenantId, userKey, username, keys) {
  const unlocked = [];
  for (const key of new Set(keys)) {
    if (!BADGES[key]) continue;
    const result = await db.query(
      "INSERT INTO user_badges(tenant_id,user_key,badge_key,username) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING badge_key",
      [tenantId, userKey, key, username],
    );
    if (result.rowCount) unlocked.push({ key, ...BADGES[key] });
  }
  return unlocked;
}
async function rankingForViewer(
  tenantId,
  userKey,
  username,
  period = "weekly",
) {
  period = normalizePeriod(period);
  const source =
    period === "alltime"
      ? `SELECT user_key,username,points,wins,best_streak AS "bestStreak",correct,wrong FROM scores WHERE tenant_id=$1`
      : `SELECT user_key,(ARRAY_AGG(username ORDER BY won_at DESC))[1] username,SUM(points)::int points,COUNT(*) FILTER(WHERE placement=1)::int wins,MAX(streak)::int AS "bestStreak",COUNT(*)::int correct,0::int wrong FROM score_events WHERE tenant_id=$1 AND won_at>=${period === "daily" ? "date_trunc('day',NOW())" : "date_trunc('week',NOW())"} GROUP BY user_key`;
  const result = await pool.query(
      `WITH totals AS (${source}),ranked AS (SELECT *,ROW_NUMBER() OVER(ORDER BY points DESC,wins DESC,user_key)::int rank,COUNT(*) OVER()::int AS "totalPlayers",LAG(points) OVER(ORDER BY points DESC,wins DESC,user_key)::int AS "previousPoints" FROM totals) SELECT * FROM ranked WHERE user_key=$2 OR LOWER(username)=LOWER($3) ORDER BY (user_key=$2) DESC LIMIT 1`,
      [tenantId, userKey, username],
    ),
    row = result.rows[0] || null;
  if (!row) {
    const count = await pool.query(
      `SELECT COUNT(*)::int count FROM (${source}) totals`,
      [tenantId],
    );
    return {
      period,
      username,
      rank: null,
      totalPlayers: Number(count.rows[0]?.count || 0),
      points: 0,
      wins: 0,
      bestStreak: 0,
      correct: 0,
      wrong: 0,
      pointsToNext: null,
    };
  }
  return {
    ...row,
    period,
    rank: Number(row.rank),
    totalPlayers: Number(row.totalPlayers),
    points: Number(row.points || 0),
    wins: Number(row.wins || 0),
    bestStreak: Number(row.bestStreak || 0),
    correct: Number(row.correct || 0),
    wrong: Number(row.wrong || 0),
    pointsToNext:
      row.previousPoints === null
        ? null
        : Math.max(1, Number(row.previousPoints) - Number(row.points) + 1),
  };
}
function showRankCard(tenant, card, duration = 10000) {
  const id = crypto.randomUUID(),
    value = { ...card, id, visible: true, hideAt: Date.now() + duration };
  rankCards.set(tenant.id, value);
  setTimeout(() => {
    if (rankCards.get(tenant.id)?.id !== id) return;
    rankCards.delete(tenant.id);
    push(tenant).catch(console.error);
  }, duration + 25);
  return push(tenant);
}
function showBadgeAlert(tenant, username, badges) {
  if (!badges.length) return;
  const id = crypto.randomUUID(),
    value = { id, visible: true, username, badges, hideAt: Date.now() + 8000 };
  badgeAlerts.set(tenant.id, value);
  setTimeout(() => {
    if (badgeAlerts.get(tenant.id)?.id !== id) return;
    badgeAlerts.delete(tenant.id);
    push(tenant).catch(console.error);
  }, 8025);
}
async function showScoreboard(
  tenant,
  { period = "weekly", shownBy = "Streamer", duration = 12000 } = {},
) {
  const id = crypto.randomUUID(),
    value = {
      id,
      visible: true,
      shownBy: String(shownBy).slice(0, 30),
      period: normalizePeriod(period),
      hideAt: Date.now() + duration,
    };
  scoreboardStates.set(tenant.id, value);
  rankCards.delete(tenant.id);
  await push(tenant);
  setTimeout(() => {
    if (scoreboardStates.get(tenant.id)?.id !== id) return;
    scoreboardStates.delete(tenant.id);
    push(tenant).catch(console.error);
  }, duration + 25);
  return value;
}
async function hideScoreboard(tenant) {
  scoreboardStates.delete(tenant.id);
  await push(tenant);
}
async function handleViewerCommand(tenant, user, userKey, parts) {
  const command = parts[0],
    known = new Set([
      "!commands",
      "!rank",
      "!profile",
      "!badges",
      "!achievements",
      "!jackpot",
      "!scoreboard",
    ]);
  if (!known.has(command)) return false;
  const cooldownKey =
      command === "!scoreboard"
        ? `${tenant.id}:scoreboard`
        : `${tenant.id}:${userKey}:${command}`,
    now = Date.now(),
    readyAt = commandTimes.get(cooldownKey) || 0;
  if (now < readyAt) return true;
  commandTimes.set(cooldownKey, now + 15000);
  if (commandTimes.size > 5000)
    for (const [key, at] of commandTimes)
      if (at < now - 60000) commandTimes.delete(key);
  if (command === "!commands") {
    await showRankCard(tenant, { mode: "commands", username: user }, 15000);
    return true;
  }
  if (command === "!scoreboard") {
    await showScoreboard(tenant, { period: parts[1], shownBy: user });
    return true;
  }
  if (command === "!jackpot") {
    const config = gameSettings(tenant.settings);
    await showRankCard(
      tenant,
      {
        mode: "jackpot",
        username: user,
        jackpot: Number(tenant.jackpot || 250),
        chance: config.jackpotChance,
      },
      8000,
    );
    return true;
  }
  const period = command === "!rank" ? normalizePeriod(parts[1]) : "alltime",
    profile = await rankingForViewer(tenant.id, userKey, user, period);
  if (command === "!rank") {
    await showRankCard(tenant, { mode: "rank", ...profile }, 10000);
    return true;
  }
  const badges = await badgesFor(tenant.id, userKey, user),
    total = profile.correct + profile.wrong,
    mode = command === "!profile" ? "profile" : "badges";
  await showRankCard(
    tenant,
    {
      mode,
      username: user,
      ...profile,
      badges,
      badgeTotal: Object.keys(BADGES).length,
      accuracy: total ? Math.round((profile.correct / total) * 100) : 0,
    },
    12000,
  );
  return true;
}
const difficultyOrder = ["easy", "medium", "hard", "expert"];
const gameCategories = [
  "Film",
  "Game",
  "TV",
  "Phrase",
  "Character",
  "Person",
  "Object",
];
const defaultGameSettings = {
  preset: "custom",
  automatic: true,
  frequencyMinutes: 15,
  roundSeconds: 60,
  minDifficulty: "easy",
  maxDifficulty: "expert",
  categories: gameCategories,
  jackpotChance: 20,
  progressiveReveals: true,
  communityEnabled: false,
  communityTarget: 25,
  communityRewardMinutes: 5,
};
const gamePresets = {
  casual: {
    automatic: true,
    frequencyMinutes: 20,
    roundSeconds: 60,
    minDifficulty: "easy",
    maxDifficulty: "medium",
    categories: gameCategories,
    jackpotChance: 15,
    progressiveReveals: true,
    communityEnabled: true,
    communityTarget: 15,
    communityRewardMinutes: 5,
  },
  competitive: {
    automatic: true,
    frequencyMinutes: 15,
    roundSeconds: 60,
    minDifficulty: "easy",
    maxDifficulty: "expert",
    categories: gameCategories,
    jackpotChance: 20,
    progressiveReveals: true,
    communityEnabled: true,
    communityTarget: 25,
    communityRewardMinutes: 5,
  },
  fast: {
    automatic: true,
    frequencyMinutes: 8,
    roundSeconds: 30,
    minDifficulty: "easy",
    maxDifficulty: "hard",
    categories: gameCategories,
    jackpotChance: 15,
    progressiveReveals: true,
    communityEnabled: true,
    communityTarget: 30,
    communityRewardMinutes: 3,
  },
  large: {
    automatic: true,
    frequencyMinutes: 10,
    roundSeconds: 45,
    minDifficulty: "medium",
    maxDifficulty: "expert",
    categories: gameCategories,
    jackpotChance: 25,
    progressiveReveals: true,
    communityEnabled: true,
    communityTarget: 50,
    communityRewardMinutes: 5,
  },
};
function normalizeGameSettings(input = {}) {
  const preset = Object.hasOwn(gamePresets, input.preset)
      ? input.preset
      : "custom",
    base = gamePresets[preset] || defaultGameSettings,
    requestedCategories = Array.isArray(input.categories)
      ? input.categories
      : base.categories,
    categories = gameCategories.filter((category) =>
      requestedCategories.includes(category),
    ),
    minDifficulty = difficultyOrder.includes(input.minDifficulty)
      ? input.minDifficulty
      : base.minDifficulty,
    maxDifficulty = difficultyOrder.includes(input.maxDifficulty)
      ? input.maxDifficulty
      : base.maxDifficulty,
    minIndex = Math.min(
      difficultyOrder.indexOf(minDifficulty),
      difficultyOrder.indexOf(maxDifficulty),
    ),
    maxIndex = Math.max(
      difficultyOrder.indexOf(minDifficulty),
      difficultyOrder.indexOf(maxDifficulty),
    ),
    jackpot = Number(input.jackpotChance);
  return {
    preset,
    automatic:
      input.automatic === undefined ? base.automatic : Boolean(input.automatic),
    frequencyMinutes: Math.max(
      5,
      Math.min(60, Number(input.frequencyMinutes) || base.frequencyMinutes),
    ),
    roundSeconds: Math.max(
      30,
      Math.min(90, Number(input.roundSeconds) || base.roundSeconds),
    ),
    minDifficulty: difficultyOrder[minIndex],
    maxDifficulty: difficultyOrder[maxIndex],
    categories: categories.length ? categories : [...base.categories],
    jackpotChance: Math.max(
      0,
      Math.min(50, Number.isFinite(jackpot) ? jackpot : base.jackpotChance),
    ),
    progressiveReveals:
      input.progressiveReveals === undefined
        ? base.progressiveReveals
        : Boolean(input.progressiveReveals),
    communityEnabled:
      input.communityEnabled === undefined
        ? base.communityEnabled
        : Boolean(input.communityEnabled),
    communityTarget: Math.max(
      5,
      Math.min(250, Number(input.communityTarget) || base.communityTarget),
    ),
    communityRewardMinutes: Math.max(
      1,
      Math.min(
        15,
        Number(input.communityRewardMinutes) || base.communityRewardMinutes,
      ),
    ),
  };
}
function gameSettings(settings = {}) {
  const input = settings.game || defaultGameSettings;
  return normalizeGameSettings(
    input.communityEnabled === undefined
      ? { ...input, preset: "custom", communityEnabled: false }
      : input,
  );
}
function rotationState(settings = {}) {
  const value = settings.rotation || {};
  return {
    recentIds: Array.isArray(value.recentIds) ? value.recentIds.slice(-20) : [],
    recentCategories: Array.isArray(value.recentCategories)
      ? value.recentCategories.slice(-6)
      : [],
    skill: Math.max(0, Math.min(3, Number(value.skill) || 0)),
    rounds: Math.max(0, Number(value.rounds) || 0),
    lastResult: value.lastResult || null,
  };
}
function choosePuzzle(settings = {}) {
  const rotation = rotationState(settings),
    game = gameSettings(settings),
    minimum = difficultyOrder.indexOf(game.minDifficulty),
    maximum = difficultyOrder.indexOf(game.maxDifficulty),
    eligible = puzzles.filter(
      (puzzle) =>
        game.categories.includes(puzzle.category) &&
        difficultyOrder.indexOf(String(puzzle.difficulty).toLowerCase()) >=
          minimum &&
        difficultyOrder.indexOf(String(puzzle.difficulty).toLowerCase()) <=
          maximum,
    ),
    source = eligible.length ? eligible : puzzles,
    unseen = source.filter((puzzle) => !rotation.recentIds.includes(puzzle.id)),
    pool =
      unseen.length >= Math.min(10, source.length)
        ? unseen
        : source.filter(
            (puzzle) => !rotation.recentIds.slice(-8).includes(puzzle.id),
          ),
    lastCategory = rotation.recentCategories.at(-1),
    varied = pool.filter((puzzle) => puzzle.category !== lastCategory),
    candidates = varied.length >= Math.min(5, pool.length) ? varied : pool,
    target =
      difficultyOrder[Math.max(minimum, Math.min(maximum, rotation.skill))] ||
      game.minDifficulty,
    weighted = [];
  for (const puzzle of candidates) {
    const distance = Math.abs(
        difficultyOrder.indexOf(String(puzzle.difficulty).toLowerCase()) -
          difficultyOrder.indexOf(target),
      ),
      weight =
        Math.max(1, 6 - distance * 2) +
        (rotation.recentCategories.includes(puzzle.category) ? 0 : 2);
    for (let i = 0; i < weight; i++) weighted.push(puzzle);
  }
  const puzzle =
      weighted[Math.floor(Math.random() * weighted.length)] ||
      source[Math.floor(Math.random() * source.length)],
    next = {
      ...rotation,
      recentIds: [...rotation.recentIds, puzzle.id].slice(-20),
      recentCategories: [...rotation.recentCategories, puzzle.category].slice(
        -6,
      ),
    };
  return { puzzle, rotation: next };
}
function emojiParts(value) {
  return [
    ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(
      String(value || ""),
    ),
  ]
    .map((item) => item.segment)
    .filter((item) => item.trim());
}
function revealPlan(puzzle, duration) {
  const parts = emojiParts(puzzle.emojis),
    difficulty = String(puzzle.difficulty || "easy").toLowerCase();
  if (parts.length < 2) return { parts, counts: [parts.length], times: [] };
  const initial =
      difficulty === "hard" || difficulty === "expert"
        ? 1
        : Math.max(1, parts.length - 1),
    counts = [
      ...new Set([
        initial,
        ...(initial < parts.length - 1 ? [initial + 1] : []),
        parts.length,
      ]),
    ],
    times = counts
      .slice(1)
      .map((_, index) =>
        Math.round(
          duration * (counts.length === 2 ? 0.48 : (index + 1) / counts.length),
        ),
      );
  return { parts, counts, times };
}
function prepareReveals(round, duration, enabled = true) {
  const parts = emojiParts(round.emojis),
    plan = enabled
      ? revealPlan(round, duration)
      : { parts, counts: [parts.length], times: [] };
  round.revealParts = plan.parts;
  round.revealCounts = plan.counts;
  round.revealStage = 0;
  round.visibleEmojis = plan.parts.slice(0, plan.counts[0]).join(" ");
  round.revealTimes = plan.times;
  round.nextRevealAt = plan.times.length
    ? round.startedAt + plan.times[0]
    : null;
}
function scheduleReveals(round, pushUpdate) {
  round.revealTimes.forEach((delay, index) =>
    setTimeout(() => {
      if (round.status !== "open") return;
      round.revealStage = index + 1;
      round.visibleEmojis = round.revealParts
        .slice(0, round.revealCounts[round.revealStage])
        .join(" ");
      round.nextRevealAt = round.revealTimes[index + 1]
        ? round.startedAt + round.revealTimes[index + 1]
        : null;
      Promise.resolve()
        .then(pushUpdate)
        .catch((error) => console.error("Round reveal update:", error.message));
    }, delay),
  );
}
function clueMultiplier(round) {
  if (round.gameConfig?.progressiveReveals === false) return 1;
  return round.revealStage === 0
    ? 1.2
    : round.revealStage < round.revealCounts.length - 1
      ? 1.1
      : 1;
}
function recordPuzzleResult(rotation, round) {
  const solved = Boolean(round.winner),
    solveMs = round.winner?.responseMs || null,
    participants = round.correctAnswers?.length || 0;
  let skill = rotationState({ rotation }).skill;
  if (!solved) skill = Math.max(0, skill - 1);
  else if ((solveMs && solveMs < 10000) || participants >= 5)
    skill = Math.min(3, skill + 1);
  else if (solveMs && solveMs > 30000) skill = Math.max(0, skill - 1);
  return {
    ...rotationState({ rotation }),
    skill,
    rounds: rotationState({ rotation }).rounds + 1,
    lastResult: {
      solved,
      solveMs,
      participants,
      difficulty: round.difficulty,
      at: Date.now(),
    },
  };
}
async function saveTenantRotation(tenant, rotation, db = pool) {
  const result = await db.query(
    "UPDATE tenants SET settings=jsonb_set(settings,'{rotation}',$2::jsonb,true),updated_at=NOW() WHERE id=$1 RETURNING settings",
    [tenant.id, JSON.stringify(rotation)],
  );
  tenant.settings = result.rows[0]?.settings || {
    ...(tenant.settings || {}),
    rotation,
  };
}
function serializeActiveRound(round) {
  return {
    ...round,
    users: [...(round.users || [])],
    attempts: [...(round.attempts || new Map()).entries()],
  };
}
function hydrateActiveRound(value) {
  const round = { ...value };
  round.users = new Set(Array.isArray(value.users) ? value.users : []);
  round.attempts = new Map(Array.isArray(value.attempts) ? value.attempts : []);
  round.correctAnswers = Array.isArray(value.correctAnswers)
    ? value.correctAnswers
    : [];
  round.pendingAnswers = 0;
  return round;
}
async function persistActiveRound(
  tenant,
  round,
  db = pool,
  allowInsert = false,
) {
  if (!round || round.status !== "open") return false;
  const params = [
      tenant.id,
      round.id,
      JSON.stringify(serializeActiveRound(round)),
      new Date(round.endsAt),
    ],
    result = await db.query(
      allowInsert
        ? "INSERT INTO active_rounds(tenant_id,round_id,state,ends_at,updated_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(tenant_id) DO UPDATE SET round_id=EXCLUDED.round_id,state=EXCLUDED.state,ends_at=EXCLUDED.ends_at,updated_at=NOW()"
        : "UPDATE active_rounds SET state=$3,ends_at=$4,updated_at=NOW() WHERE tenant_id=$1 AND round_id=$2",
      params,
    );
  return allowInsert || Boolean(result.rowCount);
}
async function removeActiveRound(tenantId, db = pool, roundId = null) {
  await db.query(
    roundId
      ? "DELETE FROM active_rounds WHERE tenant_id=$1 AND round_id=$2"
      : "DELETE FROM active_rounds WHERE tenant_id=$1",
    roundId ? [tenantId, roundId] : [tenantId],
  );
}
function applyRevealStage(round, stage) {
  round.revealStage = stage;
  round.visibleEmojis = round.revealParts
    .slice(0, round.revealCounts[stage])
    .join(" ");
  const nextDelay = round.revealTimes[stage];
  round.nextRevealAt = nextDelay ? round.startedAt + nextDelay : null;
}
function scheduleTenantRound(tenant, round) {
  const now = Date.now();
  for (const [index, offset] of round.revealTimes.entries()) {
    const stage = index + 1,
      revealAt = round.startedAt + offset;
    if (revealAt <= now) {
      if (stage > round.revealStage) applyRevealStage(round, stage);
      continue;
    }
    if (stage <= round.revealStage) continue;
    setTimeout(async () => {
      if (rounds.get(tenant.id) !== round || round.status !== "open") return;
      applyRevealStage(round, stage);
      try {
        await persistActiveRound(tenant, round);
        await push(tenant);
      } catch (error) {
        console.error(`Round reveal ${tenant.channel_name}:`, error.message);
      }
    }, revealAt - now);
  }
  const finishIn = Math.max(0, round.endsAt - now);
  setTimeout(() => finishRound(tenant, round).catch(console.error), finishIn);
}
async function restoreActiveRounds() {
  const rows = (
    await pool.query(
      "SELECT tenants.*,active_rounds.state AS active_state FROM active_rounds JOIN tenants ON tenants.id=active_rounds.tenant_id",
    )
  ).rows;
  for (const tenant of rows) {
    try {
      const round = hydrateActiveRound(tenant.active_state || {});
      if (!round.id || round.status !== "open") {
        await removeActiveRound(tenant.id);
        continue;
      }
      rounds.set(tenant.id, round);
      if (round.endsAt <= Date.now()) await finishRound(tenant, round);
      else scheduleTenantRound(tenant, round);
    } catch (error) {
      console.error(`Round recovery ${tenant.channel_name}:`, error.message);
    }
  }
  return rows.length;
}
async function saveGuestRotation(session, rotation) {
  const result = await pool.query(
    "UPDATE guest_sessions SET settings=jsonb_set(settings,'{rotation}',$2::jsonb,true),updated_at=NOW() WHERE id=$1 RETURNING settings",
    [session.id, JSON.stringify(rotation)],
  );
  session.settings = result.rows[0]?.settings || {
    ...(session.settings || {}),
    rotation,
  };
}
async function guestByToken(value) {
  return (
    (
      await pool.query(
        "SELECT * FROM guest_sessions WHERE access_token=$1 AND revoked_at IS NULL AND expires_at>NOW()",
        [value],
      )
    ).rows[0] || null
  );
}
async function guestById(value) {
  return (
    (
      await pool.query(
        "SELECT * FROM guest_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>NOW()",
        [value],
      )
    ).rows[0] || null
  );
}
function guestTheme(session) {
  return normalizeTheme(session.settings?.theme || defaultTheme);
}
function guestScoreList(session) {
  return Object.values(session.scores || {})
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .slice(0, 10);
}
function advanceGuestCommunity(session, config) {
  const current = session.settings?.communityState || {},
    now = Date.now();
  let progress = Number(current.progress || 0),
    completions = Number(current.completions || 0),
    doublePointsUntil = Number(current.doublePointsUntil || 0);
  if (config.communityEnabled) {
    progress++;
    if (progress >= config.communityTarget) {
      progress = 0;
      completions++;
      doublePointsUntil =
        Math.max(doublePointsUntil, now) +
        config.communityRewardMinutes * 60000;
    }
  }
  session.settings = {
    ...(session.settings || {}),
    communityState: { progress, completions, doublePointsUntil },
  };
  return {
    progress,
    completions,
    doublePointsUntil,
    doublePointsActive: doublePointsUntil > now,
  };
}
async function guestState(session) {
  const round = guestRounds.get(session.id) || null,
    game = round && round.status !== "idle" ? round : null,
    scores = guestScoreList(session),
    config = gameSettings(session.settings),
    community = session.settings?.communityState || {},
    doublePointsUntil = Number(community.doublePointsUntil || 0),
    doublePointsActive = doublePointsUntil > Date.now();
  return {
    version: VERSION,
    tenant: { channel: "guest-test", displayName: "Guest Test Mode" },
    guest: {
      active: true,
      expiresAt: new Date(session.expires_at).getTime(),
      automatic: Boolean(session.settings?.automatic),
      testAnswer: game?.answers?.[0] || null,
    },
    theme: guestTheme(session),
    round: game && {
      id: game.id,
      status: game.status,
      category: game.category,
      emojis: game.status === "finished" ? game.emojis : game.visibleEmojis,
      difficulty: game.difficulty,
      startedAt: game.startedAt,
      endsAt: game.endsAt,
      winner: game.winner,
      correctAnswers: game.correctAnswers,
      answer: game.status === "finished" ? game.answers[0] : null,
      isJackpot: game.isJackpot,
      clueStage: game.revealStage + 1,
      clueCount: game.revealCounts[game.revealStage],
      totalClues: game.revealParts.length,
      nextRevealAt: game.nextRevealAt,
      clueMultiplier: clueMultiplier(game),
    },
    scores,
    scoreboard: {
      visible: Boolean(round?.scoreboardUntil > Date.now()),
      shownBy: round?.scoreboardBy || null,
      hideAt: round?.scoreboardUntil || 0,
      period: "guest",
    },
    scoreboardScores: scores,
    rankCard: { visible: false },
    jackpot: { points: 1000, chance: config.jackpotChance / 100 },
    challenge: {
      configured: config.communityEnabled,
      enabled: config.communityEnabled || doublePointsActive,
      name: "Community Goal",
      description: `Earn ${config.communityTarget} correct answers to unlock ${config.communityRewardMinutes} minutes of double points`,
      target: config.communityTarget,
      progress: Number(community.progress || 0),
      completions: Number(community.completions || 0),
      doublePointsActive,
      doublePointsUntil,
    },
    badgeAlert: { visible: false },
    overlayQueue: { length: 0, max: 5, active: false },
    auto: {
      nextRollAt: Number(session.settings?.nextAutoAt || 0),
      missedRolls: 0,
    },
    config: {
      roundMs: game ? game.endsAt - game.startedAt : config.roundSeconds * 1000,
      autoChance: 1,
      maxMissedRolls: 0,
      resultsMs: 8000,
    },
    recentMessages: [],
  };
}
async function queueGuestPacket(id, deliver) {
  const previous = guestPushQueues.get(id) || Promise.resolve(),
    current = previous
      .catch(() => {})
      .then(async () => {
        const fresh = await guestById(id);
        if (!fresh) return false;
        const packet = `data: ${JSON.stringify(await guestState(fresh))}\n\n`;
        await deliver(packet);
        return true;
      });
  guestPushQueues.set(id, current);
  try {
    return await current;
  } finally {
    if (guestPushQueues.get(id) === current) guestPushQueues.delete(id);
  }
}
async function pushGuest(session) {
  return queueGuestPacket(session.id, (packet) => {
    for (const response of guestStreams.get(session.id) || [])
      response.write(packet);
  });
}
async function patchGuestSettings(session, patch) {
  const result = await pool.query(
      "UPDATE guest_sessions SET settings=COALESCE(settings,'{}'::jsonb)||$2::jsonb,updated_at=NOW() WHERE id=$1 RETURNING settings,scores",
      [session.id, JSON.stringify(patch)],
    ),
    row = result.rows[0];
  if (row) {
    session.settings = row.settings;
    session.scores = row.scores || session.scores || {};
  }
}
async function saveGuest(session, settingsPatch) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = (
      await client.query(
        "SELECT settings FROM guest_sessions WHERE id=$1 FOR UPDATE",
        [session.id],
      )
    ).rows[0];
    if (!current) throw new Error("Guest session not found.");
    const target = gameSettings(current.settings).communityTarget,
      patch = settingsPatch.communityState
        ? {
            ...settingsPatch,
            communityState: {
              ...settingsPatch.communityState,
              progress: Math.max(
                0,
                Math.min(
                  Number(settingsPatch.communityState.progress) || 0,
                  target - 1,
                ),
              ),
            },
          }
        : settingsPatch,
      result = await client.query(
        "UPDATE guest_sessions SET settings=COALESCE(settings,'{}'::jsonb)||$2::jsonb,scores=$3,updated_at=NOW() WHERE id=$1 RETURNING settings,scores",
        [
          session.id,
          JSON.stringify(patch),
          JSON.stringify(session.scores || {}),
        ],
      ),
      row = result.rows[0];
    await client.query("COMMIT");
    if (row) {
      session.settings = row.settings;
      session.scores = row.scores || {};
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
async function syncActiveGuestSettings(tenantId, patch) {
  const target = patch.game?.communityTarget ?? null,
    sessions = (
      await pool.query(
        "SELECT id,access_token FROM guest_sessions WHERE tenant_id=$1 AND revoked_at IS NULL AND expires_at>NOW()",
        [tenantId],
      )
    ).rows;
  await Promise.all(
    sessions.map((session) =>
      queuedGuestMutation(session, async (fresh) => {
        const result = await pool.query(
          "UPDATE guest_sessions SET settings=(COALESCE(settings,'{}'::jsonb)||$2::jsonb)||CASE WHEN $3::int IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('communityState',COALESCE(settings->'communityState','{}'::jsonb)||jsonb_build_object('progress',LEAST(COALESCE((settings->'communityState'->>'progress')::int,0),GREATEST(0,$3::int-1)))) END,updated_at=NOW() WHERE id=$1 AND tenant_id=$4 AND revoked_at IS NULL AND expires_at>NOW() RETURNING *",
          [fresh.id, JSON.stringify(patch), target, tenantId],
        );
        if (result.rowCount) await pushGuest(result.rows[0]);
        return { ok: Boolean(result.rowCount) };
      }),
    ),
  );
}
async function finishGuestRound(session, expectedRound = null) {
  const round = guestRounds.get(session.id);
  if (
    !round ||
    round.status !== "open" ||
    (expectedRound && round !== expectedRound)
  )
    return;
  round.status = "finished";
  round.visibleEmojis = round.emojis;
  round.nextRevealAt = null;
  await saveGuestRotation(session, recordPuzzleResult(round.rotation, round));
  await pushGuest(session);
  setTimeout(() => {
    if (guestRounds.get(session.id) === round) {
      guestRounds.delete(session.id);
      pushGuest(session).catch((error) =>
        console.error("Guest round cleanup:", error.message),
      );
    }
  }, 8000);
}
async function startGuestRound(
  session,
  forceJackpot = false,
  requireAutomatic = false,
) {
  session = await guestById(session.id);
  if (
    !session ||
    (requireAutomatic && !session.settings?.automatic) ||
    guestRounds.get(session.id)?.status === "open"
  )
    return false;
  const config = gameSettings(session.settings),
    selection = choosePuzzle(session.settings),
    now = Date.now(),
    round = {
      ...selection.puzzle,
      rotation: selection.rotation,
      gameConfig: config,
      id: crypto.randomUUID(),
      status: "open",
      startedAt: now,
      winner: null,
      correctAnswers: [],
      users: new Set(),
      attempts: new Map(),
      isJackpot: Boolean(forceJackpot),
    },
    duration = roundDurationMs({ gameConfig: config });
  round.endsAt = now + duration;
  prepareReveals(round, duration, config.progressiveReveals);
  guestRounds.set(session.id, round);
  await saveGuestRotation(session, selection.rotation);
  scheduleReveals(round, () => pushGuest(session));
  setTimeout(
    () => finishGuestRound(session, round).catch(console.error),
    duration,
  );
  await pushGuest(session);
  return true;
}
async function guestAnswer(session, username, content) {
  const round = guestRounds.get(session.id);
  if (!round || round.status !== "open" || Date.now() > round.endsAt)
    return { ok: false, error: "Start a round first." };
  const user =
      String(username || "GuestViewer")
        .replace(/[<>]/g, "")
        .slice(0, 30) || "GuestViewer",
    key = norm(user);
  if (round.users.has(key))
    return { ok: false, error: "That viewer already answered correctly." };
  if (!round.answers.some((answer) => norm(answer) === norm(content)))
    return { ok: false, error: "Wrong answer—try another guess." };
  const placement = round.correctAnswers.length + 1,
    responseMs = Date.now() - round.startedAt,
    multiplier =
      placement === 1
        ? 1
        : placement === 2
          ? 0.7
          : placement === 3
            ? 0.5
            : 0.25,
    clueBonus = clueMultiplier(round),
    base =
      { easy: 100, medium: 150, hard: 225, expert: 350 }[round.difficulty] ||
      150,
    community = advanceGuestCommunity(session, gameSettings(session.settings)),
    pointBoost = community.doublePointsActive ? 2 : 1,
    regular = Math.max(
      10,
      Math.round(
        (base + Math.max(0, 75 - Math.floor(responseMs / 200))) *
          multiplier *
          clueBonus *
          pointBoost,
      ),
    ),
    jackpotBonus = round.isJackpot && placement === 1 ? 1000 : 0,
    points = regular + jackpotBonus,
    answer = {
      username: user,
      placement,
      points,
      responseMs,
      multiplier,
      clueMultiplier: clueBonus,
      doublePointsMultiplier: pointBoost,
      jackpotBonus,
    };
  round.users.add(key);
  round.correctAnswers.push(answer);
  if (placement === 1) round.winner = answer;
  const current = session.scores?.[key] || {
    username: user,
    points: 0,
    wins: 0,
    streak: 0,
    bestStreak: 0,
    correct: 0,
    wrong: 0,
  };
  current.username = user;
  current.points += points;
  current.wins += placement === 1 ? 1 : 0;
  current.streak += 1;
  current.bestStreak = Math.max(current.bestStreak, current.streak);
  current.correct += 1;
  session.scores = { ...(session.scores || {}), [key]: current };
  await saveGuest(session, { communityState: session.settings.communityState });
  await pushGuest(session);
  return { ok: true, correct: true, answer };
}
async function queuedGuestMutation(session, mutation) {
  const previous = guestMessageQueues.get(session.id) || Promise.resolve(),
    current = previous
      .catch(() => {})
      .then(async () => {
        const fresh = await guestByToken(session.access_token);
        return fresh
          ? mutation(fresh)
          : { ok: false, error: "This guest session expired or was revoked." };
      });
  guestMessageQueues.set(session.id, current);
  try {
    return await current;
  } finally {
    if (guestMessageQueues.get(session.id) === current)
      guestMessageQueues.delete(session.id);
  }
}
async function queuedGuestAnswer(session, username, content) {
  return queuedGuestMutation(session, (fresh) =>
    guestAnswer(fresh, username, content),
  );
}
async function setGuestAutomatic(session, enabled) {
  const patch = {
    automatic: Boolean(enabled),
    nextAutoAt: enabled ? Date.now() + 2000 : 0,
  };
  session.settings = { ...(session.settings || {}), ...patch };
  await patchGuestSettings(session, patch);
  await pushGuest(session);
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
async function refreshTenantAuth(tenant) {
  const refresh = decrypt(tenant.kick_refresh_token);
  if (!refresh) throw new Error("No Kick refresh token");
  const response = await fetchWithTimeout("https://id.kick.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
        refresh_token: refresh,
      }),
    }),
    tokens = await response.json().catch(() => ({}));
  if (!response.ok || !tokens.access_token)
    throw new Error(`Kick token refresh failed (${response.status})`);
  tenant.kick_access_token = encrypt(tokens.access_token);
  if (tokens.refresh_token)
    tenant.kick_refresh_token = encrypt(tokens.refresh_token);
  tenant.kick_token_expires_at =
    Date.now() + Number(tokens.expires_in || 3600) * 1000;
  await pool.query(
    "UPDATE tenants SET kick_access_token=$2,kick_refresh_token=$3,kick_token_expires_at=$4,updated_at=NOW() WHERE id=$1",
    [
      tenant.id,
      tenant.kick_access_token,
      tenant.kick_refresh_token,
      tenant.kick_token_expires_at,
    ],
  );
  return tokens.access_token;
}
async function ensureSubscription(tenant, accessToken = null) {
  const access = accessToken || decrypt(tenant.kick_access_token);
  if (!access) return false;
  const headers = {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
    },
    current = await fetchWithTimeout(
      "https://api.kick.com/public/v1/events/subscriptions",
      { headers },
    );
  if (current.status === 401 && !accessToken)
    return ensureSubscription(tenant, await refreshTenantAuth(tenant));
  const body = await current.json().catch(() => ({}));
  if (!(current.ok && JSON.stringify(body).includes("chat.message.sent"))) {
    const created = await fetchWithTimeout(
      "https://api.kick.com/public/v1/events/subscriptions",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          method: "webhook",
          events: [{ name: "chat.message.sent", version: 1 }],
        }),
      },
    );
    if (!created.ok && created.status !== 409)
      throw new Error(`Kick subscription repair failed (${created.status})`);
  }
  const checkedAt = Date.now();
  subscriptionChecks.set(tenant.id, checkedAt);
  await pool.query(
    "UPDATE tenants SET kick_subscription_checked_at=$2,updated_at=NOW() WHERE id=$1",
    [tenant.id, checkedAt],
  );
  return true;
}
let kickMaintenance = null;
async function maintainKickConnections() {
  if (kickMaintenance) return kickMaintenance;
  kickMaintenance = (async () => {
    const tenants = (
      await pool.query(
        "SELECT * FROM tenants WHERE kick_refresh_token IS NOT NULL",
      )
    ).rows;
    for (const tenant of tenants) {
      try {
        let access = null;
        if (Number(tenant.kick_token_expires_at || 0) < Date.now() + 600000)
          access = await refreshTenantAuth(tenant);
        if (
          access ||
          Math.max(
            Number(subscriptionChecks.get(tenant.id) || 0),
            Number(tenant.kick_subscription_checked_at || 0),
          ) <
            Date.now() - 1800000
        )
          await ensureSubscription(tenant, access);
      } catch (error) {
        console.error(
          `Kick maintenance ${tenant.channel_name}:`,
          error.message,
        );
      }
    }
    return tenants.length;
  })();
  try {
    return await kickMaintenance;
  } finally {
    kickMaintenance = null;
  }
}
async function scores(id, period = "weekly") {
  const start =
    period === "daily"
      ? "date_trunc('day',NOW())"
      : period === "alltime"
        ? null
        : "date_trunc('week',NOW())";
  if (!start)
    return (
      await pool.query(
        'SELECT username,points,wins,streak,best_streak AS "bestStreak",correct,wrong FROM scores WHERE tenant_id=$1 ORDER BY points DESC,wins DESC LIMIT 10',
        [id],
      )
    ).rows;
  return (
    await pool.query(
      `SELECT (ARRAY_AGG(username ORDER BY won_at DESC))[1] username,SUM(points)::int points,COUNT(*) FILTER(WHERE placement=1)::int wins,0 streak,MAX(streak)::int AS "bestStreak",COUNT(*)::int correct,0 wrong FROM score_events WHERE tenant_id=$1 AND won_at>=${start} GROUP BY user_key ORDER BY points DESC,wins DESC LIMIT 10`,
      [id],
    )
  ).rows;
}
async function advanceCommunityGoal(tenant, config, db = pool) {
  const previousUntil = Number(tenant.double_points_until || 0),
    now = Date.now(),
    rewardDuration = config.communityRewardMinutes * 60000,
    result = config.communityEnabled
      ? await db.query(
          `UPDATE tenants SET community_progress=CASE WHEN community_progress+1 >= $2 THEN 0 ELSE community_progress+1 END,community_completions=community_completions+CASE WHEN community_progress+1 >= $2 THEN 1 ELSE 0 END,double_points_until=CASE WHEN community_progress+1 >= $2 THEN GREATEST(double_points_until,$3)+$4 ELSE double_points_until END WHERE id=$1 RETURNING community_progress AS progress,community_completions AS completions,double_points_until AS "doublePointsUntil",jackpot`,
          [tenant.id, config.communityTarget, now, rewardDuration],
        )
      : await db.query(
          'SELECT community_progress AS progress,community_completions AS completions,double_points_until AS "doublePointsUntil",jackpot FROM tenants WHERE id=$1 FOR UPDATE',
          [tenant.id],
        ),
    row = result.rows[0] || {};
  tenant.community_progress = Number(row.progress || 0);
  tenant.community_completions = Number(row.completions || 0);
  tenant.double_points_until = Number(row.doublePointsUntil || previousUntil);
  tenant.jackpot = Number(row.jackpot ?? tenant.jackpot ?? 250);
  return {
    enabled: config.communityEnabled,
    progress: tenant.community_progress,
    completions: tenant.community_completions,
    completed: config.communityEnabled && tenant.community_progress === 0,
    doublePointsUntil: tenant.double_points_until,
    doublePointsActive: tenant.double_points_until > Date.now(),
  };
}
async function state(tenant) {
  const round = rounds.get(tenant.id) || null,
    game = round && round.status !== "idle" ? round : null,
    config = gameSettings(tenant.settings),
    doublePointsUntil = Number(tenant.double_points_until || 0),
    doublePointsActive = doublePointsUntil > Date.now(),
    rankCard = rankCards.get(tenant.id) || { visible: false },
    badgeAlert = badgeAlerts.get(tenant.id) || { visible: false },
    scoreboard = scoreboardStates.get(tenant.id) || {
      visible: false,
      shownBy: null,
      hideAt: 0,
      period: "weekly",
    };
  const weeklyScores = await scores(tenant.id, "weekly"),
    scoreboardScores =
      (scoreboard.period || "weekly") === "weekly"
        ? weeklyScores
        : scoreboard.visible
          ? await scores(tenant.id, scoreboard.period)
          : [];
  return {
    version: VERSION,
    tenant: { channel: tenant.channel_name, displayName: tenant.display_name },
    theme: tenantTheme(tenant),
    round: game && {
      id: game.id,
      status: game.status,
      category: game.category,
      emojis: game.status === "finished" ? game.emojis : game.visibleEmojis,
      difficulty: game.difficulty,
      startedAt: game.startedAt,
      endsAt: game.endsAt,
      winner: game.winner,
      correctAnswers: game.correctAnswers,
      answer: game.status === "finished" ? game.answers[0] : null,
      isJackpot: game.isJackpot,
      clueStage: game.revealStage + 1,
      clueCount: game.revealCounts[game.revealStage],
      totalClues: game.revealParts.length,
      nextRevealAt: game.nextRevealAt,
      clueMultiplier: clueMultiplier(game),
    },
    scores: weeklyScores,
    scoreboard,
    scoreboardScores,
    rankCard,
    jackpot: { points: tenant.jackpot, chance: config.jackpotChance / 100 },
    challenge: {
      configured: config.communityEnabled,
      enabled: config.communityEnabled || doublePointsActive,
      name: "Community Goal",
      description: `Earn ${config.communityTarget} correct answers to unlock ${config.communityRewardMinutes} minutes of double points`,
      target: config.communityTarget,
      progress: Number(tenant.community_progress || 0),
      completions: Number(tenant.community_completions || 0),
      doublePointsActive,
      doublePointsUntil,
    },
    badgeAlert,
    overlayQueue: {
      length: 0,
      max: 5,
      active: Boolean(rankCard.visible || scoreboard.visible),
    },
    auto: {
      nextRollAt: Number(
        tenant.next_round_at || Date.now() + config.frequencyMinutes * 60000,
      ),
      missedRolls: 0,
    },
    config: {
      roundMs: game ? roundDurationMs(game) : config.roundSeconds * 1000,
      autoChance: config.automatic ? 1 : 0,
      maxMissedRolls: 3,
      resultsMs: 10000,
    },
    recentMessages: [],
  };
}
function dashboardRound(round) {
  if (!round || round.status === "idle") return null;
  return {
    id: round.id,
    status: round.status,
    category: round.category,
    difficulty: round.difficulty,
    emojis: round.status === "finished" ? round.emojis : round.visibleEmojis,
    answer: round.answers?.[0] || null,
    startedAt: round.startedAt,
    endsAt: round.endsAt,
    correctCount: round.correctAnswers?.length || 0,
    winner: round.winner?.username || null,
    isJackpot: Boolean(round.isJackpot),
  };
}
function sourceConnectionState(tenant, kind) {
  const registry = sourceConnections.get(tenant.id),
    connections = registry?.[kind]?.size || 0,
    lastConnectedAt = Number(tenant[`${kind}_last_connected_at`] || 0);
  return { connected: connections > 0, connections, lastConnectedAt };
}
async function dashboardLiveState(tenant) {
  const fresh = (await tenantById(tenant.id)) || tenant,
    config = gameSettings(fresh.settings),
    round = rounds.get(fresh.id) || null,
    scoreboard = scoreboardStates.get(fresh.id) || {
      visible: false,
      period: "weekly",
      hideAt: 0,
      shownBy: null,
    },
    overlay = sourceConnectionState(fresh, "overlay"),
    scoreboardSource = sourceConnectionState(fresh, "scoreboard"),
    subscriptionCheckedAt = Math.max(
      Number(fresh.kick_subscription_checked_at || 0),
      Number(subscriptionChecks.get(fresh.id) || 0),
    ),
    tokenHealthy = Boolean(
      fresh.kick_access_token &&
      Number(fresh.kick_token_expires_at || 0) > Date.now() + 120000,
    ),
    subscriptionHealthy = Boolean(
      fresh.kick_access_token && subscriptionCheckedAt > Date.now() - 2700000,
    ),
    checks = [
      {
        id: "kick",
        state:
          fresh.kick_access_token && tokenHealthy
            ? "ready"
            : fresh.kick_access_token
              ? "warning"
              : "missing",
        label: "Kick account",
        detail: fresh.kick_access_token
          ? tokenHealthy
            ? "Connected and token is healthy"
            : "Connected; token refresh is due"
          : "Connect your Kick account",
      },
      {
        id: "subscription",
        state: subscriptionHealthy
          ? "ready"
          : fresh.kick_access_token
            ? "warning"
            : "missing",
        label: "Chat subscription",
        detail: subscriptionHealthy
          ? "Chat events checked recently"
          : "Waiting for a successful subscription check",
      },
      {
        id: "overlay",
        state: overlay.connected
          ? "ready"
          : overlay.lastConnectedAt
            ? "warning"
            : "missing",
        label: "Game overlay",
        detail: overlay.connected
          ? `${overlay.connections} OBS connection${overlay.connections === 1 ? "" : "s"} active`
          : overlay.lastConnectedAt
            ? "OBS source is currently offline"
            : "Open the game overlay in OBS once",
      },
      {
        id: "scoreboard",
        state: scoreboardSource.connected
          ? "ready"
          : scoreboardSource.lastConnectedAt
            ? "warning"
            : "missing",
        label: "Scoreboard",
        detail: scoreboardSource.connected
          ? `${scoreboardSource.connections} OBS connection${scoreboardSource.connections === 1 ? "" : "s"} active`
          : scoreboardSource.lastConnectedAt
            ? "OBS source is currently offline"
            : "Open the scoreboard in OBS once",
      },
      {
        id: "automatic",
        state: config.automatic ? "ready" : "warning",
        label: "Automatic rounds",
        detail: config.automatic
          ? `Every ${config.frequencyMinutes} minutes`
          : "Paused; manual controls remain available",
      },
    ];
  const ready = checks.slice(0, 4).every((check) => check.state === "ready");
  return {
    version: VERSION,
    now: Date.now(),
    round: dashboardRound(round),
    schedule: {
      automatic: config.automatic,
      frequencyMinutes: config.frequencyMinutes,
      nextRoundAt: Number(
        fresh.next_round_at || Date.now() + config.frequencyMinutes * 60000,
      ),
    },
    scoreboard: {
      visible: Boolean(scoreboard.visible && scoreboard.hideAt > Date.now()),
      period: scoreboard.period || "weekly",
      hideAt: Number(scoreboard.hideAt || 0),
      shownBy: scoreboard.shownBy || null,
    },
    jackpot: Number(fresh.jackpot || 250),
    kick: {
      connected: Boolean(fresh.kick_access_token),
      tokenHealthy,
      subscriptionHealthy,
      lastSubscriptionCheckAt: subscriptionCheckedAt,
      lastWebhookAt: Number(fresh.last_webhook_at || 0),
    },
    sources: { overlay, scoreboard: scoreboardSource },
    readiness: { ready, checks },
    actions: {
      canStart: round?.status !== "open",
      canEnd: round?.status === "open",
      canSkip: round?.status === "open",
      canShowScoreboard: round?.status !== "open",
    },
  };
}
async function queueTenantPacket(id, deliver) {
  const previous = pushQueues.get(id) || Promise.resolve(),
    current = previous
      .catch(() => {})
      .then(async () => {
        const fresh = await tenantById(id);
        if (!fresh) return false;
        const packet = `data: ${JSON.stringify(await state(fresh))}\n\n`;
        await deliver(packet);
        return true;
      });
  pushQueues.set(id, current);
  try {
    return await current;
  } finally {
    if (pushQueues.get(id) === current) pushQueues.delete(id);
  }
}
async function push(tenant) {
  if (!streams.get(tenant.id)?.size) return false;
  return queueTenantPacket(tenant.id, (packet) => {
    for (const response of streams.get(tenant.id) || []) response.write(packet);
  });
}
async function startRound(tenant, { forceJackpot = false } = {}) {
  if (rounds.get(tenant.id)?.status === "open" || roundStarts.has(tenant.id))
    return false;
  const config = gameSettings(tenant.settings),
    selection = choosePuzzle(tenant.settings),
    round = {
      ...selection.puzzle,
      puzzleId: selection.puzzle.id,
      id: crypto.randomUUID(),
      rotation: selection.rotation,
      gameConfig: config,
      status: "open",
      winner: null,
      correctAnswers: [],
      users: new Set(),
      attempts: new Map(),
      isJackpot:
        Boolean(forceJackpot) || Math.random() < config.jackpotChance / 100,
    };
  roundStarts.add(tenant.id);
  const previousSettings = tenant.settings,
    previousNextRoundAt = tenant.next_round_at;
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const now = Date.now(),
      duration = roundDurationMs({ gameConfig: config });
    round.startedAt = now;
    round.endsAt = now + duration;
    prepareReveals(round, duration, config.progressiveReveals);
    await saveTenantRotation(tenant, selection.rotation, client);
    tenant.next_round_at = now + config.frequencyMinutes * 60000;
    await client.query("UPDATE tenants SET next_round_at=$2 WHERE id=$1", [
      tenant.id,
      tenant.next_round_at,
    ]);
    await persistActiveRound(tenant, round, client, true);
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    tenant.settings = previousSettings;
    tenant.next_round_at = previousNextRoundAt;
    throw error;
  } finally {
    client?.release();
    roundStarts.delete(tenant.id);
  }
  rounds.set(tenant.id, round);
  scoreboardStates.delete(tenant.id);
  rankCards.delete(tenant.id);
  scheduleTenantRound(tenant, round);
  await push(tenant).catch((error) =>
    console.error(
      `Round start broadcast ${tenant.channel_name}:`,
      error.message,
    ),
  );
  return true;
}
async function finishRound(tenant, expectedRound = null) {
  const round = rounds.get(tenant.id);
  if (
    !round ||
    round.status !== "open" ||
    (expectedRound && round !== expectedRound)
  )
    return false;
  if (round.pendingAnswers > 0) {
    setTimeout(() => finishRound(tenant, round).catch(console.error), 100);
    return false;
  }
  round.status = "finished";
  round.visibleEmojis = round.emojis;
  round.nextRevealAt = null;
  let client;
  const previousSettings = tenant.settings,
    previousJackpot = tenant.jackpot;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const active = await client.query(
      "SELECT state FROM active_rounds WHERE tenant_id=$1 AND round_id=$2 FOR UPDATE",
      [tenant.id, round.id],
    );
    if (!active.rowCount) {
      await client.query("ROLLBACK");
      if (rounds.get(tenant.id) === round) rounds.delete(tenant.id);
      push(tenant).catch((error) =>
        console.error("Round reconciliation broadcast:", error.message),
      );
      return true;
    }
    const pendingAnswers = round.pendingAnswers,
      finishRetries = round.finishRetries,
      shared = hydrateActiveRound(active.rows[0].state);
    Object.assign(round, shared);
    round.pendingAnswers = pendingAnswers;
    round.finishRetries = finishRetries;
    round.status = "finished";
    round.visibleEmojis = round.emojis;
    round.nextRevealAt = null;
    const history = await client.query(
      "INSERT INTO round_history(tenant_id,runtime_round_id,puzzle_id,category,difficulty,emojis,answer,winner_username,response_ms,participants,jackpot,solved,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(tenant_id,runtime_round_id) DO NOTHING RETURNING id",
      [
        tenant.id,
        round.id,
        String(round.puzzleId || round.id),
        round.category,
        round.difficulty,
        round.emojis,
        round.answers[0],
        round.winner?.username || null,
        round.winner?.responseMs || null,
        round.correctAnswers.length,
        round.isJackpot,
        Boolean(round.winner),
        new Date(round.startedAt),
      ],
    );
    if (history.rowCount) {
      await saveTenantRotation(
        tenant,
        recordPuzzleResult(round.rotation, round),
        client,
      );
      if (!round.winner) {
        tenant.jackpot += 100;
        await client.query("UPDATE tenants SET jackpot=$2 WHERE id=$1", [
          tenant.id,
          tenant.jackpot,
        ]);
      }
    }
    await removeActiveRound(tenant.id, client, round.id);
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    tenant.settings = previousSettings;
    tenant.jackpot = previousJackpot;
    round.status = "open";
    round.finishRetries = Number(round.finishRetries || 0) + 1;
    const retryDelay = Math.min(
      30000,
      1000 * 2 ** Math.min(round.finishRetries - 1, 5),
    );
    setTimeout(() => {
      if (rounds.get(tenant.id) === round && round.status === "open")
        finishRound(tenant, round).catch((retryError) =>
          console.error(
            `Round finish retry ${tenant.channel_name}:`,
            retryError.message,
          ),
        );
    }, retryDelay);
    throw error;
  } finally {
    client?.release();
  }
  round.finishRetries = 0;
  await push(tenant).catch((error) =>
    console.error("Round finish broadcast:", error.message),
  );
  setTimeout(() => {
    if (rounds.get(tenant.id) !== round) return;
    rounds.delete(tenant.id);
    push(tenant).catch((error) =>
      console.error("Round cleanup broadcast:", error.message),
    );
  }, 10000);
  return true;
}
async function skipRound(tenant) {
  return queuedTenantMessageTask(tenant.id, async () => {
    const round = rounds.get(tenant.id);
    if (!round || round.status !== "open" || round.pendingAnswers > 0)
      return false;
    round.status = "skipped";
    try {
      await removeActiveRound(tenant.id, pool, round.id);
    } catch (error) {
      round.status = "open";
      throw error;
    }
    if (rounds.get(tenant.id) === round) rounds.delete(tenant.id);
    await push(tenant);
    return true;
  });
}
async function message(tenant, user, content, userId) {
  user =
    String(user || "Viewer")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 30) || "Viewer";
  const r = rounds.get(tenant.id),
    cmd = String(content).trim().toLowerCase().split(/\s+/),
    key = `kick:${userId || norm(user)}`;
  if (await handleViewerCommand(tenant, user, key, cmd)) return;
  if (!r || r.status !== "open" || Date.now() > r.endsAt) return;
  if (r.users.has(key)) return;
  const attempt = r.attempts.get(key) || { wrong: 0, locked: 0 };
  if (Date.now() < attempt.locked) return;
  if (!r.answers.some((a) => norm(a) === norm(content))) {
    attempt.wrong++;
    attempt.locked = Date.now() + 4000;
    r.attempts.set(key, attempt);
    await pool.query(
      `INSERT INTO scores(tenant_id,user_key,username,points,wins,streak,best_streak,correct,wrong,updated_at) VALUES($1,$2,$3,0,0,0,0,0,1,NOW()) ON CONFLICT(tenant_id,user_key) DO UPDATE SET username=$3,wrong=scores.wrong+1,streak=0,updated_at=NOW()`,
      [tenant.id, key, user],
    );
    await persistActiveRound(tenant, r);
    return;
  }
  const snapshot = {
    community_progress: tenant.community_progress,
    community_completions: tenant.community_completions,
    double_points_until: tenant.double_points_until,
    jackpot: tenant.jackpot,
  };
  let client,
    newBadges = [];
  r.pendingAnswers = (r.pendingAnswers || 0) + 1;
  try {
    let roundSnapshot = null;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const active = await client.query(
        "SELECT state FROM active_rounds WHERE tenant_id=$1 AND round_id=$2 FOR UPDATE",
        [tenant.id, r.id],
      );
      if (!active.rowCount) {
        await client.query("ROLLBACK");
        return;
      }
      const pendingAnswers = r.pendingAnswers,
        shared = hydrateActiveRound(active.rows[0].state);
      Object.assign(r, shared);
      r.pendingAnswers = pendingAnswers;
      if (r.status !== "open" || Date.now() > r.endsAt || r.users.has(key)) {
        await client.query("ROLLBACK");
        return;
      }
      roundSnapshot = serializeActiveRound(r);
      const currentAttempt = r.attempts.get(key) || attempt,
        placement = r.correctAnswers.length + 1,
        mult =
          placement === 1
            ? 1
            : placement === 2
              ? 0.7
              : placement === 3
                ? 0.5
                : 0.25,
        responseMs = Date.now() - r.startedAt,
        clueBonus = clueMultiplier(r),
        base = { easy: 100, medium: 150, hard: 225, expert: 350 }[r.difficulty],
        community = await advanceCommunityGoal(
          tenant,
          gameSettings(tenant.settings),
          client,
        ),
        pointBoost = community.doublePointsActive ? 2 : 1,
        regular = Math.max(
          10,
          Math.round(
            (base +
              Math.max(0, 75 - Math.floor(responseMs / 200)) -
              currentAttempt.wrong * 10) *
              mult *
              clueBonus *
              pointBoost,
          ),
        ),
        bonus = r.isJackpot && placement === 1 ? tenant.jackpot : 0,
        points = regular + bonus;
      if (bonus) {
        tenant.jackpot = 250;
        await client.query("UPDATE tenants SET jackpot=250 WHERE id=$1", [
          tenant.id,
        ]);
      }
      const score = (
        await client.query(
          `INSERT INTO scores(tenant_id,user_key,username,points,wins,streak,best_streak,correct,updated_at) VALUES($1,$2,$3,$4,$5,1,1,1,NOW()) ON CONFLICT(tenant_id,user_key) DO UPDATE SET username=$3,points=scores.points+$4,wins=scores.wins+$5,streak=scores.streak+1,best_streak=GREATEST(scores.best_streak,scores.streak+1),correct=scores.correct+1,updated_at=NOW() RETURNING points,wins,streak,best_streak,correct,wrong`,
          [tenant.id, key, user, points, placement === 1 ? 1 : 0],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO score_events(tenant_id,user_key,username,points,placement,streak,response_ms,difficulty,wrong_guesses,jackpot_win) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          tenant.id,
          key,
          user,
          points,
          placement,
          score.streak,
          responseMs,
          r.difficulty,
          currentAttempt.wrong,
          Boolean(bonus),
        ],
      );
      const activeDays = Number(
          (
            await client.query(
              "SELECT COUNT(DISTINCT won_at::date)::int days FROM score_events WHERE tenant_id=$1 AND user_key=$2",
              [tenant.id, key],
            )
          ).rows[0]?.days || 0,
        ),
        badgeKeys = [];
      if (responseMs <= 3000) badgeKeys.push("quick_draw");
      if (Number(score.streak) >= 5) badgeKeys.push("hot_streak");
      if (currentAttempt.wrong === 0) badgeKeys.push("perfect");
      if (placement === 1) badgeKeys.push("first_place");
      if (bonus) badgeKeys.push("jackpot_winner");
      if (r.difficulty === "expert") badgeKeys.push("expert_solver");
      if (activeDays >= 7) badgeKeys.push("regular");
      if (Number(score.correct) >= 100) badgeKeys.push("century_club");
      newBadges = await unlockBadges(client, tenant.id, key, user, badgeKeys);
      const answer = {
        username: user,
        placement,
        points,
        responseMs,
        multiplier: mult,
        clueMultiplier: clueBonus,
        doublePointsMultiplier: pointBoost,
        jackpotBonus: bonus,
      };
      r.users.add(key);
      r.correctAnswers.push(answer);
      if (placement === 1) r.winner = answer;
      if (!(await persistActiveRound(tenant, r, client)))
        throw new Error("The round closed before the answer could be saved.");
      await client.query("COMMIT");
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      Object.assign(tenant, snapshot);
      if (roundSnapshot) {
        const pendingAnswers = r.pendingAnswers;
        Object.assign(r, hydrateActiveRound(roundSnapshot));
        r.pendingAnswers = pendingAnswers;
      }
      throw error;
    } finally {
      client?.release();
    }
    showBadgeAlert(tenant, user, newBadges);
    await push(tenant);
  } finally {
    r.pendingAnswers = Math.max(0, Number(r.pendingAnswers || 0) - 1);
  }
}
async function queuedTenantMessageTask(tenantId, task) {
  const previous = messageQueues.get(tenantId) || Promise.resolve(),
    current = previous.catch(() => {}).then(task);
  messageQueues.set(tenantId, current);
  try {
    return await current;
  } finally {
    if (messageQueues.get(tenantId) === current) messageQueues.delete(tenantId);
  }
}
async function queuedMessage(tenant, user, content, userId) {
  return queuedTenantMessageTask(tenant.id, () =>
    message(tenant, user, content, userId),
  );
}
function verify(req, raw) {
  const id = req.headers["kick-event-message-id"],
    ts = req.headers["kick-event-message-timestamp"],
    sig = req.headers["kick-event-signature"];
  if (!id || !ts || !sig) return false;
  const v = crypto.createVerify("RSA-SHA256");
  v.update(`${id}.${ts}.${raw}`);
  v.end();
  return v.verify(KICK_KEY, Buffer.from(sig, "base64"));
}
const joinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  dashboardLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 240,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  guestActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  privateReadLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
function sameOrigin(req, res, next) {
  const origin = req.headers.origin,
    fetchSite = req.headers["sec-fetch-site"];
  if ((origin && origin !== new URL(BASE).origin) || fetchSite === "cross-site")
    return res.status(403).json({ error: "Cross-site request blocked." });
  next();
}
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts:
      process.env.NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
    referrerPolicy: { policy: "no-referrer" },
  }),
);
app.use((req, res, next) => {
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (/^\/(?:dashboard|auth|o|g)(?:\/|$)/.test(req.path)) {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  next();
});
app.use("/join", (req, res, next) =>
  req.method === "POST" ? joinLimiter(req, res, next) : next(),
);
app.use("/auth/kick", authLimiter);
app.use("/dashboard", (req, res, next) =>
  ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
    ? sameOrigin(req, res, (error) =>
        error ? next(error) : dashboardLimiter(req, res, next),
      )
    : next(),
);
app.use("/g", (req, res, next) =>
  req.method === "POST"
    ? guestActionLimiter(req, res, next)
    : privateReadLimiter(req, res, next),
);
app.use("/o", privateReadLimiter);
app.use(
  "/webhooks/kick",
  express.raw({ type: "application/json", limit: "100kb" }),
);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders(response, filePath) {
      if (/-v\d+\.(?:webp|jpe?g|png|svg)$/i.test(filePath))
        response.setHeader(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );
      else if (/\.(?:css|js|html)$/i.test(filePath))
        response.setHeader(
          "Cache-Control",
          "public, max-age=0, must-revalidate",
        );
    },
  }),
);
app.get("/trailer", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "trailer.html")),
);
app.get("/about", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "about.html")),
);
app.get("/healthz", async (_, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      ok: true,
      database: "connected",
      version: VERSION,
      automaticUpdates: true,
      activeRounds: rounds.size,
      overlayConnections: [...streams.values()].reduce(
        (total, responses) => total + responses.size,
        0,
      ),
    });
  } catch {
    res
      .status(503)
      .json({ ok: false, database: "unavailable", version: VERSION });
  }
});
app.get("/", async (req, res) => {
  const t = await tenantBySession(req);
  res.redirect(t ? "/dashboard" : "/about");
});
app.get("/login", async (req, res) => {
  const t = await tenantBySession(req);
  if (t) return res.redirect("/dashboard");
  res.send(
    page(
      "Streamer sign in",
      `<p class="muted">Already joined the beta? Sign in securely with the Kick account that owns your registered channel.</p><a class="button" href="/auth/kick/login">Sign in with Kick</a><section class="guide"><h2>New streamer?</h2><p>Private beta access requires an invite code.</p><a class="secondary button" href="/join">Join private beta</a></section>`,
    ),
  );
});
app.get("/join", (_, res) =>
  res.send(
    page(
      "Join the private beta",
      `<p class="muted">Already registered? <a href="/login">Sign in with Kick</a>.</p><form method="post"><label>Invite code<input name="invite" required></label><label>Kick channel<input name="channel" required></label><label>Display name<input name="display" required></label><button>Join beta</button></form>`,
    ),
  ),
);
app.post("/join", async (req, res) => {
  const codes = String(process.env.INVITE_CODES || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!codes.includes(req.body.invite))
    return res
      .status(403)
      .send(page("Invite required", "<p>That invite code is not valid.</p>"));
  const session = token(),
    id = crypto.randomUUID(),
    overlay = token();
  try {
    await pool.query(
      "INSERT INTO tenants(id,channel_name,display_name,overlay_token,session_token_hash,next_round_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        norm(req.body.channel).replace(/ /g, ""),
        String(req.body.display).slice(0, 40),
        overlay,
        hash(session),
        Date.now() + 900000,
      ],
    );
    res.setHeader("Set-Cookie", sessionCookie(session));
    res.redirect("/dashboard");
  } catch (e) {
    res
      .status(400)
      .send(
        page(
          "Account already exists",
          `<p>This channel is already registered.</p><a class="button" href="/login">Sign in with Kick</a>`,
        ),
      );
  }
});
app.get("/dashboard", async (req, res) => {
  const tenant = await tenantBySession(req);
  if (!tenant) return res.redirect("/login");
  res.send(
    page(
      `${escapeHtml(tenant.display_name)} dashboard`,
      renderDashboard({
        tenant,
        theme: tenantTheme(tenant),
        version: VERSION,
      }),
    ),
  );
});
app.post("/dashboard/theme", async (req, res) => {
  const t = await tenantBySession(req);
  if (!t) return res.status(401).json({ error: "Sign in required." });
  const theme = normalizeTheme(req.body),
    error = validateCustomCss(theme.customCss);
  if (error) return res.status(400).json({ error });
  await pool.query(
    "UPDATE tenants SET settings=COALESCE(settings,'{}'::jsonb)||$2::jsonb,updated_at=NOW() WHERE id=$1",
    [t.id, JSON.stringify({ theme })],
  );
  await Promise.all([push(t), syncActiveGuestSettings(t.id, { theme })]);
  res.json({ ok: true, theme });
});
app.get("/dashboard/game-settings", async (req, res) => {
  const t = await tenantBySession(req);
  if (!t) return res.status(401).json({ error: "Sign in required." });
  res.json({
    settings: gameSettings(t.settings),
    presets: gamePresets,
    categories: gameCategories,
    difficulties: difficultyOrder,
    community: {
      progress: Number(t.community_progress || 0),
      completions: Number(t.community_completions || 0),
      doublePointsUntil: Number(t.double_points_until || 0),
    },
  });
});
app.post("/dashboard/game-settings", async (req, res) => {
  const t = await tenantBySession(req);
  if (!t) return res.status(401).json({ error: "Sign in required." });
  res.json(
    await queuedTenantSettings(t, async (fresh) => {
      const input = Object.hasOwn(gamePresets, req.body.preset)
          ? { ...gamePresets[req.body.preset], ...req.body }
          : { ...gameSettings(fresh.settings), ...req.body },
        game = normalizeGameSettings(input),
        nextRoundAt = Date.now() + game.frequencyMinutes * 60000;
      await pool.query(
        "UPDATE tenants SET settings=COALESCE(settings,'{}'::jsonb)||$2::jsonb,next_round_at=$3,community_progress=LEAST(community_progress,$4::int-1),updated_at=NOW() WHERE id=$1",
        [fresh.id, JSON.stringify({ game }), nextRoundAt, game.communityTarget],
      );
      await Promise.all([
        push(fresh),
        syncActiveGuestSettings(fresh.id, { game }),
      ]);
      return { ok: true, settings: game, nextRoundAt };
    }),
  );
});
app.post("/dashboard/community-settings", async (req, res) => {
  const t = await tenantBySession(req);
  if (!t) return res.status(401).json({ error: "Sign in required." });
  res.json(
    await queuedTenantSettings(t, async (fresh) => {
      const game = normalizeGameSettings({
          ...gameSettings(fresh.settings),
          communityEnabled: req.body.communityEnabled,
          communityTarget: req.body.communityTarget,
          communityRewardMinutes: req.body.communityRewardMinutes,
        }),
        result = await pool.query(
          "UPDATE tenants SET settings=COALESCE(settings,'{}'::jsonb)||$2::jsonb,community_progress=LEAST(community_progress,$3::int-1),updated_at=NOW() WHERE id=$1 RETURNING community_progress,community_completions,double_points_until",
          [fresh.id, JSON.stringify({ game }), game.communityTarget],
        ),
        row = result.rows[0] || {};
      await Promise.all([
        push(fresh),
        syncActiveGuestSettings(fresh.id, { game }),
      ]);
      return {
        ok: true,
        settings: game,
        community: {
          progress: Number(row.community_progress || 0),
          completions: Number(row.community_completions || 0),
          doublePointsUntil: Number(row.double_points_until || 0),
        },
      };
    }),
  );
});
app.get("/dashboard/insights", async (req, res) => {
  const t = await tenantBySession(req);
  if (!t) return res.status(401).json({ error: "Sign in required." });
  const [summary, recent, categories] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int rounds,COUNT(*) FILTER(WHERE solved)::int solved,COALESCE(ROUND(AVG(response_ms) FILTER(WHERE solved)),0)::int AS "averageResponseMs",COALESCE(ROUND(AVG(participants)),0)::int AS "averageParticipants",COUNT(*) FILTER(WHERE jackpot)::int AS jackpots,COUNT(*) FILTER(WHERE jackpot AND solved)::int AS "jackpotsWon" FROM round_history WHERE tenant_id=$1 AND finished_at>=NOW()-INTERVAL '30 days'`,
      [t.id],
    ),
    pool.query(
      `SELECT id,category,difficulty,emojis,answer,winner_username AS winner,response_ms AS "responseMs",participants,jackpot,solved,finished_at AS "finishedAt" FROM round_history WHERE tenant_id=$1 ORDER BY finished_at DESC LIMIT 12`,
      [t.id],
    ),
    pool.query(
      `SELECT category,COUNT(*)::int rounds,COUNT(*) FILTER(WHERE solved)::int solved FROM round_history WHERE tenant_id=$1 AND finished_at>=NOW()-INTERVAL '30 days' GROUP BY category ORDER BY rounds DESC,category`,
      [t.id],
    ),
  ]);
  const stats = summary.rows[0],
    rounds = stats.rounds || 0;
  res.json({
    summary: {
      ...stats,
      solveRate: rounds ? Math.round((stats.solved / rounds) * 100) : 0,
    },
    recent: recent.rows,
    categories: categories.rows,
  });
});
app.get("/dashboard/guest-sessions", async (req, res) => {
  const t = await tenantBySession(req);
  if (!t) return res.status(401).json({ error: "Sign in required." });
  const sessions = (
    await pool.query(
      "SELECT id,access_token,expires_at,created_at FROM guest_sessions WHERE tenant_id=$1 AND revoked_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC",
      [t.id],
    )
  ).rows;
  res.set("Cache-Control", "no-store").json({
    sessions: sessions.map((session) => ({
      id: session.id,
      expiresAt: new Date(session.expires_at).getTime(),
      createdAt: new Date(session.created_at).getTime(),
      labUrl: `${BASE}/g/${session.access_token}/lab`,
      overlayUrl: `${BASE}/g/${session.access_token}/overlay.html`,
      scoreboardUrl: `${BASE}/g/${session.access_token}/scoreboard.html`,
    })),
  });
});
app.post("/dashboard/guest-sessions", async (req, res) => {
  const t = await tenantBySession(req);
  if (!t) return res.status(401).json({ error: "Sign in required." });
  const count = Number(
    (
      await pool.query(
        "SELECT COUNT(*) count FROM guest_sessions WHERE tenant_id=$1 AND revoked_at IS NULL AND expires_at>NOW()",
        [t.id],
      )
    ).rows[0].count,
  );
  if (count >= 3)
    return res.status(409).json({
      error: "Revoke an existing guest session before creating another.",
    });
  const id = crypto.randomUUID(),
    access = token(32),
    expiresAt = new Date(Date.now() + 86400000),
    settings = {
      theme: tenantTheme(t),
      game: gameSettings(t.settings),
      communityState: { progress: 0, completions: 0, doublePointsUntil: 0 },
      automatic: false,
      nextAutoAt: 0,
    };
  await pool.query(
    "INSERT INTO guest_sessions(id,tenant_id,access_token,expires_at,settings,scores) VALUES($1,$2,$3,$4,$5,$6)",
    [id, t.id, access, expiresAt, JSON.stringify(settings), "{}"],
  );
  res
    .status(201)
    .set("Cache-Control", "no-store")
    .json({
      id,
      expiresAt: expiresAt.getTime(),
      labUrl: `${BASE}/g/${access}/lab`,
      overlayUrl: `${BASE}/g/${access}/overlay.html`,
      scoreboardUrl: `${BASE}/g/${access}/scoreboard.html`,
    });
});
app.delete("/dashboard/guest-sessions/:id", async (req, res) => {
  const t = await tenantBySession(req);
  if (!t) return res.status(401).json({ error: "Sign in required." });
  const result = await pool.query(
    "UPDATE guest_sessions SET revoked_at=NOW(),updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL RETURNING id",
    [req.params.id, t.id],
  );
  if (!result.rowCount)
    return res.status(404).json({ error: "Guest session not found." });
  guestRounds.delete(req.params.id);
  for (const response of guestStreams.get(req.params.id) || []) response.end();
  guestStreams.delete(req.params.id);
  res.json({ ok: true });
});
app.get("/g/:token/lab", async (req, res) => {
  if (!(await guestByToken(req.params.token)))
    return res
      .status(410)
      .sendFile(path.join(__dirname, "public", "guest-expired.html"));
  res
    .set("Cache-Control", "no-store")
    .sendFile(path.join(__dirname, "public", "guest-lab.html"));
});
app.get("/g/:token/state", async (req, res) => {
  const session = await guestByToken(req.params.token);
  if (!session)
    return res
      .status(410)
      .json({ error: "This guest session expired or was revoked." });
  res.set("Cache-Control", "no-store").json(await guestState(session));
});
app.get("/g/:token/events", async (req, res) => {
  const session = await guestByToken(req.params.token);
  if (!session) return res.sendStatus(410);
  if (!guestStreams.has(session.id)) guestStreams.set(session.id, new Set());
  const responses = guestStreams.get(session.id);
  if (responses.size >= 8) return res.sendStatus(429);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  let closed = false,
    heartbeat = null;
  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    responses.delete(res);
    if (!responses.size) guestStreams.delete(session.id);
  };
  req.on("close", close);
  res.on?.("close", close);
  try {
    await queueGuestPacket(session.id, (packet) => {
      if (closed) return;
      res.write(packet);
      responses.add(res);
      heartbeat = setInterval(() => {
        if (!closed) res.write(`: heartbeat ${Date.now()}\n\n`);
      }, 20000);
    });
  } catch (error) {
    close();
    throw error;
  }
});
app.get("/g/:token/overlay.html", async (req, res) => {
  if (!(await guestByToken(req.params.token))) return res.sendStatus(410);
  res
    .set("Cache-Control", "no-store")
    .sendFile(path.join(__dirname, "public", "overlay.html"));
});
app.get("/g/:token/scoreboard.html", async (req, res) => {
  if (!(await guestByToken(req.params.token))) return res.sendStatus(410);
  res
    .set("Cache-Control", "no-store")
    .sendFile(path.join(__dirname, "public", "scoreboard.html"));
});
app.post("/g/:token/action", async (req, res) => {
  const session = await guestByToken(req.params.token);
  if (!session)
    return res
      .status(410)
      .json({ error: "This guest session expired or was revoked." });
  res.set("Cache-Control", "no-store");
  const action = String(req.body.action || "");
  if (action === "start") {
    await startGuestRound(session, false);
    return res.json({ ok: true });
  }
  if (action === "jackpot") {
    await startGuestRound(session, true);
    return res.json({ ok: true });
  }
  if (action === "answer")
    return res.json(
      await queuedGuestAnswer(session, req.body.username, req.body.answer),
    );
  if (action === "scoreboard") {
    let round = guestRounds.get(session.id);
    if (!round) {
      round = { status: "idle", correctAnswers: [] };
      guestRounds.set(session.id, round);
    }
    const hideAt = Date.now() + 12000;
    round.scoreboardUntil = hideAt;
    round.scoreboardBy = String(req.body.username || "Guest Tester").slice(
      0,
      30,
    );
    await pushGuest(session);
    setTimeout(() => {
      if (guestRounds.get(session.id)?.scoreboardUntil === hideAt)
        pushGuest(session).catch(console.error);
    }, 12050);
    return res.json({ ok: true });
  }
  if (action === "automatic") {
    await setGuestAutomatic(session, Boolean(req.body.enabled));
    return res.json({ ok: true, automatic: Boolean(req.body.enabled) });
  }
  if (action === "reset")
    return res.json(
      await queuedGuestMutation(session, async (fresh) => {
        const communityState = {
          progress: 0,
          completions: 0,
          doublePointsUntil: 0,
        };
        fresh.scores = {};
        fresh.settings = { ...(fresh.settings || {}), communityState };
        guestRounds.delete(fresh.id);
        await saveGuest(fresh, { communityState });
        await pushGuest(fresh);
        return { ok: true };
      }),
    );
  if (action === "theme") {
    const theme = normalizeTheme(req.body.theme),
      error = validateCustomCss(theme.customCss);
    if (error) return res.status(400).json({ error });
    await patchGuestSettings(session, { theme });
    await pushGuest(session);
    return res.json({ ok: true, theme });
  }
  res.status(400).json({ error: "Unknown guest action." });
});
app.get("/dashboard/obs-sources", async (req, res) => {
  const tenant = await tenantBySession(req);
  if (!tenant) return res.status(401).json({ error: "Sign in required." });
  const root = `${BASE}/o/${tenant.overlay_token}`;
  res.set("Cache-Control", "no-store").json({
    overlayUrl: `${root}/overlay.html`,
    scoreboardUrl: `${root}/scoreboard.html`,
    sources: {
      overlay: sourceConnectionState(tenant, "overlay"),
      scoreboard: sourceConnectionState(tenant, "scoreboard"),
    },
  });
});
app.post("/dashboard/obs-sources/rotate", async (req, res) => {
  const tenant = await tenantBySession(req);
  if (!tenant) return res.status(401).json({ error: "Sign in required." });
  if (String(req.body.confirmation || "") !== "ROTATE")
    return res.status(400).json({ error: "Type ROTATE to confirm." });
  const nextToken = token();
  const result = await pool.query(
    "UPDATE tenants SET overlay_token=$2,overlay_last_connected_at=0,scoreboard_last_connected_at=0,updated_at=NOW() WHERE id=$1 RETURNING *",
    [tenant.id, nextToken],
  );
  const updated = result.rows[0];
  for (const response of streams.get(tenant.id) || []) response.end();
  streams.delete(tenant.id);
  sourceConnections.delete(tenant.id);
  const root = `${BASE}/o/${updated.overlay_token}`;
  res.set("Cache-Control", "no-store").json({
    ok: true,
    overlayUrl: `${root}/overlay.html`,
    scoreboardUrl: `${root}/scoreboard.html`,
    sources: {
      overlay: sourceConnectionState(updated, "overlay"),
      scoreboard: sourceConnectionState(updated, "scoreboard"),
    },
  });
});
app.get("/dashboard/live-state", async (req, res) => {
  const tenant = await tenantBySession(req);
  if (!tenant) return res.status(401).json({ error: "Sign in required." });
  res.set("Cache-Control", "no-store").json(await dashboardLiveState(tenant));
});
app.post("/dashboard/live-action", async (req, res) => {
  const tenant = await tenantBySession(req);
  if (!tenant) return res.status(401).json({ error: "Sign in required." });
  res.set("Cache-Control", "no-store");
  const action = String(req.body.action || "");
  if (action === "start" || action === "jackpot") {
    const started = await startRound(tenant, {
      forceJackpot: action === "jackpot",
    });
    if (!started)
      return res.status(409).json({ error: "A round is already active." });
  } else if (action === "end") {
    if (!(await finishRound(tenant, rounds.get(tenant.id))))
      return res
        .status(409)
        .json({ error: "There is no active round to end." });
  } else if (action === "skip") {
    if (!(await skipRound(tenant)))
      return res
        .status(409)
        .json({ error: "There is no active round to skip." });
  } else if (action === "show-scoreboard") {
    if (rounds.get(tenant.id)?.status === "open")
      return res.status(409).json({
        error: "End or skip the active round before showing the scoreboard.",
      });
    await showScoreboard(tenant, {
      period: req.body.period,
      shownBy: "Streamer",
    });
  } else if (action === "hide-scoreboard") {
    await hideScoreboard(tenant);
  } else if (action === "set-automatic") {
    await queuedTenantSettings(tenant, async (fresh) => {
      const game = normalizeGameSettings({
          ...gameSettings(fresh.settings),
          preset: "custom",
          automatic: Boolean(req.body.enabled),
        }),
        nextRoundAt = Date.now() + game.frequencyMinutes * 60000;
      await pool.query(
        "UPDATE tenants SET settings=COALESCE(settings,'{}'::jsonb)||$2::jsonb,next_round_at=$3,updated_at=NOW() WHERE id=$1",
        [fresh.id, JSON.stringify({ game }), nextRoundAt],
      );
      await Promise.all([
        push(fresh),
        syncActiveGuestSettings(fresh.id, { game }),
      ]);
      return { ok: true };
    });
  } else return res.status(400).json({ error: "Unknown live action." });
  res.json({ ok: true, state: await dashboardLiveState(tenant) });
});
app.post("/logout", sameOrigin, async (req, res) => {
  const tenant = await tenantBySession(req);
  if (tenant)
    await pool.query("UPDATE tenants SET session_token_hash=$2 WHERE id=$1", [
      tenant.id,
      hash(token()),
    ]);
  res.setHeader("Set-Cookie", sessionCookie("", 0));
  res.redirect("/login");
});
app.get("/auth/kick/login", (_, res) => res.redirect(kickAuthorize("login")));
app.get("/auth/kick", async (req, res) => {
  const t = await tenantBySession(req);
  if (!t) return res.redirect("/login");
  res.redirect(kickAuthorize("connect", t.id));
});
app.get("/auth/kick/callback", async (req, res) => {
  const a = oauth.get(req.query.state);
  if (!a || a.expires < Date.now())
    return res
      .status(400)
      .send(
        page(
          "Sign-in expired",
          '<p>Please start again.</p><a class="button" href="/login">Return to sign in</a>',
        ),
      );
  oauth.delete(req.query.state);
  const response = await fetchWithTimeout("https://id.kick.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
        redirect_uri: `${BASE}/auth/kick/callback`,
        code_verifier: a.verifier,
        code: req.query.code,
      }),
    }),
    tokens = await response.json();
  if (!response.ok)
    return res
      .status(400)
      .send(
        page(
          "Kick sign-in failed",
          '<p>Kick did not authorize the request.</p><a class="button" href="/login">Try again</a>',
        ),
      );
  let tenantId = a.tenant,
    kickUser = null;
  if (a.flow === "login") {
    const userResponse = await fetchWithTimeout(
        "https://api.kick.com/public/v1/users",
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        },
      ),
      userBody = await userResponse.json().catch(() => ({}));
    kickUser = Array.isArray(userBody.data)
      ? userBody.data[0]
      : userBody.data || userBody;
    if (!userResponse.ok || !kickUser)
      return res
        .status(400)
        .send(
          page(
            "Could not read Kick account",
            "<p>Please ensure account access is allowed, then try again.</p>",
          ),
        );
    const kickId = String(kickUser.user_id || kickUser.id || ""),
      channel = norm(kickUser.name || kickUser.username || "").replace(
        / /g,
        "",
      ),
      match = (
        await pool.query(
          "SELECT id FROM tenants WHERE kick_user_id=$1 OR (kick_user_id IS NULL AND channel_name=$2) ORDER BY (kick_user_id=$1) DESC LIMIT 1",
          [kickId, channel],
        )
      ).rows[0];
    if (!match)
      return res
        .status(403)
        .send(
          page(
            "No beta account found",
            `<p>Your Kick account is not linked to a registered beta channel.</p><a class="button" href="/join">Join private beta</a>`,
          ),
        );
    tenantId = match.id;
  }
  const linked = await pool.query(
    "UPDATE tenants SET kick_user_id=COALESCE($2,kick_user_id),kick_access_token=$3,kick_refresh_token=$4,kick_token_expires_at=$5,updated_at=NOW() WHERE id=$1 AND ($2::text IS NULL OR kick_user_id IS NULL OR kick_user_id=$2) RETURNING id",
    [
      tenantId,
      kickUser ? String(kickUser.user_id || kickUser.id || "") : null,
      encrypt(tokens.access_token),
      tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      Date.now() + Number(tokens.expires_in || 3600) * 1000,
    ],
  );
  if (!linked.rowCount)
    return res
      .status(409)
      .send(
        page(
          "Kick account mismatch",
          '<p>This beta channel is already linked to another Kick account.</p><a class="button" href="/login">Return to sign in</a>',
        ),
      );
  try {
    await ensureSubscription(
      { id: tenantId, kick_access_token: encrypt(tokens.access_token) },
      tokens.access_token,
    );
  } catch (error) {
    if (a.flow !== "login")
      return res
        .status(400)
        .send(
          page(
            "Kick connected",
            "<p>The account connected, but the chat subscription could not be created. Please try reconnecting.</p>",
          ),
        );
  }
  if (a.flow === "login") {
    const session = token();
    await pool.query("UPDATE tenants SET session_token_hash=$2 WHERE id=$1", [
      tenantId,
      hash(session),
    ]);
    res.setHeader("Set-Cookie", sessionCookie(session));
  }
  res.redirect("/dashboard");
});
app.post("/webhooks/kick", async (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verify(req, raw)) return res.sendStatus(403);
  const id = req.headers["kick-event-message-id"];
  try {
    await pool.query("INSERT INTO webhook_messages(message_id) VALUES($1)", [
      id,
    ]);
  } catch (error) {
    if (error.code === "23505") return res.json({ duplicate: true });
    throw error;
  }
  try {
    const event = JSON.parse(raw),
      broadcasterId = String(
        event.broadcaster?.user_id || event.broadcaster?.id || "",
      ),
      channel = norm(
        event.broadcaster?.username || event.broadcaster?.user_name || "",
      ).replace(/ /g, ""),
      tenant = (
        await pool.query(
          "SELECT * FROM tenants WHERE kick_user_id=$1 OR (kick_user_id IS NULL AND channel_name=$2) ORDER BY (kick_user_id=$1) DESC LIMIT 1",
          [broadcasterId, channel],
        )
      ).rows[0];
    if (tenant && req.headers["kick-event-type"] === "chat.message.sent") {
      const receivedAt = Date.now(),
        lastWrite = Math.max(
          Number(lastWebhookWrites.get(tenant.id) || 0),
          Number(tenant.last_webhook_at || 0),
        );
      tenant.last_webhook_at = receivedAt;
      if (receivedAt - lastWrite >= 30000) {
        lastWebhookWrites.set(tenant.id, receivedAt);
        await pool.query("UPDATE tenants SET last_webhook_at=$2 WHERE id=$1", [
          tenant.id,
          receivedAt,
        ]);
      }
      await queuedMessage(
        tenant,
        event.sender.username,
        event.content,
        event.sender.user_id,
      );
    }
    res.json({ received: true });
  } catch (error) {
    await pool
      .query("DELETE FROM webhook_messages WHERE message_id=$1", [id])
      .catch(() => {});
    throw error;
  }
});
app.get("/o/:token/events", async (req, res) => {
  const tenant = await tenantByOverlay(req.params.token);
  if (!tenant) return res.sendStatus(404);
  const source = ["overlay", "scoreboard"].includes(req.query?.source)
    ? req.query.source
    : "overlay";
  if (!streams.has(tenant.id)) streams.set(tenant.id, new Set());
  if (!sourceConnections.has(tenant.id))
    sourceConnections.set(tenant.id, {
      overlay: new Set(),
      scoreboard: new Set(),
    });
  const responses = streams.get(tenant.id),
    sourceRegistry = sourceConnections.get(tenant.id)[source];
  if (responses.size >= 8) return res.sendStatus(429);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  let closed = false,
    heartbeat = null;
  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    responses.delete(res);
    sourceRegistry.delete(res);
    if (!responses.size) streams.delete(tenant.id);
    const registry = sourceConnections.get(tenant.id);
    if (registry && !registry.overlay.size && !registry.scoreboard.size)
      sourceConnections.delete(tenant.id);
  };
  req.on("close", close);
  res.on?.("close", close);
  try {
    await queueTenantPacket(tenant.id, async (packet) => {
      if (closed) return;
      res.write(packet);
      responses.add(res);
      sourceRegistry.add(res);
      heartbeat = setInterval(() => {
        if (!closed) res.write(`: heartbeat ${Date.now()}\n\n`);
      }, 20000);
      const connectedAt = Date.now(),
        column =
          source === "overlay"
            ? "overlay_last_connected_at"
            : "scoreboard_last_connected_at";
      tenant[column] = connectedAt;
      await pool.query(`UPDATE tenants SET ${column}=$2 WHERE id=$1`, [
        tenant.id,
        connectedAt,
      ]);
    });
  } catch (error) {
    close();
    throw error;
  }
});
app.get("/o/:token/state", async (req, res) => {
  const t = await tenantByOverlay(req.params.token);
  if (!t) return res.sendStatus(404);
  res.json(await state(t));
});
app.get("/o/:token/overlay.html", async (req, res) => {
  if (!(await tenantByOverlay(req.params.token))) return res.sendStatus(404);
  res.sendFile(path.join(__dirname, "public", "overlay.html"));
});
app.get("/o/:token/scoreboard.html", async (req, res) => {
  if (!(await tenantByOverlay(req.params.token))) return res.sendStatus(404);
  res.sendFile(path.join(__dirname, "public", "scoreboard.html"));
});
let automaticSweep = null;
async function runAutomaticRounds(starter = startRound) {
  if (automaticSweep) return automaticSweep;
  automaticSweep = (async () => {
    const due = (
      await pool.query(
        "SELECT * FROM tenants WHERE kick_access_token IS NOT NULL AND COALESCE(next_round_at,0)<=$1",
        [Date.now()],
      )
    ).rows;
    for (const tenant of due) {
      if (!gameSettings(tenant.settings).automatic) continue;
      try {
        await starter(tenant);
      } catch (error) {
        console.error(
          `Automatic round ${tenant.channel_name || tenant.id}:`,
          error.message,
        );
      }
    }
    return due.length;
  })();
  try {
    return await automaticSweep;
  } finally {
    automaticSweep = null;
  }
}
let guestAutomaticSweep = null;
async function runGuestAutomaticRounds() {
  if (guestAutomaticSweep) return guestAutomaticSweep;
  guestAutomaticSweep = (async () => {
    const now = Date.now(),
      nextAutoAt = now + 45000,
      due = (
        await pool.query(
          "UPDATE guest_sessions SET settings=jsonb_set(COALESCE(settings,'{}'::jsonb),'{nextAutoAt}',to_jsonb($1::bigint),true),updated_at=NOW() WHERE revoked_at IS NULL AND expires_at>NOW() AND settings->>'automatic'='true' AND COALESCE((settings->>'nextAutoAt')::bigint,0)<=$2 RETURNING *",
          [nextAutoAt, now],
        )
      ).rows;
    for (const session of due)
      try {
        await startGuestRound(session, Math.random() < 0.2, true);
      } catch (error) {
        console.error(`Guest automatic round ${session.id}:`, error.message);
      }
    for (const [id, responses] of guestStreams) {
      const alive = (
        await pool.query(
          "SELECT 1 FROM guest_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>NOW()",
          [id],
        )
      ).rowCount;
      if (!alive) {
        for (const response of responses) response.end();
        guestStreams.delete(id);
        guestRounds.delete(id);
      }
    }
    return due.length;
  })();
  try {
    return await guestAutomaticSweep;
  } finally {
    guestAutomaticSweep = null;
  }
}
async function cleanupWebhookMessages() {
  const result = await pool.query(
    "WITH expired AS (SELECT message_id FROM webhook_messages WHERE received_at < NOW()-INTERVAL '6 hours' ORDER BY received_at LIMIT 25000) DELETE FROM webhook_messages messages USING expired WHERE messages.message_id=expired.message_id",
  );
  return result.rowCount;
}
function startBackgroundJobs() {
  setInterval(
    () =>
      runAutomaticRounds().catch((error) =>
        console.error("Automatic round scan:", error.message),
      ),
    30000,
  );
  setInterval(
    () =>
      runGuestAutomaticRounds().catch((error) =>
        console.error("Guest automatic round scan:", error.message),
      ),
    15000,
  );
  setTimeout(
    () =>
      maintainKickConnections().catch((error) =>
        console.error("Kick maintenance:", error.message),
      ),
    15000,
  );
  setInterval(
    () =>
      maintainKickConnections().catch((error) =>
        console.error("Kick maintenance:", error.message),
      ),
    300000,
  );
  setTimeout(
    () =>
      cleanupWebhookMessages().catch((error) =>
        console.error("Webhook cleanup:", error.message),
      ),
    30000,
  );
  setInterval(
    () =>
      cleanupWebhookMessages().catch((error) =>
        console.error("Webhook cleanup:", error.message),
      ),
    300000,
  );
}
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function page(title, body) {
  return `<!doctype html><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0;background:#070a08;color:#fff;font:16px system-ui}a{color:#53fc18}main{max-width:820px;margin:50px auto;padding:28px}h1{font-size:42px}h1,h2{color:#fff}.status,.copy,form,.guide{padding:18px;margin:14px 0;border:1px solid #334238;border-radius:14px;background:#101712}.status{color:#53fc18;font-weight:800}.account{display:flex;justify-content:space-between;align-items:center;color:#9cab9f;margin:-8px 0 20px}.account a{font-weight:800}.maintenance{display:grid;gap:4px;padding:13px 16px;border:1px solid #304f36;border-radius:12px;background:#0b160e;color:#53fc18}.maintenance span{color:#9cab9f;font-size:12px}label{display:grid;gap:7px;margin:14px 0}input,textarea{padding:13px;border:1px solid #415045;border-radius:9px;background:#080b09;color:#fff}.button,button{display:inline-block;padding:12px 16px;border:0;border-radius:9px;background:#53fc18;color:#071006;font-weight:900;text-decoration:none;cursor:pointer}.secondary{margin-left:8px;background:#253029;color:#fff}.copy{display:grid;grid-template-columns:130px 1fr auto;gap:12px;align-items:center}.copy code{overflow:hidden;text-overflow:ellipsis;color:#b7c5bb}.guide{margin-top:28px;padding:26px}.guide h2{font-size:27px;margin:10px 0 4px}.guide ol{padding-left:25px}.guide li{margin:12px 0;line-height:1.5}.muted{color:#9cab9f}.pill{display:inline-flex;padding:5px 10px;border-radius:99px;background:#253029;color:#53fc18;font-size:12px;font-weight:800;letter-spacing:.08em}.commands{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:18px 0}.commands div{display:grid;gap:4px;padding:13px;border-radius:11px;background:#0a0f0c}.commands code{color:#53fc18;font-weight:900}.commands span{color:#9cab9f;font-size:13px}.panel img{display:block;width:min(100%,420px);max-height:630px;object-fit:contain;margin:20px auto;border-radius:14px;border:1px solid #334238}.panel-actions{display:flex;flex-wrap:wrap;gap:8px}.panel-actions .secondary{margin:0}.panel textarea{min-height:90px;resize:vertical;line-height:1.45}@media(max-width:650px){.copy,.commands{grid-template-columns:1fr}main{margin:10px}.secondary{margin:10px 0 0}.account{align-items:flex-start;gap:10px}}</style><main><small style="color:#53fc18;letter-spacing:.18em">EMOJI DECODER CLOUD BETA</small><h1>${title}</h1>${body}</main>`;
}
pool
  .query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"))
  .then(() => backfillBadges())
  .then(() => restoreActiveRounds())
  .then(() =>
    app.listen(PORT, "0.0.0.0", () => {
      startBackgroundJobs();
      console.log(`Cloud beta listening on ${PORT}`);
    }),
  )
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
