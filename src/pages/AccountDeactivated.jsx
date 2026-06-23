import { supabase } from '@/api/supabaseClient';
import React from 'react';
import { ShieldOff } from 'lucide-react';

export default function AccountDeactivated() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="max-w-md w-full mx-auto px-6 text-center">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 mx-auto mb-6">
          <ShieldOff className="w-8 h-8 text-destructive" />
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-3">Account Deactivated</h1>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          Your ConstructIQ account has been deactivated. Please contact your administrator.
        </p>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-primary hover:underline"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}