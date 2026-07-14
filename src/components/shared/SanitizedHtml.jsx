import React from 'react';
import DOMPurify from 'dompurify';
import { cn } from '@/lib/utils';

/**
 * Renders untrusted HTML (e.g. tender Description, authored via RichTextEditor)
 * safely by sanitizing with DOMPurify before injecting into the DOM.
 *
 * Use this everywhere invitee-facing rich text is rendered — never render
 * staff-authored HTML with a raw dangerouslySetInnerHTML.
 */
export default function SanitizedHtml({ html, className }) {
  if (!html) return null;
  const clean = DOMPurify.sanitize(html);
  return (
    <div
      className={cn(
        // No Tailwind typography plugin in this project — style the common
        // rich-text tags directly so lists/headings/links render sensibly.
        'text-sm leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0',
        '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1',
        '[&_a]:text-primary [&_a]:underline',
        className
      )}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
