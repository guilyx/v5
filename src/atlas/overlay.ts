/**
 * Everything drawn in HTML on top of the globe: city pins and photo pins, the graduated ring
 * around the globe, the marker at the head of the arc being drawn, and the live scale bar.
 * Positions come from the same camera as the WebGL globe, so the two never drift apart.
 */
import { arcPoint, facing, ll, project, silhouette, toLatLon, type Cam } from "./geo";
import { LEGS, PLACES, at, legShape, type Place } from "./places";
import type { TimelineState } from "./timeline";

interface PinEl {
  place: Place;
  el: HTMLElement;
  pos: ReturnType<typeof at>;
  shown: boolean;
  label: boolean;
  active: boolean;
  open: boolean;
  opacity: number;
  thumbLoaded: boolean;
  flip: string;
}

export interface OverlayHandlers {
  onPlace: (p: Place) => void;
}

const KM = 6371;
const WATERS = [
  { name: "Atlantic Ocean", lat: 31, lon: -32 },
  { name: "Indian Ocean", lat: -12, lon: 72 },
  { name: "Pacific Ocean", lat: 22, lon: -152 },
];
const NICE = [50, 100, 200, 500, 1000, 2000, 5000];

export class Overlay {
  private pins: PinEl[] = [];
  private lit: number[] = [];
  private waters: { el: HTMLElement; pos: ReturnType<typeof ll>; shown: boolean; opacity: number }[] = [];
  private ring: SVGSVGElement;
  private ringShown = true;
  private ringSize = 0;
  private head: HTMLElement;
  private headShown = false;
  private scaleBar: HTMLElement;
  private scaleText: HTMLElement;
  private coordText: HTMLElement;
  private lastScale = "";
  private lastCoord = "";

  constructor(root: HTMLElement, handlers: OverlayHandlers) {
    this.ring = root.querySelector<SVGSVGElement>(".ring")!;
    this.head = root.querySelector<HTMLElement>(".traveller")!;
    this.scaleBar = root.querySelector<HTMLElement>(".scale-bar")!;
    this.scaleText = root.querySelector<HTMLElement>(".scale-text")!;
    this.coordText = root.querySelector<HTMLElement>(".coord-text")!;
    const layer = root.querySelector<HTMLElement>(".pins")!;
    this.buildRingTicks();

    // ocean names, set in italic like a printed atlas; only on the whole-globe views
    for (const w of WATERS) {
      const el = document.createElement("span");
      el.className = "water";
      el.textContent = w.name;
      el.style.visibility = "hidden";
      layer.appendChild(el);
      this.waters.push({ el, pos: ll(w.lat, w.lon), shown: false, opacity: -1 });
    }

    for (const place of PLACES) {
      const el = document.createElement("button");
      el.type = "button";
      el.tabIndex = -1;
      el.className = `pin pin--${place.kind} pin--${place.side}${place.photos ? " pin--photo" : ""}`;
      el.dataset.place = place.key;
      const count = place.photos?.length ?? 0;
      const [title, where] = place.photos ? place.photos[0].caption.split(" · ") : ["", ""];
      el.innerHTML = place.photos
        ? `<span class="pin-thumb"><img alt="" width="48" height="48" /></span>
           <span class="pin-label"><b>${place.name}</b></span>
           <span class="postcard"><img alt="" /><span class="postcard-cap"><b>${title}</b><span>${where}</span><em>${
             count > 1 ? `${count} photos` : "1 photo"
           }</em></span></span>`
        : `<span class="pin-dot"></span><span class="pin-label"><b>${place.name}</b>${
            place.kind === "collab" ? `<em>${place.region}</em>` : ""
          }</span>`;
      el.addEventListener("click", () => handlers.onPlace(place));
      if (place.photos) {
        // the full postcard image loads only when someone actually looks at it
        const load = () => this.loadPostcard(el, place);
        el.addEventListener("pointerenter", load, { once: true });
        el.addEventListener("focus", load, { once: true });
      }
      layer.appendChild(el);
      this.pins.push({ place, el, pos: at(place.key), shown: false, label: false, active: false, open: false, opacity: -1, thumbLoaded: false, flip: "" });
      el.style.visibility = "hidden";
    }
  }

  private loadPostcard(el: HTMLElement, place: Place) {
    const img = el.querySelector<HTMLImageElement>(".postcard img")!;
    if (!img.src && place.photos) img.src = `/photos/${place.photos[0].file}-800.webp`;
  }

