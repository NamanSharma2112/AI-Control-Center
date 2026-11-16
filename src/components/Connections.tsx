import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ArrowLeft, Check, CircleDashed, Copy, FolderOpen, Puzzle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '@/store/app';
import { useSettings } from '@/store/settings';
import { BROWSER_PROVIDERS, CLI_PROVIDERS } from '@/providers/registry';
import { CATEGORIES } from '@/lib/categories';
import { invokeSafe, invokeStrict, isTauri } from '@/lib/tauri';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/cn';
import type { CliProviderId, ProviderId } from '@/types/domain';

/** Where the app looks for a CLI, and what it found (from Rust). */
interface SourceInfo {
  id: CliProviderId;
  folder: string | null;
  origin: 'custom' | 'env' | 'default' | null;
  found: boolean;
  sessions: number;
}

interface PairRequest {
  id: string;
  browser: string;
  createdAt: number;
}

interface BridgeStatus {
  port: number | null;
  paired: boolean;
  sites: Array<{ site: ProviderId; name: string; lastSeen: number | null; openTabs: number; writing: boolean }>;
  pending: PairRequest[];
}

const ENV_VAR: Record<CliProviderId, string> = {
  'claude-code': 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
};

const USUAL_FOLDER: Record<CliProviderId, string> = {
  'claude-code': '~/.claude',
  codex: '~/.codex',
};

/** Re-reads what the app can see whenever something changes. */
function useSources() {
  const [sources, setSources] = useState<SourceInfo[] | null>(null);
  const rescan = useCallback(async () => {
    setSources(await invokeSafe<SourceInfo[] | null>('detect_sources', undefined, null));
  }, []);
  useEffect(() => {
    void rescan();
    if (!isTauri()) return;
    const off = listen('provider://changed', () => void rescan());
    return () => void off.then((fn) => fn());
  }, [rescan]);
  return { sources, rescan };
}

export function useBridgeStatus() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const read = useCallback(async () => {
    setStatus(await invokeSafe<BridgeStatus | null>('bridge_status', undefined, null));
  }, []);
  useEffect(() => {
    void read();
    if (!isTauri()) return;
    // Pairing requests and site activity come and go: keep it current while shown.
    const timer = window.setInterval(() => void read(), 2_000);
    const offs = [
      listen('bridge://pair-request', () => void read()),
      listen('bridge://changed', () => void read()),
      listen('provider://changed', () => void read()),
    ];
    return () => {
      window.clearInterval(timer);
      for (const off of offs) void off.then((fn) => fn());
    };
  }, [read]);
  return { status, read };
}

/** The full page: every source the app can read, and how to connect each. */
export function Connections() {
  const setRoute = useApp((s) => s.setRoute);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setRoute('dashboard')}
          aria-label="Back to overview"
          className="-ml-1.5 grid size-8 place-items-center rounded-full text-text-2 transition-colors duration-100 hover:bg-card hover:text-text-1"
        >
          <ArrowLeft size={16} strokeWidth={1.9} />
        </button>
        <div className="min-w-0">
          <h1 className="t-title text-text-1">Connections</h1>
        </div>
        {!isTauri() && (
          <span className="t-caption ml-auto text-text-3">Browser preview: connecting needs the desktop app</span>
        )}
      </header>
      <p className="t-caption mt-1 mb-3 text-text-2">
        Where your live data comes from. Everything is read on this computer; nothing is sent anywhere.
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid gap-3 @min-[640px]:grid-cols-2">
          <Section title="Coding agents on this computer">
            <CliSources />
          </Section>
          <Section title="Chats in your browser">
            <BrowserConnect />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg bg-card py-1.5">
      <h2 className="t-label px-4 pt-2 pb-1 text-text-2">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

/** Claude Code and Codex: found or not, where, and a folder of your own. */
export function CliSources() {
  const { sources, rescan } = useSources();
  return (
    <div className="divide-y divide-rule">
      {CLI_PROVIDERS.map((id) => (
        <CliSource key={id} id={id} info={sources?.find((s) => s.id === id) ?? null} onChanged={rescan} />
      ))}
    </div>
  );
}

