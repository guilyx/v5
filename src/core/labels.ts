import * as THREE from "three";

export interface Label {
  el: HTMLElement;
  target: THREE.Object3D;
  offset: THREE.Vector3;
  scene: string;
  /** Scenes set this to fade a label in and out with their own timeline. */
  alpha: number;
  maxDist: number;
}

/**
 * HTML labels pinned to points in the world. Text stays crisp in the brand
 * faces, and the DOM does the typography the GPU is bad at.
 */
export class Labels {
  private items: Label[] = [];
  private tmp = new THREE.Vector3();
  private camDir = new THREE.Vector3();
  private w = innerWidth;
  private h = innerHeight;

  constructor(private root: HTMLElement) {
    addEventListener("resize", () => {
      this.w = innerWidth;
      this.h = innerHeight;
    });
  }

  add(
    scene: string,
    target: THREE.Object3D,
    html: string,
    opts: { cls?: string; offset?: THREE.Vector3; maxDist?: number } = {},
  ): Label {
    const el = document.createElement("div");
    el.className = "label " + (opts.cls ?? "");
    el.innerHTML = html;
    el.style.opacity = "0";
    this.root.appendChild(el);
    const l: Label = {
      el,
      target,
      offset: opts.offset ?? new THREE.Vector3(),
      scene,
      alpha: 1,
      maxDist: opts.maxDist ?? 180,
    };
    this.items.push(l);
    return l;
  }

  update(camera: THREE.PerspectiveCamera, focusOf: (scene: string) => number) {
    camera.getWorldDirection(this.camDir);
    for (const l of this.items) {
      const f = focusOf(l.scene) * l.alpha;
      if (f <= 0.01) {
        if (l.el.style.opacity !== "0") l.el.style.opacity = "0";
        continue;
      }
      l.target.localToWorld(this.tmp.copy(l.offset));
      const dist = this.tmp.distanceTo(camera.position);
      const ahead = this.tmp.clone().sub(camera.position).dot(this.camDir);
      if (ahead < 1 || dist > l.maxDist) {
        if (l.el.style.opacity !== "0") l.el.style.opacity = "0";
        continue;
      }
      this.tmp.project(camera);
      const x = (this.tmp.x * 0.5 + 0.5) * this.w;
      const y = (-this.tmp.y * 0.5 + 0.5) * this.h;
      const fade = Math.min(1, (l.maxDist - dist) / (l.maxDist * 0.3));
      l.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      l.el.style.opacity = (f * fade).toFixed(3);
    }
  }
}
