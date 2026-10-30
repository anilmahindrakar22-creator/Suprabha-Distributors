/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The visual contract requires custom tracks and an SVG with explicit meter/img roles. */
import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'confirm' | 'pack' | 'bill';

const tones: Record<Tone, { foreground: string; soft: string; fill: string }> = {
  success: { foreground: 'text-sf-success', soft: 'bg-sf-success-soft', fill: 'bg-sf-success' },
  warning: { foreground: 'text-sf-warning', soft: 'bg-sf-warning-soft', fill: 'bg-sf-warning' },
  danger: { foreground: 'text-sf-danger', soft: 'bg-sf-danger-soft', fill: 'bg-sf-danger' },
  info: { foreground: 'text-sf-info', soft: 'bg-sf-info-soft', fill: 'bg-sf-info' },
  neutral: { foreground: 'text-sf-muted', soft: 'bg-sf-soft', fill: 'bg-sf-muted' },
  confirm: { foreground: 'text-sf-stage-confirm', soft: 'bg-sf-stage-confirm-soft', fill: 'bg-sf-stage-confirm' },
  pack: { foreground: 'text-sf-stage-pack', soft: 'bg-sf-stage-pack-soft', fill: 'bg-sf-stage-pack' },
  bill: { foreground: 'text-sf-stage-bill', soft: 'bg-sf-stage-bill-soft', fill: 'bg-sf-stage-bill' },
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function ToneIcon({ icon: Icon, tone, size = 'md' }: {
  icon: LucideIcon; tone: Tone; size?: 'sm' | 'md';
}) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full ${tones[tone].foreground} ${tones[tone].soft} ${size === 'sm' ? 'size-8' : 'size-11'}`}>
      <Icon aria-hidden="true" className={size === 'sm' ? 'size-4' : 'size-5'} />
    </span>
  );
}

export function MeterBar({ value, target, tone, label }: {
  value: number | null; target?: number; tone: Tone; label: string;
}) {
  const percent = value === null ? undefined : clamp(value) * 100;
  return (
    <div className="min-w-0 space-y-1 text-xs text-sf-body">
      <div className="flex flex-wrap justify-between gap-x-2">
        <span>{label}</span>
        <span>{percent === undefined ? 'Awaiting Tally' : `${Math.round(percent)}%`}</span>
      </div>
      <div role="meter" aria-label={value === null ? `${label}: awaiting data` : label}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
        className={`relative h-2 rounded-full ${value === null ? 'border border-dashed border-sf-line bg-transparent' : 'bg-sf-soft'}`}>
        {percent !== undefined && <div aria-hidden="true" className={`h-full rounded-full ${tones[tone].fill}`} style={{ width: `${percent}%` }} />}
        {target !== undefined && <span aria-hidden="true" className="absolute top-0 h-2 w-0.5 -translate-x-1/2 bg-sf-ink" style={{ left: `${clamp(target) * 100}%` }} />}
      </div>
    </div>
  );
}

export function CountdownBar({ daysLeft, horizonDays, label }: {
  daysLeft: number; horizonDays: number; label: string;
}) {
  const tone: Tone = daysLeft < 0 ? 'danger' : daysLeft <= horizonDays / 3 ? 'warning' : 'info';
  const description = daysLeft < 0 ? `ended ${Math.abs(daysLeft)} days ago` : `${daysLeft} days left of ${horizonDays}`;
  const elapsed = daysLeft < 0 || horizonDays <= 0 ? 1 : clamp(1 - daysLeft / horizonDays);
  return (
    <div className="min-w-0 space-y-1 text-xs text-sf-body">
      <div className="flex flex-wrap justify-between gap-x-2"><span>{label}</span><span>{description}</span></div>
      <div role="img" aria-label={`${label}: ${description}`} className="h-2 overflow-hidden rounded-full bg-sf-soft">
        <div aria-hidden="true" className={`h-full rounded-full ${tones[tone].fill}`} style={{ width: `${elapsed * 100}%` }} />
      </div>
    </div>
  );
}

export function StatusChip({ icon: Icon, tone, children, count }: {
  icon: LucideIcon; tone: Tone; children: ReactNode; count?: number;
}) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs ${tones[tone].foreground} ${tones[tone].soft}`}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
      {count !== undefined && <span className="font-semibold tabular-nums">{count}</span>}
    </span>
  );
}

export type GlanceStage = { key: string; icon: LucideIcon; label: string; count: number; tone: Tone };

export function StageStrip({ stages }: { stages: GlanceStage[] }) {
  return (
    <div className="grid min-w-0 grid-cols-[repeat(var(--stage-count),minmax(0,1fr))] gap-2 max-[360px]:grid-cols-3"
      style={{ '--stage-count': Math.max(1, stages.length) } as CSSProperties}>
      {stages.map(stage => (
        <div key={stage.key} className="flex min-w-0 flex-col items-center gap-1 text-center">
          <ToneIcon icon={stage.icon} tone={stage.tone} />
          <span className="text-2xl font-semibold tabular-nums text-sf-ink">{stage.count}</span>
          <span className="w-full break-words text-xs text-sf-body">{stage.label}</span>
        </div>
      ))}
    </div>
  );
}
