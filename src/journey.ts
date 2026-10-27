import { LEGS, TOTAL_SCREENS, END_HOLD, uFromScreens, screensFromU } from "./legs";

/**
 * The page half of the flight: scroll → progress, the logbook card, the flight plan,
 * throttle (scroll / hold / Space) and steering input. It works before (and without)
 * the 3D scene, which reads `u` and `steer` from here and reports ring passes back.
 */
export interface Journey {
  /** route progress from scroll, 0 … LEGS */
  u: number;
  reduced: boolean;
  coarse: boolean;
  steer: { x: number; y: number; active: boolean };
  stage: HTMLElement;
  /** set by the 3D scene: called whenever something might need a new frame */
  wake: () => void;
  /** true once the 3D scene is flying (it then reports ring passes itself) */
  flightOn: boolean;
  onRing(k: number, clean: boolean): void;
  telemetry(alt: number, kmh: number): void;
  /** where the drone should sit on screen, as a fraction shift of the view */
  layout(): { sx: number; sy: number; sxEnd: number; syEnd: number; syPre: number };
  disable(): void;
}

const CRUISE = 0.36; // screens per second while holding the throttle

export function initJourney(opts: { gl: boolean; reduced: boolean }): Journey {
  const html = document.documentElement;
  const section = document.getElementById("top")!;
  const stage = document.getElementById("stage")!;
  const preflight = document.getElementById("preflight")!;
  const logbook = document.getElementById("log")!;
  const logs = Array.from(document.querySelectorAll<HTMLElement>(".log"));
  const routeOl = document.querySelector<HTMLOListElement>("#route ol")!;
  const landed = document.getElementById("landed")!;
  const cruiseBtn = document.getElementById("cruise") as HTMLButtonElement;
  const altEl = document.querySelector<HTMLElement>("[data-alt]")!;
  const spdEl = document.querySelector<HTMLElement>("[data-spd]")!;
  const ringsEl = document.querySelector<HTMLElement>("[data-rings]")!;
  const landedRings = document.querySelector<HTMLElement>("[data-landed-rings]")!;
  const coarse = matchMedia("(hover: none) and (pointer: coarse)").matches;

  const j: Journey = {
    u: 0,
    reduced: opts.reduced,
    coarse,
    steer: { x: 0, y: 0, active: false },
    stage,
    wake: () => {},
    flightOn: false,
    onRing,
    telemetry,
    layout,
    disable,
  };

  // stamps and the screen-reader announcer
  for (const l of logs) {
    const s = document.createElement("span");
    s.className = "stamp";
    s.setAttribute("aria-hidden", "true");
    l.appendChild(s);
  }
  const live = document.createElement("p");
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  logbook.appendChild(live);

  // the flight plan strip
  const stops = logs.map((l, k) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const place = l.dataset.place!;
    const when = l.querySelector(".log-when")!.textContent!;
    b.setAttribute("aria-label", `${k === 0 ? "Take-off" : k === LEGS ? "Landing" : `Leg ${k}`}: ${place}, ${when}`);
    b.innerHTML = `<i class="dot" aria-hidden="true"></i><span>${place}</span>`;
    b.addEventListener("click", (e) => {
      goTo(k);
      if (e.detail > 0) b.blur(); // a mouse click: hand Space back to the throttle
    });
    li.appendChild(b);
    routeOl.appendChild(li);
    return li;
  });

  const ringState: (null | boolean)[] = logs.map(() => null);
  let active = -1;
  let enabled = opts.gl;

  if (!enabled) return j;

  // ---- geometry of the scroll ----
  const unit = CSS.supports("height", "100svh") ? "svh" : "vh";
  section.style.height = `${(TOTAL_SCREENS + 1) * 100}${unit}`;
  let top = 0,
    vh = 1;
  const measure = () => {
    top = section.getBoundingClientRect().top + scrollY;
    vh = stage.clientHeight || innerHeight;
  };
  const screens = () => (scrollY - top) / vh;
  const scrollToScreens = (s: number, smooth: boolean) =>
    scrollTo({ top: top + s * vh, behavior: smooth && !j.reduced ? "smooth" : "auto" });

  function goTo(k: number) {
    stopCruise();
    scrollToScreens(screensFromU(k) + (k === LEGS ? END_HOLD * 0.6 : 0), true);
  }

  // ---- state → DOM ----
  function setActive(e: number) {
    if (e === active) return;
    active = e;
    logs.forEach((l, k) => {
      l.classList.toggle("is-active", k === e);
      l.classList.remove("just-logged");
    });
    stops.forEach((li, k) => {
      li.classList.toggle("is-active", k === e);
      li.querySelector("button")!.setAttribute("aria-current", k === e ? "step" : "false");
    });
    const l = logs[e];
    fitLog();
    live.textContent = `${l.querySelector(".log-leg")!.textContent}: ${l.querySelector(".log-place")!.textContent!.replace(/\s+/g, " ").trim()}, ${l.querySelector(".log-when")!.textContent}`;
  }

  /** the card grows or shrinks to the active entry */
  function fitLog() {
    if (!enabled || active < 0) return;
    stage.style.setProperty("--log-h", `${logs[active].offsetHeight}px`);
  }

  function stamp(k: number, text: string, clean: boolean, animate: boolean) {
    const l = logs[k];
    const s = l.querySelector<HTMLElement>(".stamp")!;
    s.textContent = text;
    s.classList.toggle("is-clean", clean);
    l.classList.add("is-logged");
    if (animate && k === active && !j.reduced) {
      l.classList.remove("just-logged");
      void l.offsetWidth;
      l.classList.add("just-logged");
    }
    stops[k].classList.add("is-done");
    stops[k].classList.toggle("is-clean", clean);
  }

  function onRing(k: number, clean: boolean) {
    if (!enabled || ringState[k] === true || (ringState[k] === false && !clean)) return;
    ringState[k] = clean;
    stamp(k, clean ? "Clean pass" : "Logged", clean, true);
    const n = ringState.filter((v) => v === true).length;
    ringsEl.textContent = `${n}/${LEGS - 1}`;
    landedRings.textContent = `${LEGS} legs logged · ${n} of ${LEGS - 1} rings flown clean`;
  }
  ringsEl.textContent = `0/${LEGS - 1}`;

  let lastAlt = "",
    lastSpd = "";
  function telemetry(alt: number, kmh: number) {
    const a = String(Math.max(0, Math.round(alt)));
    const s = String(Math.max(0, Math.round(kmh)));
    if (a !== lastAlt) altEl.textContent = lastAlt = a;
    if (s !== lastSpd) spdEl.textContent = lastSpd = s;
  }

  function layout() {
    const narrow = innerWidth <= 720;
    return narrow
      ? { sx: 0, sy: 0.15, sxEnd: 0, syEnd: 0.12, syPre: 0.25 }
      : { sx: 0.14, sy: 0.02, sxEnd: 0.16, syEnd: 0.0, syPre: 0.02 };
  }

  let takeoffLogged = false,
    landedLogged = false;
  function update() {
    if (!enabled) return;
    const s = screens();
    const u = uFromScreens(s);
    j.u = Math.max(0, Math.min(LEGS, u));
    const pre = s < 0.025;
    section.classList.toggle("is-preflight", pre);
    preflight.classList.toggle("is-away", !pre);
    preflight.toggleAttribute("inert", !pre);
    const isLanded = j.u >= LEGS - 1e-3 && s > TOTAL_SCREENS - END_HOLD + 0.04;
    section.classList.toggle("is-landed", isLanded);
    landed.classList.toggle("is-on", isLanded);
    landed.toggleAttribute("inert", !isLanded);
    logbook.classList.toggle("is-away", isLanded && innerWidth <= 720);
    setActive(Math.max(0, Math.min(LEGS, Math.round(j.u))));
    if (!takeoffLogged && j.u > 0.04) {
      takeoffLogged = true;
      stamp(0, "Take-off", false, true);
    }
    if (!landedLogged && j.u >= LEGS - 1e-3) {
      landedLogged = true;
      stamp(LEGS, "Landed", true, true);
    }
    // without the 3D scene (or with reduced motion), rings log by position alone
    if (!j.flightOn || j.reduced) {
      for (let k = 1; k < LEGS; k++) if (j.u >= k && ringState[k] === null) onRing(k, false);
    }
    j.wake();
  }

  // ---- throttle: hold the button or Space to cruise ----
  let cruiseDir = 0,
    cruiseTo: number | null = null,
    cruiseRaf = 0,
    cruiseLast = 0,
    cruiseY = 0;
  function cruiseTick(now: number) {
    const dt = Math.min(0.12, (now - cruiseLast) / 1000);
    cruiseLast = now;
    const max = top + TOTAL_SCREENS * vh;
    let target = cruiseY + cruiseDir * CRUISE * (cruiseTo !== null ? 1.35 : 1) * vh * dt;
    if (cruiseTo !== null) {
      const goal = top + cruiseTo * vh;
      if (target >= goal) {
        target = goal;
        cruiseDir = 0;
        cruiseTo = null;
      }
    }
    cruiseY = Math.max(top, Math.min(max, target));
    scrollTo(0, Math.round(cruiseY));
    if (cruiseDir !== 0 && cruiseY > top - 1 && cruiseY < max) cruiseRaf = requestAnimationFrame(cruiseTick);
    else stopCruise();
  }
  function startCruise(dir: number, to: number | null = null) {
    if (j.reduced) {
      // reduced motion: one press, one leg
      const k = Math.round(j.u) + dir;
      const target = to ?? screensFromU(Math.max(0, Math.min(LEGS, k)));
      scrollToScreens(target, false);
      return;
    }
    if (cruiseDir === dir && cruiseTo === to) return;
    cruiseDir = dir;
    cruiseTo = to;
    cruiseY = scrollY;
    cruiseLast = performance.now();
    cancelAnimationFrame(cruiseRaf);
    cruiseRaf = requestAnimationFrame(cruiseTick);
    cruiseBtn.classList.add("is-on");
  }
  function stopCruise() {
    cruiseDir = 0;
    cruiseTo = null;
    cancelAnimationFrame(cruiseRaf);
    cruiseBtn.classList.remove("is-on");
  }

  cruiseBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    cruiseBtn.setPointerCapture(e.pointerId);
    startCruise(1);
  });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) cruiseBtn.addEventListener(ev, () => cruiseTo === null && stopCruise());
  cruiseBtn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      startCruise(1);
    }
  });
  cruiseBtn.addEventListener("keyup", (e) => {
    if (e.key === "Enter" || e.key === " ") stopCruise();
  });
  document.getElementById("takeoff")!.addEventListener("click", (e) => {
    startCruise(1, screensFromU(1));
    if (e.detail > 0) (e.currentTarget as HTMLElement).blur();
  });
  document.getElementById("again")!.addEventListener("click", () => {
    stopCruise();
    scrollToScreens(0, true);
  });
  // a wheel or touch from the visitor cancels an automatic cruise
  addEventListener("wheel", () => cruiseTo !== null && stopCruise(), { passive: true });
  addEventListener("touchstart", () => cruiseTo !== null && stopCruise(), { passive: true });

  const inFlight = () => {
    const s = screens();
    return s > -0.5 && s < TOTAL_SCREENS + 0.2;
  };
  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName));

  const keys = new Set<string>();
  addEventListener("keydown", (e) => {
    if (!inFlight() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "Space" && !typing(e.target)) {
      e.preventDefault();
      if (!e.repeat) startCruise(e.shiftKey ? -1 : 1);
      return;
    }
    if (["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(e.code)) {
      keys.add(e.code);
      applyKeys();
    }
  });
  addEventListener("keyup", (e) => {
    if (e.code === "Space") stopCruise();
    if (keys.delete(e.code)) applyKeys();
  });
  function applyKeys() {
    const l = keys.has("ArrowLeft") || keys.has("KeyA");
    const r = keys.has("ArrowRight") || keys.has("KeyD");
    j.steer.x = (r ? 1 : 0) - (l ? 1 : 0);
    j.steer.y = 0;
    j.steer.active = l || r;
    j.wake();
  }

  // ---- steering: the mouse position, or a sideways drag on touch ----
  const dead = (v: number) => Math.sign(v) * Math.max(0, Math.abs(v) - 0.1) / 0.9;
  addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch" || coarse || keys.size) return;
      // pointing at a card or a control is not steering
      if ((e.target as Element | null)?.closest?.(".logbook, .landed, .preflight, .route, .instruments, .cruise, .topbar")) {
        if (j.steer.active) {
          j.steer.active = false;
          j.wake();
        }
        return;
      }
      const L = layout();
      const cx = innerWidth * (0.5 + L.sx);
      const cy = innerHeight * (0.5 - L.sy);
      j.steer.x = Math.max(-1, Math.min(1, dead((e.clientX - cx) / (innerWidth * 0.36))));
      j.steer.y = Math.max(-1, Math.min(1, dead(-(e.clientY - cy) / (innerHeight * 0.36))));
      j.steer.active = true;
      j.wake();
    },
    { passive: true },
  );
  document.documentElement.addEventListener("pointerleave", () => {
    j.steer.active = false;
    j.wake();
  });
  addEventListener("blur", () => {
    j.steer.active = false;
    keys.clear();
    stopCruise();
  });

  let tx0 = 0,
    ty0 = 0,
    s0 = 0,
    sideways = false,
    release = 0;
  stage.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      tx0 = t.clientX;
      ty0 = t.clientY;
      s0 = j.steer.active ? j.steer.x : 0;
      sideways = false;
      clearTimeout(release);
    },
    { passive: true },
  );
  stage.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      const dx = t.clientX - tx0,
        dy = t.clientY - ty0;
      if (!sideways && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 0.7) sideways = true;
      if (!sideways) return;
      j.steer.x = Math.max(-1, Math.min(1, s0 + dx / (innerWidth * 0.32)));
      j.steer.y = 0;
      j.steer.active = true;
      j.wake();
    },
    { passive: true },
  );
  stage.addEventListener(
    "touchend",
    () => {
      release = window.setTimeout(() => {
        j.steer.active = false;
        j.wake();
      }, 1200);
    },
    { passive: true },
  );

  // keyboard users tabbing into a hidden log entry jump the flight there
  logbook.addEventListener("focusin", (e) => {
    const l = (e.target as HTMLElement).closest<HTMLElement>(".log");
    if (!l) return;
    const k = Number(l.dataset.leg);
    if (k !== active) scrollToScreens(screensFromU(k), false);
  });

  function disable() {
    enabled = false;
    stopCruise();
    html.classList.remove("gl", "gl-ready");
    section.style.height = "";
    logs.forEach((l) => l.classList.remove("is-active"));
    preflight.removeAttribute("inert");
    landed.removeAttribute("inert");
  }

  measure();
  addEventListener("resize", () => {
    measure();
    update();
    fitLog();
  });
  document.fonts?.ready.then(fitLog);
  addEventListener("load", () => {
    measure();
    update();
  });
  addEventListener("scroll", update, { passive: true });
  update();
  return j;
}
