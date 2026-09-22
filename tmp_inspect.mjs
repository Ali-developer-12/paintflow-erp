import Database from 'better-sqlite3';
const db = new Database('./server/data/paint-erp.db');
for (const table of ['productions','production_consumptions','stock_ledger','factory_items','item_particulars','formulas']) {
  console.log('\nTABLE', table);
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  console.log(JSON.stringify(cols, null, 2));
}
console.log('\nFORMULA ROWS');
console.log(db.prepare('SELECT * FROM formulas').all());
console.log('\nPRODUCTION ROWS');
console.log(db.prepare('SELECT * FROM productions').all());
