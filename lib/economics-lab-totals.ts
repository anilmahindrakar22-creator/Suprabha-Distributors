import type { EconomicTarget } from '@/lib/instrument-economics-types';

export type LabMember = { id: string; name: string; capitalPaise: bigint; recoveryPaise: bigint; sharePercent: number; noReagentSales: boolean };
export type LabTotal = { key: string; customerName: string; members: LabMember[]; capitalPaise: bigint; recoveryPaise: bigint; outstandingPaise: bigint; surplusPaise: bigint };

export function labTotals(targets: EconomicTarget[], businessDate: string): LabTotal[] {
  const groups = new Map<string, EconomicTarget[]>();
  for (const target of targets) {
    if (target.approval !== 'approved' || target.effectiveFrom > businessDate || (target.effectiveTo != null && target.effectiveTo <= businessDate) || (target.pooledIn != null && target.pooledIn !== '')) continue;
    const key = `${target.companyId}|${target.customerId}`;
    const members = groups.get(key) ?? [];
    members.push(target);
    groups.set(key, members);
  }

  const result: LabTotal[] = [];
  for (const [key, targetsInLab] of groups) {
    if (targetsInLab.length < 2 || targetsInLab.some(target => !/^-?\d+$/.test(target.capitalPaise) || !/^-?\d+$/.test(target.recoveryPaise))) continue;
    const capitalPaise = targetsInLab.reduce((sum, target) => sum + BigInt(target.capitalPaise), BigInt(0));
    const recoveryPaise = targetsInLab.reduce((sum, target) => sum + BigInt(target.recoveryPaise), BigInt(0));
    const members = targetsInLab.map(target => ({
      id: target.id,
      name: target.name.endsWith(` · ${target.customerName}`) ? target.name.slice(0, -(` · ${target.customerName}`).length) : target.name,
      capitalPaise: BigInt(target.capitalPaise),
      recoveryPaise: BigInt(target.recoveryPaise),
      sharePercent: recoveryPaise <= BigInt(0) || BigInt(target.recoveryPaise) < BigInt(0) ? 0 : Number((BigInt(target.recoveryPaise) * BigInt(100) + recoveryPaise / BigInt(2)) / recoveryPaise),
      noReagentSales: target.reagentLifetime != null && target.reagentLifetime.lines === 0,
    })).sort((a, b) => a.recoveryPaise > b.recoveryPaise ? -1 : a.recoveryPaise < b.recoveryPaise ? 1 : 0);
    result.push({ key, customerName: targetsInLab[0].customerName, members, capitalPaise, recoveryPaise, outstandingPaise: capitalPaise > recoveryPaise ? capitalPaise - recoveryPaise : BigInt(0), surplusPaise: recoveryPaise > capitalPaise ? recoveryPaise - capitalPaise : BigInt(0) });
  }
  return result.sort((a, b) => a.outstandingPaise > b.outstandingPaise ? -1 : a.outstandingPaise < b.outstandingPaise ? 1 : a.customerName.localeCompare(b.customerName));
}
