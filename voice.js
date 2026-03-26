let recognition = null;
let isRecording = false;
let hebrewTranscript = '';
let displayedText = '';
let translationMode = 'standard'; // 'standard' | 'slang'
let lastTranslatedText = ''; // זוכר את התרגום הקודם לשמירת קול עקבי
let premiumVoiceEnabled = false;
let googleCloudApiKey = '';
let premiumAudioPlayer = null;

function setTtsEngineStatus(state) {
  const ledEl = document.getElementById('ttsEngineLed');
  const textEl = document.getElementById('ttsEngineText');
  if (!ledEl || !textEl) return;

  ledEl.classList.remove('waiting', 'google', 'fallback');
  if (state === 'google') {
    ledEl.classList.add('google');
    textEl.textContent = 'Engine: Google Premium';
  } else if (state === 'fallback') {
    ledEl.classList.add('fallback');
    textEl.textContent = 'Engine: Native Fallback';
  } else {
    ledEl.classList.add('waiting');
    textEl.textContent = 'Engine: Waiting';
  }
}

// --- Wire up buttons ---
document.getElementById('micBtn').addEventListener('click', toggleRecording);
document.getElementById('pasteBtn').addEventListener('click', pasteToPage);
document.getElementById('copyBtn').addEventListener('click', copyText);
document.getElementById('clearBtn').addEventListener('click', clearText);
document.getElementById('closeBtn').addEventListener('click', () => window.close());

// Native text-to-speech for the translated output
const ttsBtnEl = document.getElementById('ttsPlayBtn');
if (ttsBtnEl) {
  ttsBtnEl.addEventListener('click', async () => {
    const fallbackOutputEl = document.getElementById('output');
    const rawOutputText = (fallbackOutputEl?.textContent || '').trim();
    const textToSpeak =
      (displayedText && displayedText.trim()) ? displayedText.trim() : rawOutputText;

    if (!textToSpeak || textToSpeak.includes('Your text will appear here')) {
      showToast('No translation to play');
      return;
    }

    await speakTranslatedText(textToSpeak);
  });
}

// --- View switching: Standard vs Duo ---
let viewMode = 'standard'; // 'standard' | 'duo'
let duoActiveTurn = null; // 'my' | 'their' | null

function setViewMode(mode) {
  viewMode = mode;
  const duoControls = document.getElementById('duoControls');
  const micArea = document.querySelector('.mic-area');
  const inputWrap = document.querySelector('.input-text-wrap');

  const duoShow = mode === 'duo';

  if (duoControls) duoControls.style.display = duoShow ? 'block' : 'none';
  if (micArea) micArea.style.display = duoShow ? 'none' : 'flex';
  if (inputWrap) inputWrap.style.display = duoShow ? 'none' : 'flex';

  const tabStandard = document.getElementById('tabStandard');
  const tabDuo = document.getElementById('tabDuo');
  if (tabStandard) tabStandard.classList.toggle('active', mode === 'standard');
  if (tabDuo) tabDuo.classList.toggle('active', mode === 'duo');

  // Stop any active listening when switching views
  try {
    if (isRecording) stopRecording();
  } catch (_) {}
  try {
    if (duoActiveTurn) stopDuoRecording();
  } catch (_) {}
}

const tabStandardBtn = document.getElementById('tabStandard');
const tabDuoBtn = document.getElementById('tabDuo');
if (tabStandardBtn && tabDuoBtn) {
  tabStandardBtn.addEventListener('click', () => setViewMode('standard'));
  tabDuoBtn.addEventListener('click', () => setViewMode('duo'));
}

// Duo buttons
const duoMyTurnBtn = document.getElementById('duoMyTurnBtn');
const duoTheirTurnBtn = document.getElementById('duoTheirTurnBtn');
if (duoMyTurnBtn) {
  duoMyTurnBtn.addEventListener('click', () => {
    if (viewMode !== 'duo') return;
    if (duoActiveTurn === 'my') stopDuoRecording();
    else startDuoRecording('my');
  });
}
if (duoTheirTurnBtn) {
  duoTheirTurnBtn.addEventListener('click', () => {
    if (viewMode !== 'duo') return;
    if (duoActiveTurn === 'their') stopDuoRecording();
    else startDuoRecording('their');
  });
}

// Default view
setViewMode('standard');
setTtsEngineStatus('waiting');

