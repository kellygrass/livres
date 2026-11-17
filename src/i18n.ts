/* Les mots de l'étagère, en français et en anglais. La langue est celle d'Obsidian. */

export type Status = 'a lire' | 'en cours' | 'lu';
type Msg = (title: string) => string;
export interface Words {
  months: string[];
  shelves: Record<string, string>;
  all: string;
  genres: Record<string, string>;
  add: string; back: string; cancel: string; searchPh: string;
  empty: Record<string, string>;
  year: (y: number) => string;
  when: Record<string, string>;
  status: Record<string, string>;
  foundVia: string;
  cards: string; citations: string; cit: string; moreCards: (n: number) => string;
  why: string; tropes: string; summary: string; check: string; themes: string; keywords: string;
  openInVault: string; leadsTo: string;
  rel: { before: string; next: string; foundHere: string; ledHere: string };
  act: Record<string, string>;
  toast: Record<Status | 'added' | 'removed', Msg> & { failed: string; notSaved: string };
  searching: string; nothing: string; offline: string;
  whyPh: string; from: string; fromPh: string;
  tropesHint: string; put: string; other: string; preparing: string;
  tropeList: string[];
}

const fr: Words = {
  months: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  shelves: { 'a lire': 'À lire', 'en cours': 'En cours', lu: 'Lus' },
  all: 'Tout',
  genres: { biographie: 'Biographie', essai: 'Essai', philosophie: 'Philosophie', science: 'Sciences', pratique: 'Pratique',
    fantasy: 'Fantasy', 'science-fiction': 'Science-fiction', classique: 'Classique', fiction: 'Fiction', 'non-fiction': 'Non-fiction' },
  add: 'Ajouter un livre', back: '← Retour', cancel: 'Annuler', searchPh: 'Un titre, un auteur',
  empty: { first: 'Ajoute ton premier livre avec le +', lu: 'Aucun livre lu pour l’instant', 'en cours': 'Aucun livre en cours', 'a lire': 'Rien à lire pour l’instant' },
  year: y => y < 0 ? `vers ${-y} av. J.-C.` : `vers ${y}`,
  when: { lu: 'Lu en', 'en cours': 'Commencé en' },
  status: { lu: 'Lu', 'en cours': 'En cours', 'a lire': 'À lire' },
  foundVia: 'découvert via',
  cards: 'Tes cartes', citations: 'citations', cit: 'cit.', moreCards: n => `et ${n} autres cartes dans le vault`,
  why: 'Pourquoi le lire', tropes: 'Tropes', summary: 'Résumé', check: 'Résumé à vérifier.', themes: 'Thèmes', keywords: 'Mots-clés',
  openInVault: 'Ouvrir dans le vault', leadsTo: 'Où il mène',
  rel: { before: 'Le tome d’avant', next: 'La suite', foundHere: 'Tu l’as trouvé là', ledHere: 'Il t’y a mené' },
  act: { 'en cours': 'En cours', lu: 'Marquer comme lu', 'a lire': 'Remettre à lire', note: 'Ouvrir la note', remove: 'Retirer de l’étagère', sure: 'Retirer ? La note reste' },
  toast: { lu: t => `${t} rangé dans Lus`, 'en cours': t => `${t} est en cours`, 'a lire': t => `${t} remis à lire`, added: t => `${t} est sur l’étagère`, failed: 'La note n’a pas pu être créée.', removed: t => `${t} a quitté l’étagère`, notSaved: 'La note n’a pas pu être modifiée.' },
  searching: 'Je cherche…', nothing: 'Rien trouvé. Essaie avec le nom de l’auteur.', offline: 'Open Library ne répond pas. Réessaie dans un instant.',
  whyPh: 'Ce qui t’a donné envie, en une phrase', from: 'Découvert via', fromPh: 'Un livre, un podcast, une personne',
  tropesHint: 'si tu veux', put: 'Mettre sur l’étagère', other: 'Un autre', preparing: 'Je prépare le livre…',
  tropeList: ['Académie de magie', 'Élu', 'Ennemis devenus amants', 'Romance lente', 'Triangle amoureux', 'Famille choisie',
    'Orphelin au passé caché', 'Héros réticent', 'Antihéros', 'Mentor', 'Quête', 'Prophétie', 'Trahison', 'Épreuves ou tournoi',
    'Intrigues de cour', 'Rébellion contre un empire', 'Système de magie précis', 'Dragons', 'Monde parallèle',
    'Premier contact', 'Voyage dans le temps', 'Intelligence artificielle', 'Dystopie', 'Space opera', 'Post-apocalyptique', 'Seul survivant'],
};

