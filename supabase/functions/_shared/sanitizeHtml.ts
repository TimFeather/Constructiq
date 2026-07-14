// Minimal allow-list HTML sanitizer for embedding staff-authored rich text
// (tender Description, authored via the RichTextEditor/Quill component) into
// outbound emails. Deno edge functions have no DOM available, so a full
// DOMPurify pass can't run here — this hand-rolls the same allow-list policy,
// scoped to Quill's limited toolbar (bold/italic/underline/lists/colour).
//
// Any tag not in the allow-list is stripped (its inner text is kept); <script>/
// <style>/<iframe>/<object>/<embed> are removed together with their content.
// Every surviving tag is rewritten from scratch with none of its original
// attributes — except <span>, which keeps a sanitised `style` limited to a
// single `color: ...` declaration — so no event-handler attribute or
// javascript:/data: URL can survive.
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'u', 'b', 'i', 'ol', 'ul', 'li', 'span']);

function sanitizeStyleAttr(styleValue: string): string {
  const m = styleValue.match(/color\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[a-zA-Z]+)/);
  return m ? `color: ${m[1]}` : '';
}

export function sanitizeHtmlForEmail(html: string): string {
  if (!html) return '';

  // Drop dangerous elements together with their content.
  let out = html.replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '');

  // Rewrite every remaining tag, keeping only allow-listed ones.
  out = out.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, rawTag, attrs) => {
    const tag = String(rawTag).toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';

    const isClosing = match.startsWith('</');
    if (isClosing) return `</${tag}>`;

    if (tag === 'span') {
      const styleMatch = attrs.match(/style\s*=\s*"([^"]*)"/i) || attrs.match(/style\s*=\s*'([^']*)'/i);
      const safeStyle = styleMatch ? sanitizeStyleAttr(styleMatch[1]) : '';
      return safeStyle ? `<span style="${safeStyle}">` : '<span>';
    }
    return `<${tag}>`;
  });

  return out;
}
