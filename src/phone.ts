const arabicDigits = (value: string) =>
  value.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0));

/** Canonical form shared by the admin UI and the PIN Worker contract. */
export function normalizeIraqiPhone(value: unknown) {
  let phone = typeof value === "string"
    ? arabicDigits(value).replace(/[\s().\-\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    : "";
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (/^\+96407\d{9}$/.test(phone)) phone = `+964${phone.slice(5)}`;
  else if (/^96407\d{9}$/.test(phone)) phone = `+964${phone.slice(4)}`;
  else if (/^07\d{9}$/.test(phone)) phone = `+964${phone.slice(1)}`;
  else if (/^7\d{9}$/.test(phone)) phone = `+964${phone}`;
  else if (/^9647\d{9}$/.test(phone)) phone = `+${phone}`;
  if (!/^\+?[1-9]\d{7,14}$/.test(phone)) throw new Error("رقم هاتف غير صالح");
  return phone;
}
/** Local Iraqi form reserved for user-facing screens and printed documents. */
export function displayIraqiPhone(value: unknown) {
  const phone = normalizeIraqiPhone(value);
  return `0${phone.slice(4)}`;
}

