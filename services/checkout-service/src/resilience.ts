import type { paymentLimits } from "./config.js";
import { HttpError } from "./http.js";

/** One process/app instance. No waiting queue and no external write capability. */
export class PaymentGate {
  private active = 0;
  private failures = 0;
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private openedAt = 0;
  private generation = 0;
  private probeActive = false;

  constructor(
    private readonly limits: ReturnType<typeof paymentLimits>,
    private readonly now: () => number = () => performance.now(),
  ) {}

  acquire(): (healthy: boolean) => void {
    if (this.limits.circuitEnabled) {
      if (
        this.state === "OPEN" &&
        this.now() - this.openedAt >= this.limits.cooldownMs
      )
        this.state = "HALF_OPEN";
      if (
        this.state === "OPEN" ||
        (this.state === "HALF_OPEN" && this.probeActive)
      )
        throw new HttpError(
          503,
          "PAYMENT_CIRCUIT_OPEN",
          "Payment dependency temporarily unavailable",
        );
    }
    if (this.active >= this.limits.maxInflight)
      throw new HttpError(
        503,
        "PAYMENT_BUSY",
        "Payment capacity temporarily exhausted",
      );
    const probe = this.state === "HALF_OPEN";
    const generation = this.generation;
    if (probe) this.probeActive = true;
    this.active++;
    let released = false;
    return (healthy) => {
      if (released) return;
      released = true;
      this.active--;
      // An earlier in-flight success must not close a newly opened circuit.
      if (!this.limits.circuitEnabled || generation !== this.generation) return;
      if (probe) this.probeActive = false;
      if (healthy) {
        this.failures = 0;
        if (probe) {
          this.state = "CLOSED";
          this.generation++;
        }
      } else if (probe || ++this.failures >= this.limits.threshold) {
        this.state = "OPEN";
        this.openedAt = this.now();
        this.generation++;
      }
    };
  }
}