function CliSource({ id, info, onChanged }: { id: CliProviderId; info: SourceInfo | null; onChanged: () => void }) {
  const cat = CATEGORIES[id];
  const folders = useSettings((s) => s.settings.folders);
  const set = useSettings((s) => s.set);
  const refresh = useApp((s) => s.refresh);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folders[id] ?? '');

  const save = async (value: string) => {
    const next = { ...folders, [id]: value.trim() };
    set('folders', next);
    await invokeSafe<void>('set_data_folders', { folders: next }, undefined);
    setEditing(false);
    onChanged();
    void refresh();
  };

  const where =
    info?.origin === 'custom'
      ? 'your folder'
      : info?.origin === 'env'
        ? ENV_VAR[id]
        : 'its usual folder';

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <cat.icon size={16} strokeWidth={2} className={cn('mt-0.5 shrink-0', cat.text)} />
        <div className="min-w-0 flex-1">
          <p className="t-strong text-text-1">{cat.label}</p>
          <p className="t-caption mt-0.5 flex items-center gap-1.5 text-text-2">
            {info?.found ? (
              <>
                <Check size={12} strokeWidth={2.4} className="text-ok" />
                Connected · {info.sessions.toLocaleString()} {info.sessions === 1 ? 'session' : 'sessions'} in {where}
              </>
            ) : info ? (
              <>
                <CircleDashed size={12} strokeWidth={2} />
                Not found in {where}
              </>
            ) : (
              <>
                <CircleDashed size={12} strokeWidth={2} />
                Read from {USUAL_FOLDER[id]} in the desktop app
              </>
            )}
          </p>
          {info?.folder && (
            <p className="t-mono mt-1 truncate text-[11.5px] text-text-3" title={info.folder}>
              {info.folder}
            </p>
          )}
          {info && !info.found && !editing && (
            <p className="t-caption mt-1.5 text-text-2">
              Run {cat.label} once and it connects by itself. Using it somewhere else, such as inside
              WSL? Point the app at its folder.
            </p>
          )}
        </div>
        {info && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(folders[id] ?? '');
              setEditing(true);
            }}
            className="t-label shrink-0 rounded-full border border-rule-strong px-3 py-1 text-text-1 transition-colors duration-100 hover:bg-card-hover"
          >
            {info.origin === 'custom' ? 'Change' : 'Use a folder'}
          </button>
        )}
      </div>

      {editing && (
        <form
          className="mt-2.5 flex gap-2 pl-7"
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft);
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={id === 'claude-code' ? '\\\\wsl.localhost\\Ubuntu\\home\\you\\.claude' : '~/.codex'}
            aria-label={`${cat.label} folder`}
            className="t-mono min-w-0 flex-1 rounded-md border border-rule-strong bg-panel px-2.5 py-1.5 text-[12px] text-text-1 outline-none focus:border-focus"
          />
          <button type="submit" className="t-label rounded-md bg-primary px-3 text-primary-fg hover:bg-primary-hover">
            Save
          </button>
          {folders[id] ? (
            <button
              type="button"
              onClick={() => void save('')}
              className="t-label rounded-md px-2 text-text-2 hover:text-text-1"
            >
              Reset
            </button>
          ) : (
            <button type="button" onClick={() => setEditing(false)} className="t-label rounded-md px-2 text-text-2 hover:text-text-1">
              Cancel
            </button>
          )}
        </form>
      )}
    </div>
  );
}

