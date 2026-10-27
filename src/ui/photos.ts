/** The polaroids open in a simple viewer, with arrows and the keyboard to flip through. */
export function wirePhotos() {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".polaroids a[data-photo]"));
  const viewer = document.querySelector<HTMLDialogElement>(".viewer");
  if (!viewer || !links.length) return;
  const img = viewer.querySelector("img")!;
  const cap = viewer.querySelector("figcaption")!;
  let current = 0;
  const show = (i: number) => {
    current = (i + links.length) % links.length;
    const a = links[current];
    img.src = a.href;
    img.alt = a.querySelector("img")!.alt;
    cap.textContent = a.dataset.caption!;
  };
  links.forEach((a, i) =>
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      show(i);
      if (!viewer.open) viewer.showModal();
    }),
  );
  viewer.querySelectorAll<HTMLButtonElement>(".viewer-nav [data-dir]").forEach((b) =>
    b.addEventListener("click", () => show(current + Number(b.dataset.dir))),
  );
  viewer.querySelector(".viewer-close")!.addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (e) => {
    if (e.target === viewer) viewer.close();
  });
  viewer.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(current + 1);
    if (e.key === "ArrowLeft") show(current - 1);
  });
}
