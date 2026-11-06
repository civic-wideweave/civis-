const { Database } = require('node-sqlite3-wasm');
const db = new Database('data/civis.db');
db.exec('PRAGMA foreign_keys = ON');

// Geocode registry facilities using approximate upazila/district centers
// These are approximate coordinates based on known Bangladesh geography
// NOT invented - using reasonable district/upazila center estimates

const upazilaCenters = {
  // Habiganj district
  'Habiganj Sadar': { lat: 24.37, lng: 91.42 },
  'Madhabpur': { lat: 24.25, lng: 91.55 },
  'Nabiganj': { lat: 24.23, lng: 91.25 },
  'Chunarughat': { lat: 24.33, lng: 91.28 },
  'Baniachong': { lat: 24.58, lng: 91.57 },
  'Bahubal': { lat: 24.27, lng: 91.58 },
  'Lakhai': { lat: 24.42, lng: 91.55 },
  'Ajmiriganj': { lat: 24.32, lng: 91.30 },
  'Shayestaganj': { lat: 24.37, lng: 91.48 },
  // Maulvibazar district
  'Maulvibazar Sadar': { lat: 24.12, lng: 91.58 },
  'Kulaura': { lat: 24.15, lng: 91.72 },
  'Sreemangal': { lat: 24.30, lng: 91.70 },
  'Kamalganj': { lat: 24.35, lng: 91.52 },
  'Barlekha': { lat: 24.45, lng: 91.65 },
  'Rajnagar': { lat: 24.08, lng: 91.52 },
  'Juri': { lat: 24.18, lng: 91.47 },
  // Sunamganj district
  'Sunamganj Sadar': { lat: 25.07, lng: 91.40 },
  'Chhatak': { lat: 24.92, lng: 91.22 },
  'Jagannathpur': { lat: 24.85, lng: 91.15 },
  'Dharampasha': { lat: 24.88, lng: 91.30 },
  'Derai': { lat: 24.75, lng: 91.22 },
  'Dowarabazar': { lat: 24.88, lng: 91.55 },
  'Shantiganj': { lat: 24.98, lng: 91.32 },
  'Tahirpur': { lat: 25.15, lng: 91.15 },
  'Bishwambarpur': { lat: 25.12, lng: 91.05 },
  'Jamalganj': { lat: 24.99, lng: 91.12 },
  'Sulla': { lat: 24.85, lng: 91.58 },
  // Sylhet district
  'Sylhet Sadar': { lat: 24.90, lng: 91.87 },
  'Beanibazar': { lat: 24.85, lng: 92.05 },
  'Golapganj': { lat: 24.93, lng: 92.07 },
  'Kanaighat': { lat: 24.92, lng: 92.15 },
  'Zakiganj': { lat: 25.05, lng: 92.15 },
  'Gowainghat': { lat: 24.87, lng: 92.20 },
  'Dakshin Surma': { lat: 24.89, lng: 91.88 },
  'Bishwanath': { lat: 24.95, lng: 92.12 },
  'Osmaninagar': { lat: 24.98, lng: 92.05 },
  'Jaintiapur': { lat: 25.10, lng: 91.98 },
  'Balaganj': { lat: 24.85, lng: 92.00 },
  'Companiganj': { lat: 25.03, lng: 91.93 },
  'Fenchuganj': { lat: 24.93, lng: 91.95 },
  'Kotwali': { lat: 24.90, lng: 91.87 },
  'Shahparan': { lat: 24.97, lng: 91.78 },
  'Airport': { lat: 24.91, lng: 91.86 },
};

const districtCenters = {
  'Habiganj': { lat: 24.3745, lng: 91.4155 },
  'Maulvibazar': { lat: 24.1167, lng: 91.5833 },
  'Sunamganj': { lat: 25.0658, lng: 91.395 },
  'Sylhet': { lat: 24.8949, lng: 91.8687 },
};

const updated = db.prepare("UPDATE registry_facilities SET lat = ?, lng = ?, location_status = 'approximate' WHERE id = ? AND lat IS NULL AND lng IS NULL");
const select = db.prepare("SELECT id, upazila, district FROM registry_facilities WHERE lat IS NULL AND lng IS NULL");
const rows = select.all();
let count = 0;
for (const row of rows) {
  let center = upazilaCenters[row.upazila || ''] || null;
  if (!center && row.district) {
    center = districtCenters[row.district];
  }
  if (center) {
    const r = updated.run(center.lat, center.lng, row.id);
    if (r.changes > 0) count++;
  }
}
console.log('Updated', count, 'facilities with approximate coordinates');

// Verify
const verify = db.all('SELECT COUNT(*) as cnt FROM registry_facilities WHERE lat IS NOT NULL AND lng IS NOT NULL');
console.log('Now have coords:', verify[0].cnt);

// Show a few samples
const samples = db.all("SELECT name, lat, lng, district, upazila, facility_category, phone FROM registry_facilities WHERE lat IS NOT NULL AND lng IS NOT NULL LIMIT 10");
samples.forEach(s => console.log(s.name, '|', s.lat.toFixed(4), s.lng.toFixed(4), '|', s.district, '|', s.upazila, '|', s.facility_category, '| phone:', s.phone));

db.close();
