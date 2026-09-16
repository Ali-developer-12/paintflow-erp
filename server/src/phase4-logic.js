export function calculateProductionRequirements(formulaLines, batchQty, batchSize = 1) {
  const size = Number(batchSize || 1);
  const batch = Number(batchQty || 0);
  const multiplier = size > 0 ? batch / size : 0;

  const lines = (formulaLines || []).map((line) => {
    const value = Number(line?.value ?? 0);
    const rate = Number(line?.rate ?? 0);
    const qtyRequired = value * multiplier;
    const amount = qtyRequired * rate;

    return {
      ...line,
      qtyRequired,
      amount,
      material_name: String(line?.material_name || ""),
    };
  });

  const totalMaterialCost = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);

  return {
    batchMultiplier: multiplier,
    totalMaterialCost,
    lines,
  };
}
