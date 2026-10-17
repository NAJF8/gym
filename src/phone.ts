const arabicDigits = (value: string) =>
  value.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0));

/** Canonical E.164 form shared by the UI and the PIN Worker contract. */
export function normalizeIraqiPhone(value: unknown) {
  let phone = typeof value === "string" ? arabicDigits(value).replace(/[\s().-]/g, "") : "";
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (/^07\d{9}$/.test(phone)) phone = `+964${phone.slice(1)}`;
  else if (/^7\d{9}$/.test(phone)) phone = `+964${phone}`;
  else if (/^9647\d{9}$/.test(phone)) phone = `+${phone}`;
  if (!/^\+9647\d{9}$/.test(phone)) throw new Error("رقم هاتف عراقي غير صالح");
  return phone;
}
