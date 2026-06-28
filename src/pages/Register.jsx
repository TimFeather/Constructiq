import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { clearClientAuthState } from "@/lib/clientAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Lock, Loader2, Phone, Building2, ShieldAlert } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function Register() {
  // ConstructIQ is invite-only. A valid invitation token (from the invite email
  // link) is required to create an account — there is no public self-signup.
  const urlParams = new URLSearchParams(window.location.search);
  const inviteToken = urlParams.get("token") || "";
  const prefillBusiness = urlParams.get("company") || "";

  const [form, setForm] = useState({
    password: "", confirmPassword: "",
    first_name: "", last_name: "", phone: "", business_name: prefillBusiness,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // On mount: clear any stale onboarding/auth state for a clean slate.
  useEffect(() => {
    clearClientAuthState();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      // Gated account creation — the edge function validates the invite token
      // server-side and creates the account (public signups are disabled).
      const { data, error: fnError } = await supabase.functions.invoke("registerInvited", {
        body: {
          token: inviteToken,
          password: form.password,
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone,
          business_name: form.business_name,
        },
      });
      // Edge function returns a non-2xx (with { error }) for invalid/expired invites.
      if (fnError) {
        // Try to surface the function's own error message body.
        let message = fnError.message || "Registration failed";
        try {
          const ctx = await fnError.context?.json?.();
          if (ctx?.error) message = ctx.error;
        } catch (_) { /* ignore */ }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.email) throw new Error("Registration failed — please try again.");

      // Account exists and is confirmed — sign in directly.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: form.password,
      });
      if (signInError) throw signInError;
      window.location.href = "/";
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  // No token → no registration. Show an invite-only notice.
  if (!inviteToken) {
    return (
      <AuthLayout
        icon={ShieldAlert}
        title="Invitation required"
        subtitle="ConstructIQ is invite-only"
        footer={<>Already have an account?{" "}<Link to="/login" className="text-primary font-medium hover:underline">Log in</Link></>}
      >
        <div className="p-4 rounded-lg bg-muted/50 text-sm text-center text-foreground leading-relaxed">
          Accounts can only be created from an invitation. Please open the
          <strong> "Create your account" </strong> link in your invitation email,
          or contact your administrator to be invited.
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={UserPlus}
      title="Create your account"
      subtitle="Complete your details to accept your invitation"
      footer={<>Already have an account?{" "}<Link to="/login" className="text-primary font-medium hover:underline">Log in</Link></>}
    >
      {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="first_name">First Name</Label>
            <Input id="first_name" value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} placeholder="First name" className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last_name">Last Name</Label>
            <Input id="last_name" value={form.last_name} onChange={e => setForm({...form, last_name: e.target.value})} placeholder="Last name" className="h-11" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone Number</Label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="phone" type="tel" placeholder="+1 (555) 000-0000" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="pl-10 h-12" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="business_name">Organisation</Label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="business_name" placeholder="Your company" value={form.business_name} onChange={e => setForm({...form, business_name: e.target.value})} className="pl-10 h-12" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="password" type="password" autoComplete="new-password" placeholder="••••••••" value={form.password} onChange={e => setForm({...form, password: e.target.value})} className="pl-10 h-12" required minLength={8} />
          </div>
          <p className="text-xs text-muted-foreground">At least 8 characters</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="confirm" type="password" autoComplete="new-password" placeholder="••••••••" value={form.confirmPassword} onChange={e => setForm({...form, confirmPassword: e.target.value})} className="pl-10 h-12" required />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating account...</> : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
