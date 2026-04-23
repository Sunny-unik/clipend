import { useAuthStore } from "../store/authStore";

export function AccountTab() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const error = useAuthStore((s) => s.error);
  const signIn = useAuthStore((s) => s.signIn);
  const signOut = useAuthStore((s) => s.signOut);

  if (status === "disabled") {
    return (
      <div className="settings-row settings-col">
        <p className="settings-note">
          Cloud sync isn't configured for this build. The maintainer needs to
          set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>{" "}
          before building to enable sign-in.
        </p>
      </div>
    );
  }

  if (status === "loading") {
    return <div className="settings-row">Checking sign-in state…</div>;
  }

  if (status === "signed-out") {
    return (
      <div className="settings-col">
        <p className="settings-note">
          Sign in with Google to sync your clips and settings across devices.
        </p>
        <button
          className="settings-btn settings-btn--primary"
          style={{ alignSelf: "flex-start" }}
          onClick={() => signIn()}
        >
          Sign in with Google
        </button>
        {error && <p className="settings-error">{error}</p>}
      </div>
    );
  }

  // signed-in
  const name =
    (user?.user_metadata?.full_name as string | undefined) ??
    user?.email ??
    "Signed in";
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

  return (
    <div className="settings-col">
      <div className="account-card">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="account-avatar" />
        ) : (
          <div className="account-avatar account-avatar--placeholder" />
        )}
        <div className="account-info">
          <div className="account-name">{name}</div>
          {user?.email && <div className="account-email">{user.email}</div>}
        </div>
      </div>
      <button
        className="settings-btn"
        style={{ alignSelf: "flex-start" }}
        onClick={() => signOut()}
      >
        Sign out
      </button>
      {error && <p className="settings-error">{error}</p>}
    </div>
  );
}
