import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Trade picker: the listed trades plus "Other", which reveals a free-text box.
 * A trade that isn't in the list (saved earlier, or filled in from a picked
 * contact) shows as "Other" with its text in the box.
 */
export default function TradeSelect({ trades, value, onChange, compact = true, allowNone = false }) {
  // What's been typed under "Other", null if not chosen. Compared against value
  // so the parent changing the trade (contact picked, form reset) still wins.
  const [typed, setTyped] = useState(null);
  const isCustom = (value || '') === typed || (!!value && !trades.includes(value));

  const setText = (text) => {
    setTyped(text);
    onChange(text);
  };

  const handleSelect = (val) => {
    if (val === 'custom') return setText('');
    setTyped(null);
    onChange(val === 'NONE' ? '' : val);
  };

  return (
    <>
      <Select value={isCustom ? 'custom' : value || (allowNone ? 'NONE' : '')} onValueChange={handleSelect}>
        <SelectTrigger className={compact ? 'h-8 text-xs' : undefined}><SelectValue placeholder="Select trade" /></SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value="NONE"><span className="text-muted-foreground">— No trade —</span></SelectItem>}
          {trades.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          <SelectItem value="custom">Other (type below)</SelectItem>
        </SelectContent>
      </Select>
      {isCustom && (
        <Input
          className={compact ? 'mt-2 h-8 text-base md:text-xs' : 'mt-2'}
          value={value || ''}
          onChange={e => setText(e.target.value)}
          onBlur={e => setText(e.target.value.trim())}
          placeholder="Enter trade"
        />
      )}
    </>
  );
}
