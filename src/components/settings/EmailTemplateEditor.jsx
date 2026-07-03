import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Save, ChevronDown, ChevronUp, Monitor, Smartphone } from 'lucide-react';
import { buildEmailHtml, DEFAULT_TEMPLATES, TEMPLATE_VARIABLES, stripHtml } from '@/lib/emailTemplates';

const TOOLBAR_ACTIONS = [
  { label: 'B', title: 'Bold', wrap: ['<strong>', '</strong>'] },
  { label: 'I', title: 'Italic', wrap: ['<em>', '</em>'] },
  { label: 'H1', title: 'Heading 1', wrap: ['<h1 style="font-size:24px;font-weight:600;margin:16px 0 8px">', '</h1>'] },
  { label: 'H2', title: 'Heading 2', wrap: ['<h2 style="font-size:18px;font-weight:600;margin:14px 0 6px">', '</h2>'] },
];

export default function EmailTemplateEditor({ templateKey, template, branding, onSave, saving }) {
  const defaultDef = DEFAULT_TEMPLATES[templateKey] || {};
  const [subjectDraft, setSubjectDraft] = useState(template?.subject || defaultDef.subject || '');
  const [bodyDraft, setBodyDraft] = useState(template?.body_html || defaultDef.body_html || '');
  const [previewHtml, setPreviewHtml] = useState('');
  const [viewMode, setViewMode] = useState('desktop');
  const [showVars, setShowVars] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const textareaRef = useRef(null);
  const debounceRef = useRef(null);

  const variables = TEMPLATE_VARIABLES[templateKey] || [];

  // Sync when template prop changes (e.g. after save/load)
  useEffect(() => {
    setSubjectDraft(template?.subject || defaultDef.subject || '');
    setBodyDraft(template?.body_html || defaultDef.body_html || '');
  }, [template?.id]);

  // Debounced preview update
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreviewHtml(buildEmailHtml(bodyDraft, branding));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [bodyDraft, branding]);

  const insertAtCursor = (text) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newVal = bodyDraft.substring(0, start) + text + bodyDraft.substring(end);
    setBodyDraft(newVal);
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + text.length;
      ta.focus();
    }, 0);
  };

  const wrapSelection = (before, after) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = bodyDraft.substring(start, end);
    const newVal = bodyDraft.substring(0, start) + before + selected + after + bodyDraft.substring(end);
    setBodyDraft(newVal);
    setTimeout(() => {
      ta.selectionStart = start + before.length;
      ta.selectionEnd = start + before.length + selected.length;
      ta.focus();
    }, 0);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor('  ');
    }
  };

  const handleInsertLink = () => {
    const url = prompt('Enter URL:');
    if (!url) return;
    wrapSelection(`<a href="${url}" style="color:#1a56db;">`, '</a>');
  };

  const handleInsertButton = () => {
    const colour = branding?.brand_colour || '#1a56db';
    insertAtCursor(`<p><a href="{url}" style="display:inline-block;padding:10px 24px;background:${colour};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View Details</a></p>`);
  };

  const handleInsertDivider = () => {
    insertAtCursor('\n<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">\n');
  };

  const handleRestore = () => {
    setBodyDraft(defaultDef.body_html || '');
    setSubjectDraft(defaultDef.subject || '');
    setShowConfirm(false);
  };

  const handleSave = () => {
    onSave(subjectDraft, bodyDraft, stripHtml(bodyDraft));
  };

  const iframeWidth = viewMode === 'desktop' ? '100%' : 375;

  return (
    <div className="space-y-3">
      {/* Subject line */}
      <div>
        <Label className="text-xs mb-1 block">Subject</Label>
        <Input
          value={subjectDraft}
          onChange={e => setSubjectDraft(e.target.value)}
          placeholder="Email subject..."
          className="text-sm"
        />
      </div>

      {/* Variables panel */}
      <div className="border rounded-md">
        <button
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setShowVars(v => !v)}
        >
          <span>Variables — click to insert</span>
          {showVars ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {showVars && (
          <div className="px-3 pb-3 flex flex-wrap gap-1.5 border-t pt-2">
            {variables.map(v => (
              <button
                key={v.key}
                title={v.desc}
                onClick={() => insertAtCursor(`{${v.key}}`)}
                className="px-2 py-0.5 rounded bg-muted hover:bg-primary/10 hover:text-primary text-xs font-mono border border-border transition-colors"
              >
                {`{${v.key}}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Split pane */}
      <div className="grid md:grid-cols-2 gap-0 border rounded-md overflow-hidden" style={{ height: 520 }}>
        {/* Left — HTML editor */}
        <div className="flex flex-col border-r">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 bg-zinc-900 border-b border-zinc-700">
            {TOOLBAR_ACTIONS.map(a => (
              <button
                key={a.label}
                title={a.title}
                onClick={() => wrapSelection(a.wrap[0], a.wrap[1])}
                className="px-2 py-0.5 text-xs font-mono rounded text-zinc-300 hover:bg-zinc-700 border border-transparent hover:border-zinc-600"
              >
                {a.label}
              </button>
            ))}
            <button
              onClick={handleInsertLink}
              className="px-2 py-0.5 text-xs rounded text-zinc-300 hover:bg-zinc-700 border border-transparent hover:border-zinc-600"
            >
              Link
            </button>
            <button
              onClick={handleInsertButton}
              className="px-2 py-0.5 text-xs rounded text-zinc-300 hover:bg-zinc-700 border border-transparent hover:border-zinc-600"
            >
              Button
            </button>
            <button
              onClick={handleInsertDivider}
              className="px-2 py-0.5 text-xs rounded text-zinc-300 hover:bg-zinc-700 border border-transparent hover:border-zinc-600"
            >
              HR
            </button>
            <div className="flex-1" />
            {!showConfirm ? (
              <button
                onClick={() => setShowConfirm(true)}
                className="px-2 py-0.5 text-xs rounded text-zinc-400 hover:text-orange-400 border border-transparent hover:border-zinc-600"
              >
                Reset
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-orange-400">Sure?</span>
                <button onClick={handleRestore} className="px-2 py-0.5 text-[10px] rounded bg-orange-600 text-white">Yes</button>
                <button onClick={() => setShowConfirm(false)} className="px-2 py-0.5 text-[10px] rounded bg-zinc-700 text-zinc-300">No</button>
              </div>
            )}
          </div>
          <textarea
            ref={textareaRef}
            value={bodyDraft}
            onChange={e => setBodyDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            className="flex-1 resize-none p-3 text-[13px] leading-relaxed overflow-auto"
            style={{
              fontFamily: 'monospace',
              background: '#1e1e1e',
              color: '#d4d4d4',
              outline: 'none',
            }}
          />
        </div>

        {/* Right — Preview */}
        <div className="flex flex-col bg-gray-100">
          <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-200 border-b">
            <span className="text-xs text-gray-500 font-medium mr-2">Preview</span>
            <button
              onClick={() => setViewMode('desktop')}
              className={`p-1 rounded ${viewMode === 'desktop' ? 'bg-white shadow text-primary' : 'text-gray-500 hover:text-gray-700'}`}
              title="Desktop"
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('mobile')}
              className={`p-1 rounded ${viewMode === 'mobile' ? 'bg-white shadow text-primary' : 'text-gray-500 hover:text-gray-700'}`}
              title="Mobile"
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto flex justify-center p-3">
            <div style={{ width: viewMode === 'mobile' ? 375 : '100%', transition: 'width 0.2s' }}>
              <iframe
                srcDoc={previewHtml}
                title="Email Preview"
                className="w-full border-0 rounded"
                style={{ height: 450 }}
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Template'}
        </Button>
      </div>
    </div>
  );
}