/** ChatGPT, Claude and Gemini through the companion extension. */
export function BrowserConnect() {
  const { status, read } = useBridgeStatus();
  const refresh = useApp((s) => s.refresh);
  const [installedAt, setInstalledAt] = useState<string | null>(null);
  const desktop = isTauri();
  const seenAny = status?.sites.some((s) => s.lastSeen !== null) ?? false;

  const answer = async (id: string, allow: boolean) => {
    try {
      await invokeStrict<void>('bridge_respond', { id, allow });
      if (allow) toast.success('Browser connected', { description: 'Your chats appear as soon as a site is open.' });
    } catch (e) {
      toast.error(String(e));
    }
    void read();
  };

  const install = async () => {
    try {
      const path = await invokeStrict<string>('install_browser_extension');
      setInstalledAt(path);
    } catch (e) {
      toast.error('Could not set up the extension', { description: String(e) });
    }
  };

  return (
    <div>
      {status?.pending.map((request) => (
        <div key={request.id} className="mx-3 my-2 rounded-lg border border-warn/40 bg-warn/10 px-3.5 py-3">
          <p className="t-strong text-text-1">{request.browser} wants to connect</p>
          <p className="t-caption mt-0.5 text-text-2">
            Allow it to show your ChatGPT, Claude and Gemini activity here. It sends nothing else.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => void answer(request.id, true)}
              className="t-label h-8 rounded-full bg-primary px-4 text-primary-fg hover:bg-primary-hover"
            >
              Allow
            </button>
            <button
              type="button"
              onClick={() => void answer(request.id, false)}
              className="t-label h-8 rounded-full px-3 text-text-2 hover:text-text-1"
            >
              Don't allow
            </button>
          </div>
        </div>
      ))}

      <ul className="px-4 py-1">
        {BROWSER_PROVIDERS.map((id) => {
          const cat = CATEGORIES[id];
          const site = status?.sites.find((s) => s.site === id);
          return (
            <li key={id} className="flex items-center gap-3 py-1.5">
              <cat.icon size={15} strokeWidth={2} className={cat.text} />
              <span className="t-body flex-1 text-text-1">{cat.label}</span>
              <span className={cn('t-caption', site?.writing ? 'text-ok' : 'text-text-3')}>
                {!site || site.lastSeen === null
                  ? 'Not seen yet'
                  : site.writing
                    ? 'Writing a reply'
                    : site.openTabs > 0
                      ? `${site.openTabs} ${site.openTabs === 1 ? 'tab' : 'tabs'} open`
                      : `Last seen ${formatRelative(site.lastSeen, Date.now())}`}
              </span>
            </li>
          );
        })}
      </ul>

      {!(status?.paired && seenAny) && (
        <ol className="mx-3 mb-2 space-y-2.5 rounded-lg bg-panel px-3.5 py-3">
          <Step n={1} title="Add the extension to Chrome, Edge or Brave">
            {installedAt ? (
              <>Done. It is in <span className="t-mono break-all text-text-1">{installedAt}</span>, now open.</>
            ) : (
              'It comes with the app.'
            )}
            <div className="mt-2">
              <button
                type="button"
                disabled={!desktop}
                onClick={() => void install()}
                className="t-label inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-primary-fg enabled:hover:bg-primary-hover disabled:opacity-50"
              >
                <FolderOpen size={14} strokeWidth={2} />
                {installedAt ? 'Show it again' : 'Get the extension'}
              </button>
            </div>
          </Step>
          <Step n={2} title="Load it in your browser">
            Open <CopyText text="chrome://extensions" />, switch on <b className="font-medium text-text-1">Developer mode</b>,
            click <b className="font-medium text-text-1">Load unpacked</b> and choose that folder.
          </Step>
          <Step n={3} title="Connect">
            Click the extension's <Puzzle size={12} className="inline align-[-1px]" /> icon, press{' '}
            <b className="font-medium text-text-1">Connect to the app</b>, then <b className="font-medium text-text-1">Allow</b> here.
          </Step>
        </ol>
      )}

      <div className="flex items-start gap-2 px-4 pt-1 pb-2">
        <ShieldCheck size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-text-3" />
        <p className="t-caption flex-1 text-text-3">
          The extension reads no messages: only whether a reply is being written and whether you've hit a
          limit, sent only to this app over 127.0.0.1.
        </p>
      </div>
      {status?.paired && (
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={async () => {
              await invokeSafe<void>('bridge_forget', undefined, undefined);
              void read();
              void refresh();
              toast('Browsers disconnected', { description: 'Connect again from the extension when you want.' });
            }}
            className="t-label text-text-3 hover:text-text-1"
          >
            Disconnect browsers
          </button>
        </div>
      )}
      {desktop && status && status.port === null && (
        <p className="t-caption px-4 pb-2 text-error">
          The browser connection could not start: another program is using its ports (47821–47824).
        </p>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="t-label grid size-5 shrink-0 place-items-center rounded-full bg-card text-text-2">{n}</span>
      <div className="min-w-0">
        <p className="t-label text-text-1">{title}</p>
        <div className="t-caption mt-0.5 text-text-2">{children}</div>
      </div>
    </li>
  );
}

function CopyText({ text }: { text: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast('Copied', { description: `Paste ${text} into the address bar.` });
        } catch {
          // Clipboard unavailable: the text is on screen to type.
        }
      }}
      className="t-mono inline-flex items-center gap-1 rounded bg-card px-1.5 py-px text-[11.5px] text-text-1 hover:bg-card-hover"
    >
      {text}
      <Copy size={11} strokeWidth={2} />
    </button>
  );
}
