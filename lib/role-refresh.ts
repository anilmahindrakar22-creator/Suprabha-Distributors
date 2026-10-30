export function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every(role => b.includes(role));
}

export function hasUnsavedInput(doc: Document): boolean {
  if (doc.querySelector('[data-unsaved="true"]')) return true;
  for (const node of Array.from(doc.querySelectorAll('form input, form textarea, form select'))) {
    const field = node as unknown as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (field.tagName === 'INPUT' && ((field as HTMLInputElement).type === 'checkbox' || (field as HTMLInputElement).type === 'radio')) {
      const input = field as HTMLInputElement;
      if (input.checked !== input.defaultChecked) return true;
    } else if (field.tagName === 'SELECT') {
      if (Array.from((field as HTMLSelectElement).options).some(option => option.selected !== option.defaultSelected)) return true;
    } else if (field.tagName === 'TEXTAREA') {
      const textarea = field as HTMLTextAreaElement;
      if (textarea.value !== textarea.defaultValue) return true;
    } else {
      const input = field as HTMLInputElement;
      if (input.value !== input.defaultValue) return true;
    }
  }
  return false;
}
