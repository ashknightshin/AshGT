// Vercel function: merges the PUBLIC GTPS Cloud API (status, players, worlds, resources, uptime)
// with the extra stats your server script pushes to Upstash Redis (web_stats.lua).
// Env vars: GTPS_SERVER_ID (default 1475) + UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// (or KV_REST_API_URL / KV_REST_API_TOKEN, which Vercel's Upstash integration sets).
const ID = process.env.GTPS_SERVER_ID || "1475";
const RURL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

module.exports = async (req, res) => {
  try {
    const [pub, snap] = await Promise.all([
      fetch(`https://api.gtps.cloud/api/server/public/${ID}`).then((r) => r.json()),
      RURL && RTOK
        ? fetch(`${RURL}/get/gtps:${ID}:stats`, { headers: { Authorization: `Bearer ${RTOK}` } })
            .then((r) => r.json())
            .then((j) => (j.result ? JSON.parse(j.result) : {}))
            .catch(() => ({}))
        : {},
    ]);
    const s = pub.state || {}, t = pub.tier_info || {};
    const now = Math.floor(Date.now() / 1000);
    const running = s.server_status === 1;
    const fresh = !!snap.updatedAt && now - snap.updatedAt < 120;
    const x = fresh ? snap : {};
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
    res.status(200).json({
      name: pub.name,
      running,
      partial: !fresh, // true until web_stats.lua is sending data
      playersOnline: s.players_online ?? 0,
      uptimeSeconds: running ? Math.max(0, now - (s.server_status_changed || now)) : 0,
      activeWorlds: s.active_worlds ?? 0,
      system: {
        memUsed: s.memory_usage ?? 0, memMax: t.max_memory_usage || 1,
        cpu: s.cpu_usage ?? 0, cpuMax: t.max_cpu_usage || 1,
        storageUsed: s.storage_usage ?? 0, storageMax: t.max_storage_usage || 1,
      },
      event: x.event ?? null, roleQuest: x.roleQuest ?? null, topWorld: x.topWorld ?? null,
      gemMultiplier: x.gemMultiplier ?? null, xpMultiplier: x.xpMultiplier ?? null,
      registryItems: x.registryItems ?? null, registeredAccounts: x.registeredAccounts ?? null,
      worldHub: x.worldHub ?? null,
      richest: x.richest ?? [], players: x.players ?? [],
      achievements: x.achievements ?? [], achievementTotal: x.achievementTotal,
    });
  } catch (e) {
    res.status(502).json({ error: "GTPS API unreachable" });
  }
};
