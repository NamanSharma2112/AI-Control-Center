const $ = (id) => document.getElementById(id);
const ask = (type) => chrome.runtime.sendMessage({ type });

let polling = null;

function show({ headline, tone, explain, button, disconnect }) {
  $('headline').textContent = headline;
  $('headline').className = tone || '';
  $('action').hidden = !explain;
  $('explain').textContent = explain || '';
  $('connect').hidden = !button;
  if (button) {
    $('connect').textContent = button.label;
    $('connect').disabled = !!button.disabled;
  }
  $('disconnect').hidden = !disconnect;
}

function showSites(open) {
  for (const li of document.querySelectorAll('#sites li')) {
    const n = open[li.dataset.site] || 0;
    li.classList.toggle('on', n > 0);
    li.querySelector('.count').textContent = n ? `${n} tab${n > 1 ? 's' : ''} open` : '';
  }
}

async function refresh() {
  const status = await ask('status');
  showSites(status.open);
  if (status.app === 'connected') {
    stopPolling();
    show({ headline: 'Connected', tone: 'ok', disconnect: true });
  } else if (status.app === 'not-running') {
    show({
      headline: 'The app is not running',
      tone: 'warn',
      explain: 'Open AI Control Center on this computer, then connect.',
      button: { label: 'Try again' },
    });
  } else if (status.pairing) {
    waiting();
  } else {
    show({
      headline: 'Not connected',
      explain: 'Connect once and your ChatGPT, Claude and Gemini activity appears in the app.',
      button: { label: 'Connect to the app' },
    });
  }
}

function waiting() {
  show({
    headline: 'Waiting for you in the app…',
    tone: 'warn',
    explain: 'AI Control Center is asking whether to allow this browser. Click Allow there.',
    button: { label: 'Waiting…', disabled: true },
  });
  if (polling) return;
  polling = setInterval(async () => {
    const progress = await ask('pairingProgress');
    if (progress.state === 'waiting') return;
    stopPolling();
    if (progress.state === 'denied') {
      show({ headline: 'Not allowed', tone: 'warn', explain: 'The app said no. You can ask again.', button: { label: 'Connect to the app' } });
    } else if (progress.state === 'expired') {
      show({ headline: 'The request timed out', tone: 'warn', explain: 'Ask again, then click Allow in the app.', button: { label: 'Connect to the app' } });
    } else {
      refresh();
    }
  }, 1_500);
}

function stopPolling() {
  clearInterval(polling);
  polling = null;
}

$('connect').addEventListener('click', async () => {
  $('connect').disabled = true;
  const result = await ask('pair');
  if (result.state === 'waiting') waiting();
  else if (result.state === 'busy') show({ headline: 'Too many requests', tone: 'warn', explain: 'Answer the requests already waiting in the app first.', button: { label: 'Try again' } });
  else refresh();
});

$('disconnect').addEventListener('click', async () => {
  await ask('disconnect');
  refresh();
});

refresh();
