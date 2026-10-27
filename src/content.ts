/**
 * Single source of truth for everything the journey says.
 * Ported from guilyx/v4 (src/data/site.ts) and guilyx/resume — edit here, not
 * in the scenes. Scenes read the numbers they draw from this file too.
 */

export const site = {
  name: "Erwin Lejeune",
  handle: "guilyx",
  role: "Head of Robotics",
  tagline: "Leading robotics software teams across orchestration, navigation and fault management.",
  url: "https://v5.elejeune.me",
  email: "erwin.lejeune15@gmail.com",
  location: "Abu Dhabi, UAE",
  resume: "https://resume.elejeune.me",
  previous: "https://v4.elejeune.me",
  socials: [
    { label: "GitHub", url: "https://github.com/guilyx" },
    { label: "LinkedIn", url: "https://www.linkedin.com/in/erwinlejeune-lkn" },
    { label: "ResearchGate", url: "https://www.researchgate.net/profile/Erwin-Lejeune" },
    { label: "Spotify", url: "https://open.spotify.com/user/11147618695" },
  ],
} as const;

export const heroSummary = `Eight years in robotics, from a supermarket robot in Denmark to drone swarms in the UAE.`;

/** The hero spec block — the YAML register from the GitHub profile README. */
export const spec = [
  { key: "role", value: "head of robotics @ sirb.ai" },
  { key: "based", value: "abu dhabi, uae" },
  { key: "leading", value: "teams since 2021" },
  { key: "hands-on", value: "ros 2 · c++ · python · go" },
  { key: "standards", value: "from embedded & web" },
] as const;

export interface Chapter {
  id: string;
  tab: string;
  years: string;
  where: string;
  title: string;
  built: string;
  led?: string;
  kept?: string;
  /** The role-by-role record behind the chapter, from the résumé. */
  log: { role: string; at: string; url: string; period: string; bullets: string[] }[];
}