// Manual translate: paste text and click to translate
document.getElementById('manualTranslateBtn').addEventListener('click', async function () {
  const text = document.getElementById('inputText').value.trim();
  if (!text) { showToast('No text to translate'); return; }
  hebrewTranscript = text;
  displayedText = await translate(text);
  setOutput(displayedText);
});

// Output language dropdown: update label and re-translate if we have transcript
document.getElementById('outputLang').addEventListener('change', async function () {
  const sel = document.getElementById('outputLang');
  document.getElementById('outputLabel').textContent = sel.options[sel.selectedIndex].text;

  try {
    chrome.storage?.local.set({ savedOutputLang: sel.value });
  } catch (_) {}

  updateUI();

  if (hebrewTranscript.trim()) {
    lastTranslatedText = ''; // איפוס הזיכרון כשמשנים שפה
    displayedText = await translate(hebrewTranscript);
    setOutput(displayedText);
  }
});

// Set initial output label from selected option & restore persisted settings
(function () {
  const sel = document.getElementById('outputLang');
  if (sel && sel.options[sel.selectedIndex]) {
    document.getElementById('outputLabel').textContent = sel.options[sel.selectedIndex].text;
  }

  try {
    chrome.storage?.local.get(['savedOutputLang', 'savedSlangLevel', 'savedContext', 'premiumVoiceEnabled', 'googleCloudApiKey'], (data) => {
      const langSelect = document.getElementById('outputLang');
      const slider = document.getElementById('slangSlider');
      const contextSelect = document.getElementById('messageContext');
      const premiumToggle = document.getElementById('premiumVoiceToggle');
      const apiKeyInput = document.getElementById('googleApiKeyInput');

      if (langSelect && data.savedOutputLang) {
        langSelect.value = data.savedOutputLang;
        const s = langSelect;
        document.getElementById('outputLabel').textContent =
          s.options[s.selectedIndex]?.text || document.getElementById('outputLabel').textContent;
      }

      if (slider && typeof data.savedSlangLevel === 'number') {
        slider.value = String(data.savedSlangLevel);
        document.getElementById('sliderValue').textContent =
          SLIDER_LABELS[+slider.value] || 'Medium';
      }

      if (contextSelect && data.savedContext) {
        contextSelect.value = data.savedContext;
      }

      premiumVoiceEnabled = !!data.premiumVoiceEnabled;
      googleCloudApiKey = (data.googleCloudApiKey || '').trim();
      if (premiumToggle) premiumToggle.checked = premiumVoiceEnabled;
      if (apiKeyInput && googleCloudApiKey) apiKeyInput.value = googleCloudApiKey;
    });
  } catch (_) {}
})();

// Slang intensity slider
const SLIDER_LABELS = { 1: 'Light', 2: 'Medium', 3: 'Hardcore' };
document.getElementById('slangSlider').addEventListener('input', function () {
  document.getElementById('sliderValue').textContent = SLIDER_LABELS[+this.value] || 'Medium';
  try {
    chrome.storage?.local.set({ savedSlangLevel: +this.value });
  } catch (_) {}
});

// Context selector — שומר את הבחירה
const contextSelectEl = document.getElementById('messageContext');
if (contextSelectEl) {
  contextSelectEl.addEventListener('change', function () {
    try {
      chrome.storage?.local.set({ savedContext: this.value });
    } catch (_) {}
  });
}

const premiumVoiceToggleEl = document.getElementById('premiumVoiceToggle');
if (premiumVoiceToggleEl) {
  premiumVoiceToggleEl.addEventListener('change', function () {
    premiumVoiceEnabled = !!this.checked;
    try {
      chrome.storage?.local.set({ premiumVoiceEnabled });
    } catch (_) {}
  });
}

const googleApiKeyInputEl = document.getElementById('googleApiKeyInput');
if (googleApiKeyInputEl) {
  googleApiKeyInputEl.addEventListener('input', function () {
    googleCloudApiKey = this.value.trim();
    try {
      chrome.storage?.local.set({ googleCloudApiKey: googleCloudApiKey });
    } catch (_) {}
  });
}

