import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/cities.mjs ne_10m_populated_places_simple.geojson');
  process.exit(1);
}

const { features } = JSON.parse(readFileSync(input, 'utf8'));
const round = (n) => Math.round(n * 1e4) / 1e4;

const cities = features
  .map(({ properties: p }) => [
    p.name,
    p.nameascii && p.nameascii !== p.name ? p.nameascii : '',
    p.adm1name && p.adm1name !== p.name ? p.adm1name : '',
    p.adm0name ?? '',
    round(p.longitude),
    round(p.latitude),
    Math.max(0, p.pop_max ?? 0),
  ])
  .filter(([name]) => name)
  .sort((a, b) => b[6] - a[6]);

writeFileSync(new URL('../public/cities.json', import.meta.url), JSON.stringify(cities));
console.log(`Wrote ${cities.length} places`);