export const chapters: Record<string, Chapter> = {
  metal: {
    id: "metal",
    tab: "metal",
    years: "2018 — 2019",
    where: "Hiventive, Ingeniarius",
    title: "Close to the metal",
    built:
      "A virtual STM32 in SystemC/TLM, with its timers, I2C, CAN, GPIO and USART running under QEMU. Then small robots with ROS, which won both maze competitions.",
    kept: "Treat time, memory and bandwidth as a budget, and test against a model of the hardware first.",
    log: [
      {
        role: "Embedded Software Engineer",
        at: "Hiventive",
        url: "https://www.hiventive.com/en/",
        period: "2018 — 2019 · Bordeaux",
        bullets: [
          "Developed a SystemC/TLM virtual prototype of an STM32 microcontroller for SoC emulation — TIM, I2C, CAN, GPIO, USART peripherals with QEMU integration.",
        ],
      },
      {
        role: "Robotics Assistant",
        at: "Ingeniarius",
        url: "https://ingeniarius.pt/",
        period: "2019 · Coimbra",
        bullets: [
          "Built full autonomy stacks from scratch with ROS and embedded systems.",
          "Won both the mapped and unmapped maze-solving competitions.",
        ],
      },
    ],
  },
  research: {
    id: "research",
    tab: "research",
    years: "2020 — 2021",
    where: "Centrale Nantes, Hiventive",
    title: "Research, and the web",
    built: "A platform for electronics logistics in Go, with PostgreSQL and Docker, alongside my research.",
    led: "Four research projects: multi-agent pathfinding, PDDL planning, real-time ROS on Xenomai, and ROS 2 latency. Two papers came out of them.",
    kept: "CI, containers and code review as habits. And a soft spot for planning problems.",
    log: [
      {
        role: "Robotics Researcher",
        at: "Ecole Centrale de Nantes",
        url: "https://www.ec-nantes.fr/",
        period: "2020 — 2021 · Nantes",
        bullets: [
          "Led 4 research projects: multi-agent pathfinding, AI planning (PDDL), real-time ROS control on Xenomai/XDDP, and ROS 2 latency benchmarking.",
          "Published research on real-time jitter measurements under ROS 2 and a survey of multi-agent pathfinding solutions.",
        ],
      },
      {
        role: "Software Engineer",
        at: "Hiventive",
        url: "https://www.hiventive.com/en/",
        period: "2020 — 2021 · Remote",
        bullets: [
          "Built core backend services in Go with PostgreSQL and Docker for a computer-aided production engineering platform.",
          "Developed an automated programming test manager for candidate evaluation.",
        ],
      },
    ],
  },
  field: {
    id: "field",
    tab: "field",
    years: "2021 — 2022",
    where: "Coalescent, Odense",
    title: "First robot in a real store",
    built:
      "The navigation stack of a robot working supermarket aisles: path planning, motion control and localization, plus some perception.",
    led: "When the CTO left, I took over navigation and trolley detection. I hired and trained interns and a junior, ran planning, and turned the CEO's requests into sprints.",
    kept: "A real store changes your priorities fast.",
    log: [
      {
        role: "Founding Robotics Engineer",
        at: "Coalescent Mobile Robotics",
        url: "https://cm-robotics.com/",
        period: "2021 — 2022 · Odense",
        bullets: [
          "Founding core technical team that delivered the first working in-store robot system, supporting company milestones across pre-seed and seed rounds.",
          "Led development of the navigation stack — path planning, motion control and localization — and contributed to perception: detection, filtering, tracking.",
          "After the CTO left, led the team on autonomous navigation and trolley detection: recruited and trained interns and a junior engineer, ran planning, and turned the CEO's product requirements into technical sprints.",
        ],
      },
    ],
  },
  swarm: {
    id: "swarm",
    tab: "swarm",
    years: "2022 — 2024",
    where: "TII, Abu Dhabi",
    title: "One robot to many",
    built:
      "Multi-robot orchestration and new swarm behaviors, including a bird-inspired flocking method we published at IROS 2024.",
    led: "The R&D on those parts, and the live demos for partners, which brought in USD 3M in contracts.",
    kept: "In a swarm every wasted byte gets multiplied. The embedded habits paid off.",
    log: [
      {
        role: "Senior Engineer — Robotics Software",
        at: "Technology Innovation Institute",
        url: "https://www.tii.ae/",
        period: "2022 — 2024 · Abu Dhabi",
        bullets: [
          "Led the research & development of components for multi-robot behavior orchestration, collaboration and control.",
          "Designed new swarm behaviors, including decentralized bird-inspired flocking published at IEEE/RSJ IROS 2024.",
          "Ran the live demos to partners; the project led to USD 3M in contracts with other companies in the UAE ecosystem.",
        ],
      },
    ],
  },
  team: {
    id: "team",
    tab: "team",
    years: "2024 — 2026",
    where: "TII, Abu Dhabi",
    title: "Leading the team",
    built: "A rework of the swarm autonomy stack that cut onboard CPU by 74% and bandwidth by 52%.",
    led: "A team of 9 across autonomy, infrastructure and platform integration, from roadmap to sprints. Also a joint program with Caltech, and demos that led to USD 10M+ in contracts.",
    kept: "Standards only stick when they're the easy option.",
    log: [
      {
        role: "Team Lead — Robotics Software",
        at: "Technology Innovation Institute",
        url: "https://www.tii.ae/",
        period: "2024 — 2026 · Abu Dhabi",
        bullets: [
          "Grew and led a Robotics Software team of 9 engineers across autonomy (navigation, perception, orchestration), infrastructure (DevOps, RobotOps) and platform integration.",
          "Overhauled the swarm autonomy architecture, cutting onboard CPU usage by 74% and network bandwidth by 52%.",
          "Scaled the framework with tooling for reliable, repeatable missions, and expanded the team's scope to path planning and path tracking.",
          "Joint program with Caltech on their multi-modal robot M4 and their humanoid: worked on outdoor planning and tracking for M4's flying and rolling modalities.",
          "Led autonomy demos to companies in Europe and the UAE, resulting in USD 10M+ in contracts.",
          "Started building AI tooling for the team to raise engineering efficiency and productivity.",
        ],
      },
    ],
  },
  company: {
    id: "company",
    tab: "company",
    years: "2024 — now",
    where: "Unchained Labs",
    title: "Starting a company",
    built:
      "Local-first AI agents that run on a client's own models and data, and Kymatics, a graph-based agent orchestrator.",
    led: "All of it: the vision, finding clients, setting up the company, and building and deploying the SaaS.",
    kept: "Selling and scoping are part of the engineering.",
    log: [
      {
        role: "Founder",
        at: "Unchained Labs",
        url: "https://unchainedlabs.dev/",
        period: "2024 — Present · Remote",
        bullets: [
          "Set the vision, found clients, set up the company, and build and deploy its SaaS.",
          "Build AI brains for companies: local-first agentic systems that run on their own models, data and infrastructure.",
          "Design graph-based agent orchestration (Kymatics) and open-source the tooling to run it reliably.",
        ],
      },
    ],
  },
  now: {
    id: "now",
    tab: "now",
    years: "2026 — now",
    where: "SIRB.AI, Abu Dhabi",
    title: "Head of Robotics",
    built:
      "The robotics architecture, and a self-healing layer: fleet-wide fault recording, agents that catch and recover from failures, and ML scoring of missions before launch.",
    led: "The autonomy roadmap, from prototype to the public launch at UMEX 2026.",
    log: [
      {
        role: "Head of Robotics",
        at: "SIRB.AI",
        url: "https://sirb.ai/",
        period: "Feb 2026 — Present · Abu Dhabi",
        bullets: [
          "Joined as founding team: designed the robotics software architecture and set the autonomy roadmap.",
          "Built a self-healing autonomy layer: swarm-wide fault and state recording, agents that detect and recover from failures, and ML-based mission scoring before launch.",
          "Took the autonomy stack from prototype to public launch at UMEX 2026, unveiled as the Middle East's first AI-powered swarm platform.",
        ],
      },
    ],
  },
};

