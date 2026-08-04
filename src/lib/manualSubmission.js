// Pure logic for the "Record submission" flow (RecordSubmissionDialog.jsx).
// Kept separate from the component so it can be unit-tested without React.

// Build the payload the recordSubmission edge function's `save` action expects,
// from raw dialog state. Mirrors the filter/total rules TenderSubmit.jsx applies
// on the portal side (handleSubmit), so a manually recorded price behaves the
// same as a self-service one.
export function buildSubmissionPayload({ priceLines, notes, files, receivedAt, notifySubcontractor }) {
  const cleanLines = (priceLines || [])
    .filter(l => l.amount != null && l.amount !== '' && Number(l.amount) > 0)
    .map(l => ({ description: (l.description || '').trim() || 'Item', amount: Number(l.amount) }));

  const lumpSum = cleanLines.reduce((sum, l) => sum + Number(l.amount), 0);

  // Dedupe by storage_path — last one wins (keeps the most recently uploaded copy).
  const seen = new Map();
  for (const f of files || []) {
    if (f.storage_path) seen.set(f.storage_path, f);
  }
  const dedupedFiles = Array.from(seen.values());

  return {
    priceLines: cleanLines,
    lumpSum,
    notes: notes || '',
    files: dedupedFiles,
    receivedAt: receivedAt || new Date().toISOString().split('T')[0],
    notifySubcontractor: !!notifySubcontractor,
  };
}

// Human-readable validation error, or null if the state is ready to save.
export function validateManualSubmission(state) {
  const { inviteeId, priceLines, files } = state || {};
  if (!inviteeId) return 'Please select a subcontractor.';

  const total = (priceLines || [])
    .filter(l => l.amount != null && l.amount !== '' && Number(l.amount) > 0)
    .reduce((sum, l) => sum + Number(l.amount), 0);
  if (!total || total <= 0) return 'Please enter at least one price.';

  if ((files || []).some(f => f.status === 'uploading')) return 'Please wait for files to finish uploading.';
  if ((files || []).some(f => f.status === 'error')) return 'Some files failed to upload. Retry or remove them before saving.';

  return null;
}

// Same +12:00 (NZ end-of-day) convention the API uses (tenderPublicApi/index.ts:403,
// recordSubmission/index.ts closingMs) so the client-side warning banner and the
// server's received_after_close flag never disagree.
export function isAfterClose(tender, receivedAtISO) {
  if (!tender) return false;
  const receivedMs = receivedAtISO ? new Date(receivedAtISO).getTime() : Date.now();
  if (['Closed', 'Cancelled'].includes(tender.status)) return true;
  if (!tender.closing_date) return false;
  const closingMs = new Date(`${tender.closing_date.split('T')[0]}T23:59:59+12:00`).getTime();
  if (isNaN(closingMs) || isNaN(receivedMs)) return false;
  return receivedMs > closingMs;
}
