/* Booksidian (l'étagère) : une liste de lecture qu'on parcourt comme une vraie étagère.
   Le plugin ouvre une vue plein onglet qui ne ressemble pas à Obsidian ; les livres, eux, restent
   des notes ordinaires du vault (voir livres.ts). */
import { App, ItemView, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, debounce, getLanguage, sanitizeHTMLToDom } from 'obsidian';
import { defaults, Livres, Settings } from './livres';

// la langue d'Obsidian : le français pour le français, l'anglais pour toutes les autres
const OBSIDIAN = getLanguage().startsWith('fr') ? 'fr' : 'en';
// le réglage « Langue » peut l'imposer ; fixé au chargement du plugin
let LANG = OBSIDIAN, FR = LANG === 'fr';
// l'interface est écrite en JavaScript (etagere.d.ts dit ce qu'elle attend)
import { mountShelf } from './etagere.js';
import type { Book, NewBook } from './types';

const VIEW = 'booksidian-view';

class ShelfView extends ItemView {
  private ui: { destroy(): void } | null = null;
  constructor(leaf: WorkspaceLeaf, private plugin: EtagerePlugin) { super(leaf); }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Booksidian'; }
  getIcon() { return 'library'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('etagere-host');
    const root = this.contentEl.createDiv({ cls: 'etagere' });
    const L = this.plugin.livres, ws = this.app.workspace;
    this.ui = mountShelf(root, {
      lang: LANG,
      html: (h: string) => sanitizeHTMLToDom(h),
      books: () => L.read(),
      cards: (b: Book) => L.cards(b),
      cover: (b: Book) => L.cover(b),
      known: (name: string) => L.known(name),
      setLecture: (b: Book, l: string) => L.setLecture(b, l),
      remove: (b: Book) => L.remove(b),
      add: (d: NewBook) => L.add(d),
      search: (q: string) => L.search(q),
      description: (key: string) => L.description(key),
      open: (path: string) => ws.openLinkText(path, '', 'tab'),
      openName: (name: string) => ws.openLinkText(name, '', 'tab'),
      listen: (t, type, fn, o) => this.registerDomEvent(t, type, fn, o),
      load: (k: string) => { const v: unknown = this.app.loadLocalStorage('booksidian-' + k); return typeof v === 'string' ? v : null; },
      save: (k: string, v: string) => this.app.saveLocalStorage('booksidian-' + k, v),
      active: () => ws.getActiveViewOfType(ShelfView) === this,
      onChange: (fn: () => void) => { this.plugin.changeFns.add(fn); return () => this.plugin.changeFns.delete(fn); },
    });
  }
  async onClose() { this.ui?.destroy(); this.ui = null; }
}

export default class EtagerePlugin extends Plugin {
  settings: Settings;
  livres: Livres;
  changeFns = new Set<() => void>();

  async onload() {
    this.settings = Object.assign({}, defaults(), (await this.loadData()) as Partial<Settings> | null);
    LANG = this.settings.langue || OBSIDIAN; FR = LANG === 'fr';
    this.livres = new Livres(this.app, this.settings, this.manifest.dir ?? '', LANG);
    this.registerView(VIEW, leaf => new ShelfView(leaf, this));
    this.addRibbonIcon('library', FR ? 'Ouvrir Booksidian' : 'Open Booksidian', () => this.show());
    this.addCommand({ id: 'open', name: FR ? 'Ouvrir l’étagère' : 'Open the bookshelf', callback: () => this.show() });
    this.addSettingTab(new Reglages(this.app, this));

    // une note de livre change (à la main, par un autre plugin, par l'étagère) : l'étagère se remet à jour
    const changed = debounce(() => this.changeFns.forEach(fn => fn()), 1500, true);
    this.registerEvent(this.app.metadataCache.on('changed', f => { if (this.livres.isBook(f)) changed(); }));
    this.registerEvent(this.app.vault.on('rename', f => { if (f instanceof TFile) changed(); }));
    this.registerEvent(this.app.vault.on('delete', () => changed()));
  }

  onunload() { this.livres?.revoke(); }

  async show() {
    const ws = this.app.workspace, found = ws.getLeavesOfType(VIEW)[0];
    const leaf = found ?? ws.getLeaf('tab');
    if (!found) await leaf.setViewState({ type: VIEW, active: true });
    await ws.revealLeaf(leaf);
  }

  async save() { await this.saveData(this.settings); }
}

class Reglages extends PluginSettingTab {
  constructor(app: App, private plugin: EtagerePlugin) { super(app, plugin); }
  display() {
    const { containerEl: el } = this, s = this.plugin.settings;
    el.empty();
    new Setting(el).setName(FR ? 'Langue' : 'Language')
      .setDesc(FR ? 'La langue de l’étagère. Prend effet au prochain lancement d’Obsidian.' : 'The language of the shelf. Takes effect the next time Obsidian starts.')
      .addDropdown(d => d.addOptions({ '': FR ? 'Celle d’Obsidian' : 'Same as Obsidian', fr: 'Français', en: 'English' })
        .setValue(s.langue).onChange(async v => { s.langue = v; await this.plugin.save(); }));
    new Setting(el).setName(FR ? 'Dossier des nouveaux livres' : 'Folder for new books')
      .setDesc(FR ? 'Où l’étagère crée la note d’un livre ajouté. Vide : Livres/.' : 'Where the shelf creates the note of a book you add. Empty: Books/.')
      .addText(t => t.setPlaceholder(FR ? 'Livres' : 'Books').setValue(s.dossier).onChange(async v => { s.dossier = v.trim(); await this.plugin.save(); }));
    new Setting(el).setName(FR ? 'Type des notes de livre' : 'Book note type')
      .setDesc(FR ? 'Une note est un livre quand son en-tête porte « type: » suivi de ce mot. Vide : livre ou book.' : 'A note is a book when its properties say “type:” followed by this word. Empty: book or livre.')
      .addText(t => t.setPlaceholder('Livre, book').setValue(s.type).onChange(async v => { s.type = v.trim(); await this.plugin.save(); }));
  }
}
