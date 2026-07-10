import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { TenderContact, User } from '@/api/entities';
import { UserCheck, Building2 } from 'lucide-react';
import { filterActiveUsers } from '@/lib/userStatus';

/**
 * PersonAutocomplete
 *
 * Shared free-text input + suggestion dropdown searching the tender_contacts
 * directory (and, optionally, registered platform users). Used by TeamManager,
 * ProjectSubcontractors, and InviteeManager so all three "add a person" flows
 * search the same directory and behave identically. The parent owns the text
 * value and decides how a selected suggestion maps onto its form fields.
 */
export default function PersonAutocomplete({
  value,
  onChange,
  onSelect,
  onBlur,
  placeholder = 'Search contacts or enter name…',
  includeUsers = false,
  className = '',
  autoFocus = false,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const { data: contacts = [] } = useQuery({
    queryKey: ['tenderContacts'],
    queryFn: () => TenderContact.list('-created_at', 500).catch(() => []),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => User.list(),
    enabled: includeUsers,
  });

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInput = (val) => {
    onChange(val);
    if (val.length >= 2) {
      const q = val.toLowerCase();
      const userMatches = includeUsers
        ? filterActiveUsers(users).filter(u =>
            u.email?.toLowerCase().includes(q) || u.full_name?.toLowerCase().includes(q)
          ).map(u => ({ kind: 'user', id: u.id, email: u.email, full_name: u.full_name, phone: u.phone, business_name: u.business_name }))
        : [];
      const userEmails = new Set(userMatches.map(u => u.email?.toLowerCase()).filter(Boolean));
      const contactMatches = contacts.filter(c =>
        !userEmails.has(c.email?.toLowerCase()) && (
          c.full_name?.toLowerCase().includes(q) ||
          c.business_name?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.trade?.toLowerCase().includes(q)
        )
      ).map(c => ({ kind: 'contact', id: c.id, email: c.email, full_name: c.full_name, phone: c.phone, business_name: c.business_name, trade: c.trade }));

      setSuggestions([...userMatches, ...contactMatches].slice(0, 8));
      setOpen(true);
    } else {
      setSuggestions([]);
      setOpen(false);
    }
  };

  const handleSelect = (person) => {
    onSelect(person);
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <Input
        value={value}
        onChange={e => handleInput(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-card border rounded-md shadow-lg max-h-44 overflow-y-auto">
          {suggestions.map(p => (
            <button
              key={`${p.kind}-${p.id}`}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center gap-2"
              onMouseDown={e => e.preventDefault()}
              onClick={() => handleSelect(p)}
            >
              {p.kind === 'user' ? (
                <UserCheck className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
              ) : (
                <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              )}
              <span className="font-medium">{p.full_name}</span>
              {p.trade && <span className="text-muted-foreground text-xs">({p.trade})</span>}
              {p.email && <span className="text-muted-foreground text-xs ml-auto truncate">{p.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
