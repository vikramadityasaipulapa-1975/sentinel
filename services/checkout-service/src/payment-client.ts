import { isPaymentResponse, type PaymentRequest, type PaymentResponse } from "./contracts.js";
import type { Config } from "./config.js";
import { HttpError } from "./http.js";

export class PaymentError extends HttpError {
  constructor(public readonly status: number, public readonly code: string) {
    super(status, code, "Payment could not be confirmed");
  }
}

export async function pay(request: PaymentRequest, config: Config, requestId: string): Promise<PaymentResponse> {
  const signal = AbortSignal.timeout(config.paymentTimeoutMs);
  try {
    const response = await fetch(`${config.paymentUrl}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": requestId },
      body: JSON.stringify(request),
      signal,
      redirect: "error",
    });
    if (response.status !== 201 || !response.headers.get("content-type")?.includes("application/json")) {
      await response.body?.cancel();
      throw new PaymentError(502, "PAYMENT_BAD_RESPONSE");
    }
    // Bound response memory as well as call duration. Never trust downstream data.
    const reader = response.body?.getReader();
    if (!reader) throw new PaymentError(502, "PAYMENT_BAD_RESPONSE");
    let text = "";
    let size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16_384) throw new PaymentError(502, "PAYMENT_BAD_RESPONSE");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel();
    }
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      throw new PaymentError(502, "PAYMENT_BAD_RESPONSE");
    }
    if (!isPaymentResponse(result, request)) throw new PaymentError(502, "PAYMENT_BAD_RESPONSE");
    return result;
  } catch (error) {
    if (signal.aborted) throw new PaymentError(504, "PAYMENT_TIMEOUT");
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(502, "PAYMENT_UNAVAILABLE");
  }
}
