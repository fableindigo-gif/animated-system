type TelemetryPayload = Record<string, string | number | boolean | null | undefined>;

export function trackEvent(eventName: string, payload?: TelemetryPayload): void {
  const event = {
    event: eventName,
    timestamp: new Date().toISOString(),
    url: typeof window !== "undefined" ? window.location.pathname : "",
    ...payload,
  };

  if (typeof window !== "undefined" && typeof (window as any).posthog?.capture === "function") {
    (window as any).posthog.capture(eventName, payload);
    return;
  }

}
