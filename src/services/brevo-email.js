function getEmailConfiguration() {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Hotel Platform";
  const frontendUrl = process.env.FRONTEND_URL?.trim();

  if (!apiKey || !senderEmail || !frontendUrl) {
    throw new Error(
      "BREVO_API_KEY, BREVO_SENDER_EMAIL, and FRONTEND_URL must be configured to send email",
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    throw new Error("BREVO_SENDER_EMAIL must be a valid email address");
  }

  let frontend;
  try {
    frontend = new URL(frontendUrl);
  } catch {
    throw new Error("FRONTEND_URL must be a valid absolute URL");
  }
  if (!["http:", "https:"].includes(frontend.protocol)) {
    throw new Error("FRONTEND_URL must use HTTP or HTTPS");
  }
  const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(frontend.hostname);
  if (frontend.protocol !== "https:" && !isLocalhost) {
    throw new Error("FRONTEND_URL must use HTTPS outside localhost");
  }
  if (frontend.username || frontend.password || frontend.search || frontend.hash) {
    throw new Error("FRONTEND_URL must be an origin or path without credentials, query, or fragment");
  }

  return { apiKey, senderEmail, senderName, frontend };
}

function buildActionUrl(path, token, frontend) {
  const url = new URL(path, frontend);
  url.searchParams.set("token", token);
  return url.toString();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

async function sendBrevoEmail({ to, subject, text, html }) {
  const { apiKey, senderEmail, senderName } = getEmailConfiguration();
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to.email, name: to.name }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Brevo email request failed with status ${response.status}`);
  }
}

async function sendVerificationEmail(user, token) {
  const { frontend } = getEmailConfiguration();
  const url = buildActionUrl("/verify-email", token, frontend);
  const name = escapeHtml(user.name);
  await sendBrevoEmail({
    to: { email: user.email, name: user.name },
    subject: "Verify your email address",
    text: `Hello ${user.name}, verify your account using this link (valid for 24 hours): ${url}`,
    html: `<p>Hello ${name},</p><p><a href="${url}">Verify your email address</a></p><p>This link expires in 24 hours. If you did not create an account, you can ignore this email.</p>`,
  });
}

async function sendPasswordResetEmail(user, token) {
  const { frontend } = getEmailConfiguration();
  const url = buildActionUrl("/reset-password", token, frontend);
  const name = escapeHtml(user.name);
  await sendBrevoEmail({
    to: { email: user.email, name: user.name },
    subject: "Reset your password",
    text: `Hello ${user.name}, reset your password using this link (valid for 1 hour): ${url}`,
    html: `<p>Hello ${name},</p><p><a href="${url}">Reset your password</a></p><p>This link expires in 1 hour. If you did not request a reset, you can ignore this email.</p>`,
  });
}

module.exports = {
  getEmailConfiguration,
  sendBrevoEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
};