/** The numbers the team scene draws as bars — straight from the résumé. */
export const rework = { cpu: 74, bandwidth: 52, team: 9, contracts: "USD 10M+" } as const;

/**
 * "Built for Companies" — systems from the day job. The scenes are sketches
 * of how they work; the code and the clients stay private.
 */
export const systems = {
  swarm: {
    tab: "Swarm navigation & coverage",
    headline: "Plan, fly in formation, cover the zone, find the target.",
    steps: [
      { key: "plan", text: "Zones and every other source of the world are costmap layers; a global plan is routed through them before anything moves." },
      { key: "formation", text: "The flock holds its slots behind a virtual leader, a safety barrier keeps every vehicle clear of the boundary, and link strength across the mesh is part of the picture." },
      { key: "coverage", text: "In the task zone the formation breaks into a Voronoi partition and each vehicle sweeps its own cell." },
      { key: "triangulate", text: "When one gets a contact, the others take bearings and triangulate it." },
    ],
    note: "Switching vehicles only means switching a plugin: every motion algorithm sits behind the same tracker interface.",
  },
  bt: {
    tab: "Behavior tree densification & scoring",
    headline: "Mission trees anyone can read, scored before they fly.",
    points: [
      "Densify: control nodes become arrows, conditions become guards. A 16-node tree reads as six actions.",
      "Find the gaps: actions with no failure path, branches that never run, loops with no exit.",
      "Score: every node logs every run, so you get the weakest branch and a concrete fix.",
    ],
  },
  fmr: {
    tab: "Agentic fault management & recovery",
    headline: "One timeline for every fault, and an agent that proposes the repair.",
    points: [
      "Components report; they don't recover themselves. Everything lands in one ordered event table.",
      "One place decides. Restarts go through the dependency graph, so dependents come back in order.",
      "The agent reads windows, not events — and never owns the actuator. Deterministic rules stay underneath.",
    ],
  },
} as const;

export const agentic = {
  intro: `AI changes how software gets built, and robotics is no exception. I treat it as a tool that lets a team ship more without lowering the bar. The real work is the harness around it: reviews, checks and habits that keep quality where it was while AI does more of the typing.`,
  harness: [
    { step: "draft", note: "written by a person or an AI" },
    { step: "ai review", note: "self-hosted, on every change" },
    { step: "checks", note: "tests, lint, the usual" },
    { step: "quiz", note: "can you explain your diff?" },
    { step: "human review", note: "a teammate signs off" },
    { step: "ship", note: "with an owner who understands it" },
  ],
  caption: "Every change takes the same path, whoever or whatever wrote it.",
  led: [
    { tag: "led", title: "A company brain in Slack", body: "An assistant that answers from sources and rules each team can set up." },
    { tag: "led", title: "Self-hosted code reviews", body: "On every change. Cheaper than paid services, and the code stays on our machines." },
    { tag: "open source", title: "grip", body: "A git hook that quizzes you on your own diff before a commit goes through.", link: "https://github.com/guilyx/grip" },
    { tag: "on the robots", title: "Agents in the loop, not in charge", body: "They read the fault timeline and propose the repair. Deterministic rules own the actuators." },
  ],
  rollout: [
    "Start with the boring work: docs, tests, first-pass reviews.",
    "Keep a person accountable for every change that ships.",
    "Grow AI use only as fast as the checks around it.",
  ],
} as const;

