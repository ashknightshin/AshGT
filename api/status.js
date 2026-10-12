// Vercel serverless function: GET /api/status
// Merges the PUBLIC gtps.cloud API (status, players, worlds, resources, uptime, IP)
// with the extra stats pushed by web_stats.lua to Upstash Redis.
//
// Env vars (Vercel -> Project -> Settings -> Environment Variables):
//   GTPS_SERVER_ID                 default "1475"
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//   (or KV_REST_API_URL / KV_REST_API_TOKEN, set by Vercel's Upstash integration)
// Use a READ-ONLY Upstash token here. It never fails as a whole:
// if one source is down the other is still returned.

const ID = (process.env.GTPS_SERVER_ID || "1475").trim();
const RURL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").replace(/\/+$/, "");
const RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const getJSON = async (url, opts = {}, ms = 6000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: c.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
};

// Finds the game port in the main API answer (field names differ, so several are tried,
// including "ip:port" strings). Returns a string like "18575" or null.
const portOf = (p) => {
  const li = p.login_page_info || {};
  for (const v of [p.port, p.server_port, p.game_port, li.port, li.server_port]) {
    if (/^\d{2,5}$/.test(String(v ?? ""))) return String(v);
  }
  for (const v of [p.ip, p.server_ip, p.address, li.ip, li.server_ip]) {
    const m = String(v ?? "").match(/:(\d{2,5})$/);
    if (m) return m[1];
  }
  return null;
};

module.exports = async (req, res) => {
  try {
    const H = { headers: { "user-agent": "Mozilla/5.0", accept: "application/json" } };
    const snapP =
      RURL && RTOK
        ? getJSON(`${RURL}/get/gtps:${encodeURIComponent(ID)}:stats`, {
            headers: { Authorization: `Bearer ${RTOK}` },
          })
            .then((j) => (j && j.result ? JSON.parse(j.result) : {}))
            .catch(() => ({}))
        : Promise.resolve({});

    // 1) Main API -> name, id, IP, dedicated IP, port
    const pub = await getJSON(`https://api.gtps.cloud/api/server/public/${encodeURIComponent(ID)}`, H).catch(() => null);

    // 2) Port is detected from the main API (override with GTPS_PORT if it cannot be found)
    const port = (pub && portOf(pub)) || process.env.GTPS_PORT || null;

    // 3) Per-port API -> status + worlds
    const [gStatus, gWorlds] = port
      ? await Promise.all(
          ["status", "worlds"].map((k) =>
            getJSON(`https://api.gtps.cloud/g-api/${port}/${k}`, H).catch(() => null)
          )
        )
      : [null, null];
    const snap = await snapP;

    // Debug: /api/status?debug=1 shows the raw answers of the three gtps.cloud endpoints
    if (req.query && req.query.debug) {
      res.setHeader("Cache-Control", "no-store");
      const upd = snap && snap.updatedAt;
      return res.status(200).json({
        id: ID,
        port,
        redis: {
          configured: !!(RURL && RTOK), // false = Vercel env vars missing (or no redeploy after adding them)
          keyFound: !!upd,              // false = web_stats.lua never wrote data (or wrong server id/token)
          ageSeconds: upd ? Math.floor(Date.now() / 1000) - upd : null, // must be under 300
        },
        pub,
        gStatus,
        gWorlds,
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const s0 = snap || {};
    const fresh = !!s0.updatedAt && now - s0.updatedAt < 300;
    const x = fresh ? s0 : {};

    const out = {
      partial: !fresh, // true until web_stats.lua is sending fresh data
      site: s0.site ?? null, // links/hosts edited in web_stats.lua
      serverId: ID,
      port,
      gapi: { status: gStatus ?? null, worlds: gWorlds ?? null },
      event: x.event ?? null,
      roleQuest: x.roleQuest ?? null,
      topWorld: x.topWorld ?? null,
      gemMultiplier: x.gemMultiplier ?? null,
      xpMultiplier: x.xpMultiplier ?? null,
      registryItems: x.registryItems ?? null,
      registeredAccounts: x.registeredAccounts ?? null,
      worldHub: x.worldHub ?? null,
      worlds: x.worlds ?? null,
      richest: x.richest ?? [],
      players: x.players ?? [],
      achievements: x.achievements ?? [],
      achievementTotal: x.achievementTotal ?? null,
    };

    if (pub && pub.state) {
      const s = pub.state;
      const t = pub.tier_info || {};
      const running = s.server_status === 1;
      Object.assign(out, {
        name: pub.name,
        serverId: pub.id ?? ID,
        running,
        playersOnline: s.players_online ?? 0,
        uptimeSeconds: running ? Math.max(0, now - (s.server_status_changed || now)) : 0,
        activeWorlds: s.active_worlds ?? 0,
        dedicatedIp: (pub.login_page_info || {}).dedicated_ip ?? null,
        system: {
          memUsed: s.memory_usage ?? 0, memMax: t.max_memory_usage || 1,
          cpu: s.cpu_usage ?? 0, cpuMax: t.max_cpu_usage || 1,
          storageUsed: s.storage_usage ?? 0, storageMax: t.max_storage_usage || 1,
        },
      });
    }

    res.setHeader("Cache-Control", "public, s-maxage=10, stale-while-revalidate=30");
    res.status(200).json(out);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "status function failed" });
  }
};
