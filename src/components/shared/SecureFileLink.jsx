import React, { useState, useEffect } from 'react';
import { getSignedUrl, isStoredUrl } from '@/api/supabaseClient';

const DEFAULT_BUCKET = 'project-files';
const DEFAULT_EXPIRY = 3600; // 1 hour

// Resolve a stored file value to a usable URL.
//   • If the value is already a full URL (a legacy public URL, or an existing
//     signed URL), it is returned as-is with no network call.
//   • If it is a bare storage path, a short-lived signed URL is generated for it.
//
// Returns { url, loading, error }. Use this for <img>/<iframe> src, where the URL
// must exist before the element renders (e.g. the document preview modal). For
// click-to-open links prefer <SecureFileLink>, which signs on click and so avoids
// pre-signing every file in a long list.
export function useSignedUrl(value, { bucket = DEFAULT_BUCKET, expiresIn = DEFAULT_EXPIRY } = {}) {
  const [state, setState] = useState(() =>
    !value ? { url: null, loading: false, error: null }
    : isStoredUrl(value) ? { url: value, loading: false, error: null }
    : { url: null, loading: true, error: null }
  );

  useEffect(() => {
    let cancelled = false;
    if (!value) { setState({ url: null, loading: false, error: null }); return; }
    if (isStoredUrl(value)) { setState({ url: value, loading: false, error: null }); return; }
    setState({ url: null, loading: true, error: null });
    getSignedUrl(bucket, value, expiresIn)
      .then(url => { if (!cancelled) setState({ url, loading: false, error: null }); })
      .catch(error => { if (!cancelled) setState({ url: null, loading: false, error }); });
    return () => { cancelled = true; };
  }, [value, bucket, expiresIn]);

  return state;
}

// Click-to-open link for a stored file. On click it resolves the signed URL (or
// uses the value directly when it is already a URL) and opens it in a new tab.
// Signing on click — rather than on mount — avoids generating a signed URL for
// every file in a list. To stay popup-blocker-safe across the async signing step,
// a blank tab is opened synchronously within the click and then redirected once
// the signed URL is ready.
//
// `value` is the stored file value (path or URL). When it is empty the children
// render as plain, non-clickable text. forwardRef so it composes with Radix
// <Slot> (e.g. <Button asChild>) without ref warnings.
const SecureFileLink = React.forwardRef(function SecureFileLink({
  value,
  bucket = DEFAULT_BUCKET,
  expiresIn = DEFAULT_EXPIRY,
  children,
  className,
  title,
  onError,
  onClick,
  ...rest
}, ref) {
  const [resolving, setResolving] = useState(false);

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.(e); // allow a wrapping <Slot>/parent to observe the click
    if (!value) return;

    // Already a usable URL — open directly inside the user gesture.
    if (isStoredUrl(value)) {
      window.open(value, '_blank', 'noopener,noreferrer');
      return;
    }

    // Open a blank tab synchronously to preserve the user gesture, then point it
    // at the signed URL once it resolves.
    const tab = window.open('', '_blank');
    setResolving(true);
    try {
      const url = await getSignedUrl(bucket, value, expiresIn);
      if (url && tab) tab.location.href = url;
      else if (tab) tab.close();
    } catch (err) {
      if (tab) tab.close();
      onError?.(err);
    } finally {
      setResolving(false);
    }
  };

  if (!value) {
    return <span ref={ref} className={className} title={title} {...rest}>{children}</span>;
  }

  return (
    <a
      ref={ref}
      href="#"
      role="button"
      onClick={handleClick}
      aria-busy={resolving || undefined}
      className={className}
      title={title}
      {...rest}
    >
      {children}
    </a>
  );
});

export default SecureFileLink;
