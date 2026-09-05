# 0026 — A map is a picture the platform draws, from public-domain tiles

- **Date:** 2026-09-05
- **Status:** Accepted (built 2026-09-05, Marketing slice 10)
- **Affects:** Marketing (the `map` section, `SiteSettings.map`,
  `src/lib/sites/map.ts` and `map-core.ts`, three map routes, the proxy's
  rewrite), `docs/security.md` trust boundaries
- **Builds on:** [0019](0019-a-website-is-pages-of-typed-sections.md)
  (the public page's scripts are few and library-free),
  [0024](0024-a-look-is-a-preset-and-its-fonts-are-the-platforms.md) (a
  visitor's browser asks no third party for anything), the Land pack's
  basemap decision (`src/packs/land/core/basemap.ts`: public-domain USGS
  tiles rather than a commercial basemap, US-only accepted)

## Context

"Where are you?" is the third thing a visitor wants from a small business's
site. MapLibre is already in the repo, drawing the Land pack's aerial, so
the obvious build was an interactive map on the public page. Three things
argued against it, and one against every commercial alternative.

1. **The page's scripts.** ADR 0019 keeps a public page's client code to a
   few small, library-free islands. MapLibre is a large library, loaded for
   a picture that nobody pans.
2. **Who the visitor's browser talks to.** ADR 0024 settled that a visitor's
   browser asks the platform for what a page needs and nobody else. An
   interactive map fetches its tiles from the tile server directly, from the
   visitor's address, on every page view.
3. **Licences.** Google, Mapbox and MapTiler serve maps under terms a
   commercial multi-tenant product has to hold and keys it has to keep;
   OpenStreetMap's own tile servers forbid use by an application without
   its own infrastructure, and its data carries an attribution obligation.
   The Land pack faced the same question and chose USGS's public-domain
   imagery, US-only, for a reason that has not changed.
4. **Geocoding** is the same question again: an address has to become a
   point, once, and the services that do it well are the ones with terms.

## Decision

**A map is a picture the platform draws, from public-domain data.**

- **The pin is placed once, when the details are saved.** The Census
  Bureau's geocoder (public data, no key, no agreement) turns the site's
  address into a pin kept on the settings with the address it was placed
  from; a changed address is placed again on save, and a miss stays a
  miss — no city-level guess about where a business is. The Website screen
  says where the map stands.
- **The picture is drawn on request and cached like a photo.** The server
  fetches the USGS Topo tiles (The National Map, public domain, roads and
  names, zoom 0 to 16) that cover a 960×540 window around the pin,
  stitches them with `sharp`, lays the marker on top in the brand colour,
  and serves WebP under the photo routes' public cache headers. The
  picture's address carries a hash of the pin, the zoom and the colour, so
  a moved pin is a new address and every cache forgets the old one by
  itself; a key the site does not hold is a 404. The draft preview reads
  the same picture through a member route.
- **The section holds only how to show it**: a zoom (town, neighborhood,
  street), whether to print the address, and whether to offer a
  `Get directions` link, which opens the visitor's own maps app and is the
  one outbound step, taken by the visitor's choice.
- **United States only, accepted.** Both services cover the US and nothing
  else, as the Land pack's imagery does. An address elsewhere is "not on
  the map" and the section still prints the address and offers directions.
- **Attribution is a courtesy here, and shown anyway**: `Map: USGS The
  National Map` under the picture.

## Consequences

- No client library reaches a public page; the map is one `<img>`.
- A cold picture costs the server up to twenty tile fetches once per pin,
  zoom and colour; the edge holds it for a week and the browser for an
  hour, the same as a photo.
- A business outside the United States has an address and directions, not
  a picture, until a second source with the same standing is found; a
  tenant-level basemap override, as the Land pack has, is the shape that
  would take.
- The Census geocoder's first match is trusted. An ambiguous address
  ("17 Main St" in a town with two of them) may pin the wrong one; the
  screen shows the matched address so the owner can see it and make the
  address more specific.
