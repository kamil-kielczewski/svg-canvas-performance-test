/* =============================================================================
 * app.js  --  Shared application shell.
 *
 * This is the "higher level logic" required by the task. It is IDENTICAL for
 * both pages: it receives a renderer factory and a renderer-interaction factory
 * and from then on talks only to the common Renderer interface. Nowhere below
 * does it test for "canvas" or "svg" (except to label the UI and build the
 * cross-link).
 *
 * PIPELINE (requirement #9)
 *   configuration change -> regenerate(level) -> cached geometry -> dirty flag
 *   rAF loop             -> renderer.renderFrame()  <-- the only timed part
 *   drag                 -> model mutation + incremental renderer update
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});

  const LEVEL_RANK = { none: 0, render: 1, style: 2, geometry: 3, scene: 4 };

  // Backdrop colours. The benchmark alternates A/B so that every clear+redraw
  // cycle is visible on screen; normal interactive use stays white.
  const NORMAL_BG = '#ffffff';
  const BENCH_BG_A = '#ffffff';
  const BENCH_BG_B = '#000000';

  function $(id) { return document.getElementById(id); }
  function ms(v) { return v.toFixed(2) + ' ms'; }
  /**
   * FPS readout: 2 decimals normally, 4 decimals below 1 fps -- at very heavy
   * scene sizes a frame can take several seconds, and "0" would hide the whole
   * interesting range.
   */
  function fpsFmt(v) { return v < 1 ? v.toFixed(4) : v.toFixed(2); }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  /**
   * The current view is carried across the two pages together with the
   * configuration. It is stored as "world point at the centre of the surface"
   * plus the scale, so the view stays identical even if the two windows do not
   * have exactly the same size.
   */
  function parseViewState(hash) {
    const o = {};
    (hash || '').replace(/^#/, '').split('&').forEach(function (pair) {
      const i = pair.indexOf('=');
      if (i < 0) return;
      const k = pair.slice(0, i);
      if (k === '_cx' || k === '_cy' || k === '_s') o[k] = parseFloat(decodeURIComponent(pair.slice(i + 1)));
    });
    return (isFinite(o._cx) && isFinite(o._cy) && isFinite(o._s) && o._s > 0) ? o : null;
  }

  function start(options) {
    const kind = options.kind;

    /* ---------------- configuration + incoming view state ------------- */
    const config = SQAR.Configuration.fromQuery(location.hash);
    const incomingView = parseViewState(location.hash);

    /* ---------------- shared assets ---------------------------------- */
    // Parsed ONCE, shared by both backends. Never part of any measurement.
    const asset = SQAR.IconAsset.loadDefault();

    /* ---------------- renderer + viewport ---------------------------- */
    const surface = $('viewport');
    const renderer = options.createRenderer(surface);
    renderer.setBackground(NORMAL_BG);
    const viewport = new SQAR.Viewport();
    renderer.setViewport(viewport);
    const host = options.createInteraction(renderer);

    /* ---------------- measurement ------------------------------------ */
    const renderTimer = new SQAR.Benchmark.RenderTimer(120);
    const fps = new SQAR.Benchmark.FpsMeter(10000);
    const runner = new SQAR.Benchmark.BenchmarkRunner();

    let scene = null;
    let controller = null;
    let dirty = true;
    let viewHashDirty = true;
    let genTime = 0, geomTime = 0;
    let benchmarking = false;

    /* =================================================================== */
    /* STEP 1 + 2 : scene generation and geometry preparation              */
    /* (always OUTSIDE the render measurement)                             */
    /* =================================================================== */
    function regenerate(level) {
      if (level === 'none') return;

      const prevRootSize = scene ? scene.root.w : null;
      if (level === 'scene') {
        const t0 = performance.now();
        scene = SQAR.SceneGenerator.generate(config);          // [1] generation
        genTime = performance.now() - t0;
      }
      if (level === 'scene' || level === 'geometry') {
        const t1 = performance.now();
        SQAR.GeometryBuilder.prepare(scene, config, asset);    // [2] preparation
        geomTime = performance.now() - t1;
      } else if (level === 'style') {
        const t1 = performance.now();
        SQAR.GeometryBuilder.prepareStyles(scene, config);
        geomTime = performance.now() - t1;
      }

      renderer.setScene(scene, config, asset);   // bind cache (no drawing yet)
      // Re-frame only when the scene's extent actually changed, so tweaking
      // margins or colours never throws away the user's zoom.
      if (prevRootSize !== null && prevRootSize !== scene.root.w && viewport.width > 1) {
        viewport.fit(scene.root.w, scene.root.h, 30);
        renderer.updateViewport();
      }
      renderer.markFullDirty();
      if (controller) controller.setScene(scene);
      renderTimer.reset();
      dirty = true;
      updateCounts();
      syncHash();
    }

    /* ---------------- debounced config changes ------------------------ */
    let pendingLevel = 'none', pendingScheduled = false;
    function scheduleRegenerate(level) {
      if (LEVEL_RANK[level] > LEVEL_RANK[pendingLevel]) pendingLevel = level;
      if (pendingScheduled) return;
      pendingScheduled = true;
      requestAnimationFrame(() => {
        pendingScheduled = false;
        const l = pendingLevel; pendingLevel = 'none';
        if (l === 'none') syncHash();                       // e.g. iteration count
        else if (l === 'render') { renderer.markFullDirty(); dirty = true; syncHash(); }
        else regenerate(l);
      });
    }

    /* ---------------- first build ------------------------------------- */
    regenerate('scene');

    controller = new SQAR.InteractionController({
      scene, config, viewport, renderer, host,
      onChange(kind) { dirty = true; if (kind === 'viewport') viewHashDirty = true; },
      onSelection: updateSelectionInfo
    });
    host.controller = controller;

    /* ---------------- sizing ------------------------------------------ */
    function applySize() {
      const r = surface.getBoundingClientRect();
      viewport.width = Math.max(1, Math.round(r.width));
      viewport.height = Math.max(1, Math.round(r.height));
      renderer.resize(viewport.width, viewport.height);
      renderer.markFullDirty();
      dirty = true;
    }
    const ro = new ResizeObserver(applySize);
    ro.observe(surface);
    applySize();
    if (incomingView) {
      // Same pan + zoom as the page we were opened from.
      viewport.scale = incomingView._s;
      viewport.tx = viewport.width / 2 - incomingView._cx * viewport.scale;
      viewport.ty = viewport.height / 2 - incomingView._cy * viewport.scale;
    } else {
      viewport.fit(scene.root.w, scene.root.h, 30);
    }
    renderer.updateViewport();
    syncHash();

    /* =================================================================== */
    /* STEP 3 : the render loop -- the ONLY place a frame is timed         */
    /* =================================================================== */
    let lastStats = 0;
    function loop(now) {
      requestAnimationFrame(loop);
      fps.tick(now);

      if (dirty && !benchmarking) {
        dirty = false;
        /* ================ MEASURED RENDER REGION START ================= */
        const t0 = performance.now();
        renderer.renderFrame();
        const t1 = performance.now();
        /* ================= MEASURED RENDER REGION END ================== */
        renderTimer.push(t1 - t0);
        fps.frame(t1);                 // FPS counts REAL rendered frames only
      }

      if (now - lastStats > 100) {
        lastStats = now;
        updateStats();
        // Pan/zoom happens at frame rate; refresh the shareable hash + the
        // cross-renderer link at a much lower rate.
        if (viewHashDirty) syncHash();
      }
    }
    requestAnimationFrame(loop);

    /* ---------------- stats readout ----------------------------------- */
    function updateStats() {
      $('stat-last').textContent = ms(renderTimer.last);
      $('stat-avg').textContent = ms(renderTimer.average);
      $('stat-frames').textContent = String(renderTimer.count);
      $('stat-fps').textContent = fpsFmt(fps.current);
      $('stat-minfps').textContent = fps.history.length ? fpsFmt(fps.min) : '-';
      $('stat-maxfps').textContent = fps.history.length ? fpsFmt(fps.max) : '-';
      $('stat-prims').textContent = String(renderer.primitiveCount);
    }

    function updateCounts() {
      const capped = scene.depth < config.levels;
      $('stat-depth').textContent = capped ? scene.depth + ' / ' + config.levels : String(scene.depth);
      $('stat-depth').title = capped
        ? (scene.budgetHit
            ? 'Stopped by the room budget (Scene panel). Raise it to generate deeper levels.'
            : 'Stopped by the margins: children would have zero size. Lower the margin settings.')
        : '';
      $('stat-depth').classList.toggle('capped', capped);
      $('stat-rooms').textContent = String(scene.roomCount);
      $('stat-walls').textContent = String(scene.wallCount);
      $('stat-icons').textContent = String(scene.icons.length);
      $('stat-gen').textContent = ms(genTime);
      $('stat-geom').textContent = ms(geomTime);
    }

    function updateSelectionInfo(sel) {
      const n = $('selinfo');
      if (!sel) { n.textContent = 'nothing selected'; return; }
      if (sel.type === 'wall') {
        n.textContent = 'wall segment ' + sel.index + ' of room #' + sel.room.id +
                        ' (level ' + sel.room.level + ')';
      } else {
        n.textContent = 'icon of room #' + sel.room.id;
      }
    }

    /* ---------------- hash / cross link ------------------------------- */
    function viewQuery() {
      const cx = viewport.toWorldX(viewport.width / 2);
      const cy = viewport.toWorldY(viewport.height / 2);
      return '&_cx=' + r3(cx) + '&_cy=' + r3(cy) + '&_s=' + r3(viewport.scale);
    }

    function syncHash() {
      viewHashDirty = false;
      const q = config.toQuery() + viewQuery();
      // Some browsers refuse history.replaceState() on file:// URLs -- the app
      // must keep working there, so a failure is simply ignored.
      try { history.replaceState(null, '', '#' + q); } catch (e) { /* file:// */ }
      const other = $('link-other');
      if (other) other.href = (kind === 'canvas' ? 'svg.html' : 'canvas.html') + '#' + q;
    }

    /* ---------------- config panel ------------------------------------ */
    SQAR.UI.buildPanel($('panel'), config, kind, function (field) {
      scheduleRegenerate(field.rebuild);
    });
    syncHash();
    updateCounts();

    /* =================================================================== */
    /* Benchmark panel (requirement #11)                                   */
    /* =================================================================== */
    function renderOnce() {
      renderer.markFullDirty();
      /* ==================== BENCHMARK REGION START ===================== */
      const t0 = performance.now();
      renderer.renderScene();
      if (config.benchFlush) renderer.flush();
      const t1 = performance.now();
      /* ===================== BENCHMARK REGION END ====================== */
      renderTimer.push(t1 - t0);
      updateStats();
    }

    $('btn-render').addEventListener('click', renderOnce);

    $('btn-clear').addEventListener('click', function () {
      renderer.setBackground(NORMAL_BG);
      renderer.clear();
      renderer.markFullDirty();
      dirty = false;                      // keep the screen empty on purpose
      $('bench-out').textContent = 'screen cleared';
    });

    $('btn-fit').addEventListener('click', function () {
      viewport.fit(scene.root.w, scene.root.h, 30);
      renderer.updateViewport();
      dirty = true;
    });

    $('btn-bench').addEventListener('click', function () {
      if (benchmarking) return;
      benchmarking = true;
      $('btn-bench').disabled = true;
      $('bench-out').textContent = 'running…';

      // A benchmark must not be polluted by leftovers on screen.
      renderer.clear();
      renderer.markFullDirty();

      const baseTx = viewport.tx, baseTy = viewport.ty;
      const iterations = Math.max(1, Math.round(config.iterations));

      runner.run({
        iterations: iterations,
        // Alternate the scene between iterations so neither backend can skip
        // work -- and so the redraw is VISIBLE: the backdrop flips black/white
        // on every cycle, which is the only part of a clear+redraw pair the
        // compositor can ever show (the pair itself is one synchronous task).
        // This runs OUTSIDE the timed region.
        beforeEach(i) {
          renderer.setBackground(i % 2 ? BENCH_BG_B : BENCH_BG_A);
          viewport.tx = baseTx + (i % 2 ? 0.5 : -0.5);
          renderer.markFullDirty();
        },
        render() { renderer.renderScene(); },   // real drawing / real DOM build
        flush: config.benchFlush ? function () { renderer.flush(); } : null,
        onProgress(done, total) {
          $('bench-out').textContent = 'running… ' + done + ' / ' + total;
        }
      }).then(function (r) {
        renderer.setBackground(NORMAL_BG);
        viewport.tx = baseTx; viewport.ty = baseTy;
        benchmarking = false;
        $('btn-bench').disabled = false;
        renderer.markFullDirty();
        dirty = true;
        $('bench-out').textContent = [
          'renderer     : ' + kind.toUpperCase() + (config.benchFlush ? ' (+flush)' : ''),
          'iterations   : ' + r.iterations,
          'total        : ' + r.total.toFixed(2) + ' ms',
          'wall clock   : ' + r.wallClock.toFixed(2) + ' ms',
          'average      : ' + r.avg.toFixed(3) + ' ms',
          'min          : ' + r.min.toFixed(3) + ' ms',
          'max          : ' + r.max.toFixed(3) + ' ms',
          'median       : ' + r.median.toFixed(3) + ' ms',
          'p95          : ' + r.p95.toFixed(3) + ' ms',
          'equiv. FPS   : ' + (r.avg > 0 ? fpsFmt(1000 / r.avg) : '-'),
          '',
          'scene        : ' + scene.roomCount + ' rooms / ' + scene.wallCount +
            ' walls / ' + scene.icons.length + ' icons',
          'primitives   : ' + renderer.primitiveCount + ' per full render',
          'scene gen    : ' + genTime.toFixed(2) + ' ms  (NOT measured)',
          'geometry prep: ' + geomTime.toFixed(2) + ' ms  (NOT measured)'
        ].join('\n');
      });
    });

    /* ---------------- keyboard shortcuts ------------------------------ */
    window.addEventListener('keydown', function (e) {
      if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
      if (e.key === 'f') { viewport.fit(scene.root.w, scene.root.h, 30); renderer.updateViewport(); dirty = true; }
      if (e.key === 'r') { renderOnce(); }
    });

    // The href is refreshed on a timer, but a click must never race it.
    ['pointerdown', 'click', 'auxclick', 'contextmenu'].forEach(function (evt) {
      $('link-other').addEventListener(evt, syncHash);
    });

    $('renderer-name').textContent = kind === 'canvas' ? 'Canvas 2D' : 'SVG DOM';
    updateSelectionInfo(null);

    // Exposed for debugging / automated checks. The application itself never
    // reaches for this object.
    const instance = {
      kind, config, viewport, renderer, controller, asset,
      get scene() { return scene; },
      regenerate, renderOnce,
      invalidate() { dirty = true; },
      timers: { renderTimer, fps }
    };
    SQAR.app = instance;
    return instance;
  }

  SQAR.App = { start };
})(window);
