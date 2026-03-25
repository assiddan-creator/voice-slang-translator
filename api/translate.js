const GEMINI_MODEL = 'gemini-2.5-flash';

function buildPrompt({
  text,
  currentLang,
  translationMode,
  slangLocation,
  slangLevel,
  isPremiumSelected,
  context,
  previousMessage
}) {
  const INTENSITY_INSTRUCTIONS = {
    1: 'Use mostly standard language with just a tiny hint of local flavor. Max 1-2 very mild slang words. Keep it readable.',
    2: 'Authentic casual street talk. Natural mix of standard language and popular local slang.',
    3: 'Heavy thick street slang. Deep local terminology, authentic street grammar, full immersion.'
  };

  const CONTEXT_INSTRUCTIONS = {
    'dm':      'This is a casual text message between close friends.',
    'post':    'This is a social media post meant to be public and punchy.',
    'reply':   'This is a reply in an argument or comeback situation — keep it sharp.',
    'hype':    'This is a hype message — energetic, loud, encouraging.',
    'flirt':   'This is a flirtatious message — smooth, charming, confident.',
    'default': 'This is a casual message between friends.'
  };

  const intensityPrompt = INTENSITY_INSTRUCTIONS[slangLevel] || INTENSITY_INSTRUCTIONS[2];
  const contextPrompt = CONTEXT_INSTRUCTIONS[context] || CONTEXT_INSTRUCTIONS['default'];
  const customLocation = slangLocation ? String(slangLocation).trim() : '';

  const slangRequested =
    translationMode === 'slang' || !!isPremiumSelected || customLocation !== '';

  const antiLeakageRule =
    `ANTI-LEAKAGE: Never use Hebrew or Israeli slang transliterated into Latin characters (sababa, yalla, achi, magniv, etc.) unless the target language is explicitly Hebrew. All slang must belong exclusively to the target language and location.`;

  const lengthRule =
    `LENGTH RULE: Keep the output roughly the same length as the input. Do not expand, explain, or add information that was not in the original text.`;

  const noAIRule =
    `AUTHENTICITY RULE: Write exactly like a real person from that location would text a friend. No formal structure. No complete sentences if the original was not complete. No filler words. Raw and human.`;

  const formattingRule =
    `\n\nOUTPUT FORMAT — follow this exactly and nothing else:\n` +
    `<rewritten text>\n` +
    `|||\n` +
    `<dictionary: 1-3 key slang words used, format: Word - Meaning>\n` +
    `Do not add any other text, explanation, or preamble.`;

  if (!slangRequested) {
    return {
      prompt:
        `You are a professional translator.\n` +
        `Translate the following into standard, formal, dictionary-accurate ${currentLang}.\n` +
        `Return ONLY the translated text. No explanations.\n` +
        `${antiLeakageRule}\n` +
        `${lengthRule}\n` +
        `Text: '''${text}'''`,
      slangRequested: false
    };
  }

  const locationLine = customLocation
    ? `You are a 22-year-old from ${customLocation} who speaks ${currentLang}. You grew up there, you text your friends every day, and you write exactly like people from your neighborhood.`
    : `You are a 22-year-old native ${currentLang} speaker from the streets. You grew up there, you text your friends every day, and you write exactly like people from your city.`;

  const previousLine = previousMessage
    ? `\nFor consistency, the previous message in this conversation was rewritten as: "${previousMessage}". Keep the same voice and energy.`
    : '';

  const isRussianLang =
    typeof currentLang === 'string' && currentLang.toLowerCase().includes('russian');

  const russianRule = isRussianLang
    ? `
CRITICAL RULES FOR RUSSIAN — read carefully:

1. GRAMMAR IS NON-NEGOTIABLE: Every sentence must be grammatically correct in Russian. Slang words must fit naturally into correct Russian sentence structure. Never force a slang word into a position where it breaks grammar. For example — "торчим" requires a location or reason, never a direct object like "тебя". Wrong: "мы тут торчим тебя". Correct: "мы тут торчим без тебя" or "мы тут зависаем".

2. USE ONLY CURRENT SLANG: Modern youth slang used right now in Moscow and St. Petersburg on Telegram and VK. Examples of current real slang: бро, чё, норм, кек, лол, зависать, чилить, агонь, жиза, краш, кринж, рофл, мб (может быть), имхо, ору, пон (понял). Do NOT use: outdated 90s criminal slang (пацан, братан in a serious way, базар, конкретно).

3. NATURAL RHYTHM: Russians text in short punchy sentences. They drop pronouns when obvious. They use abbreviations. Sound like a real 20-year-old texting on their phone right now — not a translation.

4. SELF-CHECK BEFORE OUTPUT: Before returning the result, mentally re-read it as a native Russian speaker. If any sentence sounds unnatural or grammatically broken — fix it.`
    : '';

  return {
    prompt:
      `${locationLine}${previousLine}\n\n` +
      `Context: ${contextPrompt}\n` +
      `Intensity: ${intensityPrompt}\n` +
      `${antiLeakageRule}\n` +
      `${lengthRule}\n` +
      `${noAIRule}` +
      `${russianRule}\n\n` +
      `Rewrite the following text the way YOU would actually send it:\n` +
      `'''${text}'''` +
      `${formattingRule}`,
    slangRequested: true
  };
}

module.exports = async function handler(req, res) {
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
    try { body = JSON.parse(body); }
    catch (_) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }

  const {
    text,
    currentLang,
    translationMode,
    slangLocation,
    slangLevel,
    isPremiumSelected,
    context,
    previousMessage
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
    isPremiumSelected: !!isPremiumSelected,
    context: context || 'default',
    previousMessage: previousMessage || null
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
          temperature: slangRequested ? 0.7 : 0.2,
          maxOutputTokens: 1024
        }
      })
    });

    const data = await geminiRes.json();
    const fullText = (
      data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    ).trim();

    if (!fullText) {
      return res.status(502).json({ error: 'Gemini returned no candidates', data });
    }

    return res.status(200).json({ fullText });
  } catch (e) {
    return res.status(500).json({ error: 'Gemini request failed', details: String(e?.message || e) });
  }
};