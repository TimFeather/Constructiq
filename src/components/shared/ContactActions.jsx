import React from 'react';
import { Mail, Phone } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Tap-to-call / tap-to-email for people lists (project team, subcontractors).
 *
 * Desktop: PhoneLink / EmailLink render the value as a plain inline link.
 * Phones:  ContactButtons adds full-width Call / Email buttons under the card.
 *          It's CSS-only (md:hidden, same 768px breakpoint as useIsMobile), so
 *          nothing re-renders on resize.
 */

// Dialable tel: href — keep digits and one leading +, drop the spaces, dashes
// and brackets people type into phone fields ("(021) 555-1234" → tel:0215551234).
export function telHref(phone) {
  const raw = String(phone || '').trim();
  const lead = raw.startsWith('+') ? '+' : '';
  const digits = raw.replace(/\D/g, '');
  return digits ? `tel:${lead}${digits}` : null;
}

export function mailHref(email) {
  const e = String(email || '').trim();
  return e ? `mailto:${e}` : null;
}

const linkClass = 'hover:text-foreground hover:underline underline-offset-2 transition-colors';

export function PhoneLink({ phone, className }) {
  const href = telHref(phone);
  if (!href) return phone ? <span className={className}>{phone}</span> : null;
  return <a href={href} className={cn(linkClass, className)}>{phone}</a>;
}

export function EmailLink({ email, className }) {
  const href = mailHref(email);
  if (!href) return null;
  return <a href={href} className={cn(linkClass, className)}>{email}</a>;
}

export function ContactButtons({ phone, email, name, className }) {
  const tel = telHref(phone);
  const mail = mailHref(email);
  if (!tel && !mail) return null;
  const btn = cn(buttonVariants({ variant: 'outline' }), 'flex-1 h-10 min-w-0 bg-background');
  return (
    <div className={cn('flex gap-2 md:hidden', className)}>
      {tel && (
        <a href={tel} className={btn} aria-label={name ? `Call ${name}` : 'Call'}>
          <Phone /> Call
        </a>
      )}
      {mail && (
        <a href={mail} className={btn} aria-label={name ? `Email ${name}` : 'Email'}>
          <Mail /> Email
        </a>
      )}
    </div>
  );
}
