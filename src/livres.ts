/* Les livres, tels qu'ils vivent dans le vault.

   Un livre est une note dont l'en-tête dit `type: livre` (le type se règle) et qui porte un statut de
   lecture. Tout ce que l'étagère montre vient de cette note, et tout ce qu'elle change y retourne :
   pas de base à part, pas de deuxième fichier.

   - L'en-tête : statut, auteur, année, couverture, genres, mots-clés, thèmes, d'où vient le livre.
     Il est écrit ligne par ligne, au format `clé: "valeur"`.
   - Le corps : les sections « Pourquoi le lire », « Résumé », « Tropes ».
   - Les couvertures : gardées dans le dossier du plugin, hors des notes. */
import { App, TFile, normalizePath, requestUrl } from 'obsidian';
import type { Book, Card, NewBook, OLDoc } from './types';

export interface Settings { dossier: string; type: string; langue: string }
// type vide : « livre » et « book » sont tous deux reconnus
export const defaults = (): Settings => ({ dossier: '', type: '', langue: '' });

/* Les noms des champs, dans la langue d'Obsidian. L'étagère écrit dans la sienne et sait lire les deux. */
type Key = 'lecture' | 'lu' | 'commence' | 'auteur' | 'annee' | 'couverture' | 'titre' | 'themes' | 'mots' | 'decouvert' | 'suite' | 'resume' | 'pages' | 'genres' | 'openlibrary';
const KEYS: Record<string, Record<Key, string>> = {
  fr: { lecture: 'lecture', lu: 'lu', commence: 'commence', auteur: 'auteur', annee: 'année', couverture: 'couverture', titre: 'titre', themes: 'themes', mots: 'mots', decouvert: 'decouvert', suite: 'suite', resume: 'resume', pages: 'pages', genres: 'genres', openlibrary: 'openlibrary' },
  en: { lecture: 'status', lu: 'finished', commence: 'started', auteur: 'author', annee: 'year', couverture: 'cover', titre: 'title', themes: 'themes', mots: 'keywords', decouvert: 'found_via', suite: 'sequel_of', resume: 'summary', pages: 'pages', genres: 'genres', openlibrary: 'openlibrary' },
};
const STATUS: Record<string, Record<string, string>> = {
  fr: { 'a lire': 'a lire', 'en cours': 'en cours', lu: 'lu', check: 'a verifier' },
  en: { 'a lire': 'to read', 'en cours': 'reading', lu: 'read', check: 'to check' },
};
const SECTIONS: Record<string, Record<string, string>> = {
  fr: { why: 'Pourquoi le lire', summary: 'Résumé', tropes: 'Tropes' },
  en: { why: 'Why read it', summary: 'Summary', tropes: 'Tropes' },
};
type FM = Record<string, unknown>;
const get = (fm: FM, k: Key): unknown => fm[KEYS.fr[k]] ?? fm[KEYS.en[k]] ?? (k === 'annee' ? fm.annee : undefined);
const statusOf = (v: unknown) => { const x = fold(one(v)); return x === 'lu' || x === 'read' ? 'lu' : x === 'en cours' || x === 'reading' ? 'en cours' : 'a lire'; };

import { fold, list, one, str, ownText, sectionsOf, items, plain, withFields, withSections, safeName, hash } from './format';
export { fold };

// une image trop grande est réduite (en gardant ses proportions) avant d'être gardée : la fiche reste nette,
// le dossier du plugin reste léger
async function shrink(buf: ArrayBuffer, maxH: number): Promise<ArrayBuffer> {
  try {
    const img = await createImageBitmap(new Blob([buf]));
    if (img.height <= maxH) return buf;
    const c = createEl('canvas');
    c.height = maxH; c.width = Math.round(img.width * maxH / img.height);
    const g = c.getContext('2d');
    if (!g) return buf;
    g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.9));
    return out ? await out.arrayBuffer() : buf;
  } catch { return buf; }
}

/* ---------- Le pont entre les notes et l'étagère ---------- */
export class Livres {
  private blobs = new Map<string, string>();
  private asked = new Set<string>();
  constructor(private app: App, public settings: Settings, private dir: string, private lang: string) {}

