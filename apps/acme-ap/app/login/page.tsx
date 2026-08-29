import { signIn, signOut } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const errorMessage = error === "profile_missing"
    ? "Your account is authenticated but is not assigned to this supplier workspace. Contact an administrator."
    : error
      ? "The email or password is incorrect."
      : null;
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <form action={signIn} className="auth-form">
          <div className="wordmark"><span className="mark">A</span><span>Acme Supplier Portal</span></div>
          <h1 id="login-title">Supplier sign in</h1>
          <p>Use your Acme supplier credentials. Site tools are scoped to this independent portal session.</p>
          <label>Email<input name="email" type="email" autoComplete="username" required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
          {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}
          <button type="submit">Sign in</button>
        </form>
        {error === "profile_missing" ? <form action={signOut} className="account-recovery">
          <p>Signed in with a different account?</p>
          <button type="submit">Use a different account</button>
        </form> : null}
      </section>
    </main>
  );
}
