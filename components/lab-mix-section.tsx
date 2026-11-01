'use client';

import { Fragment, useId, useRef, useState } from 'react';
import { Microscope } from 'lucide-react';
import { StatusChip } from '@/components/ui/glance';
import { formatCustomerDate } from '@/lib/customer-map';
import { bandLabel, type LabMix, type LabMixInput, type LabMixOptions } from '@/lib/lab-mix';

type Area = NonNullable<LabMixInput['areas']>[number];
type Panel = NonNullable<LabMixInput['panels']>[number];
type Busiest = NonNullable<LabMixInput['busiest']>;
export type LabMixFormState = {
  areas: Partial<Record<Area['area'], Area | null>>;
  busiest: Busiest | null;
  panels: Partial<Record<Panel['panel'], Panel | null>>;
};

export function buildLabMixPayload(state: LabMixFormState) {
  const areas = Object.values(state.areas).filter((row): row is Area => !!row);
  const panels = Object.values(state.panels).filter((row): row is Panel => !!row);
  return { areas, busiest: areas.some(row => row.area === 'IMMUNO' && row.status === 'in_house') ? state.busiest : null, panels };
}

function initialState(report: LabMix | null | undefined): LabMixFormState {
  return {
    areas: Object.fromEntries((report?.areas ?? []).map(row => [row.area, row.status === 'in_house'
      ? { area: row.area, status: row.status, ...(row.exact ? { exact: row.min! } : { min: row.min!, max: row.max }) }
      : { area: row.area, status: row.status }])),
    busiest: report?.busiest ? { test: report.busiest.test, ...(report.busiest.exact ? { exact: report.busiest.min } : { min: report.busiest.min, max: report.busiest.max }) } : null,
    panels: Object.fromEntries((report?.panels ?? []).map(row => [row.panel, { panel: row.panel, status: row.status }])),
  };
}

const choiceBaseClass = 'min-h-11 rounded-lg border px-2.5 py-1 text-left text-xs break-words disabled:opacity-50';
const choiceClass = (selected: boolean) => `${choiceBaseClass} ${selected ? 'border-sf-brand bg-sf-soft font-semibold' : 'border-sf-line'}`;
const buttonClass = 'min-h-11 rounded-lg border border-sf-line px-3 py-2 text-sm disabled:opacity-50';
const inputClass = 'min-h-11 w-full min-w-0 rounded-lg border border-sf-line bg-white px-3 text-sm';
type Count = { exact: number } | { min: number; max: number | null };

function CountChoices({ name, bands, value, onChange }: {
  name: string; bands: LabMixOptions['busiestBands']; value: Count | null; onChange: (value: Count | null) => void;
}) {
  const [showExact, setShowExact] = useState(!!value && 'exact' in value);
  const id = useId();
  return <>
    {bands.map(band => {
      const selected = !!value && 'min' in value && value.min === band.min && value.max === band.max;
      return <button key={band.min} type="button" aria-pressed={selected} aria-label={`${name}: ${bandLabel(band.min, band.max)} per day`} className={choiceClass(selected)} onClick={() => { setShowExact(false); onChange(selected ? null : band); }}>{bandLabel(band.min, band.max)}</button>;
    })}
    <button type="button" aria-label={`${name}: Exact`} aria-pressed={!!value && 'exact' in value} aria-expanded={showExact} className={choiceClass(!!value && 'exact' in value)} onClick={() => setShowExact(value => !value)}>{value && 'exact' in value ? `${value.exact}/day` : 'Exact…'}</button>
    {showExact ? <div className="w-full min-w-0"><label htmlFor={id} className="block text-xs">Exact tests per day for {name}</label><input id={id} type="number" inputMode="numeric" min={1} max={100000} step={1} className={inputClass} value={value && 'exact' in value ? value.exact : ''} onChange={event => {
        const count = Number(event.target.value);
        onChange(Number.isInteger(count) && count >= 1 && count <= 100000 ? { exact: count } : null);
      }} /></div> : null}
  </>;
}