  private fm(f: TFile): FM | undefined { return this.app.metadataCache.getFileCache(f)?.frontmatter; }
  private isType(t: unknown) { const v = fold(t); return this.settings.type ? v === fold(this.settings.type) : v === 'livre' || v === 'book'; }
  isBook(f: unknown) { const fm = f instanceof TFile ? this.fm(f) : null; return !!fm && this.isType(fm.type); }
  /* Les notes s'écrivent dans la langue des livres déjà là, pas forcément celle de l'interface :
     un vault en français reste en français même si Obsidian est en anglais. */
  private format() {
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.fm(f);
      if (!fm || !this.isType(fm.type)) continue;
      if (fm[KEYS.fr.lecture] != null) return { lang: 'fr', type: str(fm.type) };
      if (fm[KEYS.en.lecture] != null) return { lang: 'en', type: str(fm.type) };
    }
    return { lang: this.lang, type: this.lang === 'fr' ? 'livre' : 'book' };
  }
  private get K() { return KEYS[this.format().lang] || KEYS.en; }
  known(name: string) { return !!this.app.metadataCache.getFirstLinkpathDest(name, ''); }

  /* les livres posés sur l'étagère : ceux qui ont un statut de lecture */
  async read(): Promise<Book[]> {
    const out: Book[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.fm(f);
      if (!fm || !this.isType(fm.type) || !one(get(fm, 'lecture'))) continue;
      out.push(await this.book(f, fm));
    }
    for (const b of out) if (!b.pages && !this.asked.has(b.path)) { this.asked.add(b.path); void this.findPages(b); }
    return out;
  }

  private async book(f: TFile, fm: FM): Promise<Book> {
    const text = await this.app.vault.cachedRead(f), s = sectionsOf(text);
    const year = one(get(fm, 'annee'));
    return {
      id: f.path, path: f.path,
      titre: one(get(fm, 'titre')) || f.basename,
      auteur: one(get(fm, 'auteur')) || '',
      annee: year && /^-?\d+$/.test(year) ? Number(year) : year || '',
      lecture: statusOf(get(fm, 'lecture')),
      lu: one(get(fm, 'lu')), commence: one(get(fm, 'commence')),
      couverture: one(get(fm, 'couverture')), olkey: one(fm.openlibrary),
      pages: Number(one(get(fm, 'pages'))) || undefined,
      themes: list(fm.themes), mots: list(get(fm, 'mots')),
      genres: list(fm.genres).map(g => fold(g).replace(/ /g, '-')),
      decouvert: one(get(fm, 'decouvert')), suiteDe: one(get(fm, 'suite')),
      certitude: ['a verifier', 'to check'].includes(fold(one(get(fm, 'resume')))) ? 'a verifier' : undefined,
      resume: plain(s['resume'] || s['summary'] || ''), pourquoi: plain(s['pourquoi le lire'] || s['why read it'] || ''), tropes: items(s['tropes']),
      aliases: list(fm.aliases),
    };
  }

  /* les notes écrites sur un livre : celles qui pointent vers lui, et celles du dossier qui porte son nom */
  async cards(b: Book) {
    const from = new Set<string>();
    for (const [src, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) if (targets[b.path] && src !== b.path) from.add(src);
    const file = this.app.vault.getAbstractFileByPath(b.path);
    const names = new Set([b.titre, file instanceof TFile ? file.basename : '', ...(b.aliases || [])].map(fold).filter(Boolean));
    for (const f of this.app.vault.getMarkdownFiles()) if (f.parent && f.parent.path !== '/' && names.has(fold(f.parent.name))) from.add(f.path);
    const out: Card[] = [];
    for (const p of from) {
      const f = this.app.vault.getAbstractFileByPath(p);
      if (!(f instanceof TFile) || f.extension !== 'md') continue;
      if (this.isBook(f)) continue;   // un autre livre n'est pas une note sur celui-ci
      if (this.booksLinked(p) > 2) continue;   // une liste de livres (index, liste de lecture) ne parle pas de celui-ci
      const body = ownText(await this.app.vault.cachedRead(f)).trim();
      const cit = (body.match(/^\s*(?:[-*]\s*)?(?:>\s*)?["“«]/gm) || []).length;
      const par = body.split(/\n\s*\n/).map(x => x.trim()).find(x => x && !/^(#|citations?\s*:?$|source\s*:)/i.test(x)) || '';
      let ex = plain(par).replace(/\s+/g, ' ').trim();
      if (ex.length > 170) ex = ex.slice(0, 170).replace(/\s+\S*$/, '') + '…';
      out.push({ t: f.basename, ex, cit, path: f.path });
    }
    return out.sort((a, c) => c.cit - a.cit || a.t.localeCompare(c.t));
  }

  /* ---------- Les couvertures, gardées dans le dossier du plugin ---------- */
  async cover(b: Book): Promise<string | null> {
    let url = b.couverture;
    if (!url) url = await this.findCover(b);
    if (!url) return null;
    const cached = this.blobs.get(url);
    if (cached) return cached;
    // Open Library garde la couverture d'origine, bien plus grande que la taille L (500 px de haut) :
    // c'est elle qu'on garde, réduite à 1200 px de haut, pour une fiche nette sur un écran Retina
    const hd = url.replace(/(covers\.openlibrary\.org\/b\/\w+\/[^/]+?)-[SML]\.jpg$/, '$1.jpg');
    const a = this.app.vault.adapter, dir = normalizePath(`${this.dir}/couvertures`), p = `${dir}/${hash(hd)}.jpg`;
    try {
      if (!(await a.exists(p))) {
        if (!(await a.exists(dir))) await a.mkdir(dir);
        let buf: ArrayBuffer | null = null;
        for (const u of hd === url ? [url] : [hd, url]) {
          try { const r = await requestUrl({ url: u }); if (r.arrayBuffer.byteLength >= 1200) { buf = r.arrayBuffer; break; } } catch { /* l'autre taille, ou rien */ }
        }
        if (!buf) return null;   // Open Library répond par une image vide quand il n'a rien
        await a.writeBinary(p, await shrink(buf, 1200));
      }
      // une adresse blob: est de la même origine que la page : on peut lire les couleurs de l'image
      const blob = URL.createObjectURL(new Blob([await a.readBinary(p)], { type: 'image/jpeg' }));
      this.blobs.set(url, blob);
      return blob;
    } catch { return null; }
  }
  private async findCover(b: Book) {
    try {
      const q = new URLSearchParams({ title: b.titre, limit: '5', fields: 'key,cover_i' });
      if (b.auteur) q.set('author', b.auteur);
      const d = (await this.ol(q)).find(x => x.cover_i);
      if (!d) return null;
      const url = `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`;
      await this.write(b.path, t => withFields(t, { [this.K.couverture]: url, openlibrary: b.olkey ? undefined : d.key }));
      return url;
    } catch { return null; }
  }
  /* le nombre de pages donne l'épaisseur du livre : cherché une fois, puis écrit dans la note (`pages:`),
     où on peut le corriger à la main */
  private async findPages(b: Book) {
    try {
      const q = new URLSearchParams({ title: b.titre, limit: '5', fields: 'number_of_pages_median' });
      if (b.auteur) q.set('author', b.auteur);
      const n = (await this.ol(q)).find(x => x.number_of_pages_median)?.number_of_pages_median;
      if (n) await this.write(b.path, t => withFields(t, { [this.K.pages]: String(n) }));
    } catch { /* sans réseau : l'épaisseur par défaut */ }
  }
  revoke() { for (const u of this.blobs.values()) URL.revokeObjectURL(u); this.blobs.clear(); }

  /* ---------- Changer une note ---------- */
  private async write(path: string, fn: (t: string) => string) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return;
    await this.app.vault.process(f, fn);
  }

  // combien de livres une note cite : au-delà de deux, c'est une liste, pas une note sur un livre
  private booksLinked(path: string) {
    let n = 0;
    for (const t of Object.keys(this.app.metadataCache.resolvedLinks[path] || {})) if (this.isBook(this.app.vault.getAbstractFileByPath(t))) n++;
    return n;
  }

  /* Retirer un livre de l'étagère : il perd son statut de lecture, la note et ce qu'on y a écrit restent */
  remove(b: Book) {
    const K = this.K;
    return this.write(b.path, t => withFields(t, { [K.lecture]: null, [K.lu]: null, [K.commence]: null }));
  }

  setLecture(b: Book, lecture: string) {
    const today = new Date().toISOString().slice(0, 10);
    // commencé : la date de début ; lu : la date de fin (la date de début reste) ; remis à lire : plus de dates
    const K = this.K, fields = { [K.lecture]: STATUS[this.format().lang]?.[lecture] ?? lecture, [K.lu]: lecture === 'lu' ? today : null, [K.commence]: lecture === 'en cours' ? today : lecture === 'a lire' ? null : undefined };
    return this.write(b.path, t => withFields(t, fields));
  }

  /* ---------- Chercher et ajouter ---------- */
  private async ol(q: URLSearchParams): Promise<OLDoc[]> {
    const json = (await requestUrl({ url: `https://openlibrary.org/search.json?${q.toString()}` })).json as { docs?: OLDoc[] };
    return json.docs || [];
  }
  search(q: string) {
    return this.ol(new URLSearchParams({ q, limit: '16', fields: 'key,title,author_name,first_publish_year,cover_i,subject,number_of_pages_median' }));
  }
  async description(key: string) {
    try {
      const w = (await requestUrl({ url: `https://openlibrary.org${key}.json` })).json as { description?: string | { value?: string } };
      const d = typeof w.description === 'string' ? w.description : w.description?.value;
      return d ? d.split(/\n\s*\n|-{4,}|\(\[source\]/)[0].replace(/(\*\*?|__?)(.+?)\1/g, '$2').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim().slice(0, 900) : '';
    } catch { return ''; }
  }

  private folder() {
    if (this.settings.dossier) return this.settings.dossier;
    return this.format().lang === 'fr' ? 'Livres' : 'Books';
  }

  /* Un livre déjà connu du vault (une note de livre portant ce titre) est complété, jamais dédoublé.
     Sinon, une note neuve. Renvoie le chemin de la note. */
  async add(d: NewBook) {
    const F = this.format(), type = this.settings.type || F.type, t = fold(d.titre);
    const same = this.app.vault.getMarkdownFiles().find(f => {
      const fm = this.fm(f);
      if (!fm || !this.isType(fm.type)) return false;
      const names = [f.basename, one(get(fm, 'titre')), ...list(fm.aliases)].map(fold).filter(Boolean);
      return names.some(n => n === t || n.startsWith(t + ' '));
    });
    const K = KEYS[F.lang] || KEYS.en, V = STATUS[F.lang] || STATUS.en, SEC = SECTIONS[F.lang] || SECTIONS.en;
    const fields: Record<string, string | string[] | null | undefined> = {
      [K.lecture]: V['a lire'], [K.auteur]: d.auteur || null, [K.annee]: d.annee ? String(d.annee) : null,
      [K.couverture]: d.couverture || null, openlibrary: d.olkey || null, [K.pages]: d.pages ? String(d.pages) : null,
      genres: d.genres || null, [K.mots]: d.mots || null, [K.decouvert]: d.decouvert || null,
      [K.resume]: d.resume ? V.check : null,
    };
    const tropes = (d.tropes || []).map(t => `- ${t}`).join('\n');
    const sections: [string, string][] = [[SEC.why, d.pourquoi || ''], [SEC.summary, d.resume || ''], [SEC.tropes, tropes]];
    if (same) {
      const fm = this.fm(same) || {};
      // ce qui y est déjà reste tel quel : on ne complète que les trous
      // un champ déjà rempli, dans l'une ou l'autre langue, reste tel quel : on ne complète que les trous
      const filled = (k: string) => { const key = (Object.keys(K) as Key[]).find(x => K[x] === k); const v = key ? get(fm, key) : fm[k]; return v != null && v !== ''; };
      const keep = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, filled(k) ? undefined : v]));
      if (!one(get(fm, 'titre')) && fold(same.basename) !== t) keep[K.titre] = d.titre;
      const text = await this.app.vault.read(same), has = sectionsOf(text);
      const alias: Record<string, string[]> = { [SEC.why]: ['pourquoi le lire', 'why read it'], [SEC.summary]: ['resume', 'summary'], [SEC.tropes]: ['tropes'] };
      await this.write(same.path, x => withSections(withFields(x, keep), sections.filter(([k]) => !(alias[k] || [fold(k)]).some(a => has[a]))));
      return same.path;
    }
    const dir = this.folder();
    if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
    let name = safeName(d.titre) || (F.lang === 'fr' ? 'Livre' : 'Book'), path = normalizePath(`${dir}/${name}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) { name = `${name} (${type})`; path = normalizePath(`${dir}/${name}.md`); }
    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${dir}/${name} ${i}.md`);
    const base = (path.split('/').pop() || '').replace(/\.md$/, '');
    let text = withFields(`---\ntype: ${type}\n---\n`, { ...(base !== d.titre ? { [K.titre]: d.titre } : {}), ...fields });
    text = withSections(text, sections);
    await this.app.vault.create(path, text);
    return path;
  }
}
