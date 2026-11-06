const { Database } = require('node-sqlite3-wasm');
const fs = require('node:fs');
const db = new Database('data/civis.db');
db.exec('PRAGMA foreign_keys = OFF');

// Build SQL statements
const upazilaCenters = {
  'Habiganj Sadar': [24.37, 91.42],
  'Madhabpur': [24.25, 91.55],
  'Nabiganj': [24.23, 91.25],
  'Chunarughat': [24.33, 91.28],
  'Baniachong': [24.58, 91.57],
  'Bahubal': [24.27, 91.58],
  'Lakhai': [24.42, 91.55],
  'Ajmiriganj': [24.32, 91.30],
  'Shayestaganj': [24.37, 91.48],
  'Maulvibazar Sadar': [24.12, 91.58],
  'Kulaura': [24.15, 91.72],
  'Sreemangal': [24.30, 91.70],
  'Kamalganj': [24.35, 91.52],
  'Barlekha': [24.45, 91.65],
  'Rajnagar': [24.08, 91.52],
  'Juri': [24.18, 91.47],
  'Sunamganj Sadar': [25.07, 91.40],
  'Chhatak': [24.92, 91.22],
  'Jagannathpur': [24.85, 91.15],
  'Dharampasha': [24.88, 91.30],
  'Derai': [24.75, 91.22],
  'Dowarabazar': [24.88, 91.55],
  'Shantiganj': [24.98, 91.32],
  'Tahirpur': [25.15, 91.15],
  'Bishwambarpur': [25.12, 91.05],
  'Jamalganj': [24.99, 91.12],
  'Sulla': [24.85, 91.58],
  'Sylhet Sadar': [24.90, 91.87],
  'Beanibazar': [24.85, 92.05],
  'Golapganj': [24.93, 92.07],
  'Kanaighat': [24.92, 92.15],
  'Zakiganj': [25.05, 92.15],
  'Gowainghat': [24.87, 92.20],
  'Dakshin Surma': [24.89, 91.88],
  'Bishwanath': [24.95, 92.12],
  'Osmaninagar': [24.98, 92.05],
  'Jaintiapur': [25.10, 91.98],
  'Balaganj': [24.85, 92.00],
  'Companiganj': [25.03, 91.93],
  'Fenchuganj': [24.93, 91.95],
  'Kotwali': [24.90, 91.87],
  'Shahparan': [24.97, 91.78],
  'Airport': [24.91, 91.86],
};

const districtCenters = {
  'Habiganj': [24.3745, 91.4155],
  'Maulvibazar': [24.1167, 91.5833],
  'Sunamganj': [25.0658, 91.395],
  'Sylhet': [24.8949, 91.8687],
};

const statements = [];
const select = db.prepare("SELECT id, upazila, district FROM registry_facilities WHERE lat IS NULL AND lng IS NULL");
const rows = select.all();
let count = 0;
for (const row of rows) {
  let center = upazilaCenters[row.upazila || ''] || null;
  if (!center && row.district) {
    center = districtCenters[row.district];
  }
  if (center) {
    statements.push(`UPDATE registry_facilities SET lat = ${center[0]}, lng = ${center[1]}, location_status = 'approximate' WHERE id = '${row.id}' AND lat IS NULL AND lng IS NULL;`);
    count++;
  }
}

console.log(`Generated ${count} UPDATE statements`);

// Write to a SQL file and execute
const sql = statements.join('\n');
fs.writeFileSync('scripts/_geocode.sql', sql);

// Execute the SQL
db.exec(sql);
console.log(`Executed ${count} updates`);

// Verify
const verify = db.all('SELECT COUNT(*) as cnt FROM registry_facilities WHERE lat IS NOT NULL AND lng IS NOT NULL');
console.log('Now have coords:', verify[0].cnt);

// Show samples
const samples = db.all("SELECT name, lat, lng, district, upazila, facility_category, phone FROM registry_facilities WHERE lat IS NOT NULL AND lng IS NOT NULL LIMIT 10");
samples.forEach(s => console.log(s.name, '|', s.lat.toFixed(4), s.lng.toFixed(4), '|', s.district, '|', s.upazila, '|', s.facility_category, '| phone:', s.phone));

// Also check district hospital count
const dh = db.all("SELECT COUNT(*) as cnt FROM registry_facilities WHERE facility_category = 'district_hospital' AND lat IS NOT NULL");
console.log('District hospitals with coords:', dh[0].cnt);

db.close();
