/** Integer paise throughout; the largest allowed product is below MAX_SAFE_INTEGER. */
export function calculateTestVolume(testsPerDay: number, workingDaysPerMonth: number, paisePerTest: number, specialTestsPerMonth?: number, paisePerSpecialTest?: number): number | null {
  if ((specialTestsPerMonth === undefined) !== (paisePerSpecialTest === undefined)) return null;
  if (!Number.isInteger(testsPerDay) || testsPerDay < 1 || testsPerDay > 100000
    || !Number.isInteger(workingDaysPerMonth) || workingDaysPerMonth < 1 || workingDaysPerMonth > 31
    || !Number.isInteger(paisePerTest) || paisePerTest < 1 || paisePerTest > 100000000) return null;
  if (specialTestsPerMonth !== undefined && (!Number.isInteger(specialTestsPerMonth) || specialTestsPerMonth < 1 || specialTestsPerMonth > 1000000
    || !Number.isInteger(paisePerSpecialTest) || paisePerSpecialTest! < 1 || paisePerSpecialTest! > 100000000)) return null;
  return testsPerDay * workingDaysPerMonth * paisePerTest + (specialTestsPerMonth ?? 0) * (paisePerSpecialTest ?? 0);
}
