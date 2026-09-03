import type { OrderSummary } from './order-types';

export type InstalledAsset = {
  installationId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  tallyKey: string;
  itemName: string;
  serialNumber: string;
  installedAt: string;
  siteContact: string | null;
  engineerEmail: string | null;
  commissioningNotes: string | null;
};

export function installedAssetsFromOrders(orders: OrderSummary[]): InstalledAsset[] {
  return orders
    .flatMap((order) =>
      (order.installations || [])
        .filter((installation) => installation.status === 'completed' && installation.serialNumber && installation.completedAt)
        .map((installation) => ({
          installationId: installation.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          tallyKey: installation.tallyKey,
          itemName: installation.itemName,
          serialNumber: installation.serialNumber as string,
          installedAt: installation.completedAt as string,
          siteContact: installation.siteContact,
          engineerEmail: installation.engineerEmail,
          commissioningNotes: installation.commissioningNotes,
        })),
    )
    .sort((left, right) => right.installedAt.localeCompare(left.installedAt));
}

export function searchInstalledAssets(assets: InstalledAsset[], input: string) {
  const query = input.trim().toLocaleLowerCase('en-IN');
  if (!query) return assets;
  return assets.filter((asset) =>
    [asset.customerName, asset.customerPhone, asset.itemName, asset.serialNumber, asset.orderNumber, asset.siteContact]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('en-IN').includes(query)),
  );
}
