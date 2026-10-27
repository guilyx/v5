import type { Photo } from "../content";

/** Full-size view for Through the Lens. Arrow keys walk the set; Escape closes. */
export class Lightbox {
  private root = document.getElementById("lightbox")!;
  private img = this.root.querySelector("img")!;
  private cap = this.root.querySelector("figcaption")!;
  private list: Photo[] = [];
  private i = 0;
  private returnFocus: Element | null = null;

  constructor() {
    this.root.querySelector(".lb-close")!.addEventListener("click", () => this.close());
    this.root.querySelector(".lb-prev")!.addEventListener("click", () => this.step(-1));
    this.root.querySelector(".lb-next")!.addEventListener("click", () => this.step(1));
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });
    addEventListener("keydown", (e) => {
      if (this.root.hidden) return;
      if (e.key === "Escape") this.close();
      if (e.key === "ArrowLeft") this.step(-1);
      if (e.key === "ArrowRight") this.step(1);
    });
  }

  open(list: Photo[], i: number) {
    this.list = list;
    this.returnFocus = document.activeElement;
    this.root.hidden = false;
    document.documentElement.style.overflow = "hidden";
    this.show(i);
    (this.root.querySelector(".lb-close") as HTMLElement).focus();
  }

  private show(i: number) {
    this.i = (i + this.list.length) % this.list.length;
    const p = this.list[this.i];
    this.img.src = `/photos/${p.file}`;
    this.img.alt = `${p.title}, ${p.place}`;
    this.cap.innerHTML = `${p.title} <span>· ${p.place} · ${this.i + 1}/${this.list.length}</span>`;
  }

  private step(d: number) {
    this.show(this.i + d);
  }

  close() {
    this.root.hidden = true;
    document.documentElement.style.overflow = "";
    (this.returnFocus as HTMLElement | null)?.focus?.();
  }
}
