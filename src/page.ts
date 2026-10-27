/** The readable page: photo viewer, clips that play when seen, and the nav's current section. */

export function wirePhotos() {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".gallery a[data-caption]"));
  const viewer = document.querySelector<HTMLDialogElement>(".viewer")!;
  const img = viewer.querySelector("img")!;
  const cap = viewer.querySelector(".viewer-cap")!;
  let cur = 0;
  const show = (i: number) => {
    cur = (i + links.length) % links.length;
    const a = links[cur];
    img.src = a.href;
    img.alt = a.querySelector("img")!.alt;
    cap.textContent = a.dataset.caption!;
  };
  links.forEach((a, i) =>
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      show(i);
      viewer.showModal();
    }),
  );
  viewer.querySelector(".viewer-close")!.addEventListener("click", () => viewer.close());
  viewer.querySelector(".viewer-prev")!.addEventListener("click", () => show(cur - 1));
  viewer.querySelector(".viewer-next")!.addEventListener("click", () => show(cur + 1));
  viewer.addEventListener("click", (e) => {
    if (e.target === viewer) viewer.close();
  });
  viewer.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(cur + 1);
    if (e.key === "ArrowLeft") show(cur - 1);
  });
}

export function wireVideos(reduced: boolean) {
  const videos = document.querySelectorAll<HTMLVideoElement>(".project video");
  if (reduced) {
    // no autoplay when you've asked for less motion: hover or focus plays a clip
    videos.forEach((v) => {
      const card = v.closest<HTMLElement>(".project")!;
      card.addEventListener("pointerenter", () => v.play().catch(() => {}));
      card.addEventListener("pointerleave", () => v.pause());
      card.addEventListener("focusin", () => v.play().catch(() => {}));
      card.addEventListener("focusout", () => v.pause());
    });
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const v = en.target as HTMLVideoElement;
        if (en.isIntersecting) v.play().catch(() => {});
        else v.pause();
      }
    },
    { threshold: 0.55 },
  );
  videos.forEach((v) => io.observe(v));
}

export function wireNav() {
  const links = new Map(Array.from(document.querySelectorAll<HTMLAnchorElement>(".top nav a")).map((a) => [a.hash.slice(1), a]));
  const targets: [string, HTMLElement][] = [
    ["now", document.getElementById("dive")!],
    ["work", document.getElementById("work")!],
    ["writing", document.getElementById("writing")!],
    ["photos", document.getElementById("photos")!],
    ["contact", document.getElementById("contact")!],
  ];
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const id = targets.find(([, el]) => el === en.target)![0];
        links.forEach((a, k) => (k === id ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
      }
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  for (const [, el] of targets) io.observe(el);
}
