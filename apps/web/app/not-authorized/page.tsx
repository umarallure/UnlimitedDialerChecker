export default function NotAuthorizedPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-xl font-semibold">No admin access</h1>
      <p className="text-sm text-zinc-500">
        You’re signed in, but this account isn’t on the admin list. Ask the owner to add your user to the{" "}
        <code>admins</code> table.
      </p>
      <form action="/auth/signout" method="post">
        <button className="text-sm underline">Sign out</button>
      </form>
    </main>
  );
}
