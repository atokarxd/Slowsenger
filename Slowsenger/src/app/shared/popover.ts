/**
 * Whether a popover inside root is open (a date or time picker's panel): Escape then belongs to that
 * popover, not to the dialog around it. Where :popover-open is not supported (jsdom), none is open.
 */
export function hasOpenPopover(root: Element): boolean {
  try {
    return !!root.querySelector(':popover-open');
  } catch {
    return false;
  }
}
