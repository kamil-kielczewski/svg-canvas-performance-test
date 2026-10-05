/* =============================================================================
 * benchmark.js  --  Measurement utilities (renderer agnostic).
 *
 *  RenderTimer     single frame render cost          (requirement #10)
 *  BenchmarkRunner N full renders, min/avg/max       (requirement #11)
 *  FpsMeter        real rendered frames per second   (requirement #12)
 *
 * ALL timing uses performance.now() (sub-millisecond, monotonic).
 * NOTHING here ever calls the scene generator or the geometry builder -- the
 * caller must have prepared the geometry before measuring.
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});

  /* ------------------------------------------------------------------ */
  /* Single render timing                                                */
  /* ------------------------------------------------------------------ */
  class RenderTimer {
    constructor(window_ = 120) {
      this.windowSize = window_;
      this.reset();
    }
    reset() {
      this.samples = [];
      this.last = 0;
      this.count = 0;
      this.sum = 0;
    }
    push(ms) {
      this.last = ms;
      this.count++;
      this.samples.push(ms);
      this.sum += ms;
      if (this.samples.length > this.windowSize) this.sum -= this.samples.shift();
    }
    get average() { return this.samples.length ? this.sum / this.samples.length : 0; }
  }

  /* ------------------------------------------------------------------ */
  /* FPS over REAL rendered frames, with a sliding 10 s min/max window   */
  /* ------------------------------------------------------------------ */
  class FpsMeter {
    constructor(windowMs = 10000) {
      this.windowMs = windowMs;
      this.reset();
    }
    reset() {
      this.frameTimes = [];   // timestamps of the last ~1 s of rendered frames
      this.history = [];      // {t, fps} samples of the last `windowMs`
      this.current = 0;
      this.lastFrame = null;
    }
    /** Called once per ACTUALLY rendered frame (never from a timer). */
    frame(now) {
      const ft = this.frameTimes;
      ft.push(now);
      // Keep the trailing second -- but ALWAYS keep at least two timestamps.
      // A strict 1 s window holds a single frame once the rate drops below
      // ~2 fps, which would report 0 for exactly the heavy scenes the
      // benchmark exists to measure. With two kept, the rate is simply
      // 1000 / (interval between the last two frames) and stays meaningful
      // all the way down to one frame per several seconds.
      while (ft.length > 2 && now - ft[0] > 1000) ft.shift();
      const span = ft.length > 1 ? now - ft[0] : 0;
      this.current = span > 0 ? ((ft.length - 1) * 1000) / span : 0;
      this.lastFrame = now;
      // Every real measurement is recorded, even one whose frame took longer
      // than the 10 s window: dropping it would make Min FPS blind to exactly
      // the worst frames. Pruning is by TIMESTAMP, so the sample is visible for
      // the 10 s that follow it.
      if (span > 0) this.history.push({ t: now, fps: this.current });
      this._prune(now);
    }
    /**
     * Called every animation frame, rendered or not. Decays the reading while
     * nothing is drawn: a frame that has already been pending for `since` ms
     * cannot possibly belong to a rate higher than 1000 / since.
     */
    tick(now) {
      this._prune(now);
      if (this.lastFrame == null) return;
      const since = now - this.lastFrame;
      if (since > 0) this.current = Math.min(this.current, 1000 / since);
      if (since > this.windowMs) this.current = 0;
    }
    _prune(now) {
      const cut = now - this.windowMs;
      while (this.history.length && this.history[0].t < cut) this.history.shift();
    }
    get min() {
      let m = Infinity;
      for (let i = 0; i < this.history.length; i++) if (this.history[i].fps < m) m = this.history[i].fps;
      return m === Infinity ? 0 : m;
    }
    get max() {
      let m = 0;
      for (let i = 0; i < this.history.length; i++) if (this.history[i].fps > m) m = this.history[i].fps;
      return m;
    }
  }

  /* ------------------------------------------------------------------ */
  /* N-render benchmark                                                   */
  /* ------------------------------------------------------------------ */
  function stats(times) {
    const sorted = times.slice().sort((a, b) => a - b);
    const n = sorted.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sorted[i];
    return {
      iterations: n,
      total: sum,
      avg: n ? sum / n : 0,
      min: n ? sorted[0] : 0,
      max: n ? sorted[n - 1] : 0,
      median: n ? sorted[n >> 1] : 0,
      p95: n ? sorted[Math.min(n - 1, Math.floor(n * 0.95))] : 0
    };
  }

  class BenchmarkRunner {
    constructor() { this.running = false; this.cancelled = false; }
    cancel() { this.cancelled = true; }

    /**
     * @param {object} o
     * @param {number}   o.iterations
     * @param {Function} o.beforeEach  (i) => void  -- alternates the scene so no
     *                                 renderer can short-circuit the work.
     * @param {Function} o.render      () => void   -- the measured operation
     * @param {Function} [o.flush]     () => void   -- optional deferred-work flush
     * @param {Function} [o.onProgress](done,total)
     */
    run(o) {
      this.running = true;
      this.cancelled = false;
      const times = new Array(o.iterations);
      let i = 0;
      const wallStart = performance.now();

      return new Promise((resolve) => {
        const step = () => {
          if (this.cancelled) { finish(); return; }
          const chunkStart = performance.now();
          // Run as many iterations as fit into ~12 ms, then yield to the browser
          // so the UI stays responsive. Chunking happens BETWEEN iterations and
          // therefore never pollutes an individual measurement.
          while (i < o.iterations && performance.now() - chunkStart < 12) {
            if (o.beforeEach) o.beforeEach(i);

            /* ==================== BENCHMARK REGION START ================== */
            const t0 = performance.now();
            o.render();
            if (o.flush) o.flush();
            const t1 = performance.now();
            /* ==================== BENCHMARK REGION END ==================== */

            times[i] = t1 - t0;
            i++;
          }
          if (o.onProgress) o.onProgress(i, o.iterations);
          if (i < o.iterations) requestAnimationFrame(step);
          else finish();
        };
        const finish = () => {
          this.running = false;
          const r = stats(times.slice(0, i));
          r.wallClock = performance.now() - wallStart;
          r.cancelled = this.cancelled;
          resolve(r);
        };
        requestAnimationFrame(step);
      });
    }
  }

  SQAR.Benchmark = { RenderTimer, FpsMeter, BenchmarkRunner, stats };
})(window);
