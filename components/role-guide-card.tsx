'use client';

import { roleGuide } from '@/lib/role-guide';

export function RoleGuideCard({ roles, onClose }: { roles: unknown; onClose: () => void }) {
  const guide = roleGuide(roles);
  return (
    <section aria-labelledby="role-guide-heading" className="mx-4 mt-2 shrink-0 rounded-xl border border-sf-line-soft bg-white p-3 text-sm text-sf-strong sm:mx-6">
      <h2 id="role-guide-heading" className="text-sm font-extrabold text-sf-ink">What you can do</h2>
      <p className="mt-1">Your roles: {guide.roleNames.join(', ')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span>Sections:</span>
        {guide.sections.map(name => <span key={name} className="rounded-full bg-sf-soft px-2 py-0.5 text-xs font-bold">{name}</span>)}
      </div>
      <h3 className="mt-2 text-sm font-bold text-sf-ink">You can:</h3>
      {guide.canDo.length
        ? <ul className="mt-1 list-disc space-y-0.5 pl-5">{guide.canDo.map(line => <li key={line}>{line}</li>)}</ul>
        : <p className="mt-1">You can view the sections above.</p>}
      <p className="mt-2 text-xs text-sf-muted">Need more access? Ask your administrator.</p>
      <button type="button" onClick={onClose} className="mt-2 min-h-11 rounded-lg border border-sf-line-soft px-3 text-sm font-bold">Got it</button>
    </section>
  );
}