  private buildRingTicks() {
    // a graduated border, like the frame of a hemisphere plate: a tick every 5°, longer every 30°
    const g = this.ring.querySelector(".ring-ticks")!;
    let d = "";
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const r0 = 1.022;
      const r1 = i % 6 === 0 ? 1.06 : 1.04;
      d += `M${(Math.cos(a) * r0).toFixed(4)} ${(Math.sin(a) * r0).toFixed(4)}L${(Math.cos(a) * r1).toFixed(4)} ${(Math.sin(a) * r1).toFixed(4)}`;
    }
    g.setAttribute("d", d);
  }

  update(cam: Cam, st: TimelineState) {
    // ring around the globe
    const R = silhouette(cam);
    const ringOn = R < Math.hypot(cam.W, cam.H) * 0.62;
    if (ringOn !== this.ringShown) {
      this.ring.style.visibility = ringOn ? "visible" : "hidden";
      this.ringShown = ringOn;
    }
    if (ringOn) {
      // the viewBox spans ±1.07 globe radii; resizing (not scaling) keeps the hairlines crisp
      const size = R * 2.14;
      if (Math.abs(size - this.ringSize) > 0.5) {
        this.ring.style.width = this.ring.style.height = `${size.toFixed(1)}px`;
        this.ringSize = size;
      }
      this.ring.style.transform = `translate(${(cam.cx - this.ringSize / 2).toFixed(1)}px, ${(cam.cy - this.ringSize / 2).toFixed(1)}px)`;
    }

    // pins
    const zoomedIn = cam.d < 2.75;
    const wide = Math.min(1, Math.max(0, (cam.d - 3.2) / 0.6));
    for (const w of this.waters) {
      const f = facing(cam, w.pos);
      const pr = wide > 0 && f > 0.25 ? project(cam, w.pos) : null;
      const shown = !!pr && pr.y > 90 && pr.x > 90 && pr.x < cam.W - 90;
      if (shown !== w.shown) {
        w.el.style.visibility = shown ? "visible" : "hidden";
        w.shown = shown;
      }
      if (!shown || !pr) continue;
      w.el.style.transform = `translate3d(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      const op = Math.round(Math.min(1, (f - 0.25) / 0.2) * wide * 20) / 20;
      if (op !== w.opacity) {
        w.el.style.opacity = String(op);
        w.opacity = op;
      }
    }
    // where the lit pins are, so a quiet neighbour's label can step aside
    this.lit.length = 0;
    for (const k of st.pins) {
      const q = project(cam, at(k));
      if (q) this.lit.push(q.x, q.y);
    }
    for (const p of this.pins) {
      const travel = p.place.kind === "travel";
      const vis = travel ? st.travel : 1;
      const f = facing(cam, p.pos);
      const pr = vis > 0.01 && f > -0.02 ? project(cam, p.pos) : null;
      const shown = !!pr && pr.x > -200 && pr.x < cam.W + 200 && pr.y > -200 && pr.y < cam.H + 200;
      if (shown !== p.shown) {
        p.el.style.visibility = shown ? "visible" : "hidden";
        p.shown = shown;
      }
      if (!shown || !pr) continue;
      if (travel && !p.thumbLoaded && p.place.photos) {
        p.el.querySelector<HTMLImageElement>(".pin-thumb img")!.src = `/photos/thumb/${p.place.photos[0].file}.webp`;
        p.thumbLoaded = true;
      }
      p.el.style.transform = `translate3d(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px, 0)`;
      const op = Math.round(Math.min(1, Math.max(0, (f + 0.02) / 0.12)) * vis * 20) / 20;
      if (op !== p.opacity) {
        p.el.style.opacity = String(op);
        p.opacity = op;
      }
      const active = st.pins.includes(p.place.key);
      // no labels tucked under the masthead or off the sides
      let clear = pr.y > 84 && pr.x > 12 && pr.x < cam.W - 12;
      if (!active && st.open !== p.place.key)
        for (let i = 0; i < this.lit.length; i += 2)
          if (Math.abs(this.lit[i] - pr.x) < 90 && Math.abs(this.lit[i + 1] - pr.y) < 70) clear = false;
      const label = clear && (active || (zoomedIn && f > 0.12));
      const open = st.open === p.place.key;
      if (active !== p.active) p.el.classList.toggle("is-active", (p.active = active));
      if (label !== p.label) p.el.classList.toggle("has-label", (p.label = label));
      // keep side labels on screen near the edges
      const flip = p.place.side === "l" && pr.x < 130 ? "flip-r" : p.place.side === "r" && pr.x > cam.W - 150 ? "flip-l" : "";
      if (flip !== p.flip) {
        if (p.flip) p.el.classList.remove(p.flip);
        if (flip) p.el.classList.add(flip);
        p.flip = flip;
      }
      if (open !== p.open) {
        if (open) this.loadPostcard(p.el, p.place);
        p.el.classList.toggle("is-open", (p.open = open));
      }
    }

    // the head of the arc being drawn
    let headOn = false;
    const L = st.activeLeg;
    if (L >= 0) {
      const prog = st.legs[L];
      if (prog > 0.01 && prog < 0.99) {
        const leg = LEGS[L];
        const { lift, bow } = legShape(leg);
        const q = arcPoint(at(leg.from), at(leg.to), prog, lift, bow);
        const pr = facing(cam, q) > 0 ? project(cam, q) : null;
        if (pr) {
          headOn = true;
          this.head.style.transform = `translate3d(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px, 0)`;
          this.head.dataset.kind = leg.kind;
        }
      }
    }
    if (headOn !== this.headShown) {
      this.head.style.visibility = headOn ? "visible" : "hidden";
      this.headShown = headOn;
    }

    // live scale bar + the coordinates under the centre of the view
    const pxPerKm = cam.f / Math.max(0.05, cam.d - 1) / KM;
    let km = NICE[0];
    for (const n of NICE) if (n * pxPerKm <= 150) km = n;
    const w = Math.round(km * pxPerKm);
    const label = `${km.toLocaleString("en-US")} km`;
    if (label + w !== this.lastScale) {
      this.scaleBar.style.width = `${w}px`;
      this.scaleText.textContent = label;
      this.lastScale = label + w;
    }
    const [lat, lon] = toLatLon(cam.c);
    const coord = `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "N" : "S"} · ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? "E" : "W"}`;
    if (coord !== this.lastCoord) {
      this.coordText.textContent = coord;
      this.lastCoord = coord;
    }
  }
}
