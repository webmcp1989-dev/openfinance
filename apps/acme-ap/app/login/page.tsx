import { signIn } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="auth-shell">
      <form action={signIn} className="auth-card">
        <div className="wordmark"><span className="mark">A</span><span>Acme Supplier Portal</span></div>
        <h1>Supplier sign in</h1>
        <p>Use your Acme supplier credentials. Site tools are scoped to this independent portal session.</p>
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
        {error ? <p className="form-error" role="alert">The email or password is incorrect.</p> : null}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
