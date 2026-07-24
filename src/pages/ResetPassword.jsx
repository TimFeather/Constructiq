import { supabase } from '@/api/supabaseClient';
import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, AlertTriangle } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function ResetPassword() {
  // 'checking' → verifying the recovery session Supabase established from the link
  // 'ready'    → a recovery session exists; show the new-password form
  // 'invalid'  → link missing/expired/already used; ask for a fresh one
  const [status, setStatus] = useState("checking");
  const [linkError, setLinkError] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let settled = false;
    const markReady = () => { if (!settled) { settled = true; setStatus("ready"); } };

    // Supabase encodes failures (expired / already-used links) in the URL hash,
    // e.g. #error=access_denied&error_code=otp_expired&error_description=...
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get("error")) {
      settled = true;
      const desc = hash.get("error_description");
      setLinkError(
        hash.get("error_code") === "otp_expired"
          ? "This reset link has expired. Please request a new one."
          : (desc ? decodeURIComponent(desc.replace(/\+/g, " ")) : "This reset link is invalid.")
      );
      setStatus("invalid");
      return;
    }

    // supabase-js auto-detects the recovery token in the URL and establishes a
    // session, firing PASSWORD_RECOVERY. Listen for it, and also check for an
    // already-established session in case the event fired before we mounted.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) markReady();
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) markReady();
    });

    // If no recovery session materialises, the link was missing or malformed.
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        setLinkError("This password reset link is missing or invalid.");
        setStatus("invalid");
      }
    }, 4000);

    return () => { subscription.unsubscribe(); clearTimeout(timeout); };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      // Sign the recovery session out so they log in fresh with the new password.
      await supabase.auth.signOut();
      window.location.href = "/login?reset=success";
    } catch (err) {
      setError(err.message || "Failed to reset password");
      setLoading(false);
    }
  };

  if (status === "checking") {
    return (
      <AuthLayout icon={Lock} title="Reset password" subtitle="Verifying your reset link…">
        <div className="flex justify-center py-4">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AuthLayout>
    );
  }

  if (status === "invalid") {
    return (
      <AuthLayout
        icon={AlertTriangle}
        title="Invalid reset link"
        subtitle="This password reset link can't be used"
        footer={
          <Link to="/forgot-password" className="text-primary font-medium hover:underline">
            Request a new link
          </Link>
        }
      >
        <p className="text-sm text-foreground text-center">
          {linkError || "The link you used appears to be incomplete."} Please request a new password reset email.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={Lock}
      title="New password"
      subtitle="Enter your new password below"
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Resetting...
            </>
          ) : (
            "Reset password"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
