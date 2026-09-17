import { AuthShell } from "@/components/auth-shell";
import { SecondaryButton } from "@/components/ui";

export default function NotAuthorizedPage() {
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
