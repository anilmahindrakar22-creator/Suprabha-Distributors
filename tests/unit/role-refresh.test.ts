import { describe, expect, it } from 'vitest';
import { hasUnsavedInput, sameRoles } from '@/lib/role-refresh';

describe('sameRoles', () => {
  it('compares role sets without regard to order', () => {
    expect(sameRoles(['sales', 'billing'], ['billing', 'sales'])).toBe(true);
    expect(sameRoles(['sales'], ['sales', 'billing'])).toBe(false);
  });
});

describe('hasUnsavedInput', () => {
  it('detects changed values and explicit unsaved markers in forms', () => {
    const input = { tagName: 'INPUT', type: 'text', value: 'saved', defaultValue: 'saved' };
    const textarea = { tagName: 'TEXTAREA', value: 'saved', defaultValue: 'saved' };
    const options = [{ selected: true, defaultSelected: true }, { selected: false, defaultSelected: false }];
    const select = { tagName: 'SELECT', options };
    const doc = fakeDocument([input, textarea, select]);
    expect(hasUnsavedInput(doc)).toBe(false);
    input.value = 'changed';
    expect(hasUnsavedInput(doc)).toBe(true);
    input.value = 'saved';
    options[0].selected = false;
    options[1].selected = true;
    expect(hasUnsavedInput(doc)).toBe(true);
    const marked = fakeDocument([], true);
    expect(hasUnsavedInput(marked)).toBe(true);
  });

  it('detects checkbox state changes and ignores controls outside forms', () => {
    const checkbox = { tagName: 'INPUT', type: 'checkbox', checked: false, defaultChecked: false };
    const doc = fakeDocument([checkbox]);
    expect(hasUnsavedInput(doc)).toBe(false);
    checkbox.checked = true;
    expect(hasUnsavedInput(doc)).toBe(true);
  });
});

function fakeDocument(fields: object[], marked = false): Document {
  return {
    querySelector: () => marked ? ({} as Element) : null,
    querySelectorAll: () => fields as Element[],
  } as unknown as Document;
}
