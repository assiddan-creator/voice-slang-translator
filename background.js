let voiceWinId = null;

chrome.action.onClicked.addListener(async (tab) => {
  // If window already open, focus it
  if (voiceWinId !== null) {
    try {
      await chrome.windows.update(voiceWinId, { focused: true });
      return;
    } catch(e) { voiceWinId = null; }
  }
  // Open small always-on-top popup window
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('voice.html'),
    type: 'popup',
    width: 380,
    height: 560,
    top: 80,
    left: 20,
    focused: true
  });
  voiceWinId = win.id;
});

chrome.windows.onRemoved.addListener((winId) => {
  if (winId === voiceWinId) voiceWinId = null;
});

// Paste into the last focused non-voice tab
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type !== 'PASTE_TEXT') return;
  // Get all windows, find a normal one
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  let targetTab = null;
  for (const win of windows) {
    if (win.id === voiceWinId) continue;
    const active = win.tabs.find(t => t.active && t.url && !t.url.startsWith('chrome'));
    if (active) { targetTab = active; break; }
  }
  if (!targetTab) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: (text) => {
        const el = document.activeElement;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          const s = el.selectionStart ?? el.value.length;
          const e2 = el.selectionEnd ?? el.value.length;
          el.value = el.value.slice(0, s) + text + el.value.slice(e2);
          el.selectionStart = el.selectionEnd = s + text.length;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el && el.isContentEditable) {
          const sel = window.getSelection();
          if (sel.rangeCount) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(text));
            range.collapse(false);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      },
      args: [msg.text]
    });
  } catch(e) {}
});
