// Draws the toolbar icon: blue when the extension is enabled on a tab, dark grey otherwise.
// Icons are drawn on a canvas, so no image files are needed.
const COLORS = { on: '#2563eb', off: '#475569' }; // Tailwind blue-600 / slate-600 (same as the popup)

function drawIcon(enabled) {
  const imageData = {};
  for (const size of [16, 32, 48, 128]) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = COLORS[enabled ? 'on' : 'off'];
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * 0.22);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${size * 0.7}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('F', size / 2, size * 0.55);
    imageData[size] = ctx.getImageData(0, 0, size, size);
  }
  return imageData;
}

// Default icon (grey) for pages where the content script doesn't run.
const setDefault = () => chrome.action.setIcon({ imageData: drawIcon(false) });
chrome.runtime.onInstalled.addListener(setDefault);
chrome.runtime.onStartup.addListener(setDefault);

// The content script reports the state for its tab.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'icon' && sender.tab) {
    chrome.action.setIcon({ tabId: sender.tab.id, imageData: drawIcon(msg.enabled) });
  }
});
