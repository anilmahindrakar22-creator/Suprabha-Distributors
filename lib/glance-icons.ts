import {
  ArrowRight, CircleCheck, CircleHelp, CircleSlash, ClipboardList, CreditCard,
  Crown, FileBadge, FileSearch, FlaskConical, Footprints, Handshake, IndianRupee,
  LayoutGrid, Lock, Microscope, Package, PackagePlus, PackageSearch, PackageX,
  PhoneCall, Presentation, ReceiptText, Stethoscope, Target, TrendingDown,
  TriangleAlert, Truck, User, Wallet, Wrench, type LucideIcon,
} from 'lucide-react';
import type { ActionType } from '@/lib/wallet-action-types';
import type { ConstraintCategory } from '@/lib/wallet-diagnosis-types';

export type OrderStage = 'confirm' | 'waiting_for_stock' | 'pack' | 'bill' | 'dispatch' | 'delivered' | 'stuck';
export const stageIcons: Record<OrderStage, LucideIcon> = {
  confirm: PhoneCall, waiting_for_stock: PackageSearch, pack: Package,
  bill: ReceiptText, dispatch: Truck, delivered: CircleCheck, stuck: TriangleAlert,
};

export type CommercialConcept = 'lab' | 'wallet' | 'gap' | 'on_target' | 'lock_in' | 'tender' | 'open_question' | 'decider' | 'contact' | 'influence';
export const commercialIcons: Record<CommercialConcept, LucideIcon> = {
  lab: FlaskConical, wallet: Wallet, gap: TrendingDown, on_target: Target,
  lock_in: Lock, tender: FileBadge, open_question: CircleHelp, decider: Crown,
  contact: User, influence: ArrowRight,
};

export const constraintIcons: Record<ConstraintCategory, LucideIcon> = {
  price: IndianRupee, portfolio: LayoutGrid, instrument: Microscope, service: Wrench,
  relationship: Handshake, credit: CreditCard, availability: PackageX,
  clinical: Stethoscope, contract_tender: FileBadge, competitor_lock_in: Lock, unknown: CircleHelp,
};

export const actionIcons: Record<ActionType, LucideIcon> = {
  visit: Footprints, demo: Presentation, get_competitor_proof: FileSearch,
  add_product: PackagePlus, fix_service: Wrench, fix_supply: Truck,
  instrument_proposal: Microscope, credit_terms: CreditCard, price_review: IndianRupee,
  no_action: CircleSlash,
};

export type PurchasingConcept = 'po' | 'tally_receipt';
export const purchasingIcons: Record<PurchasingConcept, LucideIcon> = {
  po: ClipboardList, tally_receipt: ReceiptText,
};
