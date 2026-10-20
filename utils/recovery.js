const BROWSER_PATTERNS = [
  { name: "Microsoft Edge", pattern: /Edg(?:e|A|iOS)?\/(\d+(?:\.\d+)*)/ },
  { name: "Opera", pattern: /OPR\/(\d+(?:\.\d+)*)/ },
  { name: "Samsung Internet", pattern: /SamsungBrowser\/(\d+(?:\.\d+)*)/ },
  { name: "Firefox", pattern: /(?:Firefox|FxiOS)\/(\d+(?:\.\d+)*)/ },
  { name: "Chrome", pattern: /(?:Chrome|CriOS)\/(\d+(?:\.\d+)*)/ },
  { name: "Brave", pattern: /Brave\/(\d+(?:\.\d+)*)/ },
];

const OS_PATTERNS = [
  { name: "Windows", pattern: /Windows NT (\d+\.\d+)/ },
  { name: "Android", pattern: /Android (\d+(?:\.\d+)*)/ },
  { name: "iOS", pattern: /(?:iPhone|iPad|iPod).* OS (\d+[_.]\d+(?:[_.]\d+)*)/ },
  { name: "macOS", pattern: /Mac OS X (\d+[._]\d+(?:[._]\d+)*)/ },
  { name: "Chrome OS", pattern: /CrOS [^;]+; (\d+(?:\.\d+)*)/ },
];

export function parseUserAgent(userAgent) {
  const empty = { browserName: null, browserVersion: null, osName: null, osVersion: null };
  if (typeof userAgent !== "string" || !userAgent.trim()) return empty;

  let browserName = null;
  let browserVersion = null;
  for (const entry of BROWSER_PATTERNS) {
    const match = userAgent.match(entry.pattern);
    if (match) {
      browserName = entry.name;
      browserVersion = match[1] || null;
      break;
    }
  }

  if (!browserName) {
    const safari = userAgent.match(/Version\/(\d+(?:\.\d+)*).* Safari\//) || userAgent.match(/Safari\/(\d+(?:\.\d+)*)/);
    if (safari && /Safari\//.test(userAgent)) {
      browserName = "Safari";
      browserVersion = safari[1] || null;
    }
  }

  let osName = null;
  let osVersion = null;
  for (const entry of OS_PATTERNS) {
    const match = userAgent.match(entry.pattern);
    if (match) {
      osName = entry.name;
      osVersion = match[1] ? match[1].replace(/_/g, ".") : null;
      break;
    }
  }

  if (!osName && /Linux/.test(userAgent) && !/Android/.test(userAgent)) {
    osName = "Linux";
    osVersion = null;
  }

  if (!browserName && !osName) return empty;

  return { browserName, browserVersion, osName, osVersion };
}

export function evaluateRecoveryEligibility({ config, entitlement, purchaseOrders } = {}) {
  if (!config || !config.isEnabled) {
    return { eligible: false, reason: "NOTE_UNAVAILABLE", purchase: null };
  }

  if (!entitlement) {
    return { eligible: false, reason: "NO_ENTITLEMENT", purchase: null };
  }

  const orders = Array.isArray(purchaseOrders) ? purchaseOrders.filter(Boolean) : [];
  const captured = orders
    .filter((order) => order.status === "captured")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  if (!captured) {
    return {
      eligible: false,
      reason: orders.length > 0 ? "PURCHASE_INELIGIBLE" : "NO_VERIFIED_PURCHASE",
      purchase: null,
    };
  }

  return { eligible: true, reason: null, purchase: captured };
}

export function validateDescription(value) {
  if (typeof value !== "string") {
    return { ok: false, message: "Please describe the problem you are facing" };
  }
  const trimmed = value.trim();
  if (trimmed.length < 10) {
    return { ok: false, message: "Please describe the problem in at least 10 characters" };
  }
  if (trimmed.length > 2000) {
    return { ok: false, message: "Description must be 2000 characters or fewer" };
  }
  return { ok: true, value: trimmed };
}

export function sanitizeRegisteredDevice(device) {
  if (!device) {
    return {
      registered: false,
      deviceTokenStatus: "Not registered",
      fingerprint: null,
      registeredAt: null,
      lastSeenAt: null,
      resetAt: null,
    };
  }

  return {
    registered: true,
    deviceTokenStatus: device.deviceToken ? "Issued" : "Not issued",
    fingerprint: device.fingerprint ?? null,
    registeredAt: device.registeredAt ?? null,
    lastSeenAt: device.lastSeenAt ?? null,
    resetAt: device.resetAt ?? null,
  };
}

export function escapeHtml(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, (char) => entities[char]);
}

export const INELIGIBLE_MESSAGES = {
  NOTE_UNAVAILABLE: "This paid note is currently not available",
  NO_ENTITLEMENT: "You do not own this paid note",
  NO_VERIFIED_PURCHASE: "No verified purchase was found for this note",
  PURCHASE_INELIGIBLE: "Your purchase for this note is no longer eligible for recovery",
};
