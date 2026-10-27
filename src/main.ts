import "@fontsource-variable/geist";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./styles.css";
import { wirePhotos } from "./ui/photos";
import { wireProjects } from "./ui/projects";
import { wireNav } from "./ui/nav";

/* The page works on its own: every word is in index.html. The desk is a layer on top,
   loaded after the first paint, and only where WebGL2 exists (decided in index.html). */

wirePhotos();
wireProjects();
wireNav();

const root = document.documentElement;

async function loadDesk() {
  try {
    await Promise.all([
      document.fonts.load('400 40px "Geist Variable"'),
      document.fonts.load('600 40px "Geist Variable"'),
      document.fonts.load('400 40px "Instrument Serif"'),
      document.fonts.load('italic 400 40px "Instrument Serif"'),
    ]).catch(() => {});
    const { startDesk } = await import("./desk");
    await startDesk(document.getElementById("desk") as HTMLCanvasElement);
  } catch (err) {
    console.warn("The 3D desk could not start; showing the readable page instead.", err);
    root.classList.remove("has-desk");
    root.classList.add("desk-failed");
  }
}

if (root.classList.contains("has-desk")) {
  const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  requestAnimationFrame(() => (idle ? idle(() => void loadDesk(), { timeout: 400 }) : setTimeout(() => void loadDesk(), 60)));
}