/** Where a project runs, as an altitude. The builds scene hangs screens at it. */
export type Layer = "field" | "agent" | "machine";
export const layers: Record<Layer, string> = {
  field: "in the field",
  agent: "in the loop",
  machine: "on the metal",
};

export interface Build {
  title: string;
  blurb: string;
  tech: string[];
  layer: Layer;
  org?: string;
  github: string;
  external: string;
  externalLabel: string;
  video: string;
  poster: string;
  /** Width / height of the clip, so the screen frames it without cropping. */
  aspect: number;
}

/** Selected Builds — every slide has a real clip recorded from the thing running. */
export const builds: Build[] = [
  {
    title: "grip",
    blurb: "Pass the whiteboard defense before you ship. A git hook that quizzes you on your own diff, grades the answers against a hidden rubric, and blocks anything below your team's pass mark.",
    tech: ["Python", "Git Hooks", "LLM Grading"],
    layer: "agent",
    github: "https://github.com/guilyx/grip",
    external: "https://guilyx.github.io/grip/",
    externalLabel: "docs",
    video: "/media/grip-promo.mp4",
    poster: "/media/grip-poster.jpg",
    aspect: 16 / 9,
  },
  {
    title: "PyMAPF",
    blurb: "Multi-agent planning on arbitrary graphs, not just grids: CBS, PIBT, LaCAM and MAPF-LNS, plus multi-agent RL. The solvers stream their search live.",
    tech: ["Python", "Multi-Agent Planning", "Graph Search"],
    layer: "field",
    org: "APLA-Toolbox",
    github: "https://github.com/APLA-Toolbox/pymapf",
    external: "https://apla-toolbox.github.io/pymapf/",
    externalLabel: "playground",
    video: "/media/pymapf-promo.mp4",
    poster: "/media/pymapf-poster.png",
    aspect: 16 / 9,
  },
  {
    title: "PythonPDDL",
    blurb: "A dependency-free PDDL framework: a hand-written parser and grounder from STRIPS to durative actions, 14 planners, and heuristics you can train on your own plans.",
    tech: ["Python", "PDDL", "Heuristic Search"],
    layer: "field",
    org: "APLA-Toolbox",
    github: "https://github.com/APLA-Toolbox/pythonpddl",
    external: "https://apla-toolbox.github.io/PythonPDDL/",
    externalLabel: "workbench",
    video: "/media/jupyddl-promo.mp4",
    poster: "/media/jupyddl-poster.png",
    aspect: 16 / 9,
  },
  {
    title: "flybots",
    blurb: "Flight algorithms from scratch: multirotor, fixed-wing and VTOL physics written out in full, 40+ runnable simulations, and a gym for teaching a drone to fly itself.",
    tech: ["Python", "Flight Dynamics", "RL"],
    layer: "field",
    github: "https://github.com/guilyx/flybots",
    external: "https://guilyx.github.io/flybots/",
    externalLabel: "site",
    video: "/media/flybots-promo.mp4",
    poster: "/media/flybots-poster.jpg",
    aspect: 16 / 9,
  },
  {
    title: "Unchained Labs",
    blurb: "AI brains for companies: local-first agentic systems on their own models, data and infrastructure. Here, Kymatics turns a spoken intent into a queue of build jobs.",
    tech: ["Rust", "Python", "Agentic AI", "Voice"],
    layer: "agent",
    org: "Unchained Labs",
    github: "https://github.com/Unchained-Labs",
    external: "https://unchainedlabs.dev/",
    externalLabel: "site",
    video: "/media/kymatics-promo.mp4",
    poster: "/media/kymatics-poster.png",
    aspect: 16 / 9,
  },
  {
    title: "rostree",
    blurb: "A ROS 2 dependency graph is a DAG, not a tree. rostree explores it from the CLI, a TUI, or a self-contained HTML file that still opens on a robot with no route out.",
    tech: ["Python", "Graph Theory", "ROS 2", "TUI"],
    layer: "machine",
    github: "https://github.com/guilyx/rostree",
    external: "https://guilyx.github.io/rostree",
    externalLabel: "site",
    video: "/media/rostree-promo.mp4",
    poster: "/media/rostree-poster.png",
    aspect: 16 / 9,
  },
  {
    title: "roue",
    blurb: "Drop a file, get the file you wanted. Ctrl+Shift+right-click, pick a format on the wheel, and the result lands next to the original. Offline, on the Linux desktop.",
    tech: ["Python", "GTK 4", "FFmpeg", "libvips"],
    layer: "machine",
    github: "https://github.com/guilyx/roue",
    external: "https://guilyx.github.io/roue/",
    externalLabel: "site",
    video: "/media/roue-promo.mp4",
    poster: "/media/roue-poster.jpg",
    aspect: 1280 / 800,
  },
  {
    title: "Clanker Labs",
    blurb: "Self-host your home, let the agent run it. Notes, mail, media, passwords and money back on hardware you own, with an agent in front so it doesn't take a sysadmin.",
    tech: ["Ansible", "Docker", "LangGraph", "MCP"],
    layer: "machine",
    org: "Clanker Labs",
    github: "https://github.com/Clanker-Labs",
    external: "https://clanker-labs.github.io/clanker-labs-public/",
    externalLabel: "site",
    video: "/media/clanker-labs-promo.mp4",
    poster: "/media/clanker-labs-poster.png",
    aspect: 1000 / 620,
  },
];

