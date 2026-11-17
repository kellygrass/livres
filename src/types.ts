/* Les formes que se passent la note, l'étagère et Open Library. */

// un livre tel que l'étagère le montre, lu depuis sa note
export interface Book {
  id: string; path: string;
  titre: string; auteur: string; annee: number | string;
  lecture: string; lu?: string; commence?: string;
  couverture?: string; olkey?: string; pages?: number;
  themes: string[]; mots: string[]; genres: string[];
  decouvert?: string; suiteDe?: string; certitude?: string;
  resume: string; pourquoi: string; tropes: string[]; aliases: string[];
}

// un livre qu'on ajoute, tel que la recherche l'a préparé
export interface NewBook {
  titre: string; auteur?: string; annee?: number | string; pages?: number;
  olkey?: string; couverture?: string; mots?: string[]; genres?: string[];
  pourquoi?: string; decouvert?: string; tropes?: string[]; resume?: string;
}

// une fiche de la recherche d'Open Library (seulement les champs demandés)
export interface OLDoc {
  key: string; title?: string; author_name?: string[]; first_publish_year?: number;
  cover_i?: number; subject?: string[]; number_of_pages_median?: number;
}

// une note écrite sur un livre, montrée dans sa fiche
export interface Card { t: string; ex: string; cit: number; path: string }

// ce que l'étagère attend de l'hôte (main.ts) : tout ce qui touche au vault passe par lui
export interface ShelfHost {
  lang: string;
  html: (h: string) => DocumentFragment;
  books: () => Promise<Book[]>;
  cards: (b: Book) => Promise<Card[]>;
  cover: (b: Book) => Promise<string | null>;
  known: (name: string) => boolean;
  setLecture: (b: Book, lecture: string) => Promise<void>;
  remove(b: Book): Promise<unknown>;
  add: (d: NewBook) => Promise<string>;
  search: (q: string) => Promise<OLDoc[]>;
  description: (key: string) => Promise<string>;
  open: (path: string) => Promise<void>;
  openName: (name: string) => Promise<void>;
  listen: <K extends keyof WindowEventMap>(t: Window, type: K, fn: (e: WindowEventMap[K]) => void, o?: boolean | AddEventListenerOptions) => void;
  load: (key: string) => string | null;
  save: (key: string, value: string) => void;
  active: () => boolean;
  onChange: (fn: () => void) => () => void;
}
