import React from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { cn } from '@/lib/utils';

// Toolbar kept intentionally small — this is for tender descriptions/notes, not
// a full document editor. bold/italic/underline/lists/colour/clean covers the
// realistic formatting needs without overwhelming staff.
const TOOLBAR = [
  ['bold', 'italic', 'underline'],
  [{ list: 'ordered' }, { list: 'bullet' }],
  [{ color: [] }],
  ['clean'],
];

/**
 * Thin wrapper over ReactQuill for rich-text fields (tender Description / Notes).
 * Emits/accepts HTML strings. Renders read-only (styled) content when disabled.
 */
export default function RichTextEditor({ value, onChange, disabled, placeholder, className }) {
  return (
    <div
      className={cn(
        'rich-text-editor rounded-md border border-input overflow-hidden',
        '[&_.ql-toolbar]:border-0 [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-input [&_.ql-toolbar]:bg-muted/40',
        '[&_.ql-container]:border-0 [&_.ql-container]:font-sans [&_.ql-container]:text-sm',
        '[&_.ql-editor]:min-h-[100px] [&_.ql-editor]:bg-background',
        disabled && '[&_.ql-toolbar]:hidden [&_.ql-editor]:bg-muted/30 [&_.ql-editor]:cursor-not-allowed',
        className
      )}
    >
      <ReactQuill
        theme="snow"
        value={value || ''}
        onChange={onChange}
        readOnly={disabled}
        placeholder={placeholder}
        modules={{ toolbar: disabled ? false : TOOLBAR }}
      />
    </div>
  );
}
