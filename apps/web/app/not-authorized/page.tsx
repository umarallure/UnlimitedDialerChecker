import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { SecondaryButton } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

/**
 * The dead end for an account with no access — but an agent is not one of those. They reach here
 * by a stale link or a bookmark from before they were given dialer access, and the page they
 * actually want is one redirect away.
 */
export default async function NotAuthorizedPage() {
  const supabase = await createClient();
  const { data: isAgent } = await supabase.rpc("is_listed_agent");
  if (isAgent) redirect("/dialer");

  return (
    <AuthShell
      title="No admin access"
      description={
        <>
          You’re signed in, but this account isn’t on the admin list. Ask the owner to add your user to the{" "}
          <code className="font-mono text-code text-ink">admins</code> table.
        </>
      }
    >
      <form action="/auth/signout" method="post">
        <SecondaryButton className="w-full">Sign out</SecondaryButton>
      </form>
    </AuthShell>
  );
}
