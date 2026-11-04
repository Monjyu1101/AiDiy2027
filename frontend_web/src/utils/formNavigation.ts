// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const isEnterAsTabTarget = (target: HTMLElement) => {
  if (target.isContentEditable) return false;

  const tagName = target.tagName.toLowerCase();
  if (tagName === 'textarea') return false;
  if (tagName === 'select') return true;
  if (tagName !== 'input') return false;

  const input = target as HTMLInputElement;
  const excludedTypes = new Set([
    'button',
    'submit',
    'reset',
    'checkbox',
    'radio',
    'file',
    'range',
    'color',
    'image',
    'hidden'
  ]);
  return !excludedTypes.has((input.type || 'text').toLowerCase());
};

const getFocusableElements = (root: ParentNode) => {
  return Array.from(
    root.querySelectorAll<HTMLElement>('input, select, textarea, button, [tabindex]')
  ).filter((element) => {
    if (element.tabIndex < 0) return false;
    if ('disabled' in element && element.disabled) return false;
    if ('readOnly' in element && element.readOnly) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (element.offsetParent === null && style.position !== 'fixed') return false;

    return true;
  });
};

export const handleEnterAsTab = (event: KeyboardEvent) => {
  if (event.key !== 'Enter' || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;

  const target = event.target as HTMLElement | null;
  if (!target || !isEnterAsTabTarget(target)) return;

  const root = target.closest('form');
  if (!root) return;

  event.preventDefault();

  const focusables = getFocusableElements(root);
  const currentIndex = focusables.indexOf(target);
  if (currentIndex < 0) return;

  const step = event.shiftKey ? -1 : 1;
  const nextElement = focusables[currentIndex + step];
  nextElement?.focus();
};

const globalEnterAsTabHandler = (event: KeyboardEvent) => {
  handleEnterAsTab(event);
};

export const installGlobalEnterAsTab = () => {
  document.addEventListener('keydown', globalEnterAsTabHandler, true);
};
