export type ApiErrorBody = Readonly<{
  error?: Readonly<{ code?: string; message?: string }>;
}>;

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  });
  const body = await response.json() as T & ApiErrorBody;
  if (!response.ok) throw new Error(body.error?.message ?? "Acme AP request failed");
  return body;
}