function updateUI() {
  const outputLangEl = document.getElementById('outputLang');
  if (!outputLangEl) return;

  const selectedOption = outputLangEl.selectedOptions?.[0];
  const optGroupLabel = selectedOption?.parentElement?.label || '';
  const isPremium = optGroupLabel === '💎 Premium Slangs';

  const translationStyleContainer = document.getElementById('translationStyleContainer');
  const locationFieldContainer = document.getElementById('locationFieldContainer');
  const sliderContainer = document.getElementById('slangSliderContainer');
  const contextContainer = document.getElementById('contextContainer');

  if (isPremium) {
    if (translationStyleContainer) translationStyleContainer.style.display = 'none';
    if (locationFieldContainer) locationFieldContainer.style.display = 'none';
    if (sliderContainer) sliderContainer.style.display = 'block';
    if (contextContainer) contextContainer.style.display = 'block';
    translationMode = 'slang';
  } else {
    if (translationStyleContainer) translationStyleContainer.style.display = 'block';

    if (translationMode === 'standard') {
      if (locationFieldContainer) locationFieldContainer.style.display = 'none';
      if (sliderContainer) sliderContainer.style.display = 'none';
      if (contextContainer) contextContainer.style.display = 'none';
    } else {
      if (locationFieldContainer) locationFieldContainer.style.display = 'block';
      if (sliderContainer) sliderContainer.style.display = 'block';
      if (contextContainer) contextContainer.style.display = 'block';
    }
  }
}

document.addEventListener('DOMContentLoaded', updateUI);
updateUI();

// --- Native Text-to-Speech ---
let ttsVoices = [];

function refreshTtsVoices() {
  try {
    ttsVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  } catch (_) {
    ttsVoices = [];
  }
}

if (window.speechSynthesis) {
  refreshTtsVoices();
  window.speechSynthesis.onvoiceschanged = refreshTtsVoices;
}

function getPreferredTtsLangCode(langValue) {
  const v = String(langValue || '');
  if (v.includes('Jamaican Patois')) return 'en-JM';
  if (v.includes('London Roadman')) return 'en-GB';
  if (v.includes('New York Brooklyn')) return 'en-US';
  if (v.includes('Tokyo Gyaru')) return 'ja-JP';
  if (v.includes('Paris Banlieue')) return 'fr-FR';
  if (v.includes('Russian Street') || v.includes('Russian')) return 'ru-RU';
  if (v.includes('Mumbai Hinglish')) return 'hi-IN';
  if (v.includes('Mexico City Barrio')) return 'es-MX';
  if (v.includes('Rio Favela')) return 'pt-BR';

  if (v.includes('Hebrew (Standard)')) return 'he-IL';
  if (v.includes('English (Standard)')) return 'en-US';
  if (v === 'Spanish') return 'es-ES';
  if (v === 'French') return 'fr-FR';
  if (v === 'German') return 'de-DE';
  if (v === 'Italian') return 'it-IT';
  if (v === 'Portuguese') return 'pt-PT';
  if (v === 'Japanese') return 'ja-JP';

  // Safe fallback
  return 'en-US';
}

function pickVoiceByLang(preferredLangCode) {
  const voices = (ttsVoices && ttsVoices.length ? ttsVoices : (window.speechSynthesis.getVoices() || []));
  if (!voices.length) return null;

  const target = String(preferredLangCode || '').toLowerCase();
  if (!target) return null;

  // 1) exact / prefix match
  let voice = voices.find((v) => v.lang && v.lang.toLowerCase() === target) ||
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(target + '-')) ||
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(target));
  if (voice) return voice;

  // 2) match by base language (e.g., 'en' for 'en-GB')
  const base = target.split('-')[0];
  voice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(base));
  if (voice) return voice;

  return null;
}

function shouldUsePremiumVoice() {
  return !!premiumVoiceEnabled;
}

function getSelectedTtsEngine() {
  const el = document.getElementById('ttsEngineSelector');
  return el ? el.value : 'minimax';
}

function getVoiceTuning() {
  return {
    speed: parseFloat(document.getElementById('voiceSpeed')?.value || '1.05'),
    pitch: parseInt(document.getElementById('voicePitch')?.value || '0', 10),
    volume: parseFloat(document.getElementById('voiceVolume')?.value || '1.0'),
    emotion: document.getElementById('voiceEmotion')?.value || 'neutral'
  };
}

