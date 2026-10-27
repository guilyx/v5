/**
 * Scroll → story time. Shared by the page (rail, nav, card fades) and the workshop (the arm),
 * so both always agree on where you are. No three.js in here.
 *
 *   s = -1 … 0   the hero: the arm follows your cursor
 *   s = i + p    chapter i, p = 0 … 1 through one pick-and-place cycle
 *   kb, kc       how far the camera has moved to the bench / the final shot
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Timeline {
  y: number;
  s: number;
  kb: number;
  kc: number;
  /** the reading sheets cover the whole viewport: nothing to draw */
  covered: boolean;
  zone: "hero" | "journey" | "bench" | "sheet" | "contact";
  /** the part of the viewport the arm may use (never under the text) */
  rect: Rect;
  vw: number;
  vh: number;
  mobile: boolean;
  reduced: boolean;
}

interface Marks {
  ch: { top: number; h: number }[];
  bench: { top: number; h: number };
  sheets: { top: number; bottom: number };
  contact: { top: number; h: number };
}

const ANCHOR = 0.6; // a chapter starts when its section's top reaches 60% of the viewport

let marks: Marks | null = null;

const absTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY;

export function measure(tl: Timeline) {
  const ch = Array.from(document.querySelectorAll<HTMLElement>(".chapter")).map((el) => ({ top: absTop(el), h: el.offsetHeight }));
  const bench = document.getElementById("bench")!;
  const notes = document.getElementById("notes")!;
  const photos = document.getElementById("photos")!;
  const contact = document.getElementById("contact")!;
  marks = {
    ch,
    bench: { top: absTop(bench), h: bench.offsetHeight },
    sheets: { top: absTop(notes), bottom: absTop(photos) + photos.offsetHeight },
    contact: { top: absTop(contact), h: contact.offsetHeight },
  };
  tl.vw = window.innerWidth;
  tl.vh = window.innerHeight;
  tl.mobile = tl.vw <= 860;
  const navH = tl.mobile ? 56 : 64;
  if (tl.mobile) {
    const free = tl.vh <= 760 ? 0.45 : 0.52; // matches the docked card's max-height in CSS
    tl.rect = { x: 0, y: navH, w: tl.vw, h: Math.max(180, tl.vh * free - navH) };
  } else {
    const card = document.querySelector(".hero .card");
    const right = card ? card.getBoundingClientRect().right : tl.vw * 0.4;
    const x = right + 12;
    tl.rect = { x, y: navH, w: tl.vw - x, h: tl.vh - navH - 84 };
  }
  update(tl);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function update(tl: Timeline) {
  if (!marks) return;
  const y = window.scrollY;
  const vh = tl.vh;
  tl.y = y;
  const a = ANCHOR * vh;
  const first = marks.ch[0];
  const start = first.top - a;
  let s: number;
  if (y < start) s = -1 + clamp01(y / Math.max(1, start));
  else {
    s = marks.ch.length;
    for (let i = 0; i < marks.ch.length; i++) {
      const c = marks.ch[i];
      if (y < c.top + c.h - a) {
        s = i + clamp01((y - (c.top - a)) / c.h);
        break;
      }
    }
  }
  tl.s = s;
  const b = marks.bench;
  tl.kb = clamp01((y - (b.top - vh)) / (vh * 0.85)) * (1 - clamp01((y - (b.top + b.h - vh * 0.9)) / (vh * 0.6)));
  const c = marks.contact;
  tl.kc = clamp01((y - (c.top - vh)) / (vh * 0.8));
  tl.covered = y >= marks.sheets.top && y + vh <= marks.sheets.bottom;

  const mid = y + vh * 0.5;
  if (mid < first.top) tl.zone = "hero";
  else if (mid < b.top) tl.zone = "journey";
  else if (mid < marks.sheets.top) tl.zone = "bench";
  else if (mid < c.top) tl.zone = "sheet";
  else tl.zone = "contact";
}

export function createTimeline(): Timeline {
  return {
    y: 0,
    s: -1,
    kb: 0,
    kc: 0,
    covered: false,
    zone: "hero",
    rect: { x: 0, y: 0, w: 1, h: 1 },
    vw: 1,
    vh: 1,
    mobile: false,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}
