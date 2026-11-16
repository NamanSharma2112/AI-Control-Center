// AI Control Center — background worker.
//
// Passes the content scripts' signals (writing / done / limit reached) to the
// AI Control Center app on this computer, over 127.0.0.1 only, and handles
// pairing: the app must approve this browser before it accepts anything.

const PORTS = [47821, 47822, 47823, 47824];
const BASE = (port) => `http://127.0.0.1:${port}`;

async function config() {
  return chrome.storage.local.get(['token', 'port']);
}

/** The app's port, or null when the app is not running. */
async function findApp(token) {
  for (const port of PORTS) {
    try {
      const res = await fetch(`${BASE(port)}/v1/hello`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      // 401 is still the app, just not paired with us.
      if (res.status === 200 || res.status === 401) return { port, paired: res.status === 200 };
    } catch {
      // Nothing on this port.
    }
  }
  return null;
}

// Events are batched for a moment so a burst becomes one request.
let queue = [];
let flushTimer = null;

function enqueue(event) {
  queue.push(event);
  if (!flushTimer) flushTimer = setTimeout(flush, 300);
}

async function flush() {
  flushTimer = null;
  const batch = queue.splice(0, 50);
  if (batch.length === 0) return;
  let { token, port } = await config();
  if (!token) return; // not paired: nothing is sent anywhere
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE(port || PORTS[0])}/v1/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (res.status === 401) {
        // The app forgot this browser ("Disconnect" in the app).
        await chrome.storage.local.remove(['token']);
      }
      return;
    } catch {
      // The app moved to another port, or is not running.
      const found = await findApp(token);
      if (!found) return;
      port = found.port;
      await chrome.storage.local.set({ port });
    }
  }
}

// Which site each tab is on, so a closed tab can be reported.
async function rememberTab(tabId, site) {
  const { tabs = {} } = await chrome.storage.session.get('tabs');
  if (tabs[tabId] === site) return;
  tabs[tabId] = site;
  await chrome.storage.session.set({ tabs });
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { tabs = {} } = await chrome.storage.session.get('tabs');
  const site = tabs[tabId];
  if (!site) return;
  delete tabs[tabId];
  await chrome.storage.session.set({ tabs });
  enqueue({ site, tab: tabId, kind: 'closed' });
});

function browserName() {
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const named = brands.map((b) => b.brand).find((b) => !/Not.?A.?Brand|Chromium/i.test(b));
  return named || 'Chrome';
}

async function pair() {
  const found = await findApp(null);
  if (!found) return { state: 'no-app' };
  let id;
  try {
    const res = await fetch(`${BASE(found.port)}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browser: browserName() }),
    });
    if (res.status === 429) return { state: 'busy' };
    id = (await res.json()).id;
  } catch {
    return { state: 'no-app' };
  }
  await chrome.storage.session.set({ pairing: { id, port: found.port, since: Date.now() } });
  return { state: 'waiting' };
}

/** Polled by the popup while you approve in the app. */
async function pairingProgress() {
  const { pairing } = await chrome.storage.session.get('pairing');
  if (!pairing) return { state: 'idle' };
  try {
    const res = await fetch(`${BASE(pairing.port)}/v1/pair/${pairing.id}`);
    const body = await res.json();
    if (body.status === 'approved' && body.token) {
      await chrome.storage.local.set({ token: body.token, port: pairing.port });
      await chrome.storage.session.remove('pairing');
      return { state: 'connected' };
    }
    if (body.status !== 'pending') {
      await chrome.storage.session.remove('pairing');
      return { state: body.status }; // denied | expired
    }
    return { state: 'waiting' };
  } catch {
    return { state: 'no-app' };
  }
}

async function status() {
  const { token } = await config();
  const found = await findApp(token);
  const { tabs = {} } = await chrome.storage.session.get('tabs');
  const sites = Object.values(tabs);
  const { pairing } = await chrome.storage.session.get('pairing');
  return {
    app: found ? (found.paired ? 'connected' : 'unpaired') : 'not-running',
    pairing: !!pairing,
    open: {
      chatgpt: sites.filter((s) => s === 'chatgpt').length,
      'claude-web': sites.filter((s) => s === 'claude-web').length,
      gemini: sites.filter((s) => s === 'gemini').length,
    },
  };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type === 'event' && sender.tab && typeof sender.tab.id === 'number') {
    const { site, kind, resetAt } = message;
    rememberTab(sender.tab.id, site);
    enqueue({ site, tab: sender.tab.id, kind, resetAt: resetAt ?? null });
    return false;
  }
  const handlers = { pair, pairingProgress, status };
  if (message.type === 'disconnect') {
    chrome.storage.local.remove(['token']).then(() => reply({ ok: true }));
    return true;
  }
  if (handlers[message.type]) {
    handlers[message.type]().then(reply);
    return true; // reply arrives asynchronously
  }
  return false;
});
