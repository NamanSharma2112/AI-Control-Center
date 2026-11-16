// AI Control Center — content script.
//
// Watches one of ChatGPT, Claude or Gemini for exactly two things:
//   1. whether the site is writing a reply right now (its own "Stop" button
//      is on screen), and
//   2. whether it is showing its "you've reached your limit" notice, and the
//      reset time if the notice gives one.
// It never reads your messages, the model's replies, or chat titles. Only
// those two signals leave this page, and only to the extension, which passes
// them to the AI Control Center app on this computer.
(() => {
  const SITES = {
    'chatgpt.com': 'chatgpt',
    'chat.openai.com': 'chatgpt',
    'claude.ai': 'claude-web',
    'gemini.google.com': 'gemini',
  };
  const site = SITES[location.hostname];
  if (!site) return;

  // The site's own control for stopping a reply: present only while it writes.
  const STOP_BUTTONS = {
    chatgpt: ['button[data-testid="stop-button"]', 'button[aria-label^="Stop" i]'],
    'claude-web': ['button[aria-label="Stop response" i]', 'button[aria-label^="Stop" i]'],
    gemini: ['button[aria-label^="Stop" i]', 'button.stop'],
  }[site];

  // Only notice-like regions are looked at for the limit message — never the
  // conversation itself.
  const NOTICE_REGIONS =
    '[role="alert"], [role="status"], [data-testid*="limit" i], [class*="limit" i], [class*="banner" i]';
  const LIMIT_TEXT =
    /(usage limit|message limit|reached (?:your|the) (?:\w+ )?limit|out of (?:free )?messages|limit (?:will )?resets?|you(?:'|’)ve hit)/i;

  const visible = (el) => !!el && el.getClientRects().length > 0;

  function isWriting() {
    return STOP_BUTTONS.some((selector) => visible(document.querySelector(selector)));
  }

  function limitNotice() {
    for (const el of document.querySelectorAll(NOTICE_REGIONS)) {
      if (!visible(el)) continue;
      const text = (el.innerText || '').slice(0, 300);
      if (LIMIT_TEXT.test(text)) return text;
    }
    return null;
  }

  /** "until 3:45 PM", "at 15:45", "in 2 hours", "in 30 minutes" → epoch ms. */
  function parseReset(text) {
    let m = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (m) {
      let hours = Number(m[1]);
      const minutes = Number(m[2]);
      const half = m[3] && m[3].toLowerCase();
      if (half === 'pm' && hours < 12) hours += 12;
      if (half === 'am' && hours === 12) hours = 0;
      const at = new Date();
      at.setHours(hours, minutes, 0, 0);
      if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
      return at.getTime();
    }
    m = text.match(/in\s+(\d+)\s*(hours?|hrs?|h\b|minutes?|mins?|m\b)/i);
    if (m) return Date.now() + Number(m[1]) * (/^h/i.test(m[2]) ? 3_600_000 : 60_000);
    return null;
  }

  function send(kind, extra) {
    try {
      chrome.runtime.sendMessage({ type: 'event', site, kind, ...extra });
    } catch {
      // The extension was reloaded or removed: this page's copy is orphaned.
      clearInterval(timer);
    }
  }

  let writing = false;
  let lastSent = 0;
  let lastPresent = 0;
  let lastLimitCheck = 0;
  let limitShown = false;

  function tick() {
    const now = Date.now();
    const nowWriting = isWriting();
    if (nowWriting !== writing) {
      writing = nowWriting;
      send(writing ? 'generating' : 'idle');
      lastSent = now;
      lastPresent = now;
    } else if (writing && now - lastSent > 10_000) {
      send('generating'); // still writing
      lastSent = now;
      lastPresent = now;
    } else if (now - lastPresent > 60_000) {
      send('present'); // the tab is still open
      lastPresent = now;
    }

    if (!writing && now - lastLimitCheck > 5_000) {
      lastLimitCheck = now;
      const notice = limitNotice();
      if (notice && !limitShown) send('limit', { resetAt: parseReset(notice) });
      limitShown = !!notice;
    }
  }

  send('present');
  lastPresent = Date.now();
  const timer = setInterval(tick, 1_000);
})();
