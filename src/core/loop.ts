/** requestAnimationFrame loop. dt is in seconds and clamped to 100 ms. */
export function createLoop(frame: (dt: number) => void) {
  let raf = 0;
  let last = 0;
  const tick = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    frame(dt);
    raf = requestAnimationFrame(tick);
  };
  return {
    start() {
      if (raf) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
