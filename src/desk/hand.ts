import type { Photo, Project } from "./objects/after";

/* The paper you read while holding something. Everything in it is cloned from the page's own
   HTML, so the words exist once and the 3D never invents any. */

export interface HandHooks {
  close: () => void;
  laptopStep: (d: number) => void;
  photoStep: (d: number) => void;
  openPhoto: (i: number) => void;
}

export class HandPanel {
  el = document.querySelector<HTMLElement>(".hand")!;
  paper = this.el.querySelector<HTMLElement>(".hand-paper")!;
  kicker = this.el.querySelector<HTMLElement>(".hand-kicker")!;
  title = this.el.querySelector<HTMLElement>(".hand-title")!;
  body = this.el.querySelector<HTMLElement>(".hand-body")!;
  private returnFocus: HTMLElement | null = null;

  constructor(private hooks: HandHooks) {
    this.el.querySelector(".hand-back")!.addEventListener("click", () => hooks.close());
  }

  get open() {
    return !this.el.hidden;
  }

  /** the rectangle of the screen the panel covers, for framing the object next to it */
  rect() {
    return this.paper.getBoundingClientRect();
  }

  show(panel: string, name: string, ctx: { projects: Project[]; laptopIndex: number; photos: Photo[] }, focus: boolean) {
    const wasOpen = this.open;
    this.kicker.textContent = panel.startsWith("photo:") ? "A polaroid" : name;
    this.body.replaceChildren();
    const [kind, arg] = panel.split(":");
    if (kind === "station") this.station(arg);
    else if (kind === "laptop") this.project(ctx.projects, ctx.laptopIndex);
    else if (kind === "photo") this.photo(ctx.photos, Number(arg));
    else if (kind === "writing") this.writing();
    else if (kind === "contact") this.contact();
    else if (kind === "offclock") this.offclock();
    this.el.hidden = false;
    if (!wasOpen) {
      // restart the paper's little entrance
      this.paper.style.animation = "none";
      void this.paper.offsetWidth;
      this.paper.style.animation = "";
      this.paper.scrollTop = 0;
    }
    if (focus) {
      if (!wasOpen) this.returnFocus = document.activeElement as HTMLElement | null;
      this.paper.focus({ preventScroll: true });
    }
  }

  hide() {
    if (!this.open) return;
    this.el.hidden = true;
    if (this.returnFocus && document.contains(this.returnFocus)) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  private station(id: string) {
    const card = document.querySelector<HTMLElement>(`.station[data-station="${id}"] .card`);
    if (!card) return;
    this.title.innerHTML = card.querySelector("h3")!.innerHTML;
    for (const child of Array.from(card.children)) {
      if (child.matches("h3, button, .after-picks")) continue;
      const c = child.cloneNode(true) as HTMLElement;
      c.removeAttribute("id");
      this.body.append(c);
    }
  }

  private nav(count: string, step: (d: number) => void) {
    const nav = document.createElement("div");
    nav.className = "hand-nav";
    nav.innerHTML = `<span class="count">${count}</span><button type="button" data-d="-1" aria-label="Previous">←</button><button type="button" data-d="1" aria-label="Next">→</button>`;
    nav.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.addEventListener("click", () => step(Number(b.dataset.d))));
    return nav;
  }

  private project(projects: Project[], i: number) {
    const p = projects[i];
    this.title.textContent = p.title;
    const text = document.createElement("p");
    text.textContent = p.text;
    const links = document.createElement("p");
    links.className = "links";
    for (const l of p.links) {
      const a = document.createElement("a");
      a.href = l.href;
      a.textContent = l.label;
      links.append(a);
    }
    const note = document.createElement("p");
    note.className = "aside";
    note.textContent = "The screen plays a recording of it running. Click the laptop for the next one.";
    this.body.append(text, links, this.nav(`${i + 1} / ${projects.length}`, this.hooks.laptopStep), note);
  }

  private photo(photos: Photo[], i: number) {
    const p = photos[i];
    this.title.textContent = p.caption;
    const text = document.createElement("p");
    text.textContent = "One of my own photos, from the pile at the end of the desk.";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn btn-quiet";
    open.textContent = "Open it full size";
    open.addEventListener("click", () => this.hooks.openPhoto(i));
    this.body.append(text, open, this.nav(`${i + 1} / ${photos.length}`, this.hooks.photoStep));
  }

  private writing() {
    this.title.textContent = "Papers, notes, upstream code";
    const cols = document.querySelector("#writing .columns");
    if (cols) {
      for (const col of Array.from(cols.children)) this.body.append(col.cloneNode(true));
    }
  }

  private contact() {
    this.title.textContent = "Write to me";
    const env = document.querySelector("#contact .envelope");
    if (!env) return;
    for (const sel of ["p:not(.kicker):not(.email)", ".email", ".elsewhere"]) {
      const n = env.querySelector(sel);
      if (n) this.body.append(n.cloneNode(true));
    }
  }

  private offclock() {
    this.title.textContent = "Off the clock";
    const p = document.createElement("p");
    p.textContent = "Basketball, films, photography, and Clanker Labs: my self-hosted home, with an agent running it.";
    const links = document.createElement("p");
    links.className = "links";
    links.innerHTML = `<a href="https://clanker-labs.github.io/clanker-labs-public/">Clanker Labs</a><a href="#photos">The photos</a>`;
    this.body.append(p, links);
  }
}
