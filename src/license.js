// Zero-backend Gumroad License Key verification for ContextPack Pro ($9.99 one-time).

const GUMROAD_PRODUCT_ID = "REPLACE_WITH_GUMROAD_PRODUCT_ID"
const GUMROAD_CHECKOUT_URL = "https://nicolastic1642.gumroad.com/l/contextpack-pro"

async function verifyGumroadLicense(licenseKey, fetchImpl = fetch) {
  const trimmed = (licenseKey || "").trim()
  if (!trimmed) {
    return { valid: false, error: "Please enter a license key." }
  }

  const body = new URLSearchParams({
    product_id: GUMROAD_PRODUCT_ID,
    license_key: trimmed,
    increment_uses_count: "false",
  })

  const response = await fetchImpl("https://api.gumroad.com/v2/licenses/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.success) {
    return {
      valid: false,
      error: data?.message || "Invalid license key.",
    }
  }
  if (data.purchase?.refunded || data.purchase?.chargebacked) {
    return { valid: false, error: "This license key has been refunded." }
  }

  return {
    valid: true,
    licenseKey: trimmed,
    email: data.purchase?.email || "",
    verifiedAt: new Date().toISOString(),
  }
}

module.exports = {
  GUMROAD_PRODUCT_ID,
  GUMROAD_CHECKOUT_URL,
  verifyGumroadLicense,
}