function initTuningPanel() {
  const engineSelector = document.getElementById('ttsEngineSelector');
  const tuningPanel = document.getElementById('minimaxTuningPanel');
  if (!engineSelector || !tuningPanel) return;

  function updatePanelVisibility() {
    tuningPanel.style.display = engineSelector.value === 'minimax' ? 'block' : 'none';
  }

  engineSelector.addEventListener('change', updatePanelVisibility);
  updatePanelVisibility();

  const speedSlider = document.getElementById('voiceSpeed');
  const pitchSlider = document.getElementById('voicePitch');
  const volumeSlider = document.getElementById('voiceVolume');

  if (speedSlider) speedSlider.addEventListener('input', function() {
    document.getElementById('speedValue').textContent = parseFloat(this.value).toFixed(2);
    try { chrome.storage?.local.set({ voiceSpeed: +this.value }); } catch(_) {}
  });

  if (pitchSlider) pitchSlider.addEventListener('input', function() {
    document.getElementById('pitchValue').textContent = this.value;
    try { chrome.storage?.local.set({ voicePitch: +this.value }); } catch(_) {}
  });

  if (volumeSlider) volumeSlider.addEventListener('input', function() {
    document.getElementById('volumeValue').textContent = parseFloat(this.value).toFixed(1);
    try { chrome.storage?.local.set({ voiceVolume: +this.value }); } catch(_) {}
  });

  const emotionSelect = document.getElementById('voiceEmotion');
  if (emotionSelect) emotionSelect.addEventListener('change', function() {
    try { chrome.storage?.local.set({ voiceEmotion: this.value }); } catch(_) {}
  });

  try {
    chrome.storage?.local.get(['voiceSpeed', 'voicePitch', 'voiceVolume', 'voiceEmotion'], (data) => {
      if (speedSlider && data.voiceSpeed) {
        speedSlider.value = data.voiceSpeed;
        document.getElementById('speedValue').textContent = parseFloat(data.voiceSpeed).toFixed(2);
      }
      if (pitchSlider && typeof data.voicePitch === 'number') {
        pitchSlider.value = data.voicePitch;
        document.getElementById('pitchValue').textContent = data.voicePitch;
      }
      if (volumeSlider && data.voiceVolume) {
        volumeSlider.value = data.voiceVolume;
        document.getElementById('volumeValue').textContent = parseFloat(data.voiceVolume).toFixed(1);
      }
      if (emotionSelect && data.voiceEmotion) {
        emotionSelect.value = data.voiceEmotion;
      }
    });
  } catch(_) {}
}

document.addEventListener('DOMContentLoaded', initTuningPanel);

async function speakWithMiniMax(text) {
  const outputLangEl = document.getElementById('outputLang');
  const dialect = outputLangEl?.value || '';

  const MINIMAX_DIALECTS = [
    'New York Brooklyn', 'London Roadman', 'Jamaican Patois',
    'Tokyo Gyaru', 'Paris Banlieue', 'Russian Street',
    'Mumbai Hinglish', 'Mexico City Barrio', 'Rio Favela'
  ];

  const isSupportedDialect = MINIMAX_DIALECTS.some(d => dialect.includes(d));
  if (!isSupportedDialect) return false;

  try {
    const tuning = getVoiceTuning();
    const res = await fetch('https://voice-slang-translator.vercel.app/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, dialect, tuning })
    });

    if (!res.ok) return false;
    const data = await res.json();

    if (data.output) {
      if (premiumAudioPlayer) { try { premiumAudioPlayer.pause(); } catch (_) {} }
      premiumAudioPlayer = new Audio(data.output);
      await premiumAudioPlayer.play();
      setTtsEngineStatus('google');
      return true;
    }

    if (data.predictionId) {
      const audioUrl = await pollForAudio(data.predictionId);
      if (!audioUrl) return false;
      if (premiumAudioPlayer) { try { premiumAudioPlayer.pause(); } catch (_) {} }
      premiumAudioPlayer = new Audio(audioUrl);
      await premiumAudioPlayer.play();
      setTtsEngineStatus('google');
      return true;
    }

    return false;
  } catch (e) {
    console.error('MiniMax TTS failed:', e);
    return false;
  }
}

async function pollForAudio(predictionId, maxAttempts = 20, intervalMs = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    try {
      const res = await fetch('https://voice-slang-translator.vercel.app/api/tts-poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ predictionId })
      });
      const data = await res.json();
      if (data.status === 'succeeded' && data.output) return data.output;
      if (data.status === 'failed') return null;
    } catch (_) {}
  }
  return null;
}

