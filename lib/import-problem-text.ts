const importProblemMessages: Record<string, string> = {
  'Canonical customer GUID unavailable in the master export.': "The party ledger on this invoice wasn't found in Tally's customer list.",
  'Canonical product GUID unavailable in the master export.': "A product on this invoice isn't in Tally's stock item list.",
  'Quantity/base-unit evidence unavailable.': 'A line has no quantity or unit.',
  'Alternative or composite unit requires a verified conversion.': 'A line uses an alternate unit without a set conversion.',
  'Inventory, GST, adjustments and party value do not reconcile.': "The invoice total doesn't match its items, GST and adjustments.",
  'Mixed economic signs require review.': 'The invoice mixes positive and negative lines.',
  'Unclassified document adjustment; configure its canonical ledger role.': "An extra ledger on this invoice (discount, freight or rounding) isn't classified yet.",
  'Unclassified inventory voucher type; configure its verified voucher role.': "This voucher type isn't set up as a sale, purchase or return.",
  'Accounting-only credit or voucher needs verified product/original-sale linkage.': "This document isn't linked to products or to the original sale.",
  'Economic amount is not exact decimal currency.': "An amount isn't an exact rupee value.",
  'Tally did not verify a zero-valued inventory amount.': "A zero-value line couldn't be verified in Tally.",
  'Zero-value amount evidence does not match the voucher revision and inventory line.': "A zero-value line doesn't match the invoice version.",
  'Cannot allocate a document adjustment over zero inventory value.': "An adjustment can't be spread over an invoice with no item value.",
  'Voucher GUID or AlterID unavailable.': "Tally didn't provide this voucher's identity.",
  'Numeric amount evidence lacks canonical voucher revision.': "Tally's amount export didn't match this invoice version.",
  'Ledger classification evidence unavailable.': "Ledger classification wasn't available from Tally.",
  'Incomplete voucher identity, lines or net economic values': 'Tally sent this document without complete lines or verified amounts.',
};
export function importProblemText(message: string): string {
  return Object.hasOwn(importProblemMessages, message) ? importProblemMessages[message] : message;
}
