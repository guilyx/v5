/** Project clips play only while you can see them, and only on request if you prefer less motion. */
export function wireProjects() {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>(".project video"));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    for (const v of videos) {
      const box = v.closest(".project")!;
      box.addEventListener("pointerenter", () => v.play().catch(() => {}));
      box.addEventListener("pointerleave", () => v.pause());
    }
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
