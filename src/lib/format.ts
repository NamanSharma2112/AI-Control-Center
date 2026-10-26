/**
 * "claude-sonnet-4-5-20250929" → "Claude Sonnet 4.5"; "gpt-5-codex" → "GPT-5 Codex".
 *
 * The CLIs record raw model ids. The card shows a readable name, derived
 * mechanically so a new model needs no code change and nothing is guessed.
 */
export function formatModel(raw: string | undefined): string | null {
  if (!raw) return null;
  // Drop a trailing build date such as -20250929.
  const id = raw.replace(/-\d{8}$/, '');
  const parts = id.split('-').filter(Boolean);
  const out: string[] = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (/^\d+$/.test(part)) {
      // Join consecutive version numbers: 4-5 → 4.5.
      const prev = out[out.length - 1];
      if (prev !== undefined && /^\d+(\.\d+)*$/.test(prev)) {
        out[out.length - 1] = `${prev}.${part}`;
      } else if (out.length > 0 && /^GPT$/.test(out[out.length - 1])) {
        out[out.length - 1] = `GPT-${part}`;
      } else {
        out.push(part);
      }
      continue;
    }
    if (part.toLowerCase() === 'gpt') {
      out.push('GPT');
      continue;
    }
    if (/^o\d/.test(part)) {
      out.push(part);
      continue;
    }
    out.push(part.charAt(0).toUpperCase() + part.slice(1));
  }

  return out.join(' ');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
