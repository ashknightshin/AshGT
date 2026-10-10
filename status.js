// Vercel serverless function: proxies your GTPS status endpoint so the secret key stays private.
// Set GTPS_API_URL (and optionally GTPS_API_KEY) in Vercel -> Settings -> Environment Variables.
module.exports = async (req, res) => {
  const base = process.env.GTPS_API_URL;
  if (!base) return res.status(503).json({ error: "GTPS_API_URL is not set" });
  try {
    const r = await fetch(base.replace(/\/$/, "") + "/status", {
      headers: { "x-api-key": process.env.GTPS_API_KEY || "" },
    });
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: "GTPS server unreachable" });
  }
};
