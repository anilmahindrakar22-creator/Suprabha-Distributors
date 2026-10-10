import { loadOfflineVault, resetOfflineVault } from '../lib/offline-vault-storage';
import { offlineOrderDocument, type OfflineOrderDocument } from '../lib/offline-order-document';
import { saveOfflineOrderDocument } from '../lib/offline-order-device';
import { confirmedOrderNumber, orderSubmissionTimeoutMs } from '../lib/order-submission';
import type { OfflineOrderDraft } from '../lib/offline-order-drafts';
import { resumeStaffSession } from '../lib/staff-session-client';

function element<T = HTMLElement>(id: string) { return document.getElementById(id) as T; }
const message = element('message');
const editor = element('editor');
const pinInput = element<HTMLInputElement>('pin');
const customer = element<HTMLSelectElement>('customer');
const product = element<HTMLSelectElement>('product');
let vault: OfflineOrderDocument | null = null;
let revision: string | null = null;
let pin = '';
let busy = false;
let generation = 0;
let editingKey: string | null = null;
let lines: Array<{ tallyKey: string; quantity: number }> = [];

function lock() {
  generation += 1; vault = null; revision = null; pin = ''; pinInput.value = ''; busy = false;
  lines = []; editingKey = null; editor.hidden = true;
  for (const id of ['account', 'drafts', 'lines', 'customer', 'product']) element(id).replaceChildren();
  element<HTMLFormElement>('order').reset();
  element<HTMLFormElement>('unlock').hidden = false;
  message.textContent = 'Locked. Unlock with your offline PIN.';
}
async function operation(callback: (ticket: number) => Promise<void>) {
  if (busy) return;
  busy = true;
  const ticket = generation;
  document.querySelectorAll('button').forEach((button) => { button.disabled = button.id !== 'lock'; });
  try { await callback(ticket); }
  catch (error) { if (ticket === generation) message.textContent = error instanceof Error ? error.message : 'Unable to complete this action. Saved drafts were retained.'; }
  finally {
    if (ticket === generation) busy = false;
    document.querySelectorAll('button').forEach((button) => { button.disabled = false; });
  }
}
function selectRows(select: HTMLSelectElement, rows: Array<{ value: string; label: string }>) {
  const previous = select.value;
  select.replaceChildren(new Option('Select…', ''), ...rows.slice(0, 100).map((row) => new Option(row.label, row.value)));
  if (rows.slice(0, 100).some((row) => row.value === previous)) select.value = previous;
}
function search() {
  if (!vault) return;
  const cq = element<HTMLInputElement>('customer-search').value.toLocaleLowerCase('en-IN');
  const pq = element<HTMLInputElement>('product-search').value.toLocaleLowerCase('en-IN');
  selectRows(customer, vault.customers.filter((row) => row.name.toLocaleLowerCase('en-IN').includes(cq)).map((row) => ({ value: row.id, label: row.name })));
  selectRows(product, vault.products.filter((row) => `${row.item} ${row.group}`.toLocaleLowerCase('en-IN').includes(pq)).map((row) => ({ value: row.tallyKey, label: `${row.item} (${row.baseUnit})` })));
}
function renderLines() {
  const list = element('lines'); list.replaceChildren();
  lines.forEach((line, index) => {
    const li = document.createElement('li');
    li.textContent = `${vault?.products.find((row) => row.tallyKey === line.tallyKey)?.item || line.tallyKey}: ${line.quantity} `;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
    remove.onclick = () => { if (!busy) { lines.splice(index, 1); renderLines(); } };
    li.appendChild(remove); list.appendChild(li);
  });
}
async function persist(next: OfflineOrderDocument, ticket: number) {
  const nextRevision = await saveOfflineOrderDocument(localStorage, next, pin, revision);
  if (ticket !== generation) return false;
  vault = next; revision = nextRevision; return true;
}
function renderDrafts() {
  const list = element('drafts'); list.replaceChildren();
  vault?.drafts.forEach((draft) => {
    const article = document.createElement('article');
    const label = document.createElement('p');
    label.textContent = `${draft.command.payload.customerName} · ${draft.command.payload.lines.length} lines · ${draft.state === 'pending' ? 'Submission unresolved — retry unchanged' : 'Not submitted'}`;
    article.appendChild(label);
    if (draft.state === 'draft') {
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit draft';
      edit.onclick = () => {
        if (busy || !vault) return;
        editingKey = draft.command.payload.idempotencyKey;
        lines = draft.command.payload.lines.map((line) => ({ ...line }));
        element<HTMLInputElement>('customer-search').value = draft.command.payload.customerName;
        search(); customer.value = draft.command.payload.customerId || '';
        element<HTMLTextAreaElement>('notes').value = draft.command.payload.notes || '';
        renderLines(); message.textContent = 'Editing saved draft. Save before sending.';
      };
      article.appendChild(edit);
    }
    const send = document.createElement('button'); send.type = 'button'; send.textContent = draft.state === 'pending' ? 'Verify account and retry' : 'Verify account and submit';
    send.onclick = () => void operation((ticket) => submit(draft, ticket));
    article.appendChild(send); list.appendChild(article);
  });
}
async function submit(draft: OfflineOrderDraft, ticket: number) {
  if (!vault || !navigator.onLine) throw new Error('Reconnect before submitting. Your draft remains saved.');
  const verify = () => fetch('/api/offline-session', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  let session = await verify();
  if (session.status === 401 && await resumeStaffSession()) session = await verify();
  const identity = await session.json() as { actorEmail?: string };
  if (!session.ok || identity.actorEmail !== vault.actorEmail) throw new Error('Sign in with the account that saved these drafts, then return and unlock.');
  if (ticket !== generation || !vault) return;
  const pending: OfflineOrderDraft = { ...draft, state: 'pending' };
  if (!await persist({ ...vault, drafts: vault.drafts.map((row) => row.command.payload.idempotencyKey === draft.command.payload.idempotencyKey ? pending : row) }, ticket)) return;
  renderDrafts();
  const headers = { 'content-type': 'application/json', 'x-stockflow-actor': draft.actorEmail };
  const response = await fetch('/api/orders', { method: 'POST', headers, body: JSON.stringify(pending.command), signal: AbortSignal.timeout(orderSubmissionTimeoutMs) });
  const body = await response.json().catch(() => null);
  let number = response.ok ? confirmedOrderNumber(body) : null;
  if (response.status === 409) {
    const recovery = await fetch('/api/orders/recovery', { method: 'POST', headers, body: JSON.stringify({ idempotencyKey: pending.command.payload.idempotencyKey }), signal: AbortSignal.timeout(orderSubmissionTimeoutMs) });
    const receipt = await recovery.json() as { status?: string };
    number = recovery.ok && receipt.status === 'accepted' ? confirmedOrderNumber(receipt) : null;
  }
  if (!number) throw new Error('Submission is unresolved. Draft and original retry key were retained. Sign in if needed, then retry unchanged.');
  if (ticket !== generation || !vault) return;
  if (!await persist({ ...vault, drafts: vault.drafts.filter((row) => row.command.payload.idempotencyKey !== pending.command.payload.idempotencyKey) }, ticket)) return;
  renderDrafts(); message.textContent = `Order ${number} confirmed saved. Stock and pricing remain governed online.`;
}

element<HTMLFormElement>('unlock').onsubmit = (event) => {
  event.preventDefault();
  void operation(async (ticket) => {
    const entered = pinInput.value;
    const saved = await loadOfflineVault(localStorage, entered, true);
    if (ticket !== generation) return;
    if (!saved || !saved.value || typeof saved.value !== 'object') throw new Error('Prepare this device online first.');
    const actor = (saved.value as { actorEmail?: unknown }).actorEmail;
    if (typeof actor !== 'string') throw new Error('Invalid offline account.');
    vault = offlineOrderDocument(saved.value, actor); revision = saved.revision; pin = entered; pinInput.value = '';
    element('account').textContent = `Offline drafts for ${actor} · catalogue prepared ${vault.preparedAt}`;
    element<HTMLFormElement>('unlock').hidden = true; editor.hidden = false;
    search(); renderDrafts(); message.textContent = 'Unlocked locally. No online sign-in or stock availability is implied.';
  });
};
element('add').onclick = () => {
  if (!vault || busy) return;
  const quantity = element<HTMLInputElement>('quantity').valueAsNumber;
  if (!product.value || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000 || lines.length >= 50) { message.textContent = 'Choose a product and whole quantity (1–1,000,000); maximum 50 lines.'; return; }
  if (lines.some((line) => line.tallyKey === product.value)) { message.textContent = 'Product already added. Remove its line to change quantity.'; return; }
  lines.push({ tallyKey: product.value, quantity }); renderLines();
};
element<HTMLFormElement>('order').onsubmit = (event) => {
  event.preventDefault();
  void operation(async (ticket) => {
    if (!vault) return;
    const selected = vault.customers.find((row) => row.id === customer.value);
    if (!selected || !lines.length) throw new Error('Select a downloaded customer and add at least one product.');
    const prior = editingKey ? vault.drafts.find((row) => row.command.payload.idempotencyKey === editingKey) : null;
    if (editingKey && (!prior || prior.state !== 'draft')) throw new Error('Unresolved submissions cannot be edited.');
    if (!editingKey && vault.drafts.length >= 100) throw new Error('Submit existing drafts before adding more (limit 100).');
    const draft: OfflineOrderDraft = { schemaVersion: 1, actorEmail: vault.actorEmail, state: 'draft', updatedAt: new Date().toISOString(), command: { action: 'create_order', payload: {
      ...(prior?.command.payload.customerId === selected.id ? prior.command.payload : { priority: prior?.command.payload.priority, expectedDeliveryDate: prior?.command.payload.expectedDeliveryDate }),
      idempotencyKey: editingKey || crypto.randomUUID(), customerId: selected.id, customerName: selected.name, source: prior?.command.payload.source || 'phone', lines: lines.map((line) => ({ ...line })), notes: element<HTMLTextAreaElement>('notes').value,
    } } };
    const next = offlineOrderDocument({ ...vault, drafts: [...vault.drafts.filter((row) => row.command.payload.idempotencyKey !== editingKey), draft] }, vault.actorEmail);
    if (!await persist(next, ticket)) return;
    editingKey = null; lines = []; element<HTMLFormElement>('order').reset(); search(); renderLines(); renderDrafts();
    message.textContent = 'Encrypted draft saved — not submitted.';
  });
};
element('lock').onclick = lock;
element('reset').onclick = () => {
  if (!confirm('Reset encrypted offline data? ALL unsent encrypted drafts will be permanently lost. This cannot be undone.')) return;
  void operation(async () => { await resetOfflineVault(localStorage); lock(); message.textContent = 'Encrypted offline data reset. Original legacy drafts, if any, were not deleted.'; });
};
element('customer-search').oninput = search;
element('product-search').oninput = search;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') lock(); });
window.addEventListener('pagehide', lock);
window.addEventListener('storage', lock);
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
