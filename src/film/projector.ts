/**
 * The projector: one dialog that shows a clip or a still big, with its caption.
 * It opens out of the frame you clicked (a quick FLIP), and closes on Esc.
 */
export interface ProjItem {
  media(): HTMLElement;
  caption(): Node[];
}

export class Projector {
  private dlg = document.getElementById("projector") as HTMLDialogElement;
  private box = this.dlg.querySelector<HTMLElement>(".proj-media")!;
  private cap = this.dlg.querySelector<HTMLElement>(".proj-cap")!;
  private prev = this.dlg.querySelector<HTMLButtonElement>(".proj-prev")!;
  private next = this.dlg.querySelector<HTMLButtonElement>(".proj-next")!;
  private items: ProjItem[] = [];
  private i = 0;
  private opener: Element | null = null;
  onOpen: ((open: boolean) => void)[] = [];

  constructor(private reduced: boolean) {
    this.dlg.querySelector(".proj-close")!.addEventListener("click", () => this.dlg.close());
    this.prev.addEventListener("click", () => this.show(this.i - 1));
    this.next.addEventListener("click", () => this.show(this.i + 1));
    this.dlg.addEventListener("click", (e) => {
      if (e.target === this.dlg) this.dlg.close();
    });
    this.dlg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") this.show(this.i + 1);
      if (e.key === "ArrowLeft") this.show(this.i - 1);
    });
    this.dlg.addEventListener("close", () => {
      this.box.querySelector("video")?.pause();
      this.box.replaceChildren();
      for (const f of this.onOpen) f(false);
      if (this.opener instanceof HTMLElement) this.opener.focus({ preventScroll: true });
    });
  }

  get isOpen() {
    return this.dlg.open;
  }

  open(items: ProjItem[], i: number, from?: DOMRect) {
    this.items = items;
    this.opener = document.activeElement;
    this.prev.hidden = this.next.hidden = items.length < 2;
    this.show(i);
    this.dlg.showModal();
    for (const f of this.onOpen) f(true);
    if (from && !this.reduced) {
      const m = this.box.firstElementChild as HTMLElement | null;
      const r = m?.getBoundingClientRect();
      if (m && r && r.width > 0) {
        const sx = from.width / r.width;
        const dx = from.left + from.width / 2 - (r.left + r.width / 2);
        const dy = from.top + from.height / 2 - (r.top + r.height / 2);
        m.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx})`, opacity: 0.4 }, { transform: "none", opacity: 1 }], {
          duration: 480,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        });
      }
      this.cap.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: 160, fill: "backwards" });
    }
  }

  private show(i: number) {
    const n = this.items.length;
    this.i = ((i % n) + n) % n;
    const it = this.items[this.i];
    this.box.querySelector("video")?.pause();
    this.box.replaceChildren(it.media());
    this.cap.replaceChildren(...it.caption());
  }
}

/** a still from the contact sheet */
export function stillItem(a: HTMLAnchorElement): ProjItem {
  return {
    media() {
      // the contact-sheet size is already loaded: show it at once, swap in the big one when it lands
      const thumb = a.querySelector("img");
      const img = new Image();
      img.alt = thumb?.alt ?? "";
      if (thumb) {
        img.src = thumb.currentSrc || thumb.src;
        img.width = thumb.naturalWidth || 800;
        img.height = thumb.naturalHeight || 534;
      }
      img.style.width = `min(88vw, 1200px, calc(68dvh * ${(img.width / img.height).toFixed(4)}))`;
      const big = new Image();
      big.onload = () => (img.src = a.href);
      big.src = a.href;
      return img;
    },
    caption() {
      const h = document.createElement("h3");
      h.textContent = a.dataset.caption ?? "";
      const p = document.createElement("p");
      p.textContent = "Photo by Erwin Lejeune";
      return [h, p];
    },
  };
}

/** a clip from the reel */
export function clipItem(li: HTMLElement, reduced: boolean): ProjItem {
  const key = li.dataset.key!;
  return {
    media() {
      const v = document.createElement("video");
      v.src = `/work/${key}.mp4`;
      v.poster = `/work/${key}.webp`;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.controls = true;
      v.preload = "auto";
      v.autoplay = !reduced;
      v.setAttribute("aria-label", `${li.querySelector("h3")?.textContent ?? key}, a silent clip`);
      return v;
    },
    caption() {
      return [li.querySelector("h3")!, li.querySelector(".clip-line")!, li.querySelector(".clip-links")!].map((n) => n.cloneNode(true));
    },
  };
}
