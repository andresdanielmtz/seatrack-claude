/* ============================================================
   Seatrack — debris data model
   ------------------------------------------------------------
   No public feed exposes individual debris GPS positions, so
   Seatrack models debris as particles drifting inside the
   documented accumulation zones — the five subtropical gyres
   plus smaller, high-density coastal / enclosed-sea clusters.

   Each zone has an irregular, oriented outline (not a circle).
   The same outline drives both the drawn polygon and where the
   particles are seeded & confined, so the field matches the shape.

   The public interface (init / tick / heatPoints / points /
   zones / outline) is the only contract app.js depends on, so a
   real observational feed can be dropped in by reimplementing it.
   ============================================================ */

const Seatrack = (() => {
  const KM_PER_DEG = 111.32;
  const rad = (d) => (d * Math.PI) / 180;

  // tiny deterministic PRNG so zone shapes are stable across reloads
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A wobbly radial profile m(angle) ≈ 1 that makes each zone an
  // organic, lopsided blob instead of an ellipse.
  function makeShape(seed) {
    const rnd = mulberry32(seed);
    const harmonics = [];
    for (let k = 2; k <= 4; k++) {
      harmonics.push({ k, amp: 0.07 + rnd() * 0.14, phase: rnd() * 6.2832 });
    }
    return (ang) => {
      let m = 1;
      for (const h of harmonics) m += h.amp * Math.sin(h.k * ang + h.phase);
      return m;
    };
  }

  /* ---- Zones -------------------------------------------------
     type   : 'gyre' (large open-ocean) | 'cluster' (smaller)
     radKmX : E-W half-extent before rotation
     radKmY : N-S half-extent before rotation
     rot    : orientation of the blob (radians)
     spin   : circulation sign/strength (+cw / -ccw, fractional ok)
     weight : relative debris concentration
     count  : particles simulated
     ----------------------------------------------------------- */
  const ZONES = [
    // ---------- major subtropical gyres ----------
    { id: "np", type: "gyre", name: "North Pacific Gyre",
      sub: "Great Pacific Garbage Patch",
      lat: 33, lng: -142, radKmX: 1650, radKmY: 780, rot: -0.40, spin: 1,
      weight: 1.0, count: 640, seed: 7,
      estimate: "~1.8 trillion pieces", area: "1.6 million km²" },

    { id: "na", type: "gyre", name: "North Atlantic Gyre",
      sub: "North Atlantic Garbage Patch",
      lat: 33, lng: -55, radKmX: 1300, radKmY: 700, rot: -0.15, spin: 1,
      weight: 0.72, count: 420, seed: 12,
      estimate: "~200k pieces / km²", area: "Sargasso Sea region" },

    { id: "sp", type: "gyre", name: "South Pacific Gyre",
      sub: "South Pacific Garbage Patch",
      lat: -32, lng: -118, radKmX: 1400, radKmY: 800, rot: 0.25, spin: -1,
      weight: 0.58, count: 340, seed: 21,
      estimate: "~26k pieces / km²", area: "Valparaíso → Easter Island" },

    { id: "sa", type: "gyre", name: "South Atlantic Gyre",
      sub: "South Atlantic accumulation zone",
      lat: -29, lng: -8, radKmX: 1150, radKmY: 720, rot: 0.10, spin: -1,
      weight: 0.50, count: 280, seed: 4,
      estimate: "emerging accumulation", area: "Brazil ↔ South Africa" },

    { id: "io", type: "gyre", name: "Indian Ocean Gyre",
      sub: "Indian Ocean Garbage Patch",
      lat: -31, lng: 80, radKmX: 1450, radKmY: 760, rot: -0.10, spin: -1,
      weight: 0.64, count: 380, seed: 33,
      estimate: "~10k pieces / km²", area: "south of the subcontinent" },

    // ---------- smaller high-density clusters ----------
    { id: "med", type: "cluster", name: "Mediterranean Sea",
      sub: "Enclosed-basin accumulation",
      lat: 38.5, lng: 9, radKmX: 880, radKmY: 270, rot: 0.04, spin: 0.4,
      weight: 0.6, count: 160, seed: 9,
      estimate: "~1.25M fragments / km²", area: "Mediterranean basin" },

    { id: "bob", type: "cluster", name: "Bay of Bengal",
      sub: "Ganges–Brahmaputra outflow",
      lat: 15, lng: 89, radKmX: 430, radKmY: 470, rot: 0, spin: -0.5,
      weight: 0.5, count: 120, seed: 17,
      estimate: "major river-borne load", area: "Bay of Bengal" },

    { id: "carib", type: "cluster", name: "Gulf & Caribbean",
      sub: "Semi-enclosed coastal zone",
      lat: 22, lng: -86, radKmX: 720, radKmY: 360, rot: 0.12, spin: 0.4,
      weight: 0.42, count: 120, seed: 28,
      estimate: "dense coastal litter", area: "Gulf of Mexico & Caribbean" },

    { id: "ecs", type: "cluster", name: "East China & Yellow Sea",
      sub: "Yangtze River outflow",
      lat: 31, lng: 124, radKmX: 380, radKmY: 520, rot: 0, spin: 0.5,
      weight: 0.52, count: 140, seed: 41,
      estimate: "highest river plastic flux", area: "East Asian marginal seas" },

    { id: "arab", type: "cluster", name: "Arabian Sea",
      sub: "Indus outflow & coastal drift",
      lat: 18, lng: 64, radKmX: 540, radKmY: 470, rot: 0, spin: -0.4,
      weight: 0.4, count: 110, seed: 6,
      estimate: "seasonal monsoon load", area: "Arabian Sea" },
  ];

  // precompute per-zone shape fn + cos(lat) scale
  ZONES.forEach((z) => {
    z.shape = makeShape(z.seed);
    z.cosLat = Math.cos(rad(z.lat));
  });

  let particles = [];

  const biasedRadius = () => Math.pow(Math.random(), 0.7); // denser core

  // Map a particle's normalised polar position (within its zone's
  // wobbly, oriented outline) to absolute lat/lng.
  function place(p) {
    const z = p.zone;
    const reach = p.rr * z.shape(p.angle);      // 0..~1 toward the rim
    let east = Math.cos(p.angle) * reach * z.radKmX;
    let north = Math.sin(p.angle) * reach * z.radKmY;
    // rotate the local frame so blobs can tilt
    const c = Math.cos(z.rot), s = Math.sin(z.rot);
    const e2 = east * c - north * s;
    const n2 = east * s + north * c;
    p.lat = z.lat + n2 / KM_PER_DEG;
    p.lng = z.lng + e2 / (KM_PER_DEG * z.cosLat);
  }

  function seedZone(z) {
    const base = z.type === "cluster" ? 0.0011 : 0.0019;
    for (let i = 0; i < z.count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const rr = biasedRadius();
      particles.push({
        zone: z,
        angle,
        rr,
        spd: (base + Math.random() * base) * z.spin,
        w: (1 - rr * 0.6) * z.weight * (0.6 + Math.random() * 0.6),
        lat: 0, lng: 0,
      });
    }
  }

  function init() {
    particles = [];
    ZONES.forEach(seedZone);
    particles.forEach(place);
    return api;
  }

  // Advance one step: circulate each particle and add Brownian drift,
  // reflecting it back inside its zone outline.
  function tick() {
    for (const p of particles) {
      p.angle += p.spd * (1.3 - p.rr * 0.5);
      p.rr += (Math.random() - 0.5) * 0.012;
      if (p.rr > 1) p.rr = 1 - (p.rr - 1);   // reflect at the rim
      if (p.rr < 0.04) p.rr = 0.04;
      place(p);
    }
    return api;
  }

  // Sampled outline polygon for a zone: [[lat,lng], ...]
  function outline(z, steps = 56) {
    const pts = [];
    const probe = { zone: z, rr: 1, angle: 0, lat: 0, lng: 0 };
    for (let i = 0; i < steps; i++) {
      probe.angle = (i / steps) * Math.PI * 2;
      place(probe);
      pts.push([probe.lat, probe.lng]);
    }
    return pts;
  }

  function heatPoints() {
    const out = new Array(particles.length);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      out[i] = [p.lat, p.lng, p.w];
    }
    return out;
  }

  const api = {
    init, tick, heatPoints, outline,
    points: () => particles,
    zones: ZONES,
    get total() { return particles.length; },
  };
  return api;
})();
