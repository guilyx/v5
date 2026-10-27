import "./styles.css";
import * as THREE from "three";
import { Engine } from "./core/engine";
import { World, ROUTE_LEN } from "./core/world";
import { Flock } from "./core/flock";
import { Labels } from "./core/labels";
import { Journey } from "./core/journey";
import { prefersReducedMotion, smoothstep } from "./core/util";
import { renderSections } from "./ui/sections";
import { Hud } from "./ui/hud";
import { Lightbox } from "./ui/lightbox";
import type { FrameCtx, Scene, SceneEnv } from "./scenes/types";
import { createHero } from "./scenes/hero";
import { createMetal } from "./scenes/metal";
import { createResearch } from "./scenes/research";
import { createField } from "./scenes/field";
import { createSwarm } from "./scenes/swarm";
import { createTeam } from "./scenes/team";
import { createCompany } from "./scenes/company";
import { createNow } from "./scenes/now";
import { createHarness } from "./scenes/harness";
import { createBuilds } from "./scenes/builds";
import { createOpenSource } from "./scenes/opensource";
import { createLens } from "./scenes/lens";
import { createChannel, revealFit } from "./scenes/channel";

const preflight = document.getElementById("preflight")!;
const log = (line: string, ok = "ok") => {
  const dots = ".".repeat(Math.max(2, 22 - line.length));
  preflight.innerHTML += `\n${line} ${dots} <span class="ok">${ok}</span>`;
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

async function boot() {
  const reduced = prefersReducedMotion();
  const canvas = document.getElementById("gl") as HTMLCanvasElement;

  let engine: Engine;
  try {
    engine = new Engine(canvas);
  } catch {
    // No WebGL: the page still reads top to bottom.
    document.documentElement.classList.add("no-gl");
    const main = document.getElementById("content")!;
    renderSections(main, scenesForText());
    document.getElementById("loader")!.classList.add("done");
    return;
  }
  log("webgl", engine.tier === "high" ? "high tier" : "low tier");

  await document.fonts.ready;
  log("fonts");
  await nextFrame();

  const world = new World(engine.tier);
  engine.scene.add(world.group);
  const flock = new Flock(engine.tier === "high" ? 160 : 90);
  engine.scene.add(flock.mesh);
  const labels = new Labels(document.getElementById("labels")!);
  const env: SceneEnv = { world, labels, flock, tier: engine.tier };
  log("flock", `${flock.count} birds`);

  const lightbox = new Lightbox();
  const factories = [
    createHero,
    createMetal,
    createResearch,
    createField,
    createSwarm,
    createTeam,
    createCompany,
    createNow,
    createHarness,
    createBuilds,
    (e: SceneEnv) => createOpenSource(e),
    (e: SceneEnv) => createLens(e, lightbox),
    createChannel,
  ];
  const scenes: Scene[] = [];
  for (const make of factories) {
    scenes.push(make(env));
    await nextFrame();
  }
  for (const s of scenes) engine.scene.add(s.group);
  log("scenes", String(scenes.length));

  const main = document.getElementById("content")!;
  const railItems = renderSections(main, scenes);
  const journey = new Journey(scenes, engine.camera, reduced);
  const hud = new Hud(document.getElementById("rail")!, railItems);
  hud.onJump = (id) => {
    const top = journey.topOf(id);
    if (top !== null) scrollTo({ top: top + 2, behavior: "instant" as ScrollBehavior });
  };
  log("route", `${Math.round(ROUTE_LEN)} m`);

  // pointer: parallax, the flock's hawk, and clicks on things in the world
  const pointer = new THREE.Vector2();
  const ndc = new THREE.Vector2(-9, -9);
  const ray = new THREE.Raycaster();
  let hovering: (() => void) | null = null;
  addEventListener("pointermove", (e) => {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ndc.copy(pointer);
  });
  addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a, button, .panel, .lightbox, summary")) return;
    hovering?.();
  });

  const byId = new Map(scenes.map((s, i) => [s.id, i]));
  const ctx: FrameCtx = {
    dt: 0,
    time: 0,
    u: 0,
    focus: 0,
    camera: engine.camera,
    pointer,
    reduced,
  };

  // a first frame under the loader, so shaders compile before the reveal
  journey.update(0, pointer);
  engine.renderer.compile(engine.scene, engine.camera);
  engine.render(0);
  log("ready", "scroll to take off");
  await new Promise((r) => setTimeout(r, reduced ? 0 : 450));
  document.getElementById("loader")!.classList.add("done");

  let last = performance.now();
  let time = 0;
  const tmp = new THREE.Vector3();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt * (reduced ? 0.35 : 1);
    engine.adapt(dt);

    const fit = revealFit(engine.camera.aspect, smoothstep(0.6, 0.95, journey.u[scenes.length - 1]));
    journey.fitScale = fit.scale;
    journey.fitShift.set(0, 0, fit.shiftZ);
    journey.update(dt, pointer);
    const active = journey.activeScene();

    ctx.dt = dt;
    ctx.time = time;
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const u = journey.u[i];
      const visible = u > -0.9 && u < 1.9;
      s.group.visible = visible;
      if (!visible) continue;
      ctx.u = u;
      ctx.focus = journey.focus[i];
      s.update(ctx);
    }
    flock.goal = { kind: "escort" };
    flock.setHighlight([]);
    const steering = scenes[active];
    if (steering.steer) {
      ctx.u = journey.u[active];
      ctx.focus = journey.focus[active];
      steering.steer(ctx);
    }

    // the pointer is a hawk: project it into the flock's depth
    ray.setFromCamera(pointer, engine.camera);
    flock.threat.copy(ray.ray.at(46, tmp));
    flock.update(dt, time, engine.camera, reduced ? 0.4 : 1);

    // the final pull-back: fog thins with altitude so the whole route can be read
    const alt = engine.camera.position.y;
    const reveal = smoothstep(160, 900, alt);
    const thin = smoothstep(25, 150, alt);
    engine.fog.density = 0.0065 * (1 - 0.6 * thin) * (1 - reveal) + 0.00012 * reveal;
    const along = Math.min(1, journey.progress) * ROUTE_LEN;
    world.update(time, engine.camera, along, reveal);
    for (const s of scenes) if (s.id !== "channel" && reveal > 0.5) s.group.visible = false;

    labels.update(engine.camera, (id) => {
      const i = byId.get(id);
      return i === undefined ? 0 : scenes[i].group.visible ? journey.focus[i] : 0;
    });

    // hover + click targets in the visible scenes
    hovering = null;
    if (ndc.x > -2) {
      ray.setFromCamera(ndc, engine.camera);
      let best = Infinity;
      for (const s of scenes) {
        if (!s.group.visible || !s.clickables) continue;
        for (const c of s.clickables) {
          if (!c.object.visible) continue;
          const hit = ray.intersectObject(c.object, true)[0];
          if (hit && hit.distance < best) {
            best = hit.distance;
            hovering = c.onClick;
          }
        }
      }
    }
    document.body.classList.toggle("pointing", hovering !== null);

    hud.update(journey.progress, engine.camera, scenes[active].id);
    engine.render(time);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Stop definitions without any GPU work, for the no-WebGL fallback. */
function scenesForText(): Scene[] {
  const stub = {
    world: { frame: () => ({ origin: new THREE.Vector3(), yaw: 0, along: 0 }), addMarker: () => {} },
    labels: { add: () => ({}) },
    flock: { count: 0 },
    tier: "low",
  } as unknown as SceneEnv;
  const lb = new Lightbox();
  return [
    createHero,
    createMetal,
    createResearch,
    createField,
    createSwarm,
    createTeam,
    createCompany,
    createNow,
    createHarness,
    createBuilds,
    createOpenSource,
    (e: SceneEnv) => createLens(e, lb),
    createChannel,
  ].map((f) => f(stub));
}

boot();
