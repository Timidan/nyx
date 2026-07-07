import { useEffect, useRef, useState } from "react";

/**
 * NightSky — the interactive constellation backdrop. Nyx runs an agent that
 * matches hidden orders, so the page sits over a living agent network: ~100
 * drifting nodes under a deep-space gradient, edges forming between nodes
 * that come within reach, the net brightening toward mint and tightening
 * around the cursor while nodes shy away from it, and mint pulses
 * occasionally traveling along strongly-lit edges — nodes finding matches.
 * It is both the image and the interaction — one fixed full-viewport
 * <canvas> behind all content, on both routes.
 *
 * DARK THEME ONLY. In light mode the component renders nothing (returns null),
 * so the canvas is absent from the DOM and today's subtle warm atmosphere is
 * untouched. The theme lives on document.documentElement.dataset.theme; a
 * MutationObserver re-checks it whenever the header toggle flips it.
 *
 * Performance / a11y contract:
 *  - one requestAnimationFrame loop, zero per-frame allocations: the node
 *    array and a 12-slot pulse pool are preallocated, and every fill/stroke
 *    style comes from prebuilt rgba string lookup tables (alpha quantized to
 *    1/100), so the frame loop creates no objects, arrays, or strings;
 *  - pair distances use one reused i<j loop with a squared-distance early-out
 *    (N ≤ 100 → ≤ ~5k checks/frame); node count capped at 70 under 640px;
 *  - shadowBlur rides only on pulse dots (≤ 12 concurrent), never on edges;
 *  - DPR-aware, capped at 1.5; physics scaled by dt (frame-rate independent);
 *  - pauses on visibilitychange:hidden, resumes on visible;
 *  - prefers-reduced-motion → draws ONE static frame (nodes + edges at rest,
 *    no pulses, no cursor boost), never starts the loop;
 *  - pointermove listener is passive and only stores target coordinates;
 *  - canvas is pointer-events:none and aria-hidden; resize is debounced and
 *    rescales node positions proportionally.
 */

type NetNode = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // dot radius, 1.6–2.2px
  ts: number; // twinkle speed (rad/s)
  tp: number; // twinkle phase
};

type Pulse = {
  active: boolean;
  a: NetNode | null; // endpoints tracked live so the pulse rides the edge
  b: NetNode | null;
  p: number; // 0..1 progress along the edge
};

