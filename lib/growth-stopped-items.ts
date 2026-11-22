export type GrowthStoppedItem = {
  itemKey: string;
  itemName: string;
  usualMonthlyQuantity: number;
  unit: string | null;
  lastBilledOn: string;
  lastRatePaise: number | null;
};

export type GrowthStoppedItems = {
  labs: { labKey: string; items: GrowthStoppedItem[] }[];
};

type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Obj, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function parseGrowthStoppedItems(value: unknown): GrowthStoppedItems {
  const invalid = (): never => { throw new Error('Malformed growth stopped items response'); };
  if (!object(value) || !exactKeys(value, ['labs']) || !Array.isArray(value.labs) || value.labs.length < 1 || value.labs.length > 8) return invalid();
  const labKeys = new Set<string>();
  const labs = value.labs.map(lab => {
    if (!object(lab) || !exactKeys(lab, ['labKey', 'items']) || typeof lab.labKey !== 'string'
      || lab.labKey.length < 3 || lab.labKey.length > 300 || !lab.labKey.includes('|') || labKeys.has(lab.labKey)
      || !Array.isArray(lab.items) || lab.items.length > 3) return invalid();
    labKeys.add(lab.labKey);
    const itemKeys = new Set<string>();
    const items = lab.items.map(item => {
      if (!object(item) || !exactKeys(item, ['itemKey', 'itemName', 'usualMonthlyQuantity', 'unit', 'lastBilledOn', 'lastRatePaise'])
        || !text(item.itemKey) || itemKeys.has(item.itemKey) || !text(item.itemName)
        || typeof item.usualMonthlyQuantity !== 'number' || !Number.isFinite(item.usualMonthlyQuantity) || item.usualMonthlyQuantity <= 0
        || !(item.unit === null || typeof item.unit === 'string') || !date(item.lastBilledOn)
        || !(item.lastRatePaise === null || typeof item.lastRatePaise === 'number' && Number.isSafeInteger(item.lastRatePaise) && item.lastRatePaise >= 0)) return invalid();
      itemKeys.add(item.itemKey);
      return { itemKey: item.itemKey, itemName: item.itemName, usualMonthlyQuantity: item.usualMonthlyQuantity,
        unit: item.unit, lastBilledOn: item.lastBilledOn, lastRatePaise: item.lastRatePaise };
    });
    return { labKey: lab.labKey, items };
  });
  return { labs };
}
