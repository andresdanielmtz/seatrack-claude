/* ============================================================
   Seatrack — app
   Map, theming, animated debris layers, gyre markers, stats.
   ============================================================ */

(() => {
  "use strict";

  const THEME_KEY = "seatrack-theme";
  const TILES = {
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  };
  const TILE_ATTR =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
    '&copy; <a href="https://carto.com/attributions">CARTO</a>';

  // ---- seed the data model ----
  Seatrack.init();

  // ---- map ----
  const map = L.map("map", {
    center: [22, -50],
    zoom: 3,
    minZoom: 2,
    maxZoom: 8,
    zoomControl: true,
    worldCopyJump: true,
    zoomAnimation: false, // keeps the canvas overlay pixel-aligned on zoom
    attributionControl: true,
  });
  L.control.attribution({ position: "bottomright" }).addTo(map);

  let currentTheme = localStorage.getItem(THEME_KEY) || "dark";
  document.documentElement.setAttribute("data-theme", currentTheme);

  let tileLayer = L.tileLayer(TILES[currentTheme], {
    subdomains: "abcd",
    attribution: TILE_ATTR,
    detectRetina: true,
    maxZoom: 8,
  }).addTo(map);

  // ---- heat layer (debris density) ----
  const heat = L.heatLayer(Seatrack.heatPoints(), {
    radius: 20,
    blur: 26,
    max: 1.15,
    minOpacity: 0.22,
    maxZoom: 8,
    gradient: {
      0.2: "#2dd4bf",
      0.4: "#22d3ee",
      0.6: "#eab308",
      0.8: "#f97316",
      1.0: "#ef4444",
    },
  }).addTo(map);

  // ---- accumulation zones + markers ----
  const zoneLayer = L.layerGroup().addTo(map);
  Seatrack.zones.forEach((z) => {
    const isGyre = z.type === "gyre";
    L.polygon(Seatrack.outline(z), {
      color: "#14b8a6",
      weight: isGyre ? 1.3 : 1,
      opacity: isGyre ? 0.5 : 0.45,
      dashArray: isGyre ? null : "3 4",
      fillColor: "#14b8a6",
      fillOpacity: isGyre ? 0.055 : 0.04,
      smoothFactor: 1.5,
      interactive: false,
    }).addTo(zoneLayer);

    const icon = L.divIcon({
      className: "gyre-marker" + (isGyre ? "" : " gyre-marker--cluster"),
      html: '<span class="gyre-marker__ring"></span>',
      iconSize: isGyre ? [16, 16] : [11, 11],
    });
    const spinTxt =
      Math.abs(z.spin) < 0.6 ? "gentle swirl" : z.spin > 0 ? "clockwise" : "counter-cw";
    L.marker([z.lat, z.lng], { icon })
      .bindPopup(
        `<div class="popup">
           <h3>${z.name}</h3>
           <p class="popup__sub">${isGyre ? "Subtropical gyre" : "Coastal cluster"} · ${z.sub}</p>
           <div class="popup__rows">
             <div><span>Concentration</span><b>${z.estimate}</b></div>
             <div><span>Extent</span><b>${z.area}</b></div>
             <div><span>Circulation</span><b>${spinTxt}</b></div>
             <div><span>Tracked here</span><b>${z.count.toLocaleString()}</b></div>
           </div>
         </div>`,
        { closeButton: true }
      )
      .addTo(zoneLayer);
  });

  // ---- animated particle canvas (overlay above the map) ----
  const canvas = document.createElement("canvas");
  canvas.id = "seatrack-particles";
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "450",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let showParticles = true;

  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  sizeCanvas();
  window.addEventListener("resize", sizeCanvas);

  // threshold colouring — fast for thousands of dots
  function colorFor(w) {
    const t = w / 1.15;
    if (t > 0.8) return "rgba(239,68,68,.9)";
    if (t > 0.6) return "rgba(249,115,22,.85)";
    if (t > 0.42) return "rgba(234,179,8,.8)";
    if (t > 0.24) return "rgba(34,211,238,.8)";
    return "rgba(45,212,191,.75)";
  }

  function drawParticles() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    if (!showParticles) return;
    const pts = Seatrack.points();
    const r = map.getZoom() >= 5 ? 2.3 : 1.7;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const cp = map.latLngToContainerPoint([p.lat, p.lng]);
      if (cp.x < -6 || cp.y < -6 || cp.x > w + 6 || cp.y > h + 6) continue;
      ctx.fillStyle = colorFor(p.w);
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, r, 0, 6.2832);
      ctx.fill();
    }
  }

  // ---- main loops ----
  // Draw every animation frame; advance the simulation on a fixed
  // cadence; refresh the (heavier) heat layer once a second.
  let lastSim = 0;
  let lastHeat = 0;
  function frame(ts) {
    if (ts - lastSim > 33) {       // ~30 sim updates / second
      Seatrack.tick();
      lastSim = ts;
    }
    drawParticles();
    if (ts - lastHeat > 1000) {    // refresh density once a second
      heat.setLatLngs(Seatrack.heatPoints());
      lastHeat = ts;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // redraw immediately while the user pans/zooms
  map.on("move zoom", drawParticles);

  // ---- stats ----
  const $ = (id) => document.getElementById(id);
  $("statTotal").textContent = Seatrack.total.toLocaleString();
  $("statZones").textContent = Seatrack.zones.length;
  const densest = Seatrack.zones.reduce((a, b) =>
    b.weight * b.count > a.weight * a.count ? b : a
  );
  $("statHot").textContent = densest.name;

  const clockEl = $("clock");
  function updateClock() {
    const d = new Date();
    clockEl.textContent =
      d.toISOString().substr(11, 8) + " UTC";
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ---- theme toggle ----
  $("themeBtn").addEventListener("click", () => {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", currentTheme);
    localStorage.setItem(THEME_KEY, currentTheme);
    map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(TILES[currentTheme], {
      subdomains: "abcd",
      attribution: TILE_ATTR,
      detectRetina: true,
      maxZoom: 8,
    }).addTo(map);
    tileLayer.bringToBack();
  });

  // ---- layer toggles ----
  $("tgHeat").addEventListener("change", (e) => {
    if (e.target.checked) heat.addTo(map);
    else map.removeLayer(heat);
  });
  $("tgParticles").addEventListener("change", (e) => {
    showParticles = e.target.checked;
  });
  $("tgZones").addEventListener("change", (e) => {
    if (e.target.checked) zoneLayer.addTo(map);
    else map.removeLayer(zoneLayer);
  });

  // ---- about modal ----
  const modal = $("aboutModal");
  $("aboutBtn").addEventListener("click", () => (modal.hidden = false));
  $("aboutClose").addEventListener("click", () => (modal.hidden = true));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modal.hidden = true;
  });
})();