async function speakWithGoogleCloudTts(text) {
  const outputLangEl = document.getElementById('outputLang');
  const langValue = outputLangEl?.value || '';

  // Dynamic voice mapping based on selected dialect
  const VOICE_MAP = {
    'New York Brooklyn': { languageCode: 'en-US', name: 'en-US-Journey-D', gender: 'MALE', pitch: 0 },
    'London Roadman': { languageCode: 'en-GB', name: 'en-GB-Neural2-D', gender: 'MALE', pitch: -1.5 },
    'Jamaican Patois': { languageCode: 'en-GB', name: 'en-GB-Neural2-B', gender: 'MALE', pitch: -1.5 },
    'Tokyo Gyaru': { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B', gender: 'FEMALE', pitch: 0.5 },
    'Paris Banlieue': { languageCode: 'fr-FR', name: 'fr-FR-Neural2-D', gender: 'MALE', pitch: -1.5 },
    'Russian Street': { languageCode: 'ru-RU', name: 'ru-RU-Standard-D', gender: 'MALE', pitch: -1.5 },
    'Mumbai Hinglish': { languageCode: 'hi-IN', name: 'hi-IN-Neural2-C', gender: 'MALE', pitch: -1.5 },
    'Mexico City Barrio': { languageCode: 'es-US', name: 'es-US-Neural2-B', gender: 'MALE', pitch: -1.5 },
    'Rio Favela': { languageCode: 'pt-BR', name: 'pt-BR-Neural2-B', gender: 'MALE', pitch: -1.5 },
  };

  // Find matching voice — check if langValue contains any key
  let voiceConfig = null;
  for (const [key, cfg] of Object.entries(VOICE_MAP)) {
    if (langValue.includes(key)) { voiceConfig = cfg; break; }
  }

  // Default fallback voice
  if (!voiceConfig) {
    voiceConfig = { languageCode: 'en-US', name: 'en-US-Journey-F', gender: 'FEMALE', pitch: 0 };
  }

  const res = await fetch(
    'https://texttospeech.googleapis.com/v1/text:synthesize?key=' +
      encodeURIComponent(googleCloudApiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: voiceConfig.languageCode,
          name: voiceConfig.name,
          ssmlGender: voiceConfig.gender
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.05,
          pitch: voiceConfig.pitch
        }
      })
    }
  );

  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    const apiErrorMessage =
      errJson?.error?.message ||
      errJson?.message ||
      `Google Cloud TTS failed (${res.status})`;
    alert(apiErrorMessage);
    throw new Error(apiErrorMessage);
  }

  const data = await res.json().catch(() => null);
  const audioContent = data?.audioContent;
  if (!audioContent) {
    const fallbackError = data?.error?.message || 'Google Cloud TTS returned no audioContent';
    alert(fallbackError);
    throw new Error(fallbackError);
  }

  const audioUrl = `data:audio/mp3;base64,${audioContent}`;
  if (premiumAudioPlayer) { try { premiumAudioPlayer.pause(); } catch (_) {} }
  premiumAudioPlayer = new Audio(audioUrl);
  await premiumAudioPlayer.play();
  setTtsEngineStatus('google');
}

function speakWithNativeTts(text) {
  if (!window.speechSynthesis) {
    showToast('Text-to-speech not supported');
    return;
  }

  const outputLangEl = document.getElementById('outputLang');
  const langValue = outputLangEl?.value || 'English (Standard)';
  const preferredLangCode = getPreferredTtsLangCode(langValue);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.lang = preferredLangCode;

  const voice = pickVoiceByLang(preferredLangCode);
  if (voice) {
    utterance.voice = voice;
  } else {
    // Fallback to an English voice if the browser doesn't support the dialect
    const enVoice = pickVoiceByLang('en-US') || pickVoiceByLang('en-GB') || pickVoiceByLang('en');
    if (enVoice) {
      utterance.voice = enVoice;
      utterance.lang = enVoice.lang;
    } else {
      utterance.lang = 'en-US';
    }
  }

  try {
    window.speechSynthesis.cancel();
  } catch (_) {}
  window.speechSynthesis.speak(utterance);
}

async function speakTranslatedText(text) {
  if (!shouldUsePremiumVoice()) {
    speakWithNativeTts(text);
    return;
  }

  const engine = getSelectedTtsEngine();

  if (engine === 'native') {
    speakWithNativeTts(text);
    return;
  }

  if (engine === 'minimax') {
    const ok = await speakWithMiniMax(text);
    if (ok) return;
    showToast('MiniMax failed, trying Google...');
    try {
      await speakWithGoogleCloudTts(text);
      return;
    } catch (e) {
      showToast('Google also failed, using native voice');
      setTtsEngineStatus('fallback');
    }
    speakWithNativeTts(text);
    return;
  }

  if (engine === 'google') {
    try {
      await speakWithGoogleCloudTts(text);
      return;
    } catch (e) {
      showToast('Google failed, using native voice');
      setTtsEngineStatus('fallback');
    }
    speakWithNativeTts(text);
    return;
  }

  speakWithNativeTts(text);
}

