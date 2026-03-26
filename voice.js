let recognition = null;
let isRecording = false;
let hebrewTranscript = '';
let displayedText = '';
let translationMode = 'standard'; // 'standard' | 'slang'
let lastTranslatedText = ''; // זוכר את התרגום הקודם לשמירת קול עקבי

// --- Wire up buttons ---
document.getElementById('micBtn').addEventListener('click', toggleRecording);
document.getElementById('pasteBtn').addEventListener('click', pasteToPage);
document.getElementById('copyBtn').addEventListener('click', copyText);
document.getElementById('clearBtn').addEventListener('click', clearText);
document.getElementById('closeBtn').addEventListener('click', () => window.close());

// Native text-to-speech for the translated output
const ttsBtnEl = document.getElementById('ttsPlayBtn');
if (ttsBtnEl) {
  ttsBtnEl.addEventListener('click', () => {
    const fallbackOutputEl = document.getElementById('output');
    const rawOutputText = (fallbackOutputEl?.textContent || '').trim();
    const textToSpeak =
      (displayedText && displayedText.trim()) ? displayedText.trim() : rawOutputText;

    if (!textToSpeak || textToSpeak.includes('Your text will appear here')) {
      showToast('No translation to play');
      return;
    }

    speakTranslatedText(textToSpeak);
  });
}

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
    chrome.storage?.local.get(['savedOutputLang', 'savedSlangLevel', 'savedContext'], (data) => {
      const langSelect = document.getElementById('outputLang');
      const slider = document.getElementById('slangSlider');
      const contextSelect = document.getElementById('messageContext');

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

function speakTranslatedText(text) {
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