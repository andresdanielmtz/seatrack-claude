# 🌊 Seatrack

**Live marine debris drift tracker.** Seatrack visualizes how floating debris
concentrates and circulates across the world's five subtropical ocean gyres —
the rotating currents that gather plastic into the "garbage patches."

![Seatrack](https://img.shields.io/badge/map-Leaflet%20%2B%20CARTO-14b8a6) ![No build](https://img.shields.io/badge/build-none-06b6d4)

## Features

- 🗺️ **Clean, structured basemap** (CARTO Positron / Dark Matter) — map-style,
  not satellite.
- 🌗 **Light / dark mode** toggle (remembers your choice).
- 🔴 **Live animated debris field** — thousands of particles drift on each zone's
  circulation, updating ~30×/second.
- 🔥 **Heat-density layer** showing where the largest quantities accumulate.
- 🌀 **Irregular, current-shaped zones** — not circles. Five subtropical gyres
  plus five smaller high-density clusters (Mediterranean, Bay of Bengal, Gulf &
  Caribbean, East China Sea, Arabian Sea).
- 📍 **Zone hotspots** with concentration estimates from published research.
- 🎛️ Toggle the heat, particle, and gyre-zone layers independently.
- 📊 Live stats panel + UTC clock.

## Run it

No build step, no dependencies to install. Serve the folder over HTTP (needed so
the browser can load the map tiles and modules cleanly):

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Then open <http://localhost:8000>.

## About the data

There is **no public feed of individual debris GPS positions** — that data
doesn't exist at that granularity. Seatrack instead models debris as particles
drifting on the five documented subtropical gyres (clockwise in the Northern
Hemisphere, counter-clockwise in the Southern). Concentration estimates are based
on published figures from **NOAA** and **The Ocean Cleanup**.

The data layer is fully isolated in [`js/data.js`](js/data.js) behind a small
interface (`Seatrack.init / tick / heatPoints / points / gyres`), so a real
observational feed can be connected by reimplementing that one file — the map and
UI need no changes.

## Project structure

```
seatrack/
├── index.html      # markup + panels
├── css/styles.css  # theming (blue/green accent) + components
└── js/
    ├── data.js     # gyre model + drift simulation  ← swap for a real feed
    └── app.js      # map, layers, animation, controls
```

## Credits

Basemaps © [CARTO](https://carto.com/attributions), © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors. Mapping by [Leaflet](https://leafletjs.com) +
[Leaflet.heat](https://github.com/Leaflet/Leaflet.heat).
