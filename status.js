// Vercel function: merges the PUBLIC GTPS Cloud API (status, players, worlds, resources, uptime)
// with the extra stats your server script pushes to Upstash Redis (web_stats.lua).
// Env vars: GTPS_SERVER_ID (default 1475) + UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// (or KV_REST_API_URL / KV_REST_API_TOKEN, which Vercel's Upstash integration sets).
// It never fails as a whole: if one source is down, the other one is still returned.
const ID = process.env.GTPS_SERVER_ID || "1475";
const RURL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const getJSON = (url, opts) => fetch(url, opts).then((r) => r.json());

module.exports = async (req, res) => {
  try {
    const [pub, snap] = await Promise.all([
      getJSON(`https://api.gtps.cloud/api/server/public/${ID}`, {
        headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
      }).catch(() => null),
      RURL && RTOK
        ? getJSON(`${RURL}/get/gtps:${ID}:stats`, { headers: { Authorization: `Bearer ${RTOK}` } })
            .then((j) => (j.result ? JSON.parse(j.result) : {}))
            .catch(() => ({}))
        : {},
    ]);
    const now = Math.floor(Date.now() / 1000);
    const fresh = !!snap.updatedAt && now - snap.updatedAt < 300;
    const x = fresh ? snap : {};

    const out = {
      partial: !fresh, // true until web_stats.lua is sending data
      site: snap.site ?? null, // links/hosts edited in web_stats.lua
      event: x.event ?? null, roleQuest: x.roleQuest ?? null, topWorld: x.topWorld ?? null,
      gemMultiplier: x.gemMultiplier ?? null, xpMultiplier: x.xpMultiplier ?? null,
      registryItems: x.registryItems ?? null, registeredAccounts: x.registeredAccounts ?? null,
      worldHub: x.worldHub ?? null, worlds: x.worlds ?? null,
      richest: x.richest ?? [], players: x.players ?? [],
      achievements: x.achievements ?? [], achievementTotal: x.achievementTotal,
    };

    if (pub && pub.state) {
      const s = pub.state, t = pub.tier_info || {};
      const running = s.server_status === 1;
      Object.assign(out, {
        name: pub.name,
        serverId: pub.id ?? ID,
        running,
        playersOnline: s.players_online ?? 0,
        // real uptime: time since the server status last changed to "running"
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
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: "status function failed" });
  }
};
