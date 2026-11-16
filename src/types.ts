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