export const openSource = {
  since: 2018,
  intro: `My first open-source contribution was in 2018. Robotics runs on shared code — ROS and the thousands of packages around it only exist because people published their work — so I try to give back.`,
  upstream: [
    { name: "TheAlgorithms/Python", what: "graph search algorithms", url: "https://github.com/TheAlgorithms/Python/pulls?q=is%3Apr+author%3Aguilyx+is%3Amerged" },
    { name: "AtsushiSakai/PythonRobotics", what: "robotics algorithms, with animations", url: "https://github.com/AtsushiSakai/PythonRobotics/pulls?q=is%3Apr+author%3Aguilyx+is%3Amerged" },
    { name: "ros-navigation/navigation2", what: "the ROS 2 navigation stack", url: "https://github.com/ros-navigation/navigation2/pulls?q=is%3Apr+author%3Aguilyx+is%3Amerged" },
  ],
} as const;

/** The full record, newest first — each one becomes a star in the open-source sky. */
export const archive: { year: number; title: string; madeAt?: string; url: string }[] = [
  { year: 2026, title: "roue", url: "https://github.com/guilyx/roue" },
  { year: 2026, title: "jarvis_ros2", url: "https://github.com/guilyx/jarvis_ros2" },
  { year: 2026, title: "awesome-daily-minigames", url: "https://github.com/guilyx/awesome-daily-minigames" },
  { year: 2026, title: "grip", url: "https://github.com/guilyx/grip" },
  { year: 2026, title: "Clanker Labs", madeAt: "Clanker Labs", url: "https://github.com/Clanker-Labs" },
  { year: 2026, title: "wallet", madeAt: "Clanker Labs", url: "https://github.com/Clanker-Labs/wallet" },
  { year: 2026, title: "tradesights", madeAt: "Clanker Labs", url: "https://github.com/Clanker-Labs/tradesights" },
  { year: 2026, title: "selfmail", madeAt: "Clanker Labs", url: "https://github.com/Clanker-Labs/selfmail" },
  { year: 2026, title: "lebenchmark", madeAt: "Clanker Labs", url: "https://github.com/Clanker-Labs/lebenchmark" },
  { year: 2026, title: "Kymatics", madeAt: "Unchained Labs", url: "https://github.com/Unchained-Labs/kymatics" },
  { year: 2026, title: "t212-mcp", url: "https://github.com/guilyx/t212-mcp" },
  { year: 2026, title: "BTView", url: "https://github.com/guilyx/btview-vscode-plugin" },
  { year: 2026, title: "zucman", url: "https://github.com/guilyx/zucman" },
  { year: 2026, title: "flybots", url: "https://github.com/guilyx/flybots" },
  { year: 2026, title: "rostree", url: "https://github.com/guilyx/rostree" },
  { year: 2026, title: "setup", madeAt: "Clanker Labs", url: "https://github.com/Clanker-Labs/setup" },
  { year: 2025, title: "v3", url: "https://github.com/guilyx/v3" },
  { year: 2024, title: "Unchained Labs", madeAt: "Unchained Labs", url: "https://github.com/Unchained-Labs" },
  { year: 2024, title: "Bird-inspired flocking", madeAt: "TII", url: "https://www.researchgate.net/publication/387418977_Decentralized_Acceleration-Based_Bird-Inspired_Flocking" },
  { year: 2022, title: "v2", url: "https://github.com/guilyx/v2" },
  { year: 2021, title: "PyMAPF", madeAt: "APLA-Toolbox", url: "https://github.com/APLA-Toolbox/pymapf" },
  { year: 2021, title: "ROS 2 jitter", madeAt: "Centrale Nantes", url: "https://github.com/mastererts/ros2_realtime_statistics" },
  { year: 2021, title: "MAPF survey", madeAt: "Centrale Nantes", url: "https://www.researchgate.net/publication/348716625_Survey_of_the_Multi-Agent_Pathfinding_Solutions" },
  { year: 2020, title: "PythonPDDL", madeAt: "APLA-Toolbox", url: "https://github.com/APLA-Toolbox/pythonpddl" },
  { year: 2020, title: "artin-pathfinding", madeAt: "Centrale Nantes", url: "https://github.com/master-coro/artin-pathfinding" },
  { year: 2020, title: "awesome-gh-pages-portfolios", url: "https://github.com/guilyx/awesome-github-pages-portfolios" },
  { year: 2020, title: "v1", url: "https://github.com/guilyx/v1" },
];

