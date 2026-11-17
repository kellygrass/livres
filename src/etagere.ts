/* L'étagère, dans un onglet d'Obsidian.
   On fait défiler les tranches ; un clic sort un livre et montre sa couverture ; un second clic le
   prend : il monte vers nous, s'ouvre, et on entre dans sa page de garde, qui devient la fiche.
   Tout ce qui touche au vault passe par `host` (main.ts, livres.ts) : ici, seulement le geste. */

import { words, TROPE_HINTS, type Status } from './i18n';
import type { Book, Card, NewBook, OLDoc, ShelfHost } from './types';

type RGB = number[];
interface Palette { spine: RGB; bg: RGB }
// un livre sur l'étagère : sa note, plus ce qu'on a tiré de sa couverture
interface ShelfBook extends Book { src?: string; pal?: Palette; ratio?: number; cards?: Card[] }
// un livre posé sur l'étagère, avec sa place et son mouvement
interface Entry { el: HTMLElement; W: number; H: number; T: number; b: ShelfBook; pull: number; pullTarget: number; pv?: number; coverOn: boolean; ly: number; lv: number; hover?: boolean }
interface Spring { v: number; vel: number; to: number; k: number; c: number; step(dt: number): void; rest(eps: number): boolean }
interface Waiter { cond: () => boolean; res: () => void }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rad = (d: number) => d * Math.PI / 180;
const wait = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms));
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const text = (s: unknown) => typeof s === 'string' ? s : typeof s === 'number' ? String(s) : '';
const esc = (s: unknown) => text(s).replace(/[&<>"]/g, c => ESC[c]);
// l'élément le plus proche qui correspond, depuis la cible d'un événement
const closest = (t: EventTarget | null, sel: string) => t instanceof Element ? t.closest<HTMLElement>(sel) : null;
const fold = (s: unknown) => text(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// un nombre stable par livre, pour que chaque tranche garde sa hauteur et son épaisseur
const seed = (s: string, k: number) => { let h = 2166136261 ^ k; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };

/* ---------- Couleurs tirées de la couverture ---------- */
const lum = ([r, g, b]: RGB) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const hex = ([r, g, b]: RGB) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a: RGB, b: RGB, t: number) => a.map((v, i) => v + (b[i] - v) * t);
function palette(img: HTMLImageElement): Palette {
  const c = createEl('canvas'), w = 40, h = 60;
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, w, h);
  const px = x.getImageData(0, 0, w, h).data, bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const k = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    const e = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b; bins.set(k, e);
  }
  // les nuances proches sont regroupées : sinon un grand aplat se découpe en dizaines de nuances
  // et perd face à un petit détail d'une seule couleur
  const groups: { rgb: RGB; n: number; share?: number; sat?: number; l?: number }[] = [], total = w * h;
  for (const e of [...bins.values()].sort((a, b) => b.n - a.n)) {
    const rgb = [e.r / e.n, e.g / e.n, e.b / e.n];
    const near = groups.find(g => Math.hypot(g.rgb[0] - rgb[0], g.rgb[1] - rgb[1], g.rgb[2] - rgb[2]) < 34);
    if (near) { near.rgb = near.rgb.map((v, i) => (v * near.n + rgb[i] * e.n) / (near.n + e.n)); near.n += e.n; }
    else groups.push({ rgb, n: e.n });
  }
  for (const g of groups) {
    const mx = Math.max(...g.rgb), mn = Math.min(...g.rgb);
    g.share = g.n / total; g.sat = mx ? (mx - mn) / mx : 0; g.l = lum(g.rgb);
  }
  groups.sort((a, b) => b.n - a.n);
  const main = groups[0];
  // la couleur d'accent : une couleur franche qui occupe une vraie part de la couverture
  const accent = groups.filter(g => g !== main && g.share > .025 && g.sat > .3 && g.l > .1 && g.l < .9)
    .sort((a, b) => b.share * (.5 + b.sat) - a.share * (.5 + a.sat))[0];
  // la couleur la plus présente ; sauf si c'est du papier blanc ou du gris, alors la couleur d'accent
  const plain = main.sat < .14 && main.l > .2;
  let bg = plain && accent ? accent.rgb : main.rgb;
  const L = lum(bg);
  if (L > .8) bg = mix(bg, [40, 36, 30], .5);         // un fond trop clair éblouit
  else if (L < .07) bg = mix(bg, [60, 56, 52], .3);   // trop noir, on perd la matière
  return { spine: main.rgb, bg };
}

/* ---------- Les genres ---------- */
// les filtres : la non-fiction regroupe tout ce qui n'est ni fantasy ni science-fiction
const GENRES = ['non-fiction', 'fantasy', 'science-fiction'];
const imaginary = (b: Book) => (b.genres || []).some(g => g === 'fantasy' || g === 'science-fiction');
// le genre d'un livre ajouté, deviné à partir des sujets d'Open Library
function inferGenres(subjects: string[]): string[] {
  const s = subjects.join(' | ').toLowerCase(), g = new Set<string>();
  const fic = /(?<!non[\s-]?)fiction|novel|roman\b|fantasy|fantastique|fairy tales/.test(s);
  if (/fantasy|fantastique|magic|dragons|wizards/.test(s)) g.add('fantasy');
  if (/science fiction|science-fiction|space opera|dystopi|cyberpunk/.test(s)) g.add('science-fiction');
  if (/biograph|memoir|mémoires/.test(s)) g.add('biographie');
  if (/philosoph/.test(s)) g.add('philosophie');
  if (!fic && /\bscience|physics|history|histoire|psycholog/.test(s)) g.add('science');
  if (/classic|classique/.test(s)) g.add('classique');
  return [fic || g.has('fantasy') || g.has('science-fiction') ? 'fiction' : 'non-fiction', ...g];
}

const skeleton = (W: ReturnType<typeof words>) => `
  <header class="top">
    <nav class="tabs" role="tablist">
      <button class="tab" data-shelf="a lire" role="tab">${W.shelves['a lire']} <span class="count"></span></button>
      <button class="tab" data-shelf="en cours" role="tab">${W.shelves['en cours']} <span class="count"></span></button>
      <button class="tab" data-shelf="lu" role="tab">${W.shelves.lu} <span class="count"></span></button>
      <span class="tab-pill"></span>
    </nav>
    <button class="add-btn" aria-label="${W.add}">+</button>
  </header>
  <nav class="genres" aria-label="Genres"></nav>
  <main class="stage">
    <div class="shelf"></div>
    <div class="caption"><div class="cap-title"></div><div class="cap-author"></div></div>
  </main>
  <section class="detail" aria-hidden="true">
    <div class="detail-bg"></div>
    <button class="back">${W.back}</button>
    <div class="detail-grid">
      <div class="detail-cover-wrap"><div class="detail-cover"><img alt=""><span class="gloss"></span></div></div>
      <div class="detail-body"></div>
    </div>
  </section>
  <div class="persp"></div>
  <section class="adder" aria-hidden="true">
    <button class="adder-close">${W.cancel}</button>
    <div class="adder-inner">
      <input class="adder-q" type="text" placeholder="${W.searchPh}" autocomplete="off" spellcheck="false">
      <div class="adder-state"></div>
      <div class="results"></div>
      <div class="pick"></div>
    </div>
  </section>
  <div class="toast"></div>`;

