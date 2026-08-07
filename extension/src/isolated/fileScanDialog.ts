const ENTITY_TYPE_LABELS: Record<string, string> = {
  name: 'שמות',
  id_number: 'מספרי ת.ז.',
  case_number: 'מספרי תיק',
  amount: 'סכומים',
  email: 'כתובות מייל',
  phone: 'מספרי טלפון',
};

function countsByType(entityTypes: string[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of entityTypes) counts.set(t, (counts.get(t) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([type, count]) => ({ label: ENTITY_TYPE_LABELS[type] ?? type, count }))
    .sort((a, b) => b.count - a.count);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeButton(label: string, variant: 'primary' | 'secondary'): HTMLButtonElement {
  return el(
    'button',
    {
      flex: '1',
      padding: '10px 16px',
      borderRadius: '10px',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      border: variant === 'primary' ? 'none' : '1px solid #d1d5db',
      background: variant === 'primary' ? '#dc2626' : 'white',
      color: variant === 'primary' ? 'white' : '#374151',
    },
    label,
  );
}

/**
 * Shared shell for both dialog variants below: overlay + card + fileName
 * line + a "בטל / המשך בכל זאת" button row, resolving `true` (proceed) or
 * `false` (cancelled - also the default for clicking the backdrop, since
 * cancelling is always the safe choice). `buildBody` fills in the part
 * that differs between "found sensitive data" and "couldn't scan".
 */
function showDialog(params: {
  fileName: string;
  title: string;
  buildBody: (card: HTMLDivElement) => void;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el('div', {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      background: 'rgba(15, 23, 42, 0.55)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif',
    });

    const card = el('div', {
      background: 'white',
      borderRadius: '16px',
      padding: '24px',
      maxWidth: '420px',
      width: '90%',
      boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
      direction: 'rtl',
      textAlign: 'right',
    });
    overlay.appendChild(card);

    card.appendChild(el('h2', { margin: '0 0 8px', fontSize: '17px', fontWeight: '700', color: '#111827' }, params.title));
    card.appendChild(
      el(
        'p',
        { margin: '0 0 12px', fontSize: '12px', color: '#6b7280', wordBreak: 'break-all', direction: 'ltr', textAlign: 'right' },
        params.fileName,
      ),
    );

    params.buildBody(card);

    const buttonRow = el('div', { display: 'flex', gap: '10px' });
    const cancelBtn = makeButton('בטל העלאה', 'secondary');
    const proceedBtn = makeButton('המשך בכל זאת', 'primary');
    buttonRow.appendChild(proceedBtn);
    buttonRow.appendChild(cancelBtn);
    card.appendChild(buttonRow);

    function close(result: boolean) {
      overlay.remove();
      resolve(result);
    }
    cancelBtn.addEventListener('click', () => close(false));
    proceedBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });

    document.documentElement.appendChild(overlay);
  });
}

/**
 * spec principle for this feature: files can't be reliably redacted in
 * place the way text can, so this is *informed blocking* - tell the user
 * exactly what kind of thing was found (never the raw values themselves,
 * consistent with the rest of the product never surfacing what it
 * matched against) and let them decide, rather than silently substituting
 * or silently sending.
 */
export function showFileScanDialog(params: {
  fileName: string;
  hiddenCount: number;
  hiddenEntityTypes: string[];
}): Promise<boolean> {
  return showDialog({
    fileName: params.fileName,
    title: 'נמצא מידע רגיש בקובץ',
    buildBody: (card) => {
      card.appendChild(
        el(
          'p',
          { margin: '0 0 10px', fontSize: '14px', color: '#374151', lineHeight: '1.5' },
          `זוהו ${params.hiddenCount} פריטי מידע רגיש בקובץ הזה, לפני שהוא נשלח לכלי ה-AI:`,
        ),
      );
      const list = el('ul', { margin: '0 0 16px', paddingRight: '20px', fontSize: '13px', color: '#4b5563' });
      for (const { label, count } of countsByType(params.hiddenEntityTypes)) {
        list.appendChild(el('li', {}, `${label}: ${count}`));
      }
      card.appendChild(list);
      card.appendChild(
        el(
          'p',
          { margin: '0 0 18px', fontSize: '12px', color: '#9ca3af', lineHeight: '1.5' },
          'לא ניתן להסתיר אוטומטית רק את החלק הרגיש בתוך קובץ - הבחירה היא לבטל את ההעלאה, או להמשיך על אחריותכם.',
        ),
      );
    },
  });
}

/** Shown when a file couldn't be parsed at all (corrupted, encrypted, unsupported variant) - a distinct, honest state from "scanned and found nothing." */
export function showFileScanFailedDialog(params: { fileName: string; reason: string }): Promise<boolean> {
  return showDialog({
    fileName: params.fileName,
    title: 'לא ניתן היה לבדוק את הקובץ',
    buildBody: (card) => {
      card.appendChild(
        el(
          'p',
          { margin: '0 0 18px', fontSize: '14px', color: '#374151', lineHeight: '1.5' },
          `הקובץ לא נסרק בהצלחה (${params.reason}), ולכן לא ניתן לאשר שאין בו מידע רגיש.`,
        ),
      );
    },
  });
}
