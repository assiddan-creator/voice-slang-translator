const GEMINI_API_KEY = "AIzaSyCtTLmYS7OUkr_bkOtisSPQgImJUpCf3Ok";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY.trim();

let recognition = null;
let isRecording = false;
let hebrewTranscript = '';
let displayedText = '';
let translationMode = 'standard'; // 'standard' | 'slang'

// --- Wire up buttons ---
document.getElementById('micBtn').addEventListener('click', toggleRecording);
document.getElementById('pasteBtn').addEventListener('click', pasteToPage);
document.getElementById('copyBtn').addEventListener('click', copyText);
document.getElementById('clearBtn').addEventListener('click', clearText);
document.getElementById('closeBtn').addEventListener('click', () => window.close());

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

  // Persist selected output language
  try {
    chrome.storage?.local.set({ savedOutputLang: sel.value });
  } catch (_) {}

  updateUI();

  if (hebrewTranscript.trim()) {
    displayedText = await translate(hebrewTranscript);
    setOutput(displayedText);
  }
});

// Set initial output label from selected option & restore persisted settings
(function () {
  const sel = document.getElementById('outputLang');
  if(sel && sel.options[sel.selectedIndex]) {
      document.getElementById('outputLabel').textContent = sel.options[sel.selectedIndex].text;
  }

  // Restore saved language and slider from storage
  try {
    chrome.storage?.local.get(['savedOutputLang', 'savedSlangLevel'], (data) => {
      const langSelect = document.getElementById('outputLang');
      const slider = document.getElementById('slangSlider');

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
    });
  } catch (_) {}
})();

// Slang intensity slider: 1 = Light, 2 = Medium, 3 = Hardcore
const SLIDER_LABELS = { 1: 'Light', 2: 'Medium', 3: 'Hardcore' };
document.getElementById('slangSlider').addEventListener('input', function () {
  document.getElementById('sliderValue').textContent = SLIDER_LABELS[+this.value] || 'Medium';
  // Persist slider value
  try {
    chrome.storage?.local.set({ savedSlangLevel: +this.value });
  } catch (_) {}
});

function updateUI() {
  const outputLangEl = document.getElementById('outputLang');
  if (!outputLangEl) return;

  const selectedOption = outputLangEl.selectedOptions?.[0];
  const optGroupLabel = selectedOption?.parentElement?.label || '';
  const isPremium = optGroupLabel === '💎 Premium Slangs';

  const translationStyleContainer = document.getElementById('translationStyleContainer');
  const locationFieldContainer = document.getElementById('locationFieldContainer');
  const sliderContainer = document.getElementById('slangSliderContainer');

  if (isPremium) {
    if (translationStyleContainer) translationStyleContainer.style.display = 'none';
    if (locationFieldContainer) locationFieldContainer.style.display = 'none';
    if (sliderContainer) sliderContainer.style.display = 'block';

    // Force internal logic to slang generation for premium dialects
    translationMode = 'slang';
  } else {
    if (translationStyleContainer) translationStyleContainer.style.display = 'block';

    if (translationMode === 'standard') {
      if (locationFieldContainer) locationFieldContainer.style.display = 'none';
      if (sliderContainer) sliderContainer.style.display = 'none';
    } else {
      if (locationFieldContainer) locationFieldContainer.style.display = 'block';
      if (sliderContainer) sliderContainer.style.display = 'block';
    }
  }
}

document.addEventListener('DOMContentLoaded', updateUI);
updateUI();

// Mode buttons
document.getElementById('btnStandard').addEventListener('click', () => setMode('standard'));
document.getElementById('btnSlang').addEventListener('click', () => setMode('slang'));

function setMode(mode) {
  translationMode = mode;
  const btnStd = document.getElementById('btnStandard');
  const btnSlg = document.getElementById('btnSlang');
  const locationFieldContainer = document.getElementById('locationFieldContainer');

  // Update button active states
  if (btnStd) btnStd.className = 'mode-btn' + (mode === 'standard' ? ' active-standard' : '');
  if (btnSlg) btnSlg.className = 'mode-btn' + (mode === 'slang' ? ' active-slang' : '');

  // Show/hide the location input depending on translation mode
  if (locationFieldContainer) {
    locationFieldContainer.style.display = (mode === 'slang') ? 'block' : 'none';
  }

  updateUI();
}

