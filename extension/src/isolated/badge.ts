let badgeEl: HTMLDivElement | null = null;

export function renderBadge(): void {
  if (badgeEl || !document.documentElement) return;
  badgeEl = document.createElement('div');
  badgeEl.id = 'pii-shield-badge';
  Object.assign(badgeEl.style, {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    zIndex: '2147483647',
    background: '#1f2937',
    color: 'white',
    padding: '6px 14px',
    borderRadius: '9999px',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    pointerEvents: 'none',
  });
  badgeEl.textContent = 'Nistar active';
  document.documentElement.appendChild(badgeEl);
}

export function updateBadge(state: { failSafe: boolean; hiddenCount?: number }): void {
  if (!badgeEl) renderBadge();
  if (!badgeEl) return;
  if (state.failSafe) {
    badgeEl.textContent =
      'Nistar: לא ניתן לאמת מול רשימת החברה כרגע, הופעלה הגנה בסיסית בלבד';
    badgeEl.style.background = '#b45309';
  } else if (state.hiddenCount !== undefined) {
    badgeEl.textContent =
      state.hiddenCount > 0 ? `Nistar: ${state.hiddenCount} פריטים הוסתרו בהודעה זו` : 'Nistar active';
    badgeEl.style.background = '#1f2937';
  }
}
