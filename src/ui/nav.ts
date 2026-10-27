/** The top bar marks the part of the page you're in. */
export function wireNav() {
  const links = new Map(
    Array.from(document.querySelectorAll<HTMLAnchorElement>(".top nav a")).map((a) => [a.hash.slice(1), a]),
  );
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        links.forEach((a, id) => (id === en.target.id ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
      }
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  links.forEach((_, id) => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });
}
