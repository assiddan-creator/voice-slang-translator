module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (!replicateToken) {
    return res.status(500).json({ error: 'Missing REPLICATE_API_TOKEN env var' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (_) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }

  const { text, dialect } = body || {};
  if (!text) return res.status(400).json({ error: 'Missing text' });

  const DIALECT_VOICE_MAP = {
    'Jamaican Patois':    { voice_id: 'Casual_Guy', speed: 0.95, pitch: -1, emotion: 'happy' },
    'London Roadman':     { voice_id: 'Casual_Guy', speed: 1.05, pitch: -2, emotion: 'auto' },
    'New York Brooklyn':  { voice_id: 'Casual_Guy', speed: 1.1,  pitch: -1, emotion: 'auto' },
    'Paris Banlieue':     { voice_id: 'Casual_Guy', speed: 1.0,  pitch: -1, emotion: 'auto' },
    'Russian Street':     { voice_id: 'Casual_Guy', speed: 1.0,  pitch: -2, emotion: 'auto' },
    'Mumbai Hinglish':    { voice_id: 'Casual_Guy', speed: 1.1,  pitch: 0,  emotion: 'happy' },
    'Mexico City Barrio': { voice_id: 'Casual_Guy', speed: 1.05, pitch: -1, emotion: 'auto' },
    'Rio Favela':         { voice_id: 'Casual_Guy', speed: 1.05, pitch: -1, emotion: 'auto' },
    'Tokyo Gyaru':        { voice_id: 'Cheerful_Lady', speed: 1.1, pitch: 2, emotion: 'happy' },
  };

  const voiceConfig = DIALECT_VOICE_MAP[dialect] || { voice_id: 'Casual_Guy', speed: 1.0, pitch: 0, emotion: 'auto' };

  try {
    const startRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${replicateToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait'
      },
      body: JSON.stringify({
        version: '29657f664032844b8f800486164cf26acb2507288e348133e78ae871a43211d0',
        input: {
          text,
          voice_id: voiceConfig.voice_id,
          speed: voiceConfig.speed,
          pitch: voiceConfig.pitch,
          volume: 1.0,
          emotion: voiceConfig.emotion
        }
      })
    });

    const prediction = await startRes.json();

    if (!startRes.ok) {
      return res.status(502).json({ error: 'Replicate error', details: prediction });
    }

    const audioUrl = prediction?.output;
    if (!audioUrl) {
      return res.status(502).json({ error: 'No audio output from Replicate', prediction });
    }

    return res.status(200).json({ audioUrl });
  } catch (e) {
    return res.status(500).json({ error: 'TTS request failed', details: String(e?.message || e) });
  }
};