export function NightSky() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDark, setIsDark] = useState<boolean>(
    () => document.documentElement.dataset.theme === "dark",
  );

  // Re-check the theme whenever the toggle flips data-theme on <html>.
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setIsDark(el.dataset.theme === "dark");
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!isDark) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const canvasEl: HTMLCanvasElement = canvas;
    const ctx2d: CanvasRenderingContext2D = ctx;

    const TAU = Math.PI * 2;
    const MINT = "25,226,180"; // #19E2B4
    const NAVY = "90,102,240"; // luminous navy (token #2C31C4 lifted for edges)

    // ---- style LUTs: alpha quantized to 1/100 → zero string allocs/frame ----
    const MINT_A: string[] = new Array(101);
    const NAVY_A: string[] = new Array(101);
    for (let k = 0; k <= 100; k++) {
      MINT_A[k] = `rgba(${MINT},${k / 100})`;
      NAVY_A[k] = `rgba(${NAVY},${k / 100})`;
    }
    const PULSE_FILL = MINT_A[95];
    const PULSE_GLOW = `rgb(${MINT})`;

    // ---- tuning ----
    const LINK = 140; // edge forms under this distance
    const LINK2 = LINK * LINK;
    const NEAR = 220; // cursor boost radius
    const REPULSE = 190; // cursor repulsion radius
    const MAX_N = 100;
    const SMALL_N = 70; // under 640px viewports

    // ---- viewport + baked gradients (rebuilt on resize, reused per frame) ----
    let w = 0;
    let h = 0;
    let dpr = 1;
    let baseGrad: CanvasGradient | null = null; // deep-space vertical
    let navyGrad: CanvasGradient | null = null; // one faint navy radial, depth

    // ---- nodes (preallocated; activeN adjusts with viewport width) ----
    const nodes: NetNode[] = new Array(MAX_N);
    for (let i = 0; i < MAX_N; i++) {
      nodes[i] = {
        x: 0,
        y: 0,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: 1.6 + Math.random() * 0.6,
        ts: 0.5 + Math.random() * 0.6,
        tp: Math.random() * TAU,
      };
    }
    let activeN = MAX_N;

    // ---- pulse pool (12 slots, reused; no push/splice ever) ----
    const PULSE_SLOTS = 12;
    const pulses: Pulse[] = new Array(PULSE_SLOTS);
    for (let i = 0; i < PULSE_SLOTS; i++) {
      pulses[i] = { active: false, a: null, b: null, p: 0 };
    }
    function spawnPulse(a: NetNode, b: NetNode) {
      for (let i = 0; i < PULSE_SLOTS; i++) {
        if (!pulses[i].active) {
          pulses[i].active = true;
          pulses[i].a = a;
          pulses[i].b = b;
          pulses[i].p = 0;
          return;
        }
      }
    }

    // ---- pointer (passive; handler only stores the target coords) ----
    // Starts far off-screen so there is no boost/repulsion until a real move.
    let mx = -99999;
    let my = -99999;
    const onPointerMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };

    // ---- clock + run state ----
    let clock = 0; // seconds, only advances while visible
    let lastNow = performance.now();
    let raf = 0;
    let running = false;
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = reduceMq.matches;

    function resize() {
      const pw = w;
      const ph = h;
      w = window.innerWidth;
      h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvasEl.width = Math.round(w * dpr);
      canvasEl.height = Math.round(h * dpr);
      canvasEl.style.width = `${w}px`;
      canvasEl.style.height = `${h}px`;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

      baseGrad = ctx2d.createLinearGradient(0, 0, 0, h);
      baseGrad.addColorStop(0, "#06060a"); // near-black deep-space
      baseGrad.addColorStop(1, "#0b0d1a"); // faint navy horizon
      navyGrad = ctx2d.createRadialGradient(w * 0.75, h * 0.2, 0, w * 0.75, h * 0.2, w * 0.6);
      navyGrad.addColorStop(0, `rgba(${NAVY},0.08)`);
      navyGrad.addColorStop(1, "rgba(0,0,0,0)");

      activeN = w < 640 ? SMALL_N : MAX_N;
      if (pw === 0 || ph === 0) {
        for (let i = 0; i < MAX_N; i++) {
          nodes[i].x = Math.random() * w;
          nodes[i].y = Math.random() * h;
        }
      } else {
        // keep the net's shape across resizes
        const rx = w / pw;
        const ry = h / ph;
        for (let i = 0; i < MAX_N; i++) {
          nodes[i].x *= rx;
          nodes[i].y *= ry;
        }
      }
    }

    /** One full frame. spawnAllowed gates pulse creation (off for the static
     *  reduced-motion frame and for redraws while paused). */
    function draw(spawnAllowed: boolean) {
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.globalAlpha = 1;

      // 1. base: deep-space vertical gradient + one faint navy radial
      if (baseGrad) ctx2d.fillStyle = baseGrad;
      ctx2d.fillRect(0, 0, w, h);
      if (navyGrad) {
        ctx2d.fillStyle = navyGrad;
        ctx2d.fillRect(0, 0, w, h);
      }

      // 2. edges: pairs closer than LINK; alpha ∝ closeness with a 0.10 floor;
      //    near the cursor they brighten toward mint (≤ ~0.55) and tighten.
      for (let i = 0; i < activeN; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < activeN; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= LINK2) continue;
          const d = Math.sqrt(d2);
          const da = Math.hypot(mx - a.x, my - a.y);
          const db = Math.hypot(mx - b.x, my - b.y);
          const near = da < db ? da : db;
          const boost = near < NEAR ? (NEAR - near) / NEAR : 0;
          const closeness = 1 - d / LINK;
          let alpha = 0.1 + 0.25 * closeness + 0.35 * boost;
          if (alpha > 0.55) alpha = 0.55;
          const k = (alpha * 100) | 0;
          ctx2d.strokeStyle = boost > 0.3 ? MINT_A[k] : NAVY_A[k];
          ctx2d.lineWidth = boost > 0.3 ? 1.4 : 1;
          ctx2d.beginPath();
          ctx2d.moveTo(a.x, a.y);
          ctx2d.lineTo(b.x, b.y);
          ctx2d.stroke();
          if (spawnAllowed && boost > 0.6 && Math.random() < 0.004) {
            spawnPulse(a, b);
          }
        }
      }

      // 3. pulses: mint dots traveling along boosted edges. shadowBlur rides
      //    ONLY here (≤ 12 concurrent), never on edges.
      ctx2d.fillStyle = PULSE_FILL;
      ctx2d.shadowColor = PULSE_GLOW;
      ctx2d.shadowBlur = 10;
      for (let i = 0; i < PULSE_SLOTS; i++) {
        const u = pulses[i];
        if (!u.active || !u.a || !u.b) continue;
        const x = u.a.x + (u.b.x - u.a.x) * u.p;
        const y = u.a.y + (u.b.y - u.a.y) * u.p;
        ctx2d.beginPath();
        ctx2d.arc(x, y, 2.4, 0, TAU);
        ctx2d.fill();
      }
      ctx2d.shadowBlur = 0;

      // 4. nodes: mint dots, slow twinkle (alpha ~0.55–0.8)
      for (let i = 0; i < activeN; i++) {
        const p = nodes[i];
        const alpha = 0.675 + 0.125 * Math.sin(clock * p.ts + p.tp);
        ctx2d.fillStyle = MINT_A[(alpha * 100) | 0];
        ctx2d.beginPath();
        ctx2d.arc(p.x, p.y, p.r, 0, TAU);
        ctx2d.fill();
      }
    }

    /** Physics, scaled by dtF (= dt * 60, i.e. 1 at 60fps). */
    function step(dtF: number) {
      const damp = Math.pow(0.995, dtF);
      for (let i = 0; i < activeN; i++) {
        const p = nodes[i];
        // cursor repulsion: eased impulse; damping keeps it weighty
        const dmx = p.x - mx;
        const dmy = p.y - my;
        const dm = Math.hypot(dmx, dmy) || 1;
        if (dm < REPULSE) {
          const f = ((REPULSE - dm) / REPULSE) * 0.9;
          p.vx += (dmx / dm) * f * 0.06 * dtF;
          p.vy += (dmy / dm) * f * 0.06 * dtF;
        }
        p.x += p.vx * dtF;
        p.y += p.vy * dtF;
        p.vx *= damp;
        p.vy *= damp;
        // gentle brownian drift keeps the net alive without a pointer
        p.vx += (Math.random() - 0.5) * 0.012 * dtF;
        p.vy += (Math.random() - 0.5) * 0.012 * dtF;
        if (p.x < 0) { p.x = 0; p.vx *= -1; }
        else if (p.x > w) { p.x = w; p.vx *= -1; }
        if (p.y < 0) { p.y = 0; p.vy *= -1; }
        else if (p.y > h) { p.y = h; p.vy *= -1; }
      }
      for (let i = 0; i < PULSE_SLOTS; i++) {
        const u = pulses[i];
        if (!u.active) continue;
        u.p += 0.04 * dtF;
        if (u.p >= 1) {
          u.active = false;
          u.a = null;
          u.b = null;
        }
      }
    }

    function loop() {
      const now = performance.now();
      let dt = (now - lastNow) / 1000;
      if (dt > 0.05) dt = 0.05; // clamp after a pause / stall
      lastNow = now;
      clock += dt;
      step(dt * 60);
      draw(true);
      raf = requestAnimationFrame(loop);
    }

    function drawStatic() {
      // nodes + edges at rest: no cursor boost, no pulses, mid-twinkle
      mx = -99999;
      my = -99999;
      for (let i = 0; i < PULSE_SLOTS; i++) pulses[i].active = false;
      draw(false);
    }

    function start() {
      if (reduced || running || document.hidden) return;
      running = true;
      lastNow = performance.now();
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    // ---- wire up ----
    resize();
    if (reduced) drawStatic();
    else start();

    if (!reduced) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    }

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resize();
        if (!running) draw(false); // keep a fresh frame when paused / reduced
      }, 150);
    };
    window.addEventListener("resize", onResize);

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onMotionChange = () => {
      reduced = reduceMq.matches;
      if (reduced) {
        stop();
        window.removeEventListener("pointermove", onPointerMove);
        drawStatic();
      } else {
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        start();
      }
    };
    reduceMq.addEventListener("change", onMotionChange);

    return () => {
      stop();
      window.clearTimeout(resizeTimer);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMq.removeEventListener("change", onMotionChange);
    };
  }, [isDark]);

  if (!isDark) return null;
  return (
    <canvas
      ref={canvasRef}
      data-nightsky=""
      aria-hidden="true"
      style={{ position: "fixed", top: 0, left: 0, zIndex: -10, pointerEvents: "none" }}
    />
  );
}
