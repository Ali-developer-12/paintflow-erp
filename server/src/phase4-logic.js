function finiteNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

export function calculateProductionRequirements(formulaLines, batchQty, batchSize = 1) {
  const size = finiteNumber(batchSize, 1);
  const batch = finiteNumber(batchQty, 0);
  const multiplier = size > 0 ? batch / size : 0;

  const lines = (formulaLines || []).map((line) => {
    const value = finiteNumber(line?.value, 0);
    const rate = finiteNumber(line?.rate, 0);
    const qtyRequired = Number.isFinite(value) && Number.isFinite(multiplier) ? value * multiplier : 0;
    const amount = Number.isFinite(qtyRequired) && Number.isFinite(rate) ? qtyRequired * rate : 0;

    return {
      ...line,
      qtyRequired,
      amount,
      material_name: String(line?.material_name || ""),
    };
  });

  const totalMaterialCost = lines.reduce((sum, line) => {
    const amount = finiteNumber(line.amount, 0);
    return sum + amount;
  }, 0);

  return {
    batchMultiplier: Number.isFinite(multiplier) ? multiplier : 0,
    totalMaterialCost: Number.isFinite(totalMaterialCost) ? totalMaterialCost : 0,
    lines,
  };
}