// Mode buttons
document.getElementById('btnStandard').addEventListener('click', () => setMode('standard'));
document.getElementById('btnSlang').addEventListener('click', () => setMode('slang'));

function setMode(mode) {
  translationMode = mode;
  const btnStd = document.getElementById('btnStandard');
  const btnSlg = document.getElementById('btnSlang');
  const locationFieldContainer = document.getElementById('locationFieldContainer');

  if (btnStd) btnStd.className = 'mode-btn' + (mode === 'standard' ? ' active-standard' : '');
  if (btnSlg) btnSlg.className = 'mode-btn' + (mode === 'slang' ? ' active-slang' : '');

  if (locationFieldContainer) {
    locationFieldContainer.style.display = (mode === 'slang') ? 'block' : 'none';
  }

  if (mode === 'standard') lastTranslatedText = ''; // איפוס זיכרון בעת מעבר למצב רגיל

  updateUI();
}

// --- Translation via Vercel backend ---
async function translate(text) {
  if (!text.trim()) return '';

  const outputSelect = document.getElementById('outputLang');
  const currentLang = outputSelect?.value || '';

  const selectedOption = outputSelect?.selectedOptions?.[0];
  const isPremiumSelected = selectedOption?.parentElement?.label === '💎 Premium Slangs';

  const customLocation = document.getElementById('slangLocation')
    ? document.getElementById('slangLocation').value.trim()
    : '';

  const slangLevel = parseInt(document.getElementById('slangSlider')?.value, 10) || 2;

  // קריאת ההקשר שנבחר
  const context = document.getElementById('messageContext')?.value || 'default';

  setBadge(true);
  const dictContainerEl = document.getElementById('dictContainer');
  if (dictContainerEl) dictContainerEl.style.display = 'none';

  const loadingMessages = {
    'Jamaican Patois': 'Hold a vibes, mi a cook di patwa... 🇯🇲',
    'London Roadman': 'Hold tight bruv, mandem is translating... 🇬🇧',
    'New York Brooklyn': 'Hold up my guy, cooking up the heat... 🗽',
    'Tokyo Gyaru': 'Chotto matte! Cooking something yabai... ✨',
    'Paris Banlieue': 'Attends 2s gros, je prépare une dinguerie... 🇫🇷',
    'Russian Street': 'Sekundu bratan, shcha vsyo budet... 🇷🇺',
    'Mumbai Hinglish': 'Arey bhai, full jhakaas translation aa raha hai, zara ruk na public… 🇮🇳',
    'Mexico City Barrio': 'Aguanta tantito, wey, ya te lo pongo bien chilango y bien chido… 🇲🇽',
    'Rio Favela': 'Segura aí, mano, já vou deixar teu texto no papo reto, bem carioca, de boa… 🇧🇷'
  };
  const loadingText = loadingMessages[currentLang] || 'One sec, cooking it up... ⏳';
  setOutput(loadingText);

  const ERROR_UI = 'Translation failed - Please check your setup or connection';

  try {
    const endpoint = 'https://voice-slang-translator.vercel.app/api/translate';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        currentLang,
        translationMode,
        slangLocation: customLocation,
        slangLevel,
        isPremiumSelected,
        context,
        previousMessage: lastTranslatedText || null  // שולח את התרגום הקודם
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Secure translate failed:', res.status, err);
      setOutput(ERROR_UI);
      const dictContainer = document.getElementById('dictContainer');
      if (dictContainer) dictContainer.style.display = 'none';
      setBadge(false);
      return text;
    }

    const data = await res.json().catch((e) => {
      console.error('Translation response parse error:', e);
      return {};
    });
    const { fullText } = data || {};
    const raw = (fullText || text).trim();

    const parts = raw.split('|||');
    const translatedText = parts[0].trim();

    // שומר את התרגום הנוכחי לשימוש בתרגום הבא
    if (translatedText) lastTranslatedText = translatedText;

    const dictContainer = document.getElementById('dictContainer');
    const dictContent = document.getElementById('dictContent');

    if (parts.length > 1 && parts[1].trim() !== '') {
      let dictHTML = parts[1].trim().replace(/\*\*(.*?)\*\*/g, '$1');
      dictHTML = dictHTML.replace(/([^,]+)\s*-/g, '<b style="color: #4ade80;">$1</b> -');
      dictHTML = dictHTML.replace(/\n/g, '<br>');

      if (dictContent) dictContent.innerHTML = dictHTML;
      if (dictContainer) dictContainer.style.display = 'block';
    } else {
      if (dictContainer) dictContainer.style.display = 'none';
    }

    setBadge(false);
    return translatedText || text;
  } catch (e) {
    console.error('Translation request failed:', e);
    setOutput(ERROR_UI);
    const dictContainer = document.getElementById('dictContainer');
    if (dictContainer) dictContainer.style.display = 'none';
    setBadge(false);
    return text;
  }
}

