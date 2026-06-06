import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Trash2, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';

const CATEGORIES = ['Plans', 'Specifications', 'Bill of Quantities', 'Schedule', 'Contract', 'Other'];

const FILE_ICONS = {
  pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
  png: '🖼', jpg: '🖼', jpeg: '🖼', dwg: '📐', dxf: '📐', zip: '🗜',
};

function getExt(name) {
  return (name || '').split('.').pop()?.toLowerCase() || '';
}

function DocRow({ doc, idx, canManage, onCategoryChange, onDelete, indent = 0 }) {
  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2" style={{ paddingLeft: `${indent * 16}px` }}>
          <span className="text-base">{FILE_ICONS[getExt(doc.name)] || '📎'}</span>
          <span className="font-medium text-sm truncate max-w-[200px]">{doc.name}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        {canManage ? (
          <Select value={doc.category || 'Other'} onValueChange={v => onCategoryChange(idx, v)}>
            <SelectTrigger className="h-7 text-xs w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">{doc.category || 'Other'}</span>
        )}
      </td>
      <td className="px-4 py-3 hidden sm:table-cell">
        <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
          {doc.file_type || getExt(doc.name).toUpperCase()}
        </span>
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <span className="text-xs text-muted-foreground">
          {doc.uploaded_at ? format(new Date(doc.uploaded_at), 'dd MMM yyyy') : '—'}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 justify-end">
          <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Download">
              <Download className="w-3.5 h-3.5" />
            </Button>
          </a>
          {canManage && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => onDelete(idx)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function FolderSection({ folderPath, docs, allDocs, canManage, onCategoryChange, onDelete }) {
  const [collapsed, setCollapsed] = useState(false);

  // Display name: just the deepest folder name
  const parts = folderPath.replace(/\/$/, '').split('/');
  const displayName = parts[parts.length - 1];
  const depth = parts.length - 1;

  return (
    <>
      <tr className="bg-muted/20 border-b border-border/30">
        <td colSpan={5} className="px-4 py-1.5">
          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            style={{ paddingLeft: `${depth * 16}px` }}
            onClick={() => setCollapsed(c => !c)}
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
            {displayName}
            <span className="font-normal ml-1">({docs.length})</span>
          </button>
        </td>
      </tr>
      {!collapsed && docs.map(({ doc, idx }) => (
        <DocRow
          key={idx}
          doc={doc}
          idx={idx}
          canManage={canManage}
          onCategoryChange={onCategoryChange}
          onDelete={onDelete}
          indent={depth + 1}
        />
      ))}
    </>
  );
}

export default function DocTable({ docs, canManage, onCategoryChange, onDelete }) {
  // Separate flat docs (no folder_path) from folder docs, maintaining original indices
  const indexed = docs.map((doc, idx) => ({ doc, idx }));

  // Group by folder_path
  const flat = indexed.filter(({ doc }) => !doc.folder_path);
  const folderMap = new Map();
  indexed.filter(({ doc }) => !!doc.folder_path).forEach(item => {
    const key = item.doc.folder_path;
    if (!folderMap.has(key)) folderMap.set(key, []);
    folderMap.get(key).push(item);
  });

  // Sort folder keys so parent folders appear before children
  const sortedFolders = [...folderMap.keys()].sort();

  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase">Name</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase w-44">Category</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase w-20 hidden sm:table-cell">Type</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase w-28 hidden md:table-cell">Uploaded</th>
            <th className="w-20"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {/* Flat (root-level) docs first */}
          {flat.map(({ doc, idx }) => (
            <DocRow key={idx} doc={doc} idx={idx} canManage={canManage} onCategoryChange={onCategoryChange} onDelete={onDelete} />
          ))}
          {/* Folder groups */}
          {sortedFolders.map(folderPath => (
            <FolderSection
              key={folderPath}
              folderPath={folderPath}
              docs={folderMap.get(folderPath)}
              allDocs={docs}
              canManage={canManage}
              onCategoryChange={onCategoryChange}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}