export const publications = [
  {
    title: "Decentralized Acceleration-Based Bird-Inspired Flocking",
    venue: "IEEE/RSJ IROS 2024",
    url: "https://www.researchgate.net/publication/387418977_Decentralized_Acceleration-Based_Bird-Inspired_Flocking",
  },
  {
    title: "Real-time Jitter Measurements under ROS 2: the Inverted Pendulum Case",
    venue: "Preprint · 2021",
    url: "https://www.researchgate.net/publication/350353690_Real-time_Jitter_Measurements_under_ROS2_the_Inverted_Pendulum_case",
  },
  {
    title: "Survey of the Multi-Agent Pathfinding Solutions",
    venue: "Preprint · 2021",
    url: "https://www.researchgate.net/publication/348716625_Survey_of_the_Multi-Agent_Pathfinding_Solutions",
  },
] as const;

export const education = [
  { degree: "M.Sc. Control & Robotics", school: "Ecole Centrale de Nantes", years: "2019 — 2021" },
  { degree: "M.Sc. Computer Engineering & Aeronautics", school: "Ynov Bordeaux", years: "2018 — 2019" },
  { degree: "B.Sc. Electronics Engineering", school: "Nantes Université", years: "2014 — 2018" },
] as const;

export interface Photo {
  file: string;
  title: string;
  place: string;
}

/**
 * Through the Lens — grouped by trip, in the order they were taken. Each group
 * becomes one turn of the helix.
 */
