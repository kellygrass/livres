/* L'étagère est écrite en JavaScript ; voici ce qu'elle attend de l'hôte (main.ts). */
import type { Book, Card, NewBook, OLDoc } from './types';

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

export function mountShelf(root: HTMLElement, host: ShelfHost): { destroy(): void };