export function LabMixSection({ customerId, labMix, options, disabled, runCommand }: {
  customerId: string; labMix?: LabMix | null; options: LabMixOptions; disabled: boolean;
  runCommand: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<LabMixFormState>(() => initialState(labMix));
  const [test, setTest] = useState<Busiest['test']>(labMix?.busiest?.test ?? 'TSH');
  const testId = useId();
  const submitting = useRef(false);
  const payload = buildLabMixPayload(state);
  const immuno = state.areas.IMMUNO?.status === 'in_house';
  function setArea(code: Area['area'], row: Area | null) {
    setState(previous => ({ ...previous, areas: { ...previous.areas, [code]: row }, busiest: code === 'IMMUNO' && row?.status !== 'in_house' ? null : previous.busiest }));
    if (code === 'IMMUNO' && row?.status !== 'in_house') setTest('TSH');
  }
  const fit = { vidas: 'VIDAS fit', clia: 'CLIA fit', none: 'No immunoassay in-house', check: 'Check hormone volume', unknown: '' };
  const sentOut = labMix?.panels.filter(row => row.status === 'sent_out').map(row => row.name) ?? [];
  return <section aria-label="Test mix" className="min-w-0 space-y-2 text-sm">
    {labMix ? <>
      <div className="flex flex-wrap items-center gap-2"><h4 className="text-xs text-sf-muted">Test mix · {formatCustomerDate(labMix.reportedOn)} · {labMix.reportedBy.split('@')[0]}</h4>{labMix.stale ? <StatusChip icon={Microscope} tone="warning">Re-check</StatusChip> : null}</div>
      {labMix.areas.map(row => <p key={row.area}>{row.name} {row.status === 'in_house' ? `${row.exact ? row.min : bandLabel(row.min!, row.max)}/day` : row.status === 'sends_out' ? 'sends out' : 'not done'}</p>)}
      {labMix.fit !== 'unknown' ? <p>{fit[labMix.fit]}{labMix.busiest ? ` · Busiest: ${labMix.busiest.name} ${bandLabel(labMix.busiest.min, labMix.busiest.max)}/day` : ''}</p> : null}
      {labMix.packWasteRisk === true ? <p className="text-xs text-sf-danger opacity-80">CLIA pack-waste risk: busiest test under {options.policy.packWastePerDay}/day</p> : null}
      {sentOut.length ? <p>Sends out: {sentOut.join(', ')}</p> : null}
    </> : <p className="text-sf-muted">Ask: tests a day in each area?</p>}
    {!editing ? <div className="flex flex-wrap gap-2">
      {labMix ? <button type="button" className={buttonClass} disabled={disabled} onClick={() => void runCommand({ action: 'confirm_lab_mix', customerId, previousReportId: labMix.reportId })}>No change</button> : null}
      <button type="button" className={buttonClass} disabled={disabled} onClick={() => { setState(initialState(labMix)); setTest(labMix?.busiest?.test ?? 'TSH'); setEditing(true); }}>{labMix ? 'Update' : 'Add test mix'}</button>
    </div> : <form aria-label="Test mix" onSubmit={async event => {
      event.preventDefault(); if (submitting.current || disabled || (!payload.areas.length && !payload.panels.length)) return;
      submitting.current = true;
      try { if (await runCommand({ action: 'record_lab_mix', customerId, ...payload })) setEditing(false); }
      finally { submitting.current = false; }
    }}>
      <fieldset disabled={disabled} className="min-w-0 space-y-3">
        {options.areas.map(area => {
          const row = state.areas[area.code];
          return <Fragment key={area.code}><div data-area-row className="min-w-0 space-y-2">
            <p>{area.name}{area.brandsHint ? <span className="text-xs text-sf-muted"> · {area.brandsHint}</span> : null}</p>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {(['not_done', 'sends_out'] as const).map(status => <button key={status} type="button" className={choiceClass(row?.status === status)} aria-pressed={row?.status === status} aria-label={`${area.name}: ${status === 'not_done' ? 'not done' : 'sends out'}`} onClick={() => setArea(area.code, row?.status === status ? null : { area: area.code, status })}>{status === 'not_done' ? 'Not done' : 'Sends out'}</button>)}
              <CountChoices name={area.name} bands={area.bands} value={row?.status === 'in_house' ? row : null} onChange={count => setArea(area.code, count ? { area: area.code, status: 'in_house', ...count } : null)} />
            </div>
          </div>
          {area.code === 'IMMUNO' && immuno ? <div className="min-w-0 space-y-2 pl-3 border-l border-sf-line-soft">
            <label htmlFor={testId} className="block">Busiest hormone test</label>
            <select id={testId} value={test} className={inputClass} onChange={event => { const value = event.target.value as Busiest['test']; setTest(value); setState(previous => ({ ...previous, busiest: previous.busiest ? { ...previous.busiest, test: value } : null })); }}>{options.tests.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
            <div className="flex min-w-0 flex-wrap gap-1.5"><CountChoices name="Busiest hormone test" bands={options.busiestBands} value={state.busiest} onChange={count => setState(previous => ({ ...previous, busiest: count ? { test, ...count } : null }))} /></div>
          </div> : null}</Fragment>;
        })}
        <details><summary className="min-h-11 cursor-pointer py-3">Special tests (optional)</summary><div className="space-y-3">{options.panels.map(panel => <div key={panel.code} className="space-y-1"><p>{panel.name}</p><div className="flex flex-wrap gap-1.5">{(['in_house', 'sent_out', 'not_offered'] as const).map(status => {
          const label = { in_house: 'In-house', sent_out: 'Sent out', not_offered: 'Not offered' }[status];
          const selected = state.panels[panel.code]?.status === status;
          return <button key={status} type="button" aria-pressed={selected} aria-label={`${panel.name}: ${label.toLowerCase()}`} className={choiceClass(selected)} onClick={() => setState(previous => ({ ...previous, panels: { ...previous.panels, [panel.code]: selected ? null : { panel: panel.code, status } } }))}>{label}</button>;
        })}</div></div>)}</div></details>
        <div className="sticky bottom-0 bg-white py-2 border-t border-sf-line-soft flex flex-wrap gap-2"><button type="submit" className={buttonClass} disabled={disabled || (!payload.areas.length && !payload.panels.length)}>Save</button><button type="button" className={buttonClass} onClick={() => setEditing(false)}>Cancel</button></div>
      </fieldset>
    </form>}
  </section>;
}
