import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { createClient } from "@/lib/supabase/server";
import { MfaForm } from "./mfa-form";

export default async function MfaPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const { data: listed } = await supabase.rpc("is_listed_admin");
  if (!listed) redirect("/not-authorized");

  return (
    <AuthShell title="Two-factor verification" description="An authenticator code is required for every admin session.">
      <MfaForm />
    </AuthShell>
  );
}
