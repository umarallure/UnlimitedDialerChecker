import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MfaForm } from "./mfa-form";

export default async function MfaPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const { data: listed } = await supabase.rpc("is_listed_admin");
  if (!listed) redirect("/not-authorized");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-xl font-semibold">Two-factor verification</h1>
        <p className="text-sm text-zinc-500">An authenticator code is required for every admin session.</p>
      </div>
      <MfaForm />
    </main>
  );
}