// --- Speech Recognition ---
function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.continuous = true; r.interimResults = true;
  r.lang = document.getElementById('inputLang')?.value || 'he-IL';
  r.onstart = () => setStatus('Listening...', 'listening');
  r.onresult = async (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (!res || !res[0]) continue;
      const t = res[0].transcript || '';
      if (res.isFinal) {
        hebrewTranscript += t + ' ';
        const inputEl = document.getElementById('inputText');
        if (inputEl) inputEl.value = hebrewTranscript;
        const tr = await translate(t);
        displayedText += (displayedText ? ' ' : '') + tr;
        setOutput(displayedText);
      } else { interim = t; }
    }
    const interimEl = document.getElementById('interim');
    if (interimEl) interimEl.textContent = interim;
  };
  r.onerror = (e) => {
    const msgs = { 'not-allowed': 'Allow microphone and try again', 'no-speech': 'No speech detected', 'network': 'Network error' };
    setStatus(msgs[e.error] || 'Error: ' + e.error, '');
    stopRecording();
  };
  r.onend = () => { if (isRecording) r.start(); };
  return r;
}

function getRecognitionLangForOutputLang(outputLangValue) {
  const v = String(outputLangValue || '');

  // Premium slang dialects
  if (v.includes('Jamaican Patois')) return 'en-JM';
  if (v.includes('London Roadman')) return 'en-GB';
  if (v.includes('New York Brooklyn')) return 'en-US';
  if (v.includes('Tokyo Gyaru')) return 'ja-JP';
  if (v.includes('Paris Banlieue')) return 'fr-FR';
  if (v.includes('Russian Street')) return 'ru-RU';
  if (v.includes('Mumbai Hinglish')) return 'hi-IN';
  if (v.includes('Mexico City Barrio')) return 'es-MX';
  if (v.includes('Rio Favela')) return 'pt-BR';

  // Standard languages
  if (v.includes('Hebrew (Standard)')) return 'he-IL';
  if (v.includes('English (Standard)')) return 'en-US';
  if (v === 'Spanish') return 'es-ES';
  if (v === 'French') return 'fr-FR';
  if (v === 'German') return 'de-DE';
  if (v === 'Italian') return 'it-IT';
  if (v === 'Russian') return 'ru-RU';
  if (v === 'Portuguese') return 'pt-PT';
  if (v === 'Japanese') return 'ja-JP';

  // Best-effort fallback
  return document.getElementById('inputLang')?.value || 'en-US';
}

function setDuoButtonRecording(which, isRecordingNow) {
  const myBtn = document.getElementById('duoMyTurnBtn');
  const theirBtn = document.getElementById('duoTheirTurnBtn');
  if (!myBtn || !theirBtn) return;

  if (!myBtn.dataset.originalText) myBtn.dataset.originalText = myBtn.textContent.trim();
  if (!theirBtn.dataset.originalText) theirBtn.dataset.originalText = theirBtn.textContent.trim();

  if (which === 'my') {
    myBtn.classList.toggle('recording', isRecordingNow);
    myBtn.textContent = isRecordingNow ? '⏹️ Stop' : myBtn.dataset.originalText;
  }
  if (which === 'their') {
    theirBtn.classList.toggle('recording', isRecordingNow);
    theirBtn.textContent = isRecordingNow ? '⏹️ Stop' : theirBtn.dataset.originalText;
  }
}

