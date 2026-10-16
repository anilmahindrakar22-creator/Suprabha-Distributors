export type TallyRecentProducts = {
  customerId: string;
  linked: boolean;
  billCount: number;
  products: Array<{ tallyKey: string; billCount: number; lastBilledAt: string; lastQuantity: number }>;
};
