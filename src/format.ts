/* Le format des notes de livre : lire et écrire l'en-tête et les sections, sans rien d'Obsidian
   (testable seul). L'en-tête s'écrit ligne par ligne, au format `clé: "valeur"`. */
// une valeur d'en-tête en texte : les nombres et les booléens comptent, le reste non
export const str = (x: unknown): string => typeof x === 'string' ? x : typeof x === 'number' || typeof x === 'boolean' ? String(x) : '';
export const fold = (s: unknown) => str(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const list = (v: unknown): string[] => (v == null ? [] : Array.isArray(v) ? (v as unknown[]) : [v]).map(x => str(x).trim()).filter(Boolean);
export const one = (v: unknown): string | undefined => list(v)[0];
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const HEAD = /^---\n([\s\S]*?)\n---\n?/;

/* ---------- Lire une note ---------- */
// le texte de la note, sans l'en-tête
export function ownText(text: string) { return text.replace(HEAD, ''); }
export function sectionsOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let cur: string | null = null;
  for (const line of ownText(text).split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = fold(h[1]); out[cur] = ''; continue; }
    if (cur) out[cur] += line + '\n';
  }
  for (const k in out) out[k] = out[k].trim();
  return out;
}
export const items = (s?: string): string[] => (s || '').split('\n').map(l => l.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim() ?? '').filter(Boolean);
export const plain = (s: string) => s
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/==|\*\*|__|`/g, '');
/* ---------- Écrire dans une note ---------- */
// des champs de l'en-tête, remplacés ou ajoutés un par un ; null retire le champ
export function withFields(text: string, fields: Record<string, string | string[] | null | undefined>) {
  const m = text.match(HEAD);
  const head = m ? m[1].split('\n') : [];
  const rest = m ? text.slice(m[0].length) : text;
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const i = head.findIndex(l => new RegExp(`^${escRe(k)}:`).test(l));
    if (i >= 0) { let j = i + 1; while (j < head.length && /^\s+-/.test(head[j])) j++; head.splice(i, j - i); }
    if (v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    const lines = Array.isArray(v) ? [`${k}:`, ...v.map(x => `  - ${JSON.stringify(x)}`)] : [`${k}: ${JSON.stringify(v)}`];
    head.splice(i >= 0 ? i : head.length, 0, ...lines);
  }
  return `---\n${head.join('\n')}\n---\n${rest}`;
}
// des sections du corps, remplacées ou ajoutées à la fin
export function withSections(text: string, secs: [string, string][]) {
  const m = text.match(HEAD), head = m ? m[0] : '';
  let mine = text.slice(head.length);
  for (const [title, content] of secs) {
    if (!content?.trim()) continue;
    const block = `## ${title}\n${content.trim()}\n\n`;
    const re = new RegExp(`^## ${escRe(title)}\\s*\\n[\\s\\S]*?(?=^## |(?![\\s\\S]))`, 'm');
    mine = re.test(mine) ? mine.replace(re, block) : `${mine.trim() ? mine.replace(/\s+$/, '') + '\n\n' : ''}${block}`;
  }
  return `${head}${mine.replace(/\s+$/, '')}\n`;
}
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
export const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };

