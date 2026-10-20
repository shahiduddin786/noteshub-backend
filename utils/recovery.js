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

const REDUCED_ANDROID_PATTERN = /Android 10;\s*K(?=[;)])/;

const NON_MODEL_TOKENS = new Set(["K", "Mobile", "U", "wv", "Handheld"]);

const MODEL_VALUE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .'()._\-+/()]*$/u;

const PLATFORM_VERSION_PATTERN = /^\d+(?:\.\d+)*$/;

const HINT_LIMITS = { platform: 32, platformVersion: 32, model: 100 };

const cleanHintValue = (value, maxLength) => {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/^"|"$/g, "")
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim();
  if (!cleaned || cleaned.length > maxLength) return null;
  return cleaned;
};

const normalizePlatformVersion = (value) => {
  const cleaned = cleanHintValue(value, HINT_LIMITS.platformVersion);
  return cleaned && PLATFORM_VERSION_PATTERN.test(cleaned) ? cleaned : null;
};

const normalizeModelValue = (value) => {
  const cleaned = cleanHintValue(value, HINT_LIMITS.model);
  if (!cleaned || NON_MODEL_TOKENS.has(cleaned)) return null;
  if (!MODEL_VALUE_PATTERN.test(cleaned)) return null;
  return cleaned;
};

const extractAndroidModel = (userAgent) => {
  if (typeof userAgent !== "string") return null;
  const match = userAgent.match(/Android \d+(?:\.\d+)*;\s*([^;)]+?)(?:\s+Build\/|[;)])/);
  if (!match) return null;
  return normalizeModelValue(match[1].trim());
};

export function parseUserAgent(userAgent) {
  const empty = {
    browserName: null,
    browserVersion: null,
    osName: null,
    osVersion: null,
    osVersionRedacted: false,
    deviceModel: null,
  };
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
  let osVersionRedacted = false;
  for (const entry of OS_PATTERNS) {
    const match = userAgent.match(entry.pattern);
    if (match) {
      osName = entry.name;
      osVersion = match[1] ? match[1].replace(/_/g, ".") : null;
      if (entry.name === "Android" && REDUCED_ANDROID_PATTERN.test(userAgent)) {
        osVersion = null;
        osVersionRedacted = true;
      }
      break;
    }
  }

  if (!osName && /Linux/.test(userAgent) && !/Android/.test(userAgent)) {
    osName = "Linux";
    osVersion = null;
  }

  if (!browserName && !osName) return empty;

  return {
    browserName,
    browserVersion,
    osName,
    osVersion,
    osVersionRedacted,
    deviceModel: extractAndroidModel(userAgent),
  };
}

export function parseClientHints(headers) {
  const source = headers && typeof headers === "object" ? headers : {};
  const pick = (name, limit) => cleanHintValue(Array.isArray(source[name]) ? source[name][0] : source[name], limit);
  const mobileRaw = pick("sec-ch-ua-mobile", 8);
  return {
    platform: pick("sec-ch-ua-platform", HINT_LIMITS.platform),
    platformVersion: normalizePlatformVersion(pick("sec-ch-ua-platform-version", HINT_LIMITS.platformVersion)),
    model: normalizeModelValue(pick("sec-ch-ua-model", HINT_LIMITS.model)),
    mobile: mobileRaw === "?1" ? true : mobileRaw === "?0" ? false : null,
  };
}

export function normalizeClientHints(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { platform: null, platformVersion: null, model: null, mobile: null };
  }
  const mobileRaw = cleanHintValue(raw.mobile, 8);
  return {
    platform: cleanHintValue(raw.platform, HINT_LIMITS.platform),
    platformVersion: normalizePlatformVersion(raw.platformVersion),
    model: normalizeModelValue(raw.model),
    mobile: mobileRaw === "?1" ? true : mobileRaw === "?0" ? false : null,
  };
}

export function collectClientHints(headerHints, bodyHints) {
  const fromHeaders = headerHints && typeof headerHints === "object" ? headerHints : {};
  const fromBody = normalizeClientHints(bodyHints);
  return {
    platform: fromHeaders.platform || fromBody.platform,
    platformVersion: fromHeaders.platformVersion || fromBody.platformVersion,
    model: fromHeaders.model || fromBody.model,
    mobile: typeof fromHeaders.mobile === "boolean" ? fromHeaders.mobile : fromBody.mobile,
  };
}

export function resolveDeviceSignals({ userAgent, clientHints } = {}) {
  const ua = parseUserAgent(userAgent);
  const hints = normalizeClientHints(clientHints);

  const osName = hints.platform || ua.osName;
  const osVersion = hints.platformVersion || (ua.osVersionRedacted ? null : ua.osVersion);
  const osVersionSource = hints.platformVersion
    ? "client-hints"
    : ua.osVersion && !ua.osVersionRedacted
      ? "user-agent"
      : null;

  const deviceModel = hints.model || ua.deviceModel;
  const deviceModelSource = hints.model ? "client-hints" : ua.deviceModel ? "user-agent" : null;

  return {
    browserName: ua.browserName,
    browserVersion: ua.browserVersion,
    osName,
    osVersion,
    osVersionSource,
    deviceModel,
    deviceModelSource,
  };
}

export function sanitizeStoredRequestSignals(record) {
  const ua = parseUserAgent(record ? record.userAgent : null);
  const osVersionSource = record && typeof record.osVersionSource === "string" ? record.osVersionSource : null;

  const osVersion =
    osVersionSource === "client-hints"
      ? normalizePlatformVersion(record.osVersion)
      : ua.osVersionRedacted
        ? null
        : ua.osVersion;

  const deviceModelSource =
    record && typeof record.deviceModelSource === "string" ? record.deviceModelSource : null;

  const deviceModel =
    deviceModelSource === "client-hints"
      ? normalizeModelValue(record.deviceModel)
      : ua.deviceModel || (deviceModelSource === "user-agent" ? normalizeModelValue(record.deviceModel) : null);

  return {
    osVersion,
    osVersionSource: osVersion ? (osVersionSource === "client-hints" ? "client-hints" : "user-agent") : null,
    deviceModel,
    deviceModelSource: deviceModel ? (deviceModelSource === "client-hints" ? "client-hints" : "user-agent") : null,
  };
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