export function mountShelf(root: HTMLElement, host: ShelfHost): { destroy(): void } {
  const W = words(host.lang);
  // le HTML de l'interface passe toujours par sanitizeHTMLToDom (host.html), qui en fait des nœuds
  const dom = (h: string) => host.html(h);
  root.replaceChildren(dom(skeleton(W)));
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s);
  const shelfEl = $('.shelf'), stage = $('.stage'), caption = $('.caption'), detail = $('.detail');
  const genresEl = $('.genres');
  let books: ShelfBook[] = [], alive = true;
  // une taille et une position dans l'onglet, pas dans la fenêtre
  const vw = () => root.clientWidth, vh = () => root.clientHeight;
  const box = () => root.getBoundingClientRect();

  /* ---------- Construire une étagère ---------- */
  let shelf = 'a lire', list: ShelfBook[] = [], els: Entry[] = [], f = 0, target = 0, vel = 0, lastFocus = -1, unit = 36;
  let baseH = 360;
  let genre = 'tout';
  genre = host.load('genre') || 'tout'; shelf = host.load('shelf') || 'a lire';
  const onShelf = (b: Book) => b.lecture === shelf;
  const inGenre = (b: Book, g = genre) => g === 'tout' || (g === 'non-fiction' ? !imaginary(b) : (b.genres || []).includes(g));

  function measure() {
    baseH = Math.max(200, Math.min(vh() * 0.44, 400));
    shelfEl.style.setProperty('--shelf-h', baseH + 'px');
  }
  // l'écart entre deux livres
  const gap = () => 3;
  function geometry(b: ShelfBook) {
    const k = baseH / 380, H = baseH * (0.84 + seed(b.id, 1) * 0.16);
    // l'épaisseur suit le nombre de pages : 150 pages ≈ 27, 300 ≈ 38, 800 ≈ 74 (sans pages : 380)
    const pages = Math.min(1200, Math.max(60, b.pages || 380));
    return { W: H * (b.ratio || 0.66), H, T: (16 + pages * 0.072) * k };
  }

  /* Un livre est une boîte : la tranche face à nous, la couverture tournée vers la droite.
     Tant qu'on ne l'a pas sorti, sa couverture reste une surface de sa couleur. */
  function bookEl(b: ShelfBook): Entry {
    const { W, H, T } = geometry(b), col = b.pal ? b.pal.spine : [150, 150, 150];
    const el = createDiv();
    el.className = 'book';
    el.style.width = W + 'px'; el.style.height = H + 'px';
    const ink = lum(col) > .58 ? '#111111' : '#ffffff';
    const sp = hex(col), edge = hex(mix(col, [0, 0, 0], .14)), face = hex(mix(col, [0, 0, 0], .1)), rear = hex(mix(col, [0, 0, 0], .3));
    el.replaceChildren(dom(`
      <div class="face front" style="background-color:${face}; transform: translateZ(${T / 2}px)"></div>
      <div class="face rear" style="background:${rear}; transform: rotateY(180deg) translateZ(${T / 2}px)"></div>
      <div class="face spine" style="width:${T}px; left:${(W - T) / 2}px; background:var(--grain) 0 0 / 160px 160px, linear-gradient(90deg, ${edge}, ${sp} 22%, ${sp} 78%, ${edge}); color:${ink}; transform: rotateY(-90deg) translateZ(${W / 2}px)">
        <span class="s-title">${esc(b.titre)}</span><span class="s-author">${esc((b.auteur || '').split(' ').pop())}</span>
      </div>
      <div class="face pages" style="width:${T}px; left:${(W - T) / 2}px; transform: rotateY(90deg) translateZ(${W / 2}px)"></div>
      <div class="face tete" style="width:${W}px; height:${T}px; background:linear-gradient(180deg, ${rear} 0 7%, #f1ede4 7% 93%, ${face} 93%); transform: translateY(${-T / 2}px) rotateX(90deg)"></div>`));
    return { el, W, H, T, b, pull: 0, pullTarget: 0, coverOn: false, ly: 0, lv: 0 };
  }

  // seuls les genres présents sur l'étagère apparaissent : jamais de filtre qui mène à une étagère vide
  function genreBar() {
    const here = books.filter(onShelf);
    const opts = GENRES.map((k): [string, string, number] => [k, W.genres[k], here.filter(b => inGenre(b, k)).length]).filter(o => o[2]);
    if (genre !== 'tout' && !opts.some(o => o[0] === genre)) genre = 'tout';
    genresEl.replaceChildren(dom(opts.length ? [['tout', W.all, here.length] as [string, string, number], ...opts].map(([k, l, n]) => `<button class="genre${k === genre ? ' on' : ''}" data-g="${k}">${l}<span class="n">${n}</span></button>`).join('') : ''));
  }
  genresEl.addEventListener('click', e => {
    const g = closest(e.target, '.genre');
    if (!g || g.dataset.g === genre) return;
    genre = g.dataset.g;
    host.save('genre', genre);
    genresEl.querySelectorAll('.genre').forEach(x => x.classList.toggle('on', x === g));
    shelfEl.classList.add('leaving');
    window.setTimeout(() => { build(); window.requestAnimationFrame(() => shelfEl.classList.remove('leaving')); }, 280);
  });

  function build(focusId?: string) {
    genreBar();
    list = books.filter(b => onShelf(b) && inGenre(b));
    if (shelf === 'lu') list.sort((a, b) => (b.lu || '').localeCompare(a.lu || ''));
    if (shelf === 'en cours') list.sort((a, b) => (b.commence || '').localeCompare(a.commence || ''));
    shelfEl.replaceChildren();
    els = list.map(b => { const o = bookEl(b); shelfEl.appendChild(o.el); return o; });
    unit = els.length ? els.reduce((s, e) => s + e.T + gap(), 0) / els.length : 36;
    const at = focusId ? list.findIndex(b => b.id === focusId) : -1;
    f = target = Math.max(0, at >= 0 ? at : Math.floor((list.length - 1) / 2)); vel = 0; lastFocus = -1; pulled = null;
    counts(); layout(); showCaption(true);
  }

  /* ---------- La mise en place : chaque frame, chaque livre trouve sa place ---------- */
  function layout(dt = 0) {
    const n = els.length;
    let busy = false;
    if (!n) return busy;
    const fp = els.map(e => e.T + gap() + e.pull * (e.W - e.T + 56));
    const c: number[] = [];
    let acc = 0;
    for (let i = 0; i < n; i++) { c.push(acc + fp[i] / 2); acc += fp[i]; }
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(f))), i1 = Math.min(n - 1, i0 + 1);
    const cf = c[i0] + (c[i1] - c[i0]) * (f - i0);
    for (let i = 0; i < n; i++) {
      const e = els[i], x = c[i] - cf, p = e.pull;
      // le livre du centre ne monte pas : il bascule vers nous en pivotant sur son bord du bas, comme quand
      // on le tire du haut pour le prendre ; ses voisins à peine, celui qu'on survole un peu
      const near = Math.exp(-((i - f) ** 2) / 0.5);
      const goal = (near * 8 + (e.hover ? 3 : 0)) * (1 - p);   // en degrés, vers nous
      if (dt) { [e.ly, e.lv] = glide(e.ly, e.lv, goal, 260, dt); if (Math.abs(goal - e.ly) > .02 || Math.abs(e.lv) > .5) busy = true; }
      else { e.ly = goal; e.lv = 0; }
      e.el.style.transform = `translateX(${x - e.W / 2}px) translateY(${-p * 22}px) translateZ(${p * 140}px) rotateX(${-e.ly}deg) rotateY(${90 * (1 - p)}deg)`;
      e.el.style.zIndex = String(1000 - Math.round(Math.abs(i - f) * 10) + Math.round(p * 100));
      const show = p > .02;
      if (show !== e.coverOn) {
        e.coverOn = show;
        e.el.querySelector<HTMLElement>('.front').style.backgroundImage = show && e.b.src ? `var(--grain), url('${e.b.src}')` : 'var(--grain)';
        e.el.classList.toggle('out', show);
      }
    }
    const focus = Math.round(f);
    if (focus !== lastFocus) { lastFocus = focus; showCaption(); }
    return busy;
  }

  let capT = 0;
  function showCaption(now?: boolean) {
    const b = list[Math.round(f)];
    const set = () => {
      caption.querySelector('.cap-title').textContent = b ? b.titre : '';
      caption.querySelector('.cap-author').textContent = b ? b.auteur
        : !books.length ? W.empty.first : W.empty[shelf];
      caption.classList.remove('is-off');
    };
    if (now) return set();
    caption.classList.add('is-off');
    window.clearTimeout(capT); capT = window.setTimeout(set, 140);
  }

  /* ---------- Le mouvement ----------
     L'étagère se comporte comme un objet : du poids, de la friction, et elle se pose sans jamais dépasser
     ni rebondir (un ressort à amortissement critique). Pendant qu'on la tire, elle suit la main sans délai ;
     quand on la lâche, elle garde son élan et ralentit jusqu'au livre le plus proche de là où elle allait,
     en un seul mouvement. Tout est réglé en secondes : le même geste a la même durée à 60 ou à 120 images
     par seconde. */
  // un pas de ressort critique : arrive sur « to » sans le dépasser ; k règle la vivacité (en 1/s²)
  function glide(x: number, v: number, to: number, k: number, dt: number): [number, number] {
    const w = Math.sqrt(k), n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) { v += (-k * (x - to) - 2 * w * v) * h; x += v * h; }
    return [x, v];
  }
  let raf = 0, last = 0, stiff = 120, tracking = false;
  const waiters: Waiter[] = [];
  function wake() { if (!raf && alive) { last = performance.now(); raf = window.requestAnimationFrame(step); } }
  // attendre qu'un mouvement soit vraiment fini, plutôt qu'une durée fixe
  const settle = (cond: () => boolean) => new Promise<void>(res => { waiters.push({ cond, res }); wake(); });
  function resolveWaiters() {
    for (let k = waiters.length - 1; k >= 0; k--) if (waiters[k].cond()) { waiters[k].res(); waiters.splice(k, 1); }
  }
  function step(now: number) {
    raf = 0;
    const dt = clamp((now - last) / 1000, 0, 1 / 20); last = now;
    target = clamp(target, 0, Math.max(0, els.length - 1));
    if (tracking) { if (dt) vel = (target - f) / dt; f = target; }      // la main tient l'étagère
    else [f, vel] = glide(f, vel, target, stiff, dt);
    let busy = false;
    for (const e of els) {   // sortir un livre, le ranger : le même geste posé, sans rebond
      [e.pull, e.pv] = glide(e.pull, e.pv || 0, e.pullTarget, 150, dt);
      if (Math.abs(e.pullTarget - e.pull) > .001 || Math.abs(e.pv) > .01) busy = true; else { e.pull = e.pullTarget; e.pv = 0; }
    }
    if (layout(dt || 1 / 60)) busy = true;
    const still = !tracking && Math.abs(target - f) < .0005 && Math.abs(vel) < .005;
    if (still && !busy) { f = target; vel = 0; layout(0); resolveWaiters(); return; }
    resolveWaiters();
    wake2();
  }
  function wake2() { if (!raf && alive) raf = window.requestAnimationFrame(step); }
  // où se poser : le livre le plus proche de là où elle allait, mais jamais en arrière de son élan
  function restingPlace(aim: number) {
    let r = Math.round(aim);
    if (Math.abs(vel) > .3 && Math.sign(r - f) !== Math.sign(vel)) r = vel > 0 ? Math.ceil(f) : Math.floor(f);
    return clamp(r, 0, Math.max(0, els.length - 1));
  }
  // aller quelque part : vite pour suivre un geste, posément pour se ranger
  const goTo = (t: number, k: number) => { target = t; stiff = k; wake(); };

  /* Sur un trackpad, un défilement continue tout seul après qu'on a levé les doigts (l'inertie).
     Si on clique pendant ce temps, on ignore la fin de l'élan : sinon le livre qu'on vient de
     sortir serait aussitôt rangé. Un nouveau geste commence après une courte pause. */
  let wheelLast = 0, wheelHold = false, restT = 0;
  stage.addEventListener('wheel', e => {
    if (RD.on) return;
    e.preventDefault();
    const now = performance.now(), gap = now - wheelLast;
    wheelLast = now;
    if (wheelHold) { if (gap > 140) wheelHold = false; else return; }
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) > 2) putBack();
    // une molette de souris avance d'un livre par cran ; un trackpad fait glisser l'étagère sous les doigts
    const notch = e.deltaMode === 1 || (Math.abs(d) >= 50 && Number.isInteger(d));
    if (notch) return goTo(Math.round(target) + Math.sign(d), 140);
    goTo(target + d / (unit * 1.6), 300);
    // le geste fini, elle se pose sur le livre le plus proche, dans le prolongement de son élan
    window.clearTimeout(restT);
    restT = window.setTimeout(() => goTo(restingPlace(target), 120), 90);
  }, { passive: false });

  let down: { x: number; f: number; lx: number; lt: number; v: number } | null = null, moved = false;
  stage.addEventListener('pointerdown', e => {
    down = { x: e.clientX, f, lx: e.clientX, lt: performance.now(), v: 0 };
    moved = false;
    wheelHold = performance.now() - wheelLast < 140;   // on attrape l'étagère : l'élan s'arrête
    if (wheelHold) { window.clearTimeout(restT); goTo(Math.round(f + vel * .1), 160); }
  });
  host.listen(window, 'pointermove', e => {
    if (RD.on) return;
    if (!down) {
      if (pulled) {   // la lumière glisse sur la couverture du livre sorti
        const r = pulled.el.querySelector<HTMLElement>('.front').getBoundingClientRect();
        pulled.el.style.setProperty('--gx', clamp((e.clientX - r.left) / r.width * 100, -20, 120) + '%');
        pulled.el.style.setProperty('--gy', clamp((e.clientY - r.top) / r.height * 100, -20, 120) + '%');
      }
      const b = closest(e.target, '.book');
      for (const x of els) { const h = x.el === b; if (x.hover !== h) { x.hover = h; wake(); } }
      return;
    }
    const dx = e.clientX - down.x;
    if (Math.abs(dx) > 6 && !moved) { moved = true; tracking = true; down.f = f; down.x = e.clientX; stage.classList.add('dragging'); putBack(); }
    if (!moved) return;
    const now = performance.now();
    down.v = down.v * .4 + .6 * (e.clientX - down.lx) / Math.max(1, now - down.lt);   // vitesse lissée, en px/ms
    down.lx = e.clientX; down.lt = now;
    target = down.f - (e.clientX - down.x) / unit;
    wake();
  });
  host.listen(window, 'pointerup', e => {
    if (!down) return;
    if (!moved && !RD.on) tapShelf(e);
    if (moved) {
      // lâchée, elle garde l'élan de la main, puis ralentit jusqu'au livre le plus proche de là où elle allait
      tracking = false;
      vel = performance.now() - down.lt > 80 ? 0 : -down.v * 1000 / unit;
      goTo(restingPlace(f + vel * .22), 120);
    }
    stage.classList.remove('dragging');
    down = null; moved = false;
  });

  /* Un clic sur une tranche, ou juste à côté : les tranches sont fines, on ne demande pas
     de viser au pixel près. Premier clic, le livre sort ; deuxième clic, on le prend en main. */
  function tapShelf(e: PointerEvent) {
    const el = closest(e.target, '.book');
    let i = el ? els.findIndex(x => x.el === el) : -1;
    if (i < 0) i = nearestBook(e.clientX, e.clientY);
    if (i < 0) return putBack();
    if (pulled && pulled === els[i]) void open(i); else pullOut(i);
  }
  function nearestBook(x: number, y: number) {
    const sr = shelfEl.getBoundingClientRect();
    if (y < sr.top - 40 || y > sr.bottom + 30) return -1;
    let best = -1, bd = 24;
    els.forEach((e, i) => {
      const r = e.el.getBoundingClientRect();
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (d < bd || (d === 0 && e === pulled)) { bd = d; best = i; }
    });
    return best;
  }

  host.listen(window, 'keydown', e => {
    if (!host.active()) return;
    if (adding()) { if (e.key === 'Escape') { if (adder.classList.contains('picking')) unpick(); else closeAdd(); } return; }
    if (closest(e.target, 'input, textarea, [contenteditable]')) return;
    if (RD.on) { if (e.key === 'Escape') { e.preventDefault(); void close(); } return; }
    if (e.key === 'ArrowRight') { putBack(); goTo(Math.round(target) + 1, 140); }
    else if (e.key === 'ArrowLeft') { putBack(); goTo(Math.round(target) - 1, 140); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const i = Math.round(f);
      if (pulled && pulled === els[i]) void open(i); else pullOut(i);
    }
    else if (e.key === 'Escape') putBack();
  });

  /* ---------- Sortir un livre de l'étagère, le ranger ---------- */
  let pulled: Entry | null = null;
  function pullOut(i: number) {
    const e = els[i];
    if (!e || RD.on) return;
    if (pulled && pulled !== e) pulled.pullTarget = 0;
    pulled = e; e.pullTarget = 1; goTo(i, 120);
  }
  function putBack() {
    if (!pulled || RD.on) return;
    pulled.pullTarget = 0; pulled = null;
    wake();
  }

  /* ---------- Les deux étagères ---------- */
  const tabs = [...root.querySelectorAll<HTMLElement>('.tab')], pill = $('.tab-pill');
  function counts() {
    for (const t of tabs) {
      t.querySelector('.count').textContent = String(books.filter(b => b.lecture === t.dataset.shelf).length);
      t.classList.toggle('on', t.dataset.shelf === shelf);
    }
    const on = tabs.find(t => t.dataset.shelf === shelf);
    pill.style.width = on.offsetWidth + 'px';
    pill.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  function switchShelf(s: string, focusId?: string) {
    if (s === shelf && !focusId) return;
    shelf = s;
    host.save('shelf', s);
    const fb = focusId && books.find(b => b.id === focusId);
    if (fb && !inGenre(fb)) genre = 'tout';   // le livre qu'on veut montrer doit être visible
    counts();
    shelfEl.classList.add('leaving');
    window.setTimeout(() => { build(focusId); window.requestAnimationFrame(() => shelfEl.classList.remove('leaving')); }, 280);
  }
  for (const t of tabs) t.addEventListener('click', () => switchShelf(t.dataset.shelf));

  /* =====================================================================================
     Prendre un livre.
     Au second clic, le livre quitte l'étagère, monte vers nous et vient se poser au milieu
     pendant que l'étagère s'efface. Sa couverture s'ouvre, et on entre dans la page de garde,
     qui est de la couleur du livre : elle devient la fiche. Pour revenir, le chemin inverse.
     ===================================================================================== */
  const persp = $('.persp'), body = $('.detail-body'), dCover = $('.detail-cover');
  // le livre qu'on tient : où il était, où il va, et les ressorts de son mouvement
  const RD = {
    on: false, busy: false, closing: false, closeAfter: false, waiters: [] as Waiter[],
    b: null as ShelfBook | null, entry: null as Entry | null,
    lift: null as Spring | null, cover: null as Spring | null, zoom: null as Spring | null,
    X0: 0, Y0: 0, S0: 1, X1: 0, Y1: 0, pw: 0, ph: 0, m: 0, W: 0, H: 0,
  };
  let hero: HTMLElement | null = null, zoomEl: HTMLElement, hb: HTMLElement, coverEl: HTMLElement, shadeEl: HTMLElement, shadowEl: HTMLElement;

  /* un ressort, en secondes : raideur k, amortissement c */
  function spring(v: number, k = 170, c = 24): Spring {
    const s: Spring = {
      v, vel: 0, to: v, k, c,
      step(dt: number) {
        const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
        for (let i = 0; i < n; i++) { const a = -s.k * (s.v - s.to) - s.c * s.vel; s.vel += a * h; s.v += s.vel * h; }
      },
      rest(eps: number) { return Math.abs(s.v - s.to) < eps && Math.abs(s.vel) < eps * 8; }
    };
    return s;
  }

  function colors(b: ShelfBook) {
    const bg = b.pal ? b.pal.bg : [80, 80, 80], on = lum(bg) > .6 ? '#1b1a18' : '#fbf8f2';
    for (const el of [detail, persp]) { el.style.setProperty('--c', hex(bg)); el.style.setProperty('--on', on); }
    dCover.style.setProperty('--ratio', String(b.ratio || .66));
    const img = dCover.querySelector('img');
    if (b.src) img.src = b.src; else img.removeAttribute('src');
    // l'image garde la taille ; ce qu'on voit, c'est le fond : la couverture et son grain, d'un seul tenant
    dCover.style.backgroundImage = b.src ? `var(--grain), url('${b.src}')` : 'var(--grain)';
  }

  function sizeBook(b: ShelfBook) {
    const ratio = clamp(b.ratio || .66, .6, .74);
    let ph = Math.min(vh() * .6, 560), pw = ph * ratio;
    if (pw > vw() * .42) { pw = vw() * .42; ph = pw / ratio; }
    const m = Math.max(3, Math.round(ph * .012));
    const g = { pw, ph, m, W: pw - m, H: ph - 2 * m };
    const set = (k: string, v: number) => persp.style.setProperty(k, v + 'px');
    set('--bw', pw); set('--bh', ph); set('--m', m); set('--pgw', g.W); set('--pgh', g.H);
    return g;
  }

  function buildHero() {
    persp.replaceChildren(dom(`<div class="zoom"><div class="hero"><div class="hb">
      <div class="hb-shadow"></div><div class="hb-back"></div><div class="hb-page"></div>
      <div class="hb-cover"><div class="hb-front" style="background-image:${RD.b.src ? `var(--grain), url('${RD.b.src}')` : 'var(--grain)'}"><i class="hb-shade"></i></div><div class="hb-inside"></div></div>
    </div></div></div>`));
    zoomEl = persp.firstElementChild as HTMLElement; hero = zoomEl.firstElementChild as HTMLElement; hb = hero.firstElementChild as HTMLElement;
    coverEl = hb.querySelector<HTMLElement>('.hb-cover'); shadeEl = hb.querySelector<HTMLElement>('.hb-shade'); shadowEl = hb.querySelector<HTMLElement>('.hb-shadow');
    RD.X1 = vw() / 2; RD.Y1 = vh() * .47 - RD.ph / 2;
  }

  /* le livre se pose exactement là où il était sur l'étagère (au départ ou au retour) */
  function anchorTo(e: Entry) {
    const r = e.el.querySelector<HTMLElement>('.front').getBoundingClientRect(), o = box();
    RD.S0 = r.width / RD.pw; RD.X0 = r.left - o.left + RD.S0 * RD.pw / 2; RD.Y0 = r.top - o.top;
  }

  function render() {
    const p = RD.lift.v, arc = Math.sin(Math.PI * clamp(p, 0, 1)), z = clamp(RD.zoom.v, 0, 1);
    const X = RD.X0 + (RD.X1 - RD.X0) * p, S = RD.S0 + (1 - RD.S0) * p;
    const Y = RD.Y0 + (RD.Y1 - RD.Y0) * p - arc * RD.ph * .06;      // il monte un peu, comme soulevé
    const a = RD.cover.v, ca = Math.cos(rad(a));
    const slide = -RD.pw / 2 * (1 + ca) / 2;                          // en s'ouvrant, le livre se recentre
    const h = RD.ph / 2;
    hero.style.transform = `translate3d(${X}px, ${Y}px, 0) scale(${S}) translateY(${h}px) rotateX(${arc * 10}deg) rotateZ(${-arc * 1.4}deg) translateY(${-h}px)`;
    hb.style.transform = `translateX(${slide}px)`;
    coverEl.style.transform = `translateZ(.5px) rotateY(${a}deg)`;
    shadeEl.style.opacity = ((1 - ca) * .16).toFixed(3);             // la couverture passe dans l'ombre en se levant
    const left = Math.min(0, RD.pw * ca);
    shadowEl.style.left = left + 'px'; shadowEl.style.width = (RD.pw - left) + 'px';
    shadowEl.style.setProperty('--sy', (16 + arc * 50) + 'px');      // soulevé, son ombre s'éloigne et s'adoucit
    shadowEl.style.setProperty('--sb', (34 + arc * 70) + 'px');
    shadowEl.style.setProperty('--sa', (.4 - arc * .16).toFixed(3));
    // on plonge dans la page de garde : l'échelle grandit de façon exponentielle, comme une caméra qui avance
    const cx = RD.X1 + RD.W / 2, cy = RD.Y1 + RD.m + RD.H / 2;
    const Sz = Math.max(vw() / RD.W, vh() / RD.H) * 1.08, sc = Math.pow(Sz, z), k = (sc - 1) / (Sz - 1);
    zoomEl.style.transformOrigin = `${cx}px ${cy}px`;
    zoomEl.style.transform = `translate(${(vw() / 2 - cx) * k}px, ${(vh() / 2 - cy) * k}px) scale(${sc})`;
    hero.classList.toggle('deep', z > .4);
  }

  let rraf = 0, rlast = 0;
  function rwake() { if (!rraf && alive) { rlast = performance.now(); rraf = window.requestAnimationFrame(rstep); } }
  const until = (cond: () => boolean) => new Promise<void>(res => { RD.waiters.push({ cond, res }); rwake(); });
  function rstep(now: number) {
    rraf = 0;
    if (!RD.on || !hero) return;
    const dt = Math.min(1 / 30, Math.max(0, (now - rlast) / 1000)); rlast = now;
    const c = RD.cover;
    RD.lift.step(dt); c.step(dt); RD.zoom.step(dt);
    // la couverture qui touche la table ou le livre rebondit à peine
    if (c.v < -180) { c.v = -180; c.vel = -c.vel * .15; }
    if (c.v > 0) { c.v = 0; c.vel = -c.vel * .15; }
    render();
    for (let k = RD.waiters.length - 1; k >= 0; k--) if (RD.waiters[k].cond()) { RD.waiters[k].res(); RD.waiters.splice(k, 1); }
    if (!(RD.lift.rest(.0005) && c.rest(.05) && RD.zoom.rest(.0005)) || RD.waiters.length) rwake();
  }

  async function open(i: number) {
    const e = els[i];
    if (!e || RD.on) return;
    Object.assign(RD, { on: true, busy: true, closeAfter: false, b: e.b, entry: e, waiters: [] });
    pulled = e; e.pullTarget = 1; goTo(i, 120);
    colors(e.b); fill(e.b);
    Object.assign(RD, sizeBook(e.b));
    await settle(() => e.pull > .97 && Math.abs(f - i) < .03);
    buildHero(); anchorTo(e);
    RD.lift = spring(0, 120, 19); RD.lift.to = 1;
    RD.cover = spring(0, 90, 15);
    RD.zoom = spring(0, 110, 21);
    render();
    e.el.classList.add('is-off');
    root.classList.add('reading');
    rwake();
    await until(() => RD.lift.v > .65);
    RD.cover.to = -180;                                   // la couverture : lourde, elle prend son temps
    await until(() => RD.cover.v < -125);
    RD.zoom.to = 1;
    await until(() => RD.zoom.v > .82);
    // la fiche, de la même couleur, est déjà là dessous : le texte monte pendant qu'on finit d'entrer
    detail.classList.add('open', 'ready'); detail.setAttribute('aria-hidden', 'false');
    persp.classList.add('fade');
    await until(() => RD.zoom.v > .99);
    persp.replaceChildren(); persp.classList.remove('fade'); hero = null;
    RD.busy = false;
    if (RD.closeAfter) void close();                           // Échap pendant qu'on le prenait : on le repose aussitôt
  }

  async function close() {
    if (!RD.on || RD.closing) return;
    if (RD.busy) { RD.closeAfter = true; return; }
    RD.closing = RD.busy = true;
    detail.classList.remove('ready');
    dCover.style.removeProperty('transform');
    await wait(170);
    const e = RD.entry;
    Object.assign(RD, sizeBook(RD.b));
    buildHero(); anchorTo(e);
    RD.lift = spring(1, 130, 22); RD.cover = spring(-180, 110, 14); RD.zoom = spring(1, 110, 21);
    render();
    detail.classList.remove('open'); detail.setAttribute('aria-hidden', 'true');
    RD.zoom.to = 0;                                       // on ressort de la page
    rwake();
    await until(() => RD.zoom.v < .25);
    RD.cover.to = 0;                                      // la couverture se rabat
    await until(() => RD.cover.v > -45);
    root.classList.remove('reading');
    await until(() => RD.cover.v > -8);
    RD.lift.to = 0;                                       // et le livre retourne à sa place
    await until(() => RD.lift.v < .012);
    e.el.classList.remove('is-off');
    persp.replaceChildren(); hero = null;
    Object.assign(RD, { on: false, busy: false, closing: false, closeAfter: false });
    pulled = e;   // il reste sorti : un clic ailleurs le range
    if (stale) void reload();
  }

  /* ---------- La fiche ---------- */
  const yearOf = (y: number | string) => typeof y !== 'number' ? String(y) : y < 1000 ? W.year(y) : String(y);
  const statusOf = (b: Book) => {
    const when = (d: string | undefined, k: string) => { const [y, m] = String(d || '').split('-'); return m ? `${W.when[k]} ${W.months[+m - 1]} ${y}` : ''; };
    if (b.lecture === 'lu') return when(b.lu, 'lu') || W.status.lu;
    if (b.lecture === 'en cours') return when(b.commence, 'en cours') || W.status['en cours'];
    return W.status['a lire'];
  };
  const genreOf = (b: Book) => { const g = (b.genres || []).filter(x => x !== 'fiction' && x !== 'non-fiction'); return W.genres[g[0] || (b.genres || [])[0]]; };
  const byTitle = (t: string | undefined) => t && books.find(b => fold(b.titre) === fold(t) || (b.aliases || []).some(a => fold(a) === fold(t)));

  function related(b: ShelfBook) {
    const out: { x: ShelfBook; why: string }[] = [], seen = new Set([b.id]);
    const add = (x: ShelfBook | undefined | '', why: string) => { if (x && !seen.has(x.id)) { seen.add(x.id); out.push({ x, why }); } };
    add(byTitle(b.suiteDe), W.rel.before);
    for (const x of books) if (byTitle(x.suiteDe) === b) add(x, W.rel.next);
    add(byTitle(b.decouvert), W.rel.foundHere);
    for (const x of books) if (byTitle(x.decouvert) === b) add(x, W.rel.ledHere);
    const shared = (x: Book) => (x.themes || []).filter(t => (b.themes || []).includes(t));
    books.map(x => ({ x, s: shared(x) })).filter(r => r.s.length).sort((a, c) => c.s.length - a.s.length)
      .forEach(r => add(r.x, r.s.slice(0, 2).join(', ')));
    return out.slice(0, 6);
  }

  function fill(b: ShelfBook) {
    const notes = b.cards || [];
    const cit = notes.reduce((s, n) => s + (n.cit || 0), 0);
    const rel = related(b), g = genreOf(b);
    const S: string[] = [];
    S.push(`<div class="d-status">${statusOf(b)}${g ? ' · ' + g : ''}</div>`);
    S.push(`<h1 class="d-title">${esc(b.titre)}</h1>`);
    S.push(`<div class="d-meta">${[esc(b.auteur), b.annee ? yearOf(b.annee) : '', b.decouvert ? `${W.foundVia} ${esc(b.decouvert)}` : ''].filter(Boolean).join(' · ')}</div>`);
    if (notes.length) {
      S.push(`<div class="d-section"><div class="d-label">${W.cards} · ${notes.length}${cit ? ` · ${cit} ${W.citations}` : ''}</div><div class="notes">${
        notes.slice(0, 6).map(n => `<button class="note" data-path="${esc(n.path)}"><div class="note-t">${esc(n.t)}</div><div class="note-c">${n.cit ? n.cit + ' ' + W.cit : ''}</div>${n.ex ? `<div class="note-ex">${esc(n.ex)}</div>` : ''}</button>`).join('')
      }</div>${notes.length > 6 ? `<div class="more">${W.moreCards(notes.length - 6)}</div>` : ''}</div>`);
    }
    if (b.pourquoi) S.push(`<div class="d-section"><div class="d-label">${W.why}</div><div class="d-why">${esc(b.pourquoi)}</div></div>`);
    if ((b.tropes || []).length) S.push(`<div class="d-section"><div class="d-label">${W.tropes}</div><div class="chips">${b.tropes.map(t => `<span class="chip trope">${esc(t)}</span>`).join('')}</div></div>`);
    if (b.resume) S.push(`<div class="d-section"><div class="d-label">${W.summary}</div><div class="d-text">${esc(b.resume)}</div>${b.certitude === 'a verifier' ? `<div class="d-check">${W.check}</div>` : ''}</div>`);
    const tags = b.themes || [];
    if (tags.length) S.push(`<div class="d-section"><div class="d-label">${W.themes}</div><div class="chips">${
      tags.map(t => host.known(t) ? `<button class="chip known" data-name="${esc(t)}" title="${W.openInVault}">${esc(t)}</button>` : `<span class="chip">${esc(t)}</span>`).join('')
    }</div></div>`);
    if ((b.mots || []).length) S.push(`<div class="d-section"><div class="d-label">${W.keywords}</div><div class="chips">${b.mots.map(t => `<span class="chip kw">${esc(t)}</span>`).join('')}</div></div>`);
    if (rel.length) S.push(`<div class="d-section"><div class="d-label">${W.leadsTo}</div><div class="trail">${
      rel.map(r => `<button class="mini" data-id="${esc(r.x.id)}">${r.x.src ? `<img src="${r.x.src}" alt="">` : `<span class="mini-blank">${esc(r.x.titre)}</span>`}<span class="why">${esc(r.why)}</span></button>`).join('')
    }</div></div>`);
    // ce qu'on peut faire du livre, selon où il en est
    const next: Record<string, Status[]> = { 'a lire': ['en cours', 'lu'], 'en cours': ['lu', 'a lire'], lu: ['en cours', 'a lire'] };
    const acts = (next[b.lecture] || []).map(k => [k, W.act[k]]);
    S.push(`<div class="actions">${acts.map(([to, label], i) => `<button class="${i ? 'btn-line' : 'btn'} mark" data-to="${to}">${label}</button>`).join('')}<button class="btn-line edit">${W.act.note}</button><button class="btn-line remove">${W.act.remove}</button></div>`);
    body.replaceChildren(dom(S.join('')));
    [...body.children].forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(i)));
    body.scrollTop = 0;
    body.querySelectorAll<HTMLElement>('.mini').forEach(m => m.addEventListener('click', () => jump(books.find(x => x.id === m.dataset.id))));
    body.querySelectorAll<HTMLElement>('.note').forEach(n => n.addEventListener('click', () => void host.open(n.dataset.path)));
    body.querySelectorAll<HTMLElement>('.chip.known').forEach(c => c.addEventListener('click', () => void host.openName(c.dataset.name)));
    body.querySelectorAll<HTMLElement>('.mark').forEach(m => m.addEventListener('click', () => void mark(b, m.dataset.to as Status)));
    body.querySelector('.edit').addEventListener('click', () => void host.open(b.path));
    // retirer demande une seconde pression, et la note reste dans le vault
    const rm = body.querySelector<HTMLButtonElement>('.remove');
    rm.addEventListener('click', () => void (async () => {
      if (!rm.classList.contains('sure')) {
        rm.classList.add('sure'); rm.textContent = W.act.sure;
        window.setTimeout(() => { if (rm.isConnected && !rm.disabled) { rm.classList.remove('sure'); rm.textContent = W.act.remove; } }, 3500);
        return;
      }
      rm.disabled = true;
      try { await host.remove(b); } catch { rm.disabled = false; toast(W.toast.notSaved); return; }
      books = books.filter(x => x.id !== b.id);
      await close();
      build();
      toast(W.toast.removed(b.titre));
    })());
  }

  /* Passer d'un livre ouvert à un autre, sans repasser par l'étagère */
  function jump(b: ShelfBook | undefined) {
    if (!b || RD.busy) return;
    RD.busy = true;
    detail.classList.remove('ready');
    window.setTimeout(() => {
      const old = RD.entry;
      if (old) { old.pull = old.pullTarget = 0; old.el.classList.remove('is-off'); }
      const shelfOf = b.lecture;
      if (shelfOf !== shelf || !inGenre(b)) { shelf = shelfOf; if (!inGenre(b)) genre = 'tout'; build(b.id); }
      const i = list.findIndex(x => x.id === b.id), e = els[i];
      target = f = Math.max(0, i); vel = 0;
      if (e) { e.pull = e.pullTarget = 1; e.el.classList.add('is-off'); pulled = e; }
      layout();
      RD.b = b; RD.entry = e;
      colors(b); fill(b);
      window.requestAnimationFrame(() => { detail.classList.add('ready'); RD.busy = false; });
    }, 280);
  }

  let toastT = 0;
  function toast(msg: string) {
    const t = $('.toast');
    t.textContent = msg; t.classList.add('show');
    window.clearTimeout(toastT); toastT = window.setTimeout(() => t.classList.remove('show'), 2400);
  }

  async function mark(b: ShelfBook, lecture: Status) {
    const today = new Date().toISOString().slice(0, 10);
    b.lecture = lecture;
    b.lu = lecture === 'lu' ? today : undefined;
    if (lecture === 'en cours') b.commence = today; else if (lecture === 'a lire') b.commence = undefined;
    void host.setLecture(b, lecture);
    await close();
    switchShelf(lecture, b.id);
    toast(W.toast[lecture](b.titre));
  }

  $('.back').addEventListener('click', () => void close());

  /* la couverture suit doucement la souris, comme un objet qu'on tient */
  detail.addEventListener('pointermove', e => {
    if (!detail.classList.contains('ready')) return;
    const r = dCover.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / vw(), dy = (e.clientY - (r.top + r.height / 2)) / vh();
    dCover.style.transform = `rotateY(${dx * 14}deg) rotateX(${-dy * 10}deg)`;
    dCover.style.setProperty('--gx', (50 + dx * 80) + '%');
    dCover.style.setProperty('--gy', (40 + dy * 80) + '%');
  });

  /* ---------- Ajouter un livre : chercher dans Open Library, dire pourquoi, le poser ---------- */
  const adder = $('.adder'), q = $<HTMLInputElement>('.adder-q'), results = $('.results'), state = $('.adder-state'), pick = $('.pick');
  let found: OLDoc[] = [], docs: OLDoc[] = [], sel = -1, searchT = 0, searchN = 0, chosen: OLDoc | null = null;
  const adding = () => adder.classList.contains('open');
  const have = (d: OLDoc) => books.some(b => b.olkey === d.key || fold(b.titre) === fold(d.title));
  const coverOf = (d: OLDoc, size: string) => `https://covers.openlibrary.org/b/id/${d.cover_i}-${size}.jpg`;
  const authors = (d: OLDoc) => (d.author_name || []).slice(0, 2).join(', ');

  function openAdd() {
    if (RD.on) return;
    putBack();
    adder.classList.remove('picking'); adder.classList.add('open'); adder.setAttribute('aria-hidden', 'false');
    q.value = ''; results.replaceChildren(); state.textContent = ''; found = []; sel = -1;
    window.setTimeout(() => q.focus(), 60);
  }
  function closeAdd() {
    adder.classList.remove('open', 'picking'); adder.setAttribute('aria-hidden', 'true');
    q.blur(); searchN++; window.clearTimeout(searchT);
    if (stale) void reload();
  }
  $('.add-btn').addEventListener('click', openAdd);
  $('.adder-close').addEventListener('click', closeAdd);

  q.addEventListener('input', () => {
    window.clearTimeout(searchT);
    const v = q.value.trim();
    if (v.length < 2) { searchN++; results.replaceChildren(); state.textContent = ''; found = []; return; }
    searchT = window.setTimeout(() => void search(v), 280);
  });
  async function search(v: string) {
    const n = ++searchN;
    state.textContent = W.searching;
    try {
      docs = await host.search(v);
      if (n !== searchN) return;   // une recherche plus récente est partie entre-temps
      found = docs.filter(d => d.cover_i).slice(0, 8);   // sans couverture, pas de tranche
      sel = -1;
      state.textContent = found.length ? '' : W.nothing;
      results.replaceChildren(dom(found.map((d, i) => `<button class="result${have(d) ? ' have' : ''}" data-i="${i}" style="--i:${i}">
        <span class="r-cover" style="background-image:url('${coverOf(d, 'M')}')"></span>
        <span><span class="r-title">${esc(d.title)}</span><span class="r-author">${esc(authors(d))}</span></span>
        <span class="r-year">${esc(d.first_publish_year)}</span></button>`).join('')));
    } catch { if (n === searchN) state.textContent = W.offline; }
  }
  results.addEventListener('click', e => {
    const r = closest(e.target, '.result');
    if (r && !r.classList.contains('have')) choose(found[+r.dataset.i]);
  });
  q.addEventListener('keydown', e => {
    if (!found.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
      [...results.children].forEach((c, i) => c.classList.toggle('on', i === sel));
      results.children[sel]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const d = found[Math.max(0, sel)];
      if (d && !have(d)) choose(d);
    }
  });

  // Open Library a parfois plusieurs fiches pour le même livre : les sujets et le résumé sont répartis entre elles
  const twins = (d: OLDoc) => docs.filter(x => x.key !== d.key && fold(x.title) === fold(d.title) && (x.author_name || [])[0] === (d.author_name || [])[0]).slice(0, 3);
  const subjects = (d: OLDoc) => [...new Set([...(d.subject || []), ...twins(d).flatMap(x => x.subject || [])])];
  function choose(d: OLDoc) {
    chosen = d;
    // les tropes ne s'affichent que pour la fantasy et la science-fiction ; ceux qu'Open Library connaît sont déjà cochés
    const subj = subjects(d).join(' | ').toLowerCase();
    const fiction = inferGenres([...subjects(d), d.title]).some(g => g === 'fantasy' || g === 'science-fiction');
    const tropes = fiction ? W.tropeList.map((t, i): [string, boolean] => [t, TROPE_HINTS[i].test(subj)]) : [];
    pick.replaceChildren(dom(`<div class="pick-cover" style="background-image:url('${coverOf(d, 'L')}')"></div>
      <div>
        <div class="pick-title">${esc(d.title)}</div>
        <div class="pick-author">${esc([authors(d), d.first_publish_year].filter(Boolean).join(' · '))}</div>
        <label class="field"><span>${W.why}</span><textarea class="p-why" rows="3" placeholder="${esc(W.whyPh)}"></textarea></label>
        <label class="field"><span>${W.from}</span><input class="p-from" list="etagere-titres" placeholder="${esc(W.fromPh)}"><datalist id="etagere-titres">${books.map(b => `<option value="${esc(b.titre)}">`).join('')}</datalist></label>
        ${tropes.length ? `<div class="field"><span>${W.tropes} <em>${W.tropesHint}</em></span><div class="p-tropes">${
          tropes.sort((a, b) => Number(b[1]) - Number(a[1])).map(([t, on]) => `<button type="button" class="p-trope${on ? ' on' : ''}" aria-pressed="${on}">${esc(t)}</button>`).join('')
        }</div></div>` : ''}
        <div class="pick-actions"><button class="btn-ink p-add">${W.put}</button><button class="btn-ghost p-back">${W.other}</button></div>
      </div>`));
    adder.classList.add('picking');
    window.setTimeout(() => pick.querySelector<HTMLElement>('.p-why').focus(), 80);
    pick.querySelector('.p-add').addEventListener('click', () => void add());
    pick.querySelector('.p-back').addEventListener('click', unpick);
    pick.querySelectorAll('.p-trope').forEach(c => c.addEventListener('click', () => { const on = c.classList.toggle('on'); c.setAttribute('aria-pressed', String(on)); }));
    pick.querySelector<HTMLElement>('.p-from').addEventListener('keydown', e => { if (e.key === 'Enter') void add(); });
    pick.querySelector<HTMLElement>('.p-why').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add(); });
  }
  function unpick() { adder.classList.remove('picking'); q.focus(); }

  const NOISE = /accessible|daisy|library|large type|reading level|lending|textbook|translations|bestseller|:|=|\d{4}/i;
  async function summary(d: OLDoc) {
    for (const x of [d, ...twins(d)]) { const t = await host.description(x.key); if (t) return t; }
    return '';
  }
  async function add() {
    const d = chosen, btn = pick.querySelector<HTMLButtonElement>('.p-add');
    if (!d || btn.disabled) return;
    btn.disabled = true; btn.textContent = W.preparing;
    const seen = new Set<string>();
    const data: NewBook = {
      titre: d.title, auteur: (d.author_name || [])[0] || '', annee: d.first_publish_year, pages: d.number_of_pages_median,
      olkey: d.key, couverture: coverOf(d, 'L'),
      mots: subjects(d).filter(s => s.length < 28 && !NOISE.test(s) && !seen.has(fold(s)) && seen.add(fold(s))).slice(0, 6),
      genres: inferGenres([...subjects(d), d.title]),
      pourquoi: pick.querySelector<HTMLTextAreaElement>('.p-why').value.trim(),
      decouvert: pick.querySelector<HTMLInputElement>('.p-from').value.trim(),
      tropes: [...pick.querySelectorAll('.p-trope.on')].map(c => c.textContent),
      resume: await summary(d),   // souvent en anglais : de quoi se décider en attendant mieux
    };
    let path: string;
    try { path = await host.add(data); }
    catch { btn.disabled = false; btn.textContent = W.put; toast(W.toast.failed); return; }
    // le livre est posé tout de suite ; la relecture du vault le confirmera
    const b: ShelfBook = {
      ...data, id: path, path, lecture: 'a lire', auteur: data.auteur, annee: data.annee ?? '', themes: [], aliases: [],
      mots: data.mots, genres: data.genres, tropes: data.tropes, resume: data.resume, pourquoi: data.pourquoi,
    };
    books = books.filter(x => x.id !== path).concat(b);
    await load(b);
    closeAdd();
    switchShelf('a lire', b.id);
    window.setTimeout(() => { pullOut(list.findIndex(x => x.id === b.id)); }, 480);
    toast(W.toast.added(b.titre));
  }

  /* ---------- Charger : les livres du vault, leurs couvertures, leurs couleurs ---------- */
  function load(b: ShelfBook) {
    return host.cover(b).then(src => new Promise<void>(res => {
      b.src = src || '';
      if (!src) return res();
      const img = new Image();
      if (/^https?:/.test(src)) img.crossOrigin = 'anonymous';   // une couverture d'Open Library : sans ça, impossible d'en lire les couleurs
      img.onload = () => { b.ratio = img.naturalWidth / img.naturalHeight; try { b.pal = palette(img); } catch { /* une image illisible : la couleur par défaut */ } res(); };
      img.onerror = () => res();
      img.src = src;
    })).catch(() => {});
  }
  // les notes écrites sur les livres, cherchées après coup pour ne pas retarder l'étagère
  async function loadCards() {
    for (const b of books) { if (!alive) return; try { b.cards = await host.cards(b); } catch { b.cards = []; } }
  }

  let stale = false, loading: Promise<void> | null = null;
  async function reload(): Promise<void> {
    // pendant qu'un livre est ouvert ou qu'on en ajoute un, on attend : rien ne doit bouger sous ses mains
    if (RD.on || adding()) { stale = true; return; }
    if (loading !== null) { stale = true; return loading; }
    stale = false;
    loading = (async () => {
      const keep = list[Math.round(f)]?.id, prev = new Map(books.map(b => [b.id, b]));
      const next: ShelfBook[] = await host.books();
      // un livre déjà chargé garde sa couverture et ses couleurs si elle n'a pas changé
      for (const b of next) { const o = prev.get(b.id); if (o && o.couverture === b.couverture) Object.assign(b, { src: o.src, pal: o.pal, ratio: o.ratio, cards: o.cards }); }
      await Promise.all(next.filter(b => b.src === undefined).map(load));
      if (!alive) return;
      books = next;
      if (!RD.on && !adding()) build(keep);
      void loadCards();
    })();
    try { await loading; } finally { loading = null; if (stale) void reload(); }
  }
  const unsubscribe = host.onChange(() => void reload());

  let resizeT = 0;
  const ro = new ResizeObserver(() => {
    window.clearTimeout(resizeT);
    resizeT = window.setTimeout(() => { if (RD.on) return; measure(); build(list[Math.round(f)]?.id); }, 120);
  });
  ro.observe(root);

  measure();
  void reload();

  return {
    destroy() {
      alive = false;
      window.cancelAnimationFrame(raf); window.cancelAnimationFrame(rraf);
      ro.disconnect(); unsubscribe();
      root.replaceChildren();
    }
  };
}
