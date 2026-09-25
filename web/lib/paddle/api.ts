import { paddleApiKey, paddleEnvironment } from "./config";
export async function paddleRequest<T>(
  path: string,
  body?: unknown,
  method?: "PATCH",
): Promise<T> {
  if (
    !/^\/[a-z0-9/_-]+(?:\?(?:id=adj_[a-z0-9]{26}|transaction_id=txn_[a-z0-9]{26}&per_page=100(?:&after=adj_[a-z0-9]{26})?))?$/.test(
      path,
    )
  )
    throw new Error("Invalid Paddle API path");
  const host =
    paddleEnvironment() === "sandbox"
      ? "https://sandbox-api.paddle.com"
      : "https://api.paddle.com";
  const response = await fetch(host + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      Authorization: `Bearer ${paddleApiKey()}`,
      "Content-Type": "application/json",
      "Paddle-Version": "1",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  // Never log provider response bodies: these may contain buyer details or portal credentials.
  if (!response.ok)
    throw new Error(`Paddle request failed (${response.status})`);
  const result = (await response.json()) as { data: T };
  return result.data;
}
