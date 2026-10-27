import type * as THREE from "three";
import type { RailItem } from "./sections";
import { smoothstep } from "../core/util";

/**
 * The machine register: the waypoint rail on the left, telemetry in the
 * corner, and the panels' fade as their stop pins and unpins.
 */
export class Hud {
  private links: HTMLAnchorElement[] = [];
  private tops: number[] = [];
  private fill: HTMLElement;
  private telemetry = document.getElementById("telemetry")!;
  private panels: { el: HTMLElement; section: HTMLElement; top: number; h: number; last: boolean }[] = [];
  private lastTele = "";
  private activeRail = -1;
  onJump: (stopId: string) => void = () => {};

  constructor(
    rail: HTMLElement,
    private items: RailItem[],
  ) {
    this.fill = document.createElement("span");
    this.fill.className = "rail-fill";
    rail.appendChild(this.fill);
    for (const it of items) {
      const a = document.createElement("a");
      a.href = `#${it.stopId}`;
      a.innerHTML = `<span>${it.label}</span>`;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        this.onJump(it.stopId);
        rail.classList.remove("open");
        document.getElementById("menu-btn")?.setAttribute("aria-expanded", "false");
      });
      rail.appendChild(a);
      this.links.push(a);
    }
    const btn = document.getElementById("menu-btn")!;
    btn.addEventListener("click", () => {
      const open = rail.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
    });

    const sections = Array.from(document.querySelectorAll<HTMLElement>(".stop"));
    sections.forEach((s, i) =>
      this.panels.push({
        el: s.querySelector(".panel")!,
        section: s,
        top: 0,
        h: 0,
        last: i === sections.length - 1,
      }),
    );
    this.measure();
    addEventListener("resize", () => this.measure());
    // panel contents can grow (details open); keep offsets honest
    new ResizeObserver(() => this.measure()).observe(document.getElementById("content")!);
  }

  measure() {
    for (const p of this.panels) {
      p.top = p.section.getBoundingClientRect().top + scrollY;
      p.h = p.section.offsetHeight;
    }
    this.tops = this.items.map((it) => {
      const el = document.getElementById(it.stopId)!;
      return el.getBoundingClientRect().top + scrollY;
    });
  }

  update(progress: number, camera: THREE.PerspectiveCamera, chapter: string) {
    const y = scrollY;
    const vh = innerHeight;

    // panels share one fixed frame: each fades in as its stop begins and out as it ends
    for (let i = 0; i < this.panels.length; i++) {
      const p = this.panels[i];
      const s = (y - p.top) / p.h;
      const fin = i === 0 ? 1 : smoothstep(-0.03, 0.1, s);
      const fout = p.last ? 1 : 1 - smoothstep(0.74, 0.86, s);
      const o = fin * fout;
      const str = o.toFixed(3);
      if (p.el.style.getPropertyValue("--o") !== str) {
        p.el.style.setProperty("--o", str);
        p.el.style.setProperty("--d", s < 0.5 ? "1" : "-1");
        if (o < 0.01) p.el.setAttribute("data-hidden", "");
        else p.el.removeAttribute("data-hidden");
      }
    }

    // rail
    let active = 0;
    for (let i = 0; i < this.tops.length; i++) if (y >= this.tops[i] - vh * 0.1) active = i;
    if (active !== this.activeRail) {
      this.links.forEach((a, i) => {
        a.classList.toggle("on", i === active);
        a.classList.toggle("passed", i < active);
        if (i === active) a.setAttribute("aria-current", "step");
        else a.removeAttribute("aria-current");
      });
      this.activeRail = active;
    }
    const first = this.links[0];
    const last = this.links[this.links.length - 1];
    if (first && last) {
      const span = last.offsetTop - first.offsetTop;
      this.fill.style.height = `${(span * progress).toFixed(1)}px`;
      this.fill.style.top = `${first.offsetTop + first.offsetHeight / 2}px`;
    }

    // telemetry
    const p = camera.position;
    const f = (n: number) => (n >= 0 ? " " : "-") + Math.abs(n).toFixed(1).padStart(6, "0");
    const t = `x${f(p.x)}  y${f(p.y)}  z${f(p.z)}   t ${progress.toFixed(3)}   ${chapter}`;
    if (t !== this.lastTele) {
      this.telemetry.textContent = t;
      this.lastTele = t;
    }
    this.telemetry.style.opacity = String(1 - smoothstep(0.96, 0.99, progress));
  }
}