export const photoTrips: { name: string; when: string; photos: Photo[] }[] = [
  {
    name: "California & the West",
    when: "summer 2023",
    photos: [
      { file: "ginevra.jpg", title: "Ginevra", place: "Pasadena" },
      { file: "eglise-caltech.jpg", title: "Caltech church", place: "Pasadena" },
      { file: "pasadena-townhall.jpg", title: "Town hall", place: "Pasadena" },
      { file: "pasadena-shooting-movie.jpg", title: "A film shoot", place: "Pasadena" },
      { file: "clinton-ball.jpg", title: "Clinton ball", place: "USA" },
      { file: "olympics.jpg", title: "Olympics", place: "Sports event" },
      { file: "jokic-v-everybody.jpg", title: "Jokić vs everybody", place: "Sports event" },
      { file: "route66-gine.jpg", title: "Route 66 — Gine", place: "Route 66" },
      { file: "route66-pavel.jpg", title: "Route 66 — Pavel", place: "Route 66" },
      { file: "route66somestuff.jpg", title: "Route 66", place: "Route 66" },
      { file: "random-spot-pee.jpg", title: "A random stop", place: "Somewhere, USA" },
      { file: "alkatraz.jpg", title: "Alcatraz", place: "San Francisco" },
      { file: "santabarabarapier.jpg", title: "The pier", place: "Santa Barbara" },
      { file: "santabrabara.jpg", title: "Santa Barbara", place: "Santa Barbara" },
      { file: "skating-santa-monica.jpg", title: "Skating", place: "Santa Monica" },
      { file: "grand-canyon.jpg", title: "Grand Canyon", place: "Arizona" },
      { file: "cathedral-lakes-trail.jpg", title: "Cathedral Lakes trail", place: "Yosemite" },
      { file: "cathedral-lakes.jpg", title: "Cathedral Lakes", place: "Yosemite" },
      { file: "yosemite-dears.jpg", title: "Deer", place: "Yosemite" },
      { file: "yosemite-landscape.jpg", title: "Yosemite", place: "Yosemite" },
      { file: "pavel-zion-happy.jpg", title: "Pavel, happy", place: "Zion" },
      { file: "pavel-zion.jpg", title: "Pavel", place: "Zion" },
      { file: "zion-trail.jpg", title: "Zion trail", place: "Zion" },
      { file: "zion-trail2.jpg", title: "Zion trail, again", place: "Zion" },
      { file: "tahoe-gine.jpg", title: "Tahoe — Gine", place: "Lake Tahoe" },
      { file: "tahoe.jpg", title: "Lake Tahoe", place: "Lake Tahoe" },
    ],
  },
  {
    name: "Paris",
    when: "september 2023",
    photos: [
      { file: "parisbaguette.jpg", title: "Baguette", place: "Paris" },
      { file: "paris-monument.jpg", title: "Monument", place: "Paris" },
      { file: "valo-paris.jpg", title: "Valo", place: "Paris" },
      { file: "paris-violon.jpg", title: "Violin", place: "Paris" },
    ],
  },
  {
    name: "Togo & Tokyo",
    when: "october 2023",
    photos: [
      { file: "togo-kid.jpg", title: "A kid in Togo", place: "Togo" },
      { file: "togo-cooking-girls-clors.jpg", title: "Cooking, in colour", place: "Togo" },
      { file: "togo-cooking-girls.jpg", title: "Cooking", place: "Togo" },
      { file: "togo-love.jpg", title: "Love", place: "Togo" },
      { file: "togo-street.jpg", title: "Street", place: "Togo" },
      { file: "tokyo-tower-but-better.jpg", title: "Tokyo Tower", place: "Tokyo" },
    ],
  },
  {
    name: "Maldives & Dubai",
    when: "november 2023",
    photos: [
      { file: "maldives-couple.jpg", title: "Couple", place: "Maldives" },
      { file: "maldives-fishing.jpg", title: "Fishing", place: "Maldives" },
      { file: "maldives-hanging-shel.jpg", title: "Hanging shells", place: "Maldives" },
      { file: "maldives-cleaning.jpg", title: "Cleaning", place: "Maldives" },
      { file: "maldives-crustace.jpg", title: "Crustacean", place: "Maldives" },
      { file: "maldives-flowers.jpg", title: "Flowers", place: "Maldives" },
      { file: "maldives-shop.jpg", title: "Shop", place: "Maldives" },
      { file: "maldives-street.jpg", title: "Street", place: "Maldives" },
      { file: "maldives-talking-workers.jpg", title: "Workers", place: "Maldives" },
      { file: "maldives-sundown.jpg", title: "Sundown", place: "Maldives" },
      { file: "anantara.jpg", title: "Anantara", place: "Dubai" },
    ],
  },
];

/** Field Notes — the posts live on v4 for now. */
export const posts = [
  { title: "A homemade Alexa, and the agents that will hack my house", date: "2026-10-19", slug: "pi-voice-assistant" },
  { title: "Four portfolios", date: "2026-08-12", slug: "four-portfolios" },
  { title: "zucman: a data-viz kit for a tax policy argument", date: "2026-08-11", slug: "zucman" },
  { title: "BTView: behavior trees you can actually review", date: "2026-08-10", slug: "btview" },
  { title: "rostree: exploring a graph instead of drawing a tree", date: "2026-08-09", slug: "rostree" },
  { title: "Building v4: leaner, and a little livelier", date: "2026-08-06", slug: "building-v4" },
] as const;

export const contact = {
  title: "Open Channel",
  body: `I'm not looking for a new role, but my inbox is open. A question about multi-agent planning, an open-source idea, or just a hello are all welcome, and I'll reply.`,
} as const;
