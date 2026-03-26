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

  const { text, dialect } = body || {};
  if (!text) return res.status(400).json({ error: 'Missing text' });

  const VOICE_MAP = {
    'New York Brooklyn':   { voice_id: 'Casual_Guy',   speed: 1.05, pitch: 0,  emotion: 'happy' },
    'London Roadman':      { voice_id: 'Casual_Guy',   speed: 1.05, pitch: -1, emotion: 'neutral' },
    'Jamaican Patois':     { voice_id: 'Casual_Guy',   speed: 1.0,  pitch: -1, emotion: 'happy' },
    'Tokyo Gyaru':         { voice_id: 'Sweet_Girl',   speed: 1.1,  pitch: 2,  emotion: 'happy' },
    'Paris Banlieue':      { voice_id: 'Casual_Guy',   speed: 1.05, pitch: -1, emotion: 'neutral' },
    'Russian Street':      { voice_id: 'Casual_Guy',   speed: 1.0,  pitch: -2, emotion: 'neutral' },
    'Mumbai Hinglish':     { voice_id: 'Casual_Guy',   speed: 1.1,  pitch: 0,  emotion: 'happy' },
    'Mexico City Barrio':  { voice_id: 'Casual_Guy',   speed: 1.05, pitch: -1, emotion: 'neutral' },
    'Rio Favela':          { voice_id: 'Casual_Guy',   speed: 1.05, pitch: -1, emotion: 'happy' }
  };

  let voiceConfig = null;
  for (const [key, cfg] of Object.entries(VOICE_MAP)) {
    if ((dialect || '').includes(key)) { voiceConfig = cfg; break; }
  }
  if (!voiceConfig) voiceConfig = { voice_id: 'Casual_Guy', speed: 1.0, pitch: 0, emotion: 'neutral' };

  try {
    const minimaxRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: '29657f664032844b8f800486164cf26acb2507288e348133e78ae871a43211d0',
        input: {
          text,
          voice_id: voiceConfig.voice_id,
          speed: voiceConfig.speed,
          pitch: voiceConfig.pitch,
          emotion: voiceConfig.emotion,
          volume: 1.0
        }
      })
    });

    const prediction = await minimaxRes.json();

    if (!minimaxRes.ok || prediction.error) {
      return res.status(502).json({ error: prediction.error || 'Replicate request failed' });
    }

    return res.status(200).json({ predictionId: prediction.id, status: prediction.status, output: prediction.output || null });
  } catch (e) {
    return res.status(500).json({ error: 'TTS request failed', details: String(e?.message || e) });
  }
};

