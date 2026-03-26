module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing MINIMAX_API_KEY' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const { predictionId } = body || {};
  if (!predictionId) return res.status(400).json({ error: 'Missing predictionId' });

  try {
    const pollRes = await fetch('https://api.replicate.com/v1/predictions/' + predictionId, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    const data = await pollRes.json();
    return res.status(200).json({ status: data.status, output: data.output || null, error: data.error || null });
  } catch (e) {
    return res.status(500).json({ error: 'Poll failed', details: String(e?.message || e) });
  }
};