// --- Translation via Gemini ---
async function translate(text) {
  if (!text.trim()) return '';
  const currentLang = document.getElementById('outputLang').value;
  
  const customLocation = document.getElementById('slangLocation') ? document.getElementById('slangLocation').value.trim() : '';
  
  const slangLevel = parseInt(document.getElementById('slangSlider').value, 10) || 2;
  const INTENSITY_INSTRUCTIONS = {
    1: "Light intensity: Use mostly standard language with just a tiny hint of local flavor. Maximum 1 or 2 very common, mild slang words. Keep it highly readable and polite.",
    2: "Medium intensity: Authentic, casual street talk. A natural mix of standard language and popular local slang.",
    3: "Hardcore intensity: Heavy, thick street slang. Use deep local terminology, expressions, and authentic street grammar."
  };
  const intensityPrompt = INTENSITY_INSTRUCTIONS[slangLevel] || INTENSITY_INSTRUCTIONS[2];

  const outputSelect = document.getElementById('outputLang');
  const selectedOption = outputSelect?.selectedOptions?.[0];
  const isPremiumSelected = selectedOption?.parentElement?.label === '💎 Premium Slangs';

  // Treat as slang whenever the user explicitly chose a premium slang or typed a custom location.
  const slangRequested = translationMode === 'slang' || isPremiumSelected || customLocation !== '';

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

  try {
    let prompt = '';

    const formattingRule = "\n\nCRITICAL FORMATTING RULE: You MUST return the output in exactly this format and nothing else:\n<Your Slang Translation>\n|||\n<A short dictionary of 1-3 key slang words used, formatted as: Word - Meaning>\nDo not include any other text, explanations, or system instructions.";

    if (!slangRequested) {
      prompt = `You are a professional translator. Translate or rephrase the following text into standard, formal, dictionary-accurate ${currentLang}. DO NOT use any slang. Return ONLY the final text. No conversational filler or explanations. Text: '''${text}'''`;
    } else {
      // SLANG MODE
      const base = customLocation
        ? `You are an expert in local street culture. Translate the text into ${currentLang}, but specifically inject the authentic street slang and local dialect of ${customLocation}. Slang intensity instructions: ${intensityPrompt}.`
        : `You are an expert in local street culture. Translate the text into authentic street slang specifically for ${currentLang}. Slang intensity instructions: ${intensityPrompt}.`;

      prompt = `${base}\nText: '''${text}'''${formattingRule}`;
    }

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: slangRequested ? 1.0 : 0.2, maxOutputTokens: 2048 }
      })
    });
    
    const data = await res.json();
    setBadge(false);
    const fullText = (data?.candidates?.[0]?.content?.parts?.[0]?.text || text).trim();
    console.log("RAW GEMINI RESPONSE:", fullText);
    
    const parts = fullText.split('|||');
    const translatedText = parts[0].trim();

    const dictContainer = document.getElementById('dictContainer');
    const dictContent = document.getElementById('dictContent');

    if (parts.length > 1 && parts[1].trim() !== '') {
      // Highlight the slang word before the hyphen with premium green color
      let dictHTML = parts[1].trim().replace(/\*\*(.*?)\*\*/g, '$1');
      dictHTML = dictHTML.replace(/^(.*?)\s*-/gm, '<b style="color: #4ade80;">$1</b> -');
      dictHTML = dictHTML.replace(/\n/g, '<br>');

      if (dictContent) dictContent.innerHTML = dictHTML;
      if (dictContainer) dictContainer.style.display = 'block';
    } else {
      if (dictContainer) dictContainer.style.display = 'none';
    }

    return translatedText || text;
  } catch(e) {
    console.error("Gemini API Error:", e);
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
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_API_KEY_HERE') {
    showToast('⚠️ Paste your API key in voice.js');
    return;
  }
  recognition = initRecognition();
  if (!recognition) { setStatus('Use Chrome', ''); return; }
  try {
    recognition.start(); isRecording = true;
    const micBtn = document.getElementById('micBtn');
    const micLabel = document.getElementById('micLabel');
    if (micBtn) { micBtn.textContent = '⏹️'; micBtn.classList.add('recording'); }
    if (micLabel) { micLabel.textContent = 'Click to stop'; micLabel.classList.add('active'); }
  } catch(e) { setStatus('Error: ' + e.message, ''); }
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
  hebrewTranscript = ''; displayedText = '';
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
    if(badge) badge.classList.toggle('show', show); 
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