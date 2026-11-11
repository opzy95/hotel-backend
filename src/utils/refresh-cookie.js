const REFRESH_COOKIE_NAME = "hotel_refresh";

function cookieOptions(maxAge) {
  const configuredSameSite = (process.env.COOKIE_SAME_SITE || "lax").toLowerCase();
  const sameSite = ["lax", "strict", "none"].includes(configuredSameSite)
    ? configuredSameSite
    : "lax";
  const secure = sameSite === "none"
    || process.env.COOKIE_SECURE === "true"
    || process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/api/auth",
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

function setRefreshCookie(res, token, expiresAt) {
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
  res.cookie(REFRESH_COOKIE_NAME, token, cookieOptions(maxAge));
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions());
}

function isTrustedFrontendOrigin(req) {
  const origin = req.get("origin");
  if (!origin || !process.env.FRONTEND_URL) {
    return false;
  }
  try {
    return origin === new URL(process.env.FRONTEND_URL).origin;
  } catch {
    return false;
  }
}

module.exports = {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  cookieOptions,
  isTrustedFrontendOrigin,
  setRefreshCookie,
};