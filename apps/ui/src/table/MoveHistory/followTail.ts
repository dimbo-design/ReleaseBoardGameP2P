// How far from the bottom still counts as "at the tail" — about two rows, so a
// fractional scroll position or a part-rendered row does not stop the follow.
export const FOLLOW_SLACK = 48

/**
 * Keep the newest entry in view. The log reads oldest-first, so an arriving
 * entry lands below the fold — but only a reader who is already at the bottom
 * wants to be carried along. One scrolled up is reading, and moving the page
 * under them is worse than letting the new row wait.
 */
export function followTail(el: HTMLElement, slack: number = FOLLOW_SLACK): void {
  if (el.scrollHeight - el.scrollTop - el.clientHeight < slack) el.scrollTop = el.scrollHeight
}
