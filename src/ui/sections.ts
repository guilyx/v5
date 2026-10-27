import {
  agentic,
  archive,
  builds,
  chapters,
  contact,
  education,
  heroSummary,
  layers,
  openSource,
  photoTrips,
  posts,
  publications,
  rework,
  site,
  spec,
  systems,
  type Chapter,
  type Layer,
} from "../content";
import type { Scene } from "../scenes/types";

/**
 * The words. Every stop in every scene gets a panel here, in document order,
 * so the page reads top to bottom without the canvas — screen readers, no
 * WebGL, or "just let me read it" all get the same content.
 */

type Side = "left" | "right" | "center" | "mark";
interface Panel {
  side: Side;
  html: string;
  /** Which chapter this stop belongs to in the rail. Omit to continue the previous one. */
  rail?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ext = (url: string, text: string, cls = "") =>
  `<a class="${cls}" href="${url}" target="_blank" rel="noopener">${text}</a>`;

let chapterNo = 0;
function chapterCard(c: Chapter, extra = ""): string {
  chapterNo++;
  const n = String(chapterNo).padStart(2, "0");
  const rows = [
    ["built", c.built],
    ["led", c.led],
    ["kept", c.kept],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v!)}</dd>`)
    .join("");
  const log = c.log
    .map(
      (j) => `
      <li>
        <p class="log-role">${esc(j.role)} · ${ext(j.url, esc(j.at))}</p>
        <p class="log-period">${esc(j.period)}</p>
        <ul>${j.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      </li>`,
    )
    .join("");
  return `
    <p class="kicker"><span class="kicker-n">${n}</span> ${c.tab} · ${c.years}</p>
    <h2>${esc(c.title)}</h2>
    <p class="where">${esc(c.where)}</p>
    <dl class="bkl">${rows}</dl>
    ${extra}
    <details class="log"><summary>log</summary><ol>${log}</ol></details>`;
}

const panels: Record<string, () => Panel> = {
  top: () => ({
    side: "left",
    rail: "launch",
    html: `
      <p class="kicker">guilyx · v5</p>
      <h1>${site.name}</h1>
      <p class="role">${site.role}</p>
      <p class="lede">${esc(site.tagline)} ${esc(heroSummary)}</p>
      <pre class="spec" aria-label="spec">${spec
        .map((s) => `<span class="k">${s.key}:</span> <span class="v">${s.value}</span>`)
        .join("\n")}</pre>
      <p class="hint"><span class="hint-key">scroll</span> to fly the trajectory</p>`,
  }),

  metal: () => ({ side: "left", rail: "metal", html: chapterCard(chapters.metal) }),
  "metal-maze": () => ({
    side: "right",
    html: `
      <p class="kicker">ingeniarius · coimbra · 2019</p>
      <h3>Two mazes, two wins</h3>
      <p>Full autonomy stacks from scratch with ROS and embedded boards. One maze was mapped, one wasn't: explore first, then drive the shortest path you found.</p>
      <p class="caption">flood fill → shortest path → drive</p>`,
  }),

  research: () => ({
    side: "right",
    rail: "research",
    html: chapterCard(
      chapters.research,
      `<ul class="pubs">${publications
        .map((p) => `<li>${ext(p.url, esc(p.title))}<span>${esc(p.venue)}</span></li>`)
        .join("")}</ul>`,
    ),
  }),

  field: () => ({ side: "left", rail: "field", html: chapterCard(chapters.field) }),

  swarm: () => ({ side: "left", rail: "swarm", html: chapterCard(chapters.swarm) }),
  ...Object.fromEntries(
    systems.swarm.steps.slice(1).map((s, i) => [
      `swarm-${s.key}`,
      () => ({
        side: (i % 2 ? "left" : "right") as Side,
        html: `
          <p class="kicker">${systems.swarm.tab.toLowerCase()} · ${i + 2}/4</p>
          <h3>${i === 0 ? "Plan, then fly in formation" : i === 1 ? "Cover the zone" : "Find the target"}</h3>
          <p>${esc(i === 0 ? systems.swarm.steps[0].text + " " + s.text : s.text)}</p>
          ${i === 2 ? `<p class="caption">${esc(systems.swarm.note)}</p>` : ""}`,
      }),
    ]),
  ),

  team: () => ({
    side: "right",
    rail: "team",
    html: chapterCard(
      chapters.team,
      `<div class="stats">
        <p><b>−${rework.cpu}%</b><span>onboard cpu</span></p>
        <p><b>−${rework.bandwidth}%</b><span>bandwidth</span></p>
        <p><b>${rework.team}</b><span>engineers</span></p>
      </div>`,
    ),
  }),

  company: () => ({ side: "left", rail: "company", html: chapterCard(chapters.company) }),

  now: () => ({ side: "right", rail: "now", html: chapterCard(chapters.now) }),
  "now-bt": () => ({
    side: "left",
    html: `
      <p class="kicker">built for companies · 1/2</p>
      <h3>${esc(systems.bt.headline)}</h3>
      <ul class="points">${systems.bt.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      <p class="caption">behavior tree → action graph → risk per branch</p>`,
  }),
  "now-fmr": () => ({
    side: "right",
    html: `
      <p class="kicker">built for companies · 2/2</p>
      <h3>${esc(systems.fmr.headline)}</h3>
      <ul class="points">${systems.fmr.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      <p class="caption">report → one timeline → read the window → repair</p>`,
  }),

  agentic: () => ({
    side: "left",
    rail: "agentic era",
    html: `
      <p class="kicker">adapting to the agentic era</p>
      <h2>The harness</h2>
      <p>${esc(agentic.intro)}</p>
      <ol class="gates">${agentic.harness
        .map((h) => `<li><span class="k">${h.step}</span> <span>${esc(h.note)}</span></li>`)
        .join("")}</ol>
      <p class="caption">${esc(agentic.caption)}</p>
      <details class="log"><summary>what I've built around it</summary><ul class="led">${agentic.led
        .map(
          (l) =>
            `<li><span class="tag">${l.tag}</span> <b>${"link" in l ? ext(l.link, esc(l.title)) : esc(l.title)}</b> — ${esc(l.body)}</li>`,
        )
        .join("")}</ul><ul class="points">${agentic.rollout.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></details>`,
  }),

  ...Object.fromEntries(
    (["field", "agent", "machine"] as Layer[]).map((layer, li) => [
      `builds-${layer}`,
      () => ({
        side: (li % 2 ? "right" : "left") as Side,
        rail: li === 0 ? "builds" : undefined,
        html: `
          ${
            li === 0
              ? `<p class="kicker">selected builds</p><h2>On my own time</h2><p class="intro">All open source, each screen a real clip of the thing running. They hang at the altitude they run at — we start in the field and descend to the metal.</p>`
              : ""
          }
          <p class="tier"><span class="k">${String(li + 1).padStart(2, "0")}</span> ${layers[layer]}</p>
          <ol class="items">${builds
            .map((b, i) => ({ b, i }))
            .filter(({ b }) => b.layer === layer)
            .map(
              ({ b, i }) => `
            <li class="item" data-build="${i}">
              <h3>${esc(b.title)}${b.org ? ` <span class="org">${esc(b.org.toLowerCase())}</span>` : ""}</h3>
              <div class="more">
                <p>${esc(b.blurb)}</p>
                <p class="tech">${b.tech.map(esc).join(" · ")}</p>
                <p class="links">${ext(b.github, "source")} ${ext(b.external, b.externalLabel)}</p>
              </div>
            </li>`,
            )
            .join("")}</ol>`,
      }),
    ]),
  ),

  "open-source": () => ({
    side: "left",
    rail: "open source",
    html: `
      <p class="kicker">open source · since ${openSource.since}</p>
      <h2>Given back</h2>
      <p>${esc(openSource.intro)}</p>
      <ul class="upstream">${openSource.upstream
        .map((u) => `<li>${ext(u.url, esc(u.name))}<span>${esc(u.what)}</span></li>`)
        .join("")}</ul>
      <p class="caption">Every star overhead is one of the ${archive.length} things in the archive, placed by year.</p>`,
  }),

  lens: () => ({
    side: "left",
    rail: "lens",
    html: `
      <p class="kicker">through the lens</p>
      <h2>Off the clock</h2>
      <p>Basketball, films, and photos from the trips in between. Click any frame to open it.</p>
      <ol class="items trips">${photoTrips
        .map(
          (t, i) =>
            `<li class="item" data-trip="${i}"><p class="trip"><span class="k">${String(i + 1).padStart(2, "0")}</span> ${esc(t.name)} <span class="when">${esc(t.when)} · ${t.photos.length} frames</span></p></li>`,
        )
        .join("")}</ol>`,
  }),

  channel: () => ({
    side: "left",
    rail: "open channel",
    html: `
      <p class="kicker">waypoint 3 of 3 · now</p>
      <h3>The path stays open</h3>
      <p>The mark was never a formation. It's a route through three waypoints that enters at the top and stops at the third — and you've just flown it.</p>
      <p class="hint"><span class="hint-key">scroll</span> to look down</p>`,
  }),
  contact: () => ({
    side: "mark",
    html: `
      <p class="kicker">open channel</p>
      <h2>Say hello</h2>
      <p>${esc(contact.body)}</p>
      <p class="cta"><a class="btn" href="mailto:${site.email}">${site.email}</a> ${ext(site.resume, "résumé", "btn btn-ghost")}</p>
      <p class="socials">${site.socials.map((s) => ext(s.url, s.label.toLowerCase())).join("")}</p>
      <details class="log"><summary>field notes</summary><ul class="notes-list">${posts
        .map((p) => `<li>${ext(`${site.previous}/blog/${p.slug}`, esc(p.title))}<span>${p.date}</span></li>`)
        .join("")}</ul></details>
      <details class="log"><summary>education</summary><ul class="notes-list">${education
        .map((e) => `<li>${esc(e.degree)} <span>${esc(e.school)} · ${e.years}</span></li>`)
        .join("")}</ul></details>
      <p class="credits">v5 · three.js, typescript, vite. Colour and mark from ${ext("https://github.com/guilyx/branding", "guilyx/branding")}. Layout lineage owed to ${ext("https://v4.brittanychiang.com/", "Brittany Chiang's v4")}. Looking for v4? ${ext(site.previous, "it's still up")}.</p>`,
  }),
};

export interface RailItem {
  label: string;
  stopId: string;
}

export function renderSections(main: HTMLElement, scenes: Scene[]): RailItem[] {
  chapterNo = 0;
  const rail: RailItem[] = [];
  const frag: string[] = [];
  for (const s of scenes) {
    for (const stop of s.stops) {
      const make = panels[stop.id];
      if (!make) throw new Error(`no panel for stop ${stop.id}`);
      const p = make();
      if (p.rail) rail.push({ label: p.rail, stopId: stop.id });
      frag.push(`
        <section class="stop" id="${stop.id}" data-scene="${s.id}" data-side="${p.side}" style="--vh:${stop.vh}">
          <div class="pin"><article class="panel">${p.html}</article></div>
        </section>`);
    }
  }
  main.innerHTML = frag.join("");
  return rail;
}
