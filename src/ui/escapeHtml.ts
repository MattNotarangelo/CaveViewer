/**
 * Escape a string for safe interpolation into innerHTML. Anything derived
 * from a parsed survey file (labels, titles, metadata) MUST pass through
 * this before reaching the DOM — survey files are untrusted input.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
