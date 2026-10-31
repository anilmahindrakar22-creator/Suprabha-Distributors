/** Integer paise throughout; the largest allowed product is below MAX_SAFE_INTEGER. */
export function calculateTestVolume(testsPerDay: number, workingDaysPerMonth: number, paisePerTest: number): number | null {
  if (!Number.isInteger(testsPerDay) || testsPerDay < 1 || testsPerDay > 100000
    || !Number.isInteger(workingDaysPerMonth) || workingDaysPerMonth < 1 || workingDaysPerMonth > 31
    || !Number.isInteger(paisePerTest) || paisePerTest < 1 || paisePerTest > 100000000) return null;
  return testsPerDay * workingDaysPerMonth * paisePerTest;
}
