/** Only one offscreen WebGL thumbnail may exist. Two contexts at once drop later shots. */
let held = false;
const waiters: Array<() => void> = [];

export function acquireThumbBaker(): Promise<void> {
  if (!held) {
    held = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

export function releaseThumbBaker() {
  const next = waiters.shift();
  if (next) {
    // Let the previous WebGL context actually drop before the next card mounts.
    window.setTimeout(next, 80);
    return;
  }
  held = false;
}
