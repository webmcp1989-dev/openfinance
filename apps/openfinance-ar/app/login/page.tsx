import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="auth-shell">
      <form action={signIn} className="auth-card">
        <p className="eyebrow">OpenFinance</p>
        <h1>Sign in to portal delivery</h1>
        <p>Use your supplier workspace credentials. Site tools become available only after authentication.</p>
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
        {error ? <p className="form-error" role="alert">The email or password is incorrect.</p> : null}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
