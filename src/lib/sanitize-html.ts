import DOMPurify from "isomorphic-dompurify";

export function sanitizeHtml(rawHtml: string) {
  return DOMPurify.sanitize(rawHtml);
}