const en: Words = {
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  shelves: { 'a lire': 'To read', 'en cours': 'Reading', lu: 'Read' },
  all: 'All',
  genres: { biographie: 'Biography', essai: 'Essay', philosophie: 'Philosophy', science: 'Science', pratique: 'Practical',
    fantasy: 'Fantasy', 'science-fiction': 'Science fiction', classique: 'Classic', fiction: 'Fiction', 'non-fiction': 'Non-fiction' },
  add: 'Add a book', back: '← Back', cancel: 'Cancel', searchPh: 'A title, an author',
  empty: { first: 'Add your first book with +', lu: 'No books read yet', 'en cours': 'Nothing in progress', 'a lire': 'Nothing to read yet' },
  year: y => y < 0 ? `c. ${-y} BC` : `c. ${y}`,
  when: { lu: 'Read in', 'en cours': 'Started in' },
  status: { lu: 'Read', 'en cours': 'Reading', 'a lire': 'To read' },
  foundVia: 'found via',
  cards: 'Your notes', citations: 'quotes', cit: 'q.', moreCards: n => `and ${n} more notes in the vault`,
  why: 'Why read it', tropes: 'Tropes', summary: 'Summary', check: 'Summary to check.', themes: 'Themes', keywords: 'Keywords',
  openInVault: 'Open in the vault', leadsTo: 'Where it leads',
  rel: { before: 'The previous volume', next: 'The sequel', foundHere: 'Where you found it', ledHere: 'It led you here' },
  act: { 'en cours': 'Currently reading', lu: 'Mark as read', 'a lire': 'Back to “To read”', note: 'Open the note', remove: 'Remove from the shelf', sure: 'Remove? The note stays' },
  toast: { lu: t => `${t} is on your Read shelf`, 'en cours': t => `You're reading ${t}`, 'a lire': t => `${t} is back on To read`, added: t => `${t} is on the shelf`, failed: 'The note could not be created.', removed: t => `${t} left the shelf`, notSaved: 'The note could not be changed.' },
  searching: 'Searching…', nothing: 'Nothing found. Try the author’s name.', offline: 'Open Library isn’t answering. Try again in a moment.',
  whyPh: 'What made you want to read it, in one sentence', from: 'Found via', fromPh: 'A book, a podcast, a person',
  tropesHint: 'optional', put: 'Put it on the shelf', other: 'Another one', preparing: 'Preparing the book…',
  tropeList: ['Magic school', 'Chosen one', 'Enemies to lovers', 'Slow burn', 'Love triangle', 'Found family',
    'Orphan with a hidden past', 'Reluctant hero', 'Antihero', 'Mentor', 'Quest', 'Prophecy', 'Betrayal', 'Trials or tournament',
    'Court intrigue', 'Rebellion against an empire', 'Hard magic system', 'Dragons', 'Portal world',
    'First contact', 'Time travel', 'Artificial intelligence', 'Dystopia', 'Space opera', 'Post-apocalyptic', 'Lone survivor'],
};

// ce qu'Open Library écrit dans ses sujets, pour cocher d'avance le trope correspondant (même ordre que tropeList)
export const TROPE_HINTS = [/magic (school|academy)|academy|school of magic/, /chosen one/, /enemies[ -]to[ -]lovers/, /slow[ -]burn/, /love triangle/,
  /found family/, /orphan/, /reluctant hero/, /anti-?hero/, /mentor/, /quest/, /prophec/, /betray/, /tournament|trials/,
  /court intrigue|political intrigue|royal court/, /rebellion|revolution/, /magic system/, /dragon/, /portal|parallel world/,
  /first contact|alien contact/, /time travel/, /artificial intelligence|\bai\b|robot/, /dystopi/, /space opera/, /post-?apocalyp/, /survival|sole survivor/];

export const words = (lang: string): Words => (lang === 'fr' ? fr : en);
