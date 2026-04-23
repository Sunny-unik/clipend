import { useAuthStore } from "../store/authStore";

/**
 * First-run sign-in prompt. Renders as a full-window overlay on top of the
 * clip list the first time Clipend opens after installation. Once the user
 * either signs in or clicks Skip, the dismissed flag persists and the
 * overlay never appears again.
 */
export function LoginOverlay() {
  const signIn = useAuthStore((s) => s.signIn);
  const dismiss = useAuthStore((s) => s.dismissLoginPrompt);
  const error = useAuthStore((s) => s.error);

  return (
    <div className="login-overlay">
      <div className="login-card">
        <div className="login-title">Sign in to Clipend</div>
        <div className="login-subtitle">
          Sync your clipboard across every device you use Clipend on. Your
          clips, shortcuts, and settings follow you around.
        </div>

        <button
          className="login-btn login-btn--primary"
          onClick={() => signIn()}
        >
          <span className="login-google-icon" aria-hidden="true">G</span>
          Sign in with Google
        </button>

        <button
          className="login-btn login-btn--ghost"
          onClick={() => dismiss()}
        >
          Skip for now
        </button>

        {error && <div className="login-error">{error}</div>}

        <div className="login-footnote">
          You can sign in later from the <strong>⋯</strong> menu.
        </div>
      </div>
    </div>
  );
}
