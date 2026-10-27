import type { Camera } from "./cam";

/** what the board needs from a renderer: three.js when there is WebGL, a 2D canvas when not */
export interface EdgeData {
  pts: number[];
  cum: number[];
  len: number;
}

export interface FrameData {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0 idle, 1 running, 2 success */
  state: number;
  /** 0..1, how much this is the chapter in focus */
  focus: number;
}

export interface RobotPose {
  visible: boolean;
  x: number;
  y: number;
  /** heading in board space (radians, y down) */
  a: number;
  scale: number;
  /** board px per second, for the wheels */
  speed: number;
  led: string;
}

export interface Layer {
  kind: "gl" | "flat";
  resize(w: number, h: number): void;
  setGraph(edges: EdgeData[], bounds: { x0: number; y0: number; x1: number; y1: number }): void;
  /** per edge: filled length, state (0 idle, 1 running, 2 success), length, pulse phase */
  setEdgeStates(states: Float32Array): void;
  setFrames(list: FrameData[]): void;
  render(cam: Camera, pose: RobotPose, time: number, ambient: boolean, dt: number): { calls: number; tris: number };
  dispose(): void;
}
