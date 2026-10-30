import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PhoneCall } from 'lucide-react';
import { CountdownBar, MeterBar, StageStrip, StatusChip, ToneIcon, type Tone } from '@/components/ui/glance';
import { actionIcons, commercialIcons, constraintIcons, purchasingIcons, stageIcons } from '@/lib/glance-icons';

describe('glance tone vocabulary', () => {
  it.each([
    ['success', 'sf-success', 'sf-success-soft'],
    ['warning', 'sf-warning', 'sf-warning-soft'],
    ['danger', 'sf-danger', 'sf-danger-soft'],
    ['info', 'sf-info', 'sf-info-soft'],
    ['neutral', 'sf-muted', 'sf-soft'],
    ['confirm', 'sf-stage-confirm', 'sf-stage-confirm-soft'],
    ['pack', 'sf-stage-pack', 'sf-stage-pack-soft'],
    ['bill', 'sf-stage-bill', 'sf-stage-bill-soft'],
  ] as const)('maps %s to semantic foreground, tint and fill', (tone: Tone, color, soft) => {
    const icon = renderToStaticMarkup(<ToneIcon icon={PhoneCall} tone={tone} />);
    expect(icon).toContain(`text-${color}`);
    expect(icon).toContain(`bg-${soft}`);
    expect(icon).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(renderToStaticMarkup(<MeterBar value={0.5} tone={tone} label="Share" />)).toContain(`bg-${color}`);
    const chip = renderToStaticMarkup(<StatusChip icon={PhoneCall} tone={tone}>Ready</StatusChip>);
    expect(chip).toContain(`text-${color}`);
    expect(chip).toContain(`bg-${soft}`);
  });

  it('supports both icon sizes and a chip count of zero', () => {
    expect(renderToStaticMarkup(<ToneIcon icon={PhoneCall} tone="confirm" size="sm" />)).toContain('size-8');
    expect(renderToStaticMarkup(<ToneIcon icon={PhoneCall} tone="confirm" size="md" />)).toContain('size-11');
    const chip = renderToStaticMarkup(<StatusChip icon={PhoneCall} tone="confirm" count={0}>Confirm</StatusChip>);
    expect(chip).toContain('Confirm');
    expect(chip).toMatch(/>0<\/span>/);
    expect(chip).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});

describe('MeterBar', () => {
  it('exposes percentage aria values and hides the target tick', () => {
    const html = renderToStaticMarkup(<MeterBar value={0.74} target={0.8} tone="success" label="Wallet share" />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="Wallet share"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="74"');
    expect(html).toContain('width:74%');
    expect(html).toMatch(/<span aria-hidden="true"[^>]*w-0\.5[^>]*left:80%/);
  });

  it('renders unknown data as a dashed empty track awaiting Tally', () => {
    const html = renderToStaticMarkup(<MeterBar value={null} tone="success" label="Wallet share" />);
    expect(html).toContain('aria-label="Wallet share: awaiting data"');
    expect(html).toContain('Awaiting Tally');
    expect(html).toContain('border-dashed');
    expect(html).not.toContain('aria-valuenow');
    expect(html).not.toContain('width:');
    expect(html).not.toContain('bg-sf-success');
  });

  it.each([[0, 0], [1, 100], [-0.2, 0], [1.2, 100]])('bounds value %s to %s percent', (value, percent) => {
    const html = renderToStaticMarkup(<MeterBar value={value} tone="info" label="Share" />);
    expect(html).toContain(`aria-valuenow="${percent}"`);
    expect(html).not.toContain('Awaiting Tally');
  });
});

describe('CountdownBar', () => {
  it.each([
    [-10, 'danger', 'ended 10 days ago'],
    [0, 'warning', '0 days left of 120'],
    [40, 'warning', '40 days left of 120'],
    [41, 'info', '41 days left of 120'],
    [74, 'info', '74 days left of 120'],
    [120, 'info', '120 days left of 120'],
  ])('uses the correct tone and label at %s days', (daysLeft, tone, description) => {
    const html = renderToStaticMarkup(<CountdownBar daysLeft={daysLeft as number} horizonDays={120} label="Contract" />);
    expect(html).toContain('role="img"');
    expect(html).toContain(`aria-label="Contract: ${description}"`);
    expect(html).toContain(`bg-sf-${tone}`);
  });

  it.each([[-10, 100], [0, 100], [30, 75], [120, 0], [150, 0]])('fills the elapsed share for %s days', (daysLeft, percent) => {
    const html = renderToStaticMarkup(<CountdownBar daysLeft={daysLeft} horizonDays={120} label="Contract" />);
    expect(html).toContain(`width:${percent}%`);
  });

  it('handles a zero horizon without invalid geometry', () => {
    const html = renderToStaticMarkup(<CountdownBar daysLeft={0} horizonDays={0} label="Question" />);
    expect(html).toContain('width:100%');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});

describe('StageStrip', () => {
  it('uses equal shrinkable columns and three columns below 360px', () => {
    const html = renderToStaticMarkup(<StageStrip stages={[
      { key: 'confirm', icon: stageIcons.confirm, label: 'Confirm', count: 12, tone: 'confirm' },
      { key: 'pack', icon: stageIcons.pack, label: 'Pick/pack', count: 0, tone: 'pack' },
    ]} />);
    expect(html).toContain('grid-cols-[repeat(var(--stage-count),minmax(0,1fr))]');
    expect(html).toContain('max-[360px]:grid-cols-3');
    expect(html).toContain('--stage-count:2');
    expect(html).toContain('break-words text-xs');
    expect(html).toContain('Confirm');
    expect(html).toContain('Pick/pack');
    expect(html).toMatch(/>12<\/span>/);
    expect(html).toMatch(/>0<\/span>/);
  });
});

describe('glance icon maps', () => {
  it.each([
    ['stage', stageIcons, ['confirm', 'waiting_for_stock', 'pack', 'bill', 'dispatch', 'delivered', 'stuck']],
    ['commercial', commercialIcons, ['lab', 'wallet', 'gap', 'on_target', 'lock_in', 'tender', 'open_question', 'decider', 'contact', 'influence']],
    ['constraint', constraintIcons, ['price', 'portfolio', 'instrument', 'service', 'relationship', 'credit', 'availability', 'clinical', 'contract_tender', 'competitor_lock_in', 'unknown']],
    ['action', actionIcons, ['visit', 'demo', 'get_competitor_proof', 'add_product', 'fix_service', 'fix_supply', 'instrument_proposal', 'credit_terms', 'price_review', 'no_action']],
    ['purchasing', purchasingIcons, ['po', 'tally_receipt']],
  ] as const)('resolves every %s key to an icon component', (_name, icons, keys) => {
    expect(Object.keys(icons).sort()).toEqual([...keys].sort());
    for (const Icon of Object.values(icons)) {
      const html = renderToStaticMarkup(<Icon aria-hidden="true" />);
      expect(html).toContain('<svg');
      expect(html).toContain('aria-hidden="true"');
    }
  });
});
