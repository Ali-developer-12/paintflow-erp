import test from "node:test";
import assert from "node:assert/strict";
import { calculateProductionRequirements } from "./phase4-logic.js";

test("calculateProductionRequirements multiplies formula lines by batch size and totals material cost", () => {
  const result = calculateProductionRequirements(
    [
      { id: 1, material_name: "Solvent", value: 2, rate: 15 },
      { id: 2, material_name: "Pigment", value: 0.5, rate: 40 },
    ],
    4,
    1,
  );

  assert.deepEqual(result.lines.map((line) => ({
    material_name: line.material_name,
    qtyRequired: Number(line.qtyRequired),
    amount: Number(line.amount),
  })), [
    { material_name: "Solvent", qtyRequired: 8, amount: 120 },
    { material_name: "Pigment", qtyRequired: 2, amount: 80 },
  ]);
  assert.equal(result.totalMaterialCost, 200);
  assert.equal(result.batchMultiplier, 4);
});

test("calculateProductionRequirements handles fractional batch quantities without generating NaN or Infinity", () => {
  const result = calculateProductionRequirements(
    [
      { id: 1, material_name: "Solvent", value: 2, rate: 15 },
      { id: 2, material_name: "Pigment", value: 2, rate: 15 },
    ],
    1,
    10,
  );

  assert.equal(result.batchMultiplier, 0.1);
  assert.deepEqual(
    result.lines.map((line) => ({
      material_name: line.material_name,
      qtyRequired: Number(line.qtyRequired),
      amount: Number(line.amount),
    })),
    [
      { material_name: "Solvent", qtyRequired: 0.2, amount: 3 },
      { material_name: "Pigment", qtyRequired: 0.2, amount: 3 },
    ],
  );
  assert.equal(result.totalMaterialCost, 6);
  assert.ok(Number.isFinite(result.batchMultiplier));
  assert.ok(result.lines.every((line) => Number.isFinite(Number(line.qtyRequired)) && Number.isFinite(Number(line.amount))));
});
