const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const clone = (value) => JSON.parse(JSON.stringify(value));
const theme = (primary) => ({
  preset: "kick",
  primary,
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
});
const game = {
  preset: "custom",
  automatic: true,
  frequencyMinutes: 15,
  roundSeconds: 60,
  minDifficulty: "easy",
  maxDifficulty: "expert",
  categories: ["Film"],
  jackpotChance: 20,
  progressiveReveals: true,
  communityEnabled: true,
  communityTarget: 25,
  communityRewardMinutes: 5,
};

function loadServer(query, options = {}) {
  const routes = new Map(),
    app = {
      use() {},
      set() {},
      disable() {},
      get(route, handler) {
        routes.set(`GET ${route}`, handler);
      },
      post(route, handler) {
        routes.set(`POST ${route}`, handler);
      },
      delete(route, handler) {
        routes.set(`DELETE ${route}`, handler);
      },
    };
  function express() {
    return app;
  }
  express.json =
    express.raw =
    express.static =
    express.urlencoded =
      () => () => {};
  class Pool {
    query(sql, params) {
      return query(sql, params);
    }
    connect() {
      if (options.connect) return options.connect();
      return { query: (sql, params) => query(sql, params), release() {} };
    }
  }
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const bootstrap = Math.max(
    source.lastIndexOf("\npool.query(fs.readFileSync"),
    source.lastIndexOf("\npool\n  .query(fs.readFileSync"),
  );
  assert.notEqual(bootstrap, -1, "server bootstrap marker should exist");
  const instrumented = `${source.slice(0, bootstrap)}\nglobalThis.__server={push,pushGuest,saveGuest,syncActiveGuestSettings,queuedGuestMutation,queuedTenantSettings,runAutomaticRounds,runGuestAutomaticRounds,message,rankingForViewer,unlockBadges,startRound,finishRound,skipRound,showScoreboard,hideScoreboard,dashboardLiveState,serializeActiveRound,hydrateActiveRound,persistActiveRound,restoreActiveRounds,sameOrigin,BADGES,rounds,rankCards,badgeAlerts,scoreboardStates,sourceConnections,streams,guestStreams,pushQueues,guestPushQueues,guestMessageQueues,tenantSettingsQueues};`;
  const context = vm.createContext({
    require: (id) =>
      id === "express"
        ? express
        : id === "pg"
          ? { Pool }
          : id === "./puzzles.json"
            ? require(path.join(root, "puzzles.json"))
            : id === "./dashboard-view"
              ? require(path.join(root, "dashboard-view.js"))
              : require(id),
    __dirname: root,
    Buffer,
    AbortController,
    URL,
    URLSearchParams,
    Intl,
    Date,
    Math,
    process,
    console,
    fetch: async () => {
      throw new Error("Not used in this test");
    },
    setTimeout: options.setTimeout || (() => 0),
    setInterval: () => 0,
    clearTimeout: () => {},
    clearInterval: () => {},
  });
  vm.runInContext(instrumented, context, { filename: "server.js" });
  return { ...context.__server, routes };
}

function packetCollector() {
  const packets = [];
  return {
    packets,
    response: {
      write(value) {
        packets.push(JSON.parse(value.slice(6)));
      },
    },
  };
}

