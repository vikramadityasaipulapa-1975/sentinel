export interface PaymentRequest {
  order_id: string;
  amount_minor: number;
  currency: "INR" | "USD";
}

export interface PaymentResponse extends PaymentRequest {
  payment_id: string;
  status: "succeeded";
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPaymentRequest(value: unknown): value is PaymentRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 3 &&
    typeof record.order_id === "string" && uuidPattern.test(record.order_id) &&
    typeof record.amount_minor === "number" && Number.isSafeInteger(record.amount_minor) &&
    record.amount_minor > 0 && record.amount_minor <= 100_000_000 &&
    (record.currency === "INR" || record.currency === "USD");
}

export function isPaymentResponse(value: unknown, request: PaymentRequest): value is PaymentResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 5 &&
    typeof record.payment_id === "string" && uuidPattern.test(record.payment_id) &&
    record.status === "succeeded" && typeof record.order_id === "string" &&
    record.order_id.toLowerCase() === request.order_id.toLowerCase() &&
    record.amount_minor === request.amount_minor && record.currency === request.currency;
}
