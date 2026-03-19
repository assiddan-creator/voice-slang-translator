const GEMINI_MODEL = 'gemini-2.5-flash';

function buildPrompt({
  text,
  currentLang,
  translationMode,
  slangLocation,
  slangLevel,
  isPremiumSelected
}) {
  const INTENSITY_INSTRUCTIONS = {
    1: 'Light intensity: Use mostly standard language with just a tiny hint of local flavor. Maximum 1 or 2 very common, mild slang words. Keep it highly readable and polite.',
    2: 'Medium intensity: Authentic, casual street talk. A natural mix of standard language and popular local slang.',
    3: 'Hardcore intensity: Heavy, thick street slang. Use deep local terminology, expressions, and authentic street grammar.'
  };

  const intensityPrompt =
    INTENSITY_INSTRUCTIONS[slangLevel] || INTENSITY_INSTRUCTIONS[2];

  const customLocation = slangLocation ? String(slangLocation).trim() : '';

  // Match voice.js logic: treat as slang whenever user picked slang mode,
  // or premium slang, or typed a custom location.
  const slangRequested =
    translationMode === 'slang' || !!isPremiumSelected || customLocation !== '';

  const formattingRule =
    '\n\nCRITICAL FORMATTING RULE: You MUST return the output in exactly this format and nothing else:\n' +
    '<Your Slang Translation>\n' +
    '|||\n' +
    '<A short dictionary of 1-3 key slang words used, formatted as: Word - Meaning>\n' +
    'Do not include any other text, explanations, or system instructions.';
  const antiLeakageRule =
    "CRITICAL ANTI-LEAKAGE RULE: You MUST NOT use any Hebrew or Israeli slang transliterated into English/Latin characters (e.g., 'sababa', 'magniv', 'yalla', 'achi', etc.) unless the requested target language is explicitly Hebrew. The slang used MUST strictly and exclusively belong to the requested target language and location.";

  // Standard vs Slang prompt structure
  if (!slangRequested) {
    return {
      prompt: `You are a professional translator. Translate or rephrase the following text into standard, formal, dictionary-accurate ${currentLang}. DO NOT use any slang. Return ONLY the final text. No conversational filler or explanations.\n${antiLeakageRule}\nText: '''${text}'''`,
      slangRequested: false
    };
  }

  const base = customLocation
    ? `You are an expert in local street culture. Translate the text into ${currentLang}, but specifically inject the authentic street slang and local dialect of ${customLocation}. Slang intensity instructions: ${intensityPrompt}.`
    : `You are an expert in local street culture. Translate the text into authentic street slang specifically for ${currentLang}. Slang intensity instructions: ${intensityPrompt}.`;

  const isRussianLang =
    currentLang === 'Russian' ||
    currentLang === 'Russian Street' ||
    (typeof currentLang === 'string' && currentLang.toLowerCase().includes('russian'));

  const russianCriticalRule =
    'CRITICAL FOR RUSSIAN: Use highly authentic, modern youth street slang (current Moscow/St. Petersburg urban vibes). Do NOT use outdated 90s jargon, formal words, or literal translations. The output must sound perfectly natural for a modern native speaker texting a close friend.';

  // Mirror voice.js injection condition: only when translationMode is slang.
  const russianRuleInjection =
    translationMode === 'slang' && isRussianLang ? `\n${russianCriticalRule}` : '';

  return {
    prompt: `${base}${russianRuleInjection}\n${antiLeakageRule}\nText: '''${text}'''${formattingRule}`,
    slangRequested: true
  };
}

module.exports = async function handler(req, res) {
  // Basic CORS for extension -> Vercel calls.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY env var' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }

  const {
    text,
    currentLang,
    translationMode,
    slangLocation,
    slangLevel,
    isPremiumSelected
  } = body || {};

  if (!text || !currentLang) {
    return res.status(400).json({ error: 'Missing required fields: text, currentLang' });
  }

  const { prompt, slangRequested } = buildPrompt({
    text: String(text),
    currentLang: String(currentLang),
    translationMode: translationMode === 'slang' ? 'slang' : 'standard',
    slangLocation,
    slangLevel: parseInt(slangLevel, 10) || 2,
    isPremiumSelected: !!isPremiumSelected
  });

  const GEMINI_URL =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

  try {
    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: slangRequested ? 1.0 : 0.2,
          maxOutputTokens: 2048
        }
      })
    });

    const data = await geminiRes.json();
    const fullText = (
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      ''
    ).trim();

    // Return the raw model output (already in strict "translation ||| dictionary" format).
    // Client will parse via `split('|||')`.
    if (!fullText) {
      return res.status(502).json({ error: 'Gemini returned no candidates', data });
    }

    return res.status(200).json({ fullText });
  } catch (e) {
    return res.status(500).json({ error: 'Gemini request failed', details: String(e?.message || e) });
  }
};