test("tenant broadcasts are ordered and always hydrate the latest saved settings", async () => {
  let current = {
    id: "tenant-1",
    channel_name: "channel",
    display_name: "Channel",
    settings: { theme: theme("#53fc18"), game },
    jackpot: 250,
    next_round_at: 0,
    community_progress: 4,
    community_completions: 1,
    double_points_until: 0,
  };
  let tenantReads = 0,
    releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const server = loadServer(async (sql) => {
    if (sql.startsWith("SELECT * FROM tenants WHERE id=")) {
      const snapshot = clone(current),
        read = ++tenantReads;
      if (read === 1) await firstGate;
      return { rows: [snapshot] };
    }
    if (sql.includes("FROM score_events") || sql.includes("FROM scores"))
      return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const { packets, response } = packetCollector();
  server.streams.set(current.id, new Set([response]));

  const first = server.push({
    id: current.id,
    settings: { theme: theme("#111111") },
  });
  await new Promise((resolve) => setImmediate(resolve));
  current = {
    ...current,
    settings: { ...current.settings, theme: theme("#c45cff") },
  };
  const second = server.push({
    id: current.id,
    settings: { theme: theme("#222222") },
  });
  assert.equal(tenantReads, 1, "the second broadcast waits for the first");
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(
    packets.map((packet) => packet.theme.primary),
    ["#53fc18", "#c45cff"],
  );
  assert.ok(packets.at(-1).version);
  assert.equal(packets.at(-1).challenge.configured, true);
  assert.equal(server.pushQueues.size, 0);
});

test("new SSE connections join the ordered hydrated broadcast before their first packet", async () => {
  let current = {
    id: "tenant-sse",
    overlay_token: "overlay",
    channel_name: "channel",
    display_name: "Channel",
    settings: { theme: theme("#53fc18"), game },
    jackpot: 250,
    next_round_at: 0,
    community_progress: 0,
    community_completions: 0,
    double_points_until: 0,
  };
  const old = clone(current);
  let tenantReads = 0,
    releaseRead,
    close;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const server = loadServer(async (sql) => {
    if (sql.startsWith("SELECT * FROM tenants WHERE overlay_token="))
      return { rows: [clone(old)] };
    if (sql.startsWith("SELECT * FROM tenants WHERE id=")) {
      const snapshot = clone(current),
        read = ++tenantReads;
      if (read === 1) await readGate;
      return { rows: [snapshot] };
    }
    if (sql.startsWith("UPDATE tenants SET scoreboard_last_connected_at="))
      return { rows: [] };
    if (sql.includes("FROM score_events") || sql.includes("FROM scores"))
      return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const { packets, response } = packetCollector(),
    handler = server.routes.get("GET /o/:token/events");
  const request = {
      params: { token: "overlay" },
      query: { source: "scoreboard" },
      on(event, listener) {
        if (event === "close") close = listener;
      },
    },
    res = {
      ...response,
      set() {},
      sendStatus(status) {
        throw new Error(`Unexpected status ${status}`);
      },
    };

  const olderBroadcast = server.push({ id: old.id });
  await new Promise((resolve) => setImmediate(resolve));
  current = {
    ...current,
    settings: { ...current.settings, theme: theme("#ff5a36") },
  };
  const connected = handler(request, res);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    typeof close,
    "function",
    "close cleanup is registered before the queued state read completes",
  );
  releaseRead();
  await Promise.all([olderBroadcast, connected]);
  assert.equal(
    packets.length,
    1,
    "the connection is not exposed to the older in-flight broadcast",
  );
  assert.equal(packets[0].theme.primary, "#ff5a36");
  assert.equal(server.sourceConnections.get(old.id).scoreboard.has(res), true);
  close();
  assert.equal(server.streams.has(old.id), false);
  assert.equal(server.sourceConnections.has(old.id), false);
});

test("tenant setting mutations are serialized and rehydrate between saves", async () => {
  const tenant = { id: "tenant-settings" },
    reads = [];
  let releaseFirst;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const server = loadServer(async (sql) => {
    if (sql.startsWith("SELECT * FROM tenants WHERE id=")) {
      reads.push(reads.length + 1);
      return { rows: [tenant] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const first = server.queuedTenantSettings(tenant, async () => {
    await gate;
    return "game";
  });
  await new Promise((resolve) => setImmediate(resolve));
  const second = server.queuedTenantSettings(tenant, async () => "community");
  assert.equal(reads.length, 1);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["game", "community"]);
  assert.equal(reads.length, 2);
  assert.equal(server.tenantSettingsQueues.size, 0);
});

test("dashboard settings sync to active guests without replacing guest-owned state", async () => {
  let session = {
    id: "guest-1",
    tenant_id: "tenant-1",
    access_token: "token",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    revoked_at: null,
    settings: {
      theme: theme("#53fc18"),
      game,
      automatic: false,
      nextAutoAt: 1234,
      communityState: { progress: 7, completions: 2, doublePointsUntil: 0 },
      rotation: { recentIds: ["p1"] },
    },
    scores: { viewer: { username: "Viewer", points: 50, wins: 1 } },
  };
  const server = loadServer(async (sql, params) => {
    if (sql.startsWith("SELECT id,access_token FROM guest_sessions"))
      return { rows: [{ id: session.id, access_token: session.access_token }] };
    if (sql.startsWith("SELECT * FROM guest_sessions WHERE access_token="))
      return { rows: [clone(session)] };
    if (sql.startsWith("UPDATE guest_sessions SET settings=")) {
      const patch = JSON.parse(params[1]),
        target = params[2];
      session = { ...session, settings: { ...session.settings, ...patch } };
      if (target !== null && target !== undefined)
        session.settings.communityState = {
          ...session.settings.communityState,
          progress: Math.min(
            session.settings.communityState.progress,
            Math.max(0, target - 1),
          ),
        };
      return { rows: [clone(session)], rowCount: 1 };
    }
    if (sql.startsWith("SELECT * FROM guest_sessions WHERE id="))
      return { rows: [clone(session)] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const { packets, response } = packetCollector();
  server.guestStreams.set(session.id, new Set([response]));

  await server.syncActiveGuestSettings("tenant-1", { theme: theme("#4de8ff") });

  assert.equal(session.settings.theme.primary, "#4de8ff");
  assert.equal(session.settings.automatic, false);
  assert.equal(session.settings.nextAutoAt, 1234);
  assert.deepEqual(session.settings.communityState, {
    progress: 7,
    completions: 2,
    doublePointsUntil: 0,
  });
  assert.deepEqual(session.settings.rotation, { recentIds: ["p1"] });
  assert.equal(session.scores.viewer.points, 50);
  assert.equal(packets.at(-1).theme.primary, "#4de8ff");
  assert.ok(packets.at(-1).version);
  assert.equal(packets.at(-1).challenge.configured, true);
  assert.equal(server.guestPushQueues.size, 0);

  await server.syncActiveGuestSettings("tenant-1", {
    game: { ...game, communityTarget: 5 },
  });
  assert.equal(session.settings.communityState.progress, 4);
  assert.equal(session.settings.communityState.completions, 2);
  assert.equal(session.settings.communityState.doublePointsUntil, 0);
});

test("dashboard guest sync waits for an in-flight answer mutation", async () => {
  let session = {
    id: "guest-sync-queue",
    tenant_id: "tenant-1",
    access_token: "token",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    settings: {
      theme: theme("#53fc18"),
      game,
      communityState: { progress: 4, completions: 0, doublePointsUntil: 0 },
    },
    scores: {},
  };
  let updates = 0,
    releaseAnswer;
  const gate = new Promise((resolve) => {
    releaseAnswer = resolve;
  });
  const server = loadServer(async (sql, params) => {
    if (sql.startsWith("SELECT id,access_token FROM guest_sessions"))
      return { rows: [{ id: session.id, access_token: session.access_token }] };
    if (sql.startsWith("SELECT * FROM guest_sessions WHERE access_token="))
      return { rows: [clone(session)] };
    if (sql.startsWith("UPDATE guest_sessions SET settings=")) {
      updates++;
      session = {
        ...session,
        settings: { ...session.settings, ...JSON.parse(params[1]) },
      };
      return { rows: [clone(session)], rowCount: 1 };
    }
    if (sql.startsWith("SELECT * FROM guest_sessions WHERE id="))
      return { rows: [clone(session)] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const answer = server.queuedGuestMutation(session, async () => {
    await gate;
    return { ok: true };
  });
  await new Promise((resolve) => setImmediate(resolve));
  const sync = server.syncActiveGuestSettings("tenant-1", {
    game: { ...game, communityTarget: 50 },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates, 0);
  releaseAnswer();
  await Promise.all([answer, sync]);
  assert.equal(updates, 1);
  assert.equal(server.guestMessageQueues.size, 0);
});

test("guest score saves clamp progress against the game target locked in the database", async () => {
  const stored = {
    theme: theme("#53fc18"),
    game: { ...game, communityTarget: 5 },
    communityState: { progress: 4, completions: 2, doublePointsUntil: 0 },
  };
  const session = {
    id: "guest-save",
    settings: clone(stored),
    scores: { viewer: { username: "Viewer", points: 100, wins: 1 } },
  };
  const server = loadServer(async (sql, params) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.startsWith("SELECT settings FROM guest_sessions"))
      return { rows: [{ settings: clone(stored) }] };
    if (sql.startsWith("UPDATE guest_sessions SET settings=")) {
      const patch = JSON.parse(params[1]);
      assert.equal(patch.communityState.progress, 4);
      return {
        rows: [
          { settings: { ...stored, ...patch }, scores: clone(session.scores) },
        ],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  await server.saveGuest(session, {
    communityState: { progress: 20, completions: 2, doublePointsUntil: 0 },
  });
  assert.equal(session.settings.communityState.progress, 4);
});

test("guest mutations run in order so a reset cannot be overtaken by an answer", async () => {
  let reads = 0,
    releaseAnswer;
  const gate = new Promise((resolve) => {
    releaseAnswer = resolve;
  });
  const session = {
    id: "guest-queue",
    access_token: "token",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    settings: {},
    scores: {},
  };
  const server = loadServer(async (sql) => {
    if (sql.startsWith("SELECT * FROM guest_sessions WHERE access_token=")) {
      reads++;
      return { rows: [clone(session)] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const answer = server.queuedGuestMutation(session, async () => {
    await gate;
    return "answer";
  });
  await new Promise((resolve) => setImmediate(resolve));
  const reset = server.queuedGuestMutation(session, async () => "reset");
  assert.equal(reads, 1);
  releaseAnswer();
  assert.deepEqual(await Promise.all([answer, reset]), ["answer", "reset"]);
  assert.equal(reads, 2);
  assert.equal(server.guestMessageQueues.size, 0);
});

test("automatic guest claims require the session to still be enabled and due", async () => {
  let claimSql = "";
  const server = loadServer(async (sql) => {
    if (sql.startsWith("UPDATE guest_sessions SET settings=jsonb_set")) {
      claimSql = sql;
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  await server.runGuestAutomaticRounds();
  assert.match(claimSql, /settings->>'automatic'='true'/);
  assert.match(claimSql, /nextAutoAt/);
});

test("advertised viewer commands bypass answer handling and open an OBS card", async () => {
  const tenant = {
    id: "tenant-commands",
    channel_name: "channel",
    display_name: "Channel",
    settings: { theme: theme("#53fc18"), game },
    jackpot: 650,
    next_round_at: 0,
    community_progress: 0,
    community_completions: 0,
    double_points_until: 0,
  };
  let scoreWrites = 0;
  const server = loadServer(async (sql) => {
    if (sql.startsWith("SELECT * FROM tenants WHERE id="))
      return { rows: [clone(tenant)] };
    if (sql.includes("FROM score_events") || sql.includes("FROM scores"))
      return { rows: [] };
    if (sql.startsWith("INSERT INTO scores")) {
      scoreWrites++;
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  server.rounds.set(tenant.id, {
    id: "round-1",
    status: "open",
    category: "Film",
    difficulty: "easy",
    emojis: "🦁 👑",
    visibleEmojis: "🦁",
    startedAt: Date.now(),
    endsAt: Date.now() + 60000,
    answers: ["the lion king"],
    users: new Set(),
    attempts: new Map(),
    correctAnswers: [],
    revealStage: 0,
    revealCounts: [1, 2],
    revealParts: ["🦁", "👑"],
    nextRevealAt: null,
    gameConfig: game,
    isJackpot: false,
    winner: null,
  });

  await server.message(tenant, "Viewer", "!commands", "viewer-1");

  assert.equal(server.rankCards.get(tenant.id).mode, "commands");
  assert.equal(scoreWrites, 0);
  assert.equal(server.rounds.get(tenant.id).attempts.size, 0);
});

test("wrong answers persist accuracy and reset the all-time streak", async () => {
  const tenant = { id: "tenant-wrong", settings: { game }, jackpot: 250 };
  let wrongSql = "";
  const server = loadServer(async (sql) => {
    if (sql.startsWith("INSERT INTO scores")) {
      wrongSql = sql;
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE active_rounds")) return { rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  server.rounds.set(tenant.id, {
    status: "open",
    endsAt: Date.now() + 60000,
    answers: ["correct"],
    users: new Set(),
    attempts: new Map(),
    correctAnswers: [],
  });

  await server.message(tenant, "Viewer", "incorrect", "viewer-2");

  assert.match(wrongSql, /wrong=scores\.wrong\+1/);
  assert.match(wrongSql, /streak=0/);
});

test("period rankings use real streak facts and calculate the next position", async () => {
  let rankingSql = "";
  const server = loadServer(async (sql) => {
    rankingSql = sql;
    return {
      rows: [
        {
          username: "Viewer",
          points: 300,
          wins: 2,
          bestStreak: 4,
          correct: 3,
          wrong: 0,
          rank: 2,
          totalPlayers: 8,
          previousPoints: 349,
        },
      ],
    };
  });

  const result = await server.rankingForViewer(
    "tenant-rank",
    "kick:viewer",
    "Viewer",
    "daily",
  );

  assert.match(rankingSql, /date_trunc\('day',NOW\(\)\)/);
  assert.match(rankingSql, /MAX\(streak\)/);
  assert.equal(result.rank, 2);
  assert.equal(result.pointsToNext, 50);
});

test("badge inserts are tenant scoped and idempotent", async () => {
  const calls = [];
  const server = loadServer(async (sql, params) => {
    calls.push({ sql, params });
    return {
      rowCount: params[2] === "first_place" ? 1 : 0,
      rows: params[2] === "first_place" ? [{ badge_key: "first_place" }] : [],
    };
  });

  const badges = await server.unlockBadges(
    {
      query: (sql, params) =>
        Promise.resolve(
          calls.push({ sql, params }) && {
            rowCount: params[2] === "first_place" ? 1 : 0,
            rows: [],
          },
        ),
    },
    "tenant-a",
    "kick:1",
    "Viewer",
    ["first_place", "first_place", "perfect"],
  );

  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.params[0] === "tenant-a"));
  assert.equal(badges.map((badge) => badge.key).join(","), "first_place");
});

test("achievement schema records event facts and tenant-scoped badges", () => {
  const schema = fs.readFileSync(path.join(root, "schema.sql"), "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_badges/);
  assert.match(schema, /PRIMARY KEY\(tenant_id,user_key,badge_key\)/);
  for (const column of [
    "streak",
    "response_ms",
    "difficulty",
    "wrong_guesses",
    "jackpot_win",
  ])
    assert.match(
      schema,
      new RegExp(`score_events ADD COLUMN IF NOT EXISTS ${column}`),
    );
});

test("live controls can force a jackpot and stale round callbacks cannot touch a replacement", async () => {
  const tenant = {
    id: "tenant-live",
    channel_name: "channel",
    display_name: "Channel",
    settings: { theme: theme("#53fc18"), game },
    jackpot: 250,
    next_round_at: 0,
    community_progress: 0,
    community_completions: 0,
    double_points_until: 0,
  };
  const server = loadServer(async (sql, params) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.startsWith("UPDATE tenants SET settings=jsonb_set"))
      return {
        rows: [
          { settings: { ...tenant.settings, rotation: JSON.parse(params[1]) } },
        ],
      };
    if (sql.startsWith("UPDATE tenants SET next_round_at="))
      return { rows: [] };
    if (
      sql.startsWith("INSERT INTO active_rounds") ||
      sql.startsWith("DELETE FROM active_rounds")
    )
      return { rows: [] };
    if (sql.startsWith("SELECT * FROM tenants WHERE id="))
      return { rows: [clone(tenant)] };
    if (sql.includes("FROM score_events") || sql.includes("FROM scores"))
      return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  assert.equal(await server.startRound(tenant, { forceJackpot: true }), true);
  const first = server.rounds.get(tenant.id);
  assert.equal(first.isJackpot, true);
  assert.notEqual(first.id, first.puzzleId);
  assert.equal(await server.skipRound(tenant), true);
  assert.equal(await server.startRound(tenant), true);
  const replacement = server.rounds.get(tenant.id);

  assert.equal(await server.finishRound(tenant, first), false);
  assert.equal(server.rounds.get(tenant.id), replacement);
  assert.equal(replacement.status, "open");
});

test("scoreboard display state is independent from round lifecycle", async () => {
  const tenant = {
    id: "tenant-board",
    channel_name: "channel",
    display_name: "Channel",
    settings: { theme: theme("#53fc18"), game },
    jackpot: 250,
    next_round_at: 0,
    community_progress: 0,
    community_completions: 0,
    double_points_until: 0,
  };
  const server = loadServer(async (sql) => {
    if (sql.startsWith("SELECT * FROM tenants WHERE id="))
      return { rows: [clone(tenant)] };
    if (sql.includes("FROM score_events") || sql.includes("FROM scores"))
      return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  await server.showScoreboard(tenant, { period: "today", shownBy: "Streamer" });
  assert.equal(server.scoreboardStates.get(tenant.id).period, "daily");
  server.rounds.delete(tenant.id);
  assert.equal(server.scoreboardStates.get(tenant.id).visible, true);
  await server.hideScoreboard(tenant);
  assert.equal(server.scoreboardStates.has(tenant.id), false);
});

test("dashboard readiness reports real Kick and OBS connection health", async () => {
  const tenant = {
    id: "tenant-ready",
    channel_name: "channel",
    display_name: "Channel",
    settings: { theme: theme("#53fc18"), game },
    jackpot: 250,
    next_round_at: Date.now() + 60000,
    community_progress: 0,
    community_completions: 0,
    double_points_until: 0,
    kick_access_token: "encrypted",
    kick_token_expires_at: Date.now() + 3600000,
    kick_subscription_checked_at: Date.now(),
    overlay_last_connected_at: Date.now(),
    scoreboard_last_connected_at: Date.now(),
    last_webhook_at: Date.now(),
  };
  const server = loadServer(async (sql) => {
    if (sql.startsWith("SELECT * FROM tenants WHERE id="))
      return { rows: [clone(tenant)] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  server.sourceConnections.set(tenant.id, {
    overlay: new Set([{}]),
    scoreboard: new Set([{}, {}]),
  });

  const live = await server.dashboardLiveState(tenant);

  assert.equal(live.readiness.ready, true);
  assert.equal(live.sources.overlay.connections, 1);
  assert.equal(live.sources.scoreboard.connections, 2);
  assert.equal(live.kick.subscriptionHealthy, true);
  assert.ok(live.readiness.checks.every((check) => check.state === "ready"));
});

test("rotating OBS links requires confirmation and disconnects every old source", async () => {
  const tenant = {
    id: "tenant-rotate",
    overlay_token: "old-private-token",
    settings: { theme: theme("#53fc18"), game },
    overlay_last_connected_at: 123,
    scoreboard_last_connected_at: 456,
  };
  let updatedToken = "",
    ended = 0;
  const server = loadServer(async (sql, params) => {
    if (sql.startsWith("SELECT * FROM tenants WHERE session_token_hash="))
      return { rows: [clone(tenant)] };
    if (sql.startsWith("UPDATE tenants SET overlay_token=")) {
      updatedToken = params[1];
      return {
        rows: [
          {
            ...tenant,
            overlay_token: updatedToken,
            overlay_last_connected_at: 0,
            scoreboard_last_connected_at: 0,
          },
        ],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  server.streams.set(
    tenant.id,
    new Set([
      {
        end() {
          ended++;
        },
      },
      {
        end() {
          ended++;
        },
      },
    ]),
  );
  server.sourceConnections.set(tenant.id, {
    overlay: new Set([{}]),
    scoreboard: new Set([{}]),
  });
  const handler = server.routes.get("POST /dashboard/obs-sources/rotate");
  let statusCode = 200,
    body;
  const response = {
    status(value) {
      statusCode = value;
      return this;
    },
    set() {
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  await handler(
    {
      headers: { cookie: "emoji_session=session" },
      body: { confirmation: "no" },
    },
    response,
  );
  assert.equal(statusCode, 400);
  await handler(
    {
      headers: { cookie: "emoji_session=session" },
      body: { confirmation: "ROTATE" },
    },
    response,
  );

  assert.notEqual(updatedToken, tenant.overlay_token);
  assert.equal(ended, 2);
  assert.equal(server.streams.has(tenant.id), false);
  assert.equal(server.sourceConnections.has(tenant.id), false);
  assert.match(body.overlayUrl, new RegExp(updatedToken));
});

test("dashboard source markup is masked before JavaScript reveals it", () => {
  const { renderDashboard } = require(path.join(root, "dashboard-view.js")),
    html = renderDashboard({
      tenant: {
        channel_name: "channel",
        kick_access_token: "secret",
        overlay_token: "must-not-render",
      },
      theme: theme("#53fc18"),
      version: "test",
    });
  assert.match(html, /\/o\/••••••••••••\//);
  assert.match(html, /data-obs-source/);
  assert.doesNotMatch(html, /must-not-render/);
});

test("dashboard has one route and separate maintainable view modules", () => {
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8"),
    routes = source.match(/app\.get\("\/dashboard",/g) || [];
  assert.equal(routes.length, 1);
  assert.match(source, /renderDashboard/);
  for (const file of [
    "dashboard-view.js",
    "public/dashboard-live.js",
    "public/dashboard-sources.js",
    "public/dashboard-dirty.js",
  ])
    assert.equal(fs.existsSync(path.join(root, file)), true);
  assert.equal(
    fs.existsSync(path.join(root, ".github", "workflows", "ci.yml")),
    true,
  );
});

test("dashboard settings protect and unify unsaved changes", () => {
  const client = fs.readFileSync(
      path.join(root, "public", "dashboard-dirty.js"),
      "utf8",
    ),
    customizer = fs.readFileSync(
      path.join(root, "public", "dashboard-customizer.js"),
      "utf8",
    ),
    live = fs.readFileSync(
      path.join(root, "public", "dashboard-live.js"),
      "utf8",
    );
  assert.match(client, /beforeunload/);
  assert.match(client, /selector: "\.customizer"/);
  assert.match(client, /Save all changes/);
  assert.match(client, /discardAll/);
  assert.match(client, /nav-dirty-dot/);
  assert.match(client, /Dashboard settings/);
  assert.match(client, /initAttempts\+\+ < 25/);
  assert.match(customizer, /name="preset"/);
  assert.match(customizer, /dispatchEvent\(new Event\("input"/);
  assert.match(live, /if \(busy \|\| !current\) return/);
  assert.match(live, /emoji:live-state/);
});

test("automatic scheduler isolates tenant failures and prevents overlapping scans", async () => {
  const tenants = [
    { id: "a", channel_name: "A", settings: { game } },
    { id: "b", channel_name: "B", settings: { game } },
  ];
  let scans = 0,
    releaseScan;
  const gate = new Promise((resolve) => {
    releaseScan = resolve;
  });
  const server = loadServer(async (sql) => {
    if (sql.startsWith("SELECT * FROM tenants WHERE kick_access_token")) {
      scans++;
      if (scans === 1) await gate;
      return { rows: clone(tenants) };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const started = [];
  const starter = async (tenant) => {
    started.push(tenant.id);
    if (tenant.id === "a") throw new Error("tenant failure");
  };
  const first = server.runAutomaticRounds(starter),
    second = server.runAutomaticRounds(starter);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scans, 1);
  releaseScan();
  assert.deepEqual(await Promise.all([first, second]), [2, 2]);
  assert.equal(started.join(","), "a,b");
});

test("an answer waiting for a database connection blocks round finalization", async () => {
  let releaseConnect;
  const connectionGate = new Promise((resolve) => {
    releaseConnect = () =>
      resolve({
        query: (sql, params) => query(sql, params),
        release() {},
      });
  });
  const query = async (sql) => {
    if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
    if (sql.startsWith("SELECT state FROM active_rounds"))
      return {
        rowCount: 1,
        rows: [
          {
            state: {
              ...round,
              users: [...round.users],
              attempts: [...round.attempts],
            },
          },
        ],
      };
    if (sql.startsWith("UPDATE tenants SET community_progress="))
      return {
        rows: [
          {
            progress: 1,
            completions: 0,
            doublePointsUntil: 0,
            jackpot: 250,
          },
        ],
      };
    if (sql.startsWith("INSERT INTO scores("))
      return {
        rows: [
          {
            points: 175,
            wins: 1,
            streak: 1,
            best_streak: 1,
            correct: 1,
            wrong: 0,
          },
        ],
      };
    if (sql.startsWith("INSERT INTO score_events")) return { rowCount: 1 };
    if (sql.startsWith("SELECT COUNT(DISTINCT won_at::date)"))
      return { rows: [{ days: 1 }] };
    if (sql.startsWith("INSERT INTO user_badges")) return { rowCount: 0 };
    if (sql.startsWith("UPDATE active_rounds")) return { rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  };
  let deferredFinish = null;
  const server = loadServer(query, {
    connect: () => connectionGate,
    setTimeout: (callback) => {
      deferredFinish = callback;
      return 1;
    },
  });
  const tenant = {
      id: "tenant-answer-boundary",
      channel_name: "channel",
      settings: { game },
      community_progress: 0,
      community_completions: 0,
      double_points_until: 0,
      jackpot: 250,
    },
    round = {
      id: "11111111-1111-4111-8111-111111111112",
      puzzleId: "p1",
      status: "open",
      startedAt: Date.now() - 1000,
      endsAt: Date.now() + 1000,
      answers: ["lion king"],
      emojis: "🦁 👑",
      visibleEmojis: "🦁 👑",
      category: "Film",
      difficulty: "easy",
      correctAnswers: [],
      users: new Set(),
      attempts: new Map(),
      gameConfig: game,
      revealStage: 0,
      revealCounts: [2],
      revealParts: ["🦁", "👑"],
      rotation: { recentIds: [] },
      isJackpot: false,
    };
  server.rounds.set(tenant.id, round);

  const answer = server.message(tenant, "Viewer", "lion king", "1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(round.pendingAnswers, 1);
  assert.equal(await server.finishRound(tenant, round), false);
  assert.equal(round.status, "open");
  assert.equal(typeof deferredFinish, "function");

  releaseConnect();
  await answer;
  assert.equal(round.pendingAnswers, 0);
  assert.equal(round.correctAnswers.length, 1);
  assert.equal(round.winner.username, "Viewer");
});

test("a failed round finish reopens and schedules a bounded retry", async () => {
  let retry = null,
    retryDelay = 0;
  const server = loadServer(
    async (sql) => {
      throw new Error(`Unexpected query: ${sql}`);
    },
    {
      connect: async () => {
        throw new Error("database unavailable");
      },
      setTimeout: (callback, delay) => {
        retry = callback;
        retryDelay = delay;
        return 1;
      },
    },
  );
  const tenant = {
      id: "tenant-finish-retry",
      channel_name: "channel",
      settings: { game },
      jackpot: 250,
    },
    round = {
      id: "11111111-1111-4111-8111-111111111113",
      puzzleId: "p1",
      status: "open",
      startedAt: Date.now() - 60000,
      answers: ["lion king"],
      emojis: "🦁 👑",
      category: "Film",
      difficulty: "easy",
      correctAnswers: [],
      users: new Set(),
      attempts: new Map(),
      rotation: { recentIds: [] },
      isJackpot: false,
    };
  server.rounds.set(tenant.id, round);

  await assert.rejects(
    server.finishRound(tenant, round),
    /database unavailable/,
  );
  assert.equal(round.status, "open");
  assert.equal(round.finishRetries, 1);
  assert.equal(typeof retry, "function");
  assert.equal(retryDelay, 1000);
});

test("round finalization locks and uses the latest persisted answer state", async () => {
  const tenant = {
      id: "tenant-shared-finish",
      channel_name: "channel",
      settings: { game, rotation: { recentIds: [] } },
      jackpot: 250,
    },
    local = {
      id: "11111111-1111-4111-8111-111111111114",
      puzzleId: "p1",
      status: "open",
      startedAt: Date.now() - 2000,
      endsAt: Date.now() + 1000,
      answers: ["lion king"],
      emojis: "🦁 👑",
      visibleEmojis: "🦁 👑",
      category: "Film",
      difficulty: "easy",
      correctAnswers: [],
      users: new Set(),
      attempts: new Map(),
      rotation: { recentIds: [] },
      revealParts: ["🦁", "👑"],
      revealCounts: [2],
      revealTimes: [],
      revealStage: 0,
      nextRevealAt: null,
      isJackpot: false,
      winner: null,
    },
    canonical = {
      ...local,
      users: ["kick:1"],
      attempts: [],
      correctAnswers: [
        { username: "LatestWinner", points: 175, responseMs: 1200 },
      ],
      winner: { username: "LatestWinner", points: 175, responseMs: 1200 },
    };
  let historyParams = null,
    locked = false,
    identityDelete = false;
  const server = loadServer(async (sql, params) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.startsWith("SELECT state FROM active_rounds")) {
      locked = sql.includes("FOR UPDATE");
      return { rowCount: 1, rows: [{ state: canonical }] };
    }
    if (sql.startsWith("INSERT INTO round_history")) {
      historyParams = params;
      return { rowCount: 1, rows: [{ id: 1 }] };
    }
    if (sql.startsWith("UPDATE tenants SET settings=jsonb_set"))
      return { rows: [{ settings: tenant.settings }] };
    if (sql.startsWith("DELETE FROM active_rounds")) {
      identityDelete = sql.includes("round_id=$2");
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  server.rounds.set(tenant.id, local);

  assert.equal(await server.finishRound(tenant, local), true);
  assert.equal(locked, true);
  assert.equal(identityDelete, true);
  assert.equal(historyParams[7], "LatestWinner");
  assert.equal(historyParams[9], 1);
});

test("active rounds serialize, hydrate, and restore across a restart", async () => {
  const active = {
    id: "11111111-1111-4111-8111-111111111111",
    puzzleId: "p1",
    status: "open",
    startedAt: Date.now() - 1000,
    endsAt: Date.now() + 60000,
    emojis: "🦁 👑",
    visibleEmojis: "🦁",
    answers: ["lion king"],
    category: "Film",
    difficulty: "easy",
    correctAnswers: [],
    users: new Set(["kick:1"]),
    attempts: new Map([["kick:2", { wrong: 1, locked: 0 }]]),
    revealParts: ["🦁", "👑"],
    revealCounts: [1, 2],
    revealTimes: [30000],
    revealStage: 0,
    nextRevealAt: Date.now() + 29000,
    gameConfig: game,
    rotation: { recentIds: [] },
    isJackpot: false,
  };
  const tenant = {
    id: "tenant-restore",
    channel_name: "channel",
    display_name: "Channel",
    settings: { game },
    jackpot: 250,
    next_round_at: 0,
    community_progress: 0,
    community_completions: 0,
    double_points_until: 0,
    active_state: JSON.parse(
      JSON.stringify({
        ...active,
        users: [...active.users],
        attempts: [...active.attempts],
      }),
    ),
  };
  const server = loadServer(async (sql) => {
    if (sql.startsWith("SELECT tenants.*,active_rounds.state"))
      return { rows: [clone(tenant)] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const serialized = server.serializeActiveRound(active),
    hydrated = server.hydrateActiveRound(
      JSON.parse(JSON.stringify(serialized)),
    );
  assert.equal(hydrated.users.has("kick:1"), true);
  assert.equal(hydrated.attempts.get("kick:2").wrong, 1);
  assert.equal(await server.restoreActiveRounds(), 1);
  assert.equal(server.rounds.get(tenant.id).id, active.id);
  assert.equal(server.rounds.get(tenant.id).users.has("kick:1"), true);
});

test("private endpoints enforce same-origin writes and SSE connection caps", async () => {
  const server = loadServer(async (sql) => {
    if (sql.startsWith("SELECT * FROM tenants WHERE overlay_token="))
      return { rows: [{ id: "tenant-cap", overlay_token: "token" }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  let statusCode = 200,
    body,
    nextCalled = false;
  server.sameOrigin(
    { headers: { origin: "https://evil.example" } },
    {
      status(value) {
        statusCode = value;
        return this;
      },
      json(value) {
        body = value;
        return this;
      },
    },
    () => {
      nextCalled = true;
    },
  );
  assert.equal(statusCode, 403);
  assert.equal(nextCalled, false);
  assert.match(body.error, /Cross-site/);
  server.streams.set(
    "tenant-cap",
    new Set(Array.from({ length: 8 }, () => ({}))),
  );
  const handler = server.routes.get("GET /o/:token/events");
  await handler(
    { params: { token: "token" }, query: { source: "overlay" }, on() {} },
    {
      sendStatus(value) {
        statusCode = value;
        return this;
      },
    },
  );
  assert.equal(statusCode, 429);
  assert.equal(server.routes.has("GET /o/:token/test"), false);
});

test("resilience schema, heartbeats, headers, and rate limits remain wired", () => {
  const schema = fs.readFileSync(path.join(root, "schema.sql"), "utf8"),
    source = fs.readFileSync(path.join(root, "server.js"), "utf8"),
    pkg = require(path.join(root, "package.json"));
  assert.match(schema, /CREATE TABLE IF NOT EXISTS active_rounds/);
  assert.match(schema, /round_history_tenant_runtime_unique/);
  assert.match(schema, /webhook_messages_received_at/);
  assert.match(source, /: heartbeat/);
  assert.match(source, /X-Accel-Buffering/);
  assert.match(source, /restoreActiveRounds/);
  assert.match(source, /helmet\(/);
  assert.match(source, /rateLimit\(/);
  assert.match(source, /kick_user_id IS NULL AND channel_name/);
  assert.match(source, /cleanupWebhookMessages/);
  assert.match(source, /fetchWithTimeout/);
  assert.ok(pkg.dependencies.helmet && pkg.dependencies["express-rate-limit"]);
});

test("public site exposes complete SEO discovery and structured data", () => {
  const html = fs.readFileSync(path.join(root, "public", "about.html"), "utf8"),
    robots = fs.readFileSync(path.join(root, "public", "robots.txt"), "utf8"),
    sitemap = fs.readFileSync(path.join(root, "public", "sitemap.xml"), "utf8"),
    match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
  assert.ok(match);
  const structured = JSON.parse(match[1]),
    types = structured["@graph"].map((item) => item["@type"]);
  assert.ok(types.includes("SoftwareApplication"));
  assert.ok(types.includes("FAQPage"));
  const faq = structured["@graph"].find(
    (item) => item["@type"] === "FAQPage",
  ).mainEntity;
  assert.equal(faq.length, 4);
  for (const item of faq) {
    assert.ok(html.includes(item.name));
    assert.ok(html.includes(item.acceptedAnswer.text));
  }
  assert.match(robots, /Disallow: \/dashboard/);
  assert.match(robots, /Disallow: \/o\//);
  assert.match(
    robots,
    /Sitemap: https:\/\/emoji-decoder-beta\.onrender\.com\/sitemap\.xml/,
  );
  assert.match(
    sitemap,
    /<loc>https:\/\/emoji-decoder-beta\.onrender\.com\/about<\/loc>/,
  );
  assert.match(html, /og:image:width/);
  assert.match(html, /twitter:image/);
  assert.match(html, /emoji-decoder-social-v2\.jpg/);
});

test("optimized public artwork stays within the performance budget", () => {
  const assets = [
    "neon-arcade-studio-v2.webp",
    "emoji-decoder-social-v2.jpg",
    "emoji-decoder-panel-thumb-v2.webp",
  ];
  for (const asset of assets)
    assert.ok(
      fs.statSync(path.join(root, "public", "assets", asset)).size < 400000,
      `${asset} should stay below 400 KB`,
    );
  const aboutCss = fs.readFileSync(
      path.join(root, "public", "about.css"),
      "utf8",
    ),
    dashboardCss = fs.readFileSync(
      path.join(root, "public", "dashboard-shell.css"),
      "utf8",
    ),
    source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(aboutCss, /neon-arcade-studio-v2\.webp/);
  assert.match(dashboardCss, /neon-arcade-studio-v2\.webp/);
  assert.match(source, /max-age=31536000, immutable/);
});

function classList() {
  const values = new Set();
  return {
    add: (value) => values.add(value),
    remove: (value) => values.delete(value),
    contains: (value) => values.has(value),
    toggle(value, force) {
      const enabled = force === undefined ? !values.has(value) : Boolean(force);
      if (enabled) values.add(value);
      else values.delete(value);
      return enabled;
    },
  };
}

function element() {
  return {
    classList: classList(),
    style: {
      setProperty(name, value) {
        this[name] = value;
      },
    },
    textContent: "",
    innerHTML: "",
  };
}

function loadClient(file, selectors, pathname, nowRef) {
  const elements = Object.fromEntries(
      selectors.map((selector) => [selector, element()]),
    ),
    intervals = [],
    sources = [];
  let reloads = 0;
  class EventSource {
    constructor(url) {
      this.url = url;
      sources.push(this);
    }
  }
  const context = vm.createContext({
    location: {
      pathname,
      reload() {
        reloads++;
      },
    },
    document: { querySelector: (selector) => elements[selector] },
    window: { applyWidgetTheme() {} },
    EventSource,
    Date: { now: () => nowRef.value },
    setInterval: (callback) => {
      intervals.push(callback);
      return intervals.length;
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, "public", file), "utf8"),
    context,
    { filename: file },
  );
  return { elements, intervals, source: sources[0], reloads: () => reloads };
}

test("community goal renders while configured and hides cleanly after a boost expires", () => {
  const now = { value: 1000 },
    selectors = [
      "#stage",
      "#community",
      "#category",
      "#emojis",
      "#label",
      "#prompt",
      "#winner",
      "#highscores",
      "#board",
      "#timer",
      "#community-label",
      "#community-value",
      "#community-fill",
    ];
  const client = loadClient(
    "cloud-overlay.js",
    selectors,
    "/o/token/overlay.html",
    now,
  );
  const round = {
    status: "open",
    category: "Film",
    difficulty: "easy",
    emojis: "🎬",
    correctAnswers: [],
    clueCount: 1,
    totalClues: 1,
    nextRevealAt: null,
    clueMultiplier: 1,
    isJackpot: false,
    endsAt: 10000,
  };
  const base = {
    version: "build-1",
    theme: theme("#53fc18"),
    round,
    scores: [],
    jackpot: { points: 250 },
  };

  client.source.onmessage({
    data: JSON.stringify({
      ...base,
      challenge: {
        configured: true,
        enabled: true,
        progress: 7,
        target: 25,
        doublePointsUntil: 0,
      },
    }),
  });
  assert.equal(client.elements["#community"].classList.contains("off"), false);
  assert.equal(client.elements["#community-value"].textContent, "7 / 25");

  client.source.onmessage({
    data: JSON.stringify({
      ...base,
      challenge: {
        configured: false,
        enabled: true,
        progress: 0,
        target: 25,
        doublePointsUntil: 1500,
      },
    }),
  });
  assert.equal(client.elements["#community"].classList.contains("boost"), true);
  now.value = 1600;
  client.intervals[0]();
  assert.equal(client.elements["#community"].classList.contains("off"), true);
  assert.equal(
    client.elements["#community"].classList.contains("boost"),
    false,
  );
  client.source.onmessage({
    data: JSON.stringify({
      ...base,
      version: "build-2",
      challenge: {
        configured: true,
        progress: 0,
        target: 25,
        doublePointsUntil: 0,
      },
    }),
  });
  assert.equal(client.reloads(), 1);
});

test("scoreboard hides locally at zero and can reopen on the next server event", () => {
  const now = { value: 1000 },
    selectors = ["#scoreboard", "#title", "#caller", "#rows", "#timer"];
  const client = loadClient(
    "cloud-scoreboard.js",
    selectors,
    "/o/token/scoreboard.html",
    now,
  );
  const state = {
    version: "build-1",
    theme: theme("#53fc18"),
    round: null,
    scoreboard: {
      visible: true,
      period: "weekly",
      shownBy: "Viewer",
      hideAt: 1500,
    },
    scoreboardScores: [],
  };

  client.source.onmessage({ data: JSON.stringify(state) });
  assert.equal(
    client.elements["#scoreboard"].classList.contains("hidden"),
    false,
  );
  now.value = 1600;
  client.intervals[0]();
  assert.equal(client.elements["#timer"].textContent, 0);
  assert.equal(
    client.elements["#scoreboard"].classList.contains("hidden"),
    true,
  );

  client.source.onmessage({
    data: JSON.stringify({
      ...state,
      scoreboard: { ...state.scoreboard, hideAt: 3000 },
    }),
  });
  assert.equal(
    client.elements["#scoreboard"].classList.contains("hidden"),
    false,
  );
  client.source.onmessage({
    data: JSON.stringify({ ...state, version: "build-2" }),
  });
  assert.equal(client.reloads(), 1);
});