function initDuoRecognition(langCode) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = langCode;

  r.onstart = () => setStatus('Listening...', 'listening');

  r.onresult = async (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (!res || !res[0]) continue;
      const t = res[0].transcript || '';

      if (res.isFinal) {
        hebrewTranscript = t;
        const tr = await translate(t);
        displayedText = tr;
        setOutput(displayedText);
        speakTranslatedText(displayedText);
      } else {
        interim = t;
      }
    }
    const interimEl = document.getElementById('interim');
    if (interimEl) interimEl.textContent = interim;
  };

  r.onerror = (e) => {
    const msgs = { 'not-allowed': 'Allow microphone and try again', 'no-speech': 'No speech detected', 'network': 'Network error' };
    setStatus(msgs[e.error] || 'Error: ' + e.error, '');
    stopDuoRecording();
  };

  r.onend = () => { if (isRecording) r.start(); };
  return r;
}

function startDuoRecording(which) {
  stopDuoRecording();

  const inputLang = document.getElementById('inputLang')?.value || 'en-US';
  const outputLangValue = document.getElementById('outputLang')?.value || 'English (Standard)';
  const langCode = which === 'my' ? inputLang : getRecognitionLangForOutputLang(outputLangValue);

  recognition = initDuoRecognition(langCode);
  if (!recognition) { setStatus('Use Chrome', ''); return; }

  try {
    recognition.start();
    isRecording = true;
    duoActiveTurn = which;
    setDuoButtonRecording(which, true);
  } catch (e) {
    setStatus('Error: ' + e.message, '');
    duoActiveTurn = null;
  }
}

function stopDuoRecording() {
  isRecording = false;
  duoActiveTurn = null;
  if (recognition) { try { recognition.stop(); } catch (_) {} }
  recognition = null;

  setDuoButtonRecording('my', false);
  setDuoButtonRecording('their', false);
  setStatus('Ready', '');
}

function toggleRecording() { isRecording ? stopRecording() : startRecording(); }

function startRecording() {
  recognition = initRecognition();
  if (!recognition) { setStatus('Use Chrome', ''); return; }
  try {
    recognition.start(); isRecording = true;
    const micBtn = document.getElementById('micBtn');
    const micLabel = document.getElementById('micLabel');
    if (micBtn) { micBtn.textContent = '⏹️'; micBtn.classList.add('recording'); }
    if (micLabel) { micLabel.textContent = 'Click to stop'; micLabel.classList.add('active'); }
  } catch (e) { setStatus('Error: ' + e.message, ''); }
}

function stopRecording() {
  isRecording = false;
  if (recognition) { recognition.stop(); recognition = null; }
  const micBtn = document.getElementById('micBtn');
  const micLabel = document.getElementById('micLabel');
  const interimEl = document.getElementById('interim');
  if (micBtn) { micBtn.textContent = '🎤'; micBtn.classList.remove('recording'); }
  if (micLabel) { micLabel.textContent = 'Click to record'; micLabel.classList.remove('active'); }
  if (interimEl) { interimEl.textContent = ''; }
  setStatus('Ready', '');
}

async function pasteToPage() {
  const text = (displayedText || hebrewTranscript).trim();
  if (!text) { showToast('No text'); return; }
  chrome.runtime.sendMessage({ type: 'PASTE_TEXT', text });
  showToast('Pasted! ✓');
}

function copyText() {
  const t = (displayedText || hebrewTranscript).trim();
  if (!t) { showToast('No text'); return; }
  navigator.clipboard.writeText(t).then(() => showToast('Copied! ✓'));
}

function clearText() {
  hebrewTranscript = '';
  displayedText = '';
  lastTranslatedText = ''; // מאפס גם את הזיכרון
  const outputEl = document.getElementById('output');
  if (outputEl) outputEl.innerHTML = '<span class="placeholder">Your text will appear here...</span>';
  const interimEl = document.getElementById('interim');
  if (interimEl) interimEl.textContent = '';
  const inputEl = document.getElementById('inputText');
  if (inputEl) inputEl.value = '';
}

function setOutput(text) {
  const el = document.getElementById('output');
  if (!el) return;
  if (text?.trim()) el.textContent = text;
  else el.innerHTML = '<span class="placeholder">Your text will appear here...</span>';
}
function setBadge(show) {
  const badge = document.getElementById('translatingBadge');
  if (badge) badge.classList.toggle('show', show);
}
function setStatus(text, state) {
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');
  if (statusText) statusText.textContent = text;
  if (statusDot) statusDot.className = 'status-dot' + (state ? ' ' + state : '');
}
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}