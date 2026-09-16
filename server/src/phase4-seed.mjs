import Database from 'better-sqlite3';

const db = new Database('c:/Users/Arslan/paintflow-erp/server/data/paint-erp.db');

let rawA = db.prepare('SELECT * FROM factory_items WHERE name = ?').get('Solvent');
if (!rawA) {
  const { lastInsertRowid } = db.prepare('INSERT INTO factory_items (code, name, unit, rate, stock_qty, min_qty, max_qty, category, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime(\'now\'))').run('RM-SOLV-1', 'Solvent', 'KG', 15, 0, 0, 0, 'Raw');
  rawA = db.prepare('SELECT * FROM factory_items WHERE id = ?').get(lastInsertRowid);
}

let rawB = db.prepare('SELECT * FROM factory_items WHERE name = ?').get('Pigment');
if (!rawB) {
  const { lastInsertRowid } = db.prepare('INSERT INTO factory_items (code, name, unit, rate, stock_qty, min_qty, max_qty, category, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime(\'now\'))').run('RM-PIG-1', 'Pigment', 'KG', 40, 0, 0, 0, 'Raw');
  rawB = db.prepare('SELECT * FROM factory_items WHERE id = ?').get(lastInsertRowid);
}

let item = db.prepare('SELECT * FROM items WHERE name = ?').get('Test Paint Item');
if (!item) {
  const { lastInsertRowid } = db.prepare('INSERT INTO items (code, name, category, remarks, is_active, created_at) VALUES (?, ?, ?, ?, 1, datetime(\'now\'))').run('ITEM-TEST-1', 'Test Paint Item', 'Paint', 'Phase 4 test');
  item = db.prepare('SELECT * FROM items WHERE id = ?').get(lastInsertRowid);
}

let particular = db.prepare('SELECT * FROM item_particulars WHERE item_id = ? AND type = ?').get(item.id, 'Gallon');
if (!particular) {
  const { lastInsertRowid } = db.prepare('INSERT INTO item_particulars (item_id, type, weight_unit, cost_price, ws_price, sale_price, stock_qty, min_qty, max_qty, formula_code, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime(\'now\'))').run(item.id, 'Gallon', '3.5 KG', 0, 0, 0, 0, 0, 0, 'TP-1');
  particular = db.prepare('SELECT * FROM item_particulars WHERE id = ?').get(lastInsertRowid);
}

let formula = db.prepare('SELECT * FROM formulas WHERE particular_id = ?').get(particular.id);
if (!formula) {
  const { lastInsertRowid } = db.prepare('INSERT INTO formulas (particular_id, code, batch_size, total_cost, remarks, updated_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))').run(particular.id, 'F-TP-1', 1, 0, '');
  formula = db.prepare('SELECT * FROM formulas WHERE id = ?').get(lastInsertRowid);
}

db.prepare('DELETE FROM formula_lines WHERE formula_id = ?').run(formula.id);
db.prepare('INSERT INTO formula_lines (formula_id, factory_item_id, material_name, value, rate, cost_value, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)').run(formula.id, rawA.id, 'Solvent', 2, 15, 30, 1);
db.prepare('INSERT INTO formula_lines (formula_id, factory_item_id, material_name, value, rate, cost_value, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)').run(formula.id, rawB.id, 'Pigment', 0.5, 40, 20, 2);

console.log(JSON.stringify({ item: item.id, particular: particular.id, formula: formula.id, rawA: rawA.id, rawB: rawB.id }));
