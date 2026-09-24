export default async function handler(req, res) {
  // Izinkan akses dari mana saja (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Tangkap parameter 'endpoint' yang dikirim oleh website (misal: leaderboard atau worlds)
  const { endpoint } = req.query;

  if (!endpoint || (endpoint !== 'leaderboard' && endpoint !== 'worlds')) {
    return res.status(400).json({ error: 'Invalid endpoint specified' });
  }

  const targetUrl = `https://api.gtps.cloud/g-api/17414/${endpoint}`;

  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch from server: ${response.statusText}`);
    }
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}