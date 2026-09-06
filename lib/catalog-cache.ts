import type { CatalogItem } from './order-types';

type CatalogStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type CachedCatalog = {
  schemaVersion: 1;
  actorEmail: string;
  catalogVersion: string;
  catalog: CatalogItem[];
};

const prefix = 'stockflow:catalog:v1:';

function key(actorEmail: string) {
  return `${prefix}${actorEmail.trim().toLocaleLowerCase('en-IN')}`;
}

export function readCatalogCache(
  storage: CatalogStorage,
  actorEmail: string,
  catalogVersion: string,
) {
  try {
    const cacheKey = key(actorEmail);
    const cached = JSON.parse(
      storage.getItem(cacheKey) || 'null',
    ) as Partial<CachedCatalog> | null;
    const normalizedEmail = actorEmail.trim().toLocaleLowerCase('en-IN');
    if (
      !cached ||
      cached.schemaVersion !== 1 ||
      cached.actorEmail?.trim().toLocaleLowerCase('en-IN') !==
        normalizedEmail ||
      cached.catalogVersion !== catalogVersion ||
      !Array.isArray(cached.catalog)
    ) {
      storage.removeItem(cacheKey);
      return null;
    }
    return cached.catalog as CatalogItem[];
  } catch {
    storage.removeItem(key(actorEmail));
    return null;
  }
}

export function writeCatalogCache(
  storage: CatalogStorage,
  actorEmail: string,
  catalogVersion: string,
  catalog: CatalogItem[],
) {
  const cached: CachedCatalog = {
    schemaVersion: 1,
    actorEmail: actorEmail.trim().toLocaleLowerCase('en-IN'),
    catalogVersion,
    catalog,
  };
  storage.setItem(key(actorEmail), JSON.stringify(cached));
}
