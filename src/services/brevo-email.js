function getEmailSenderConfiguration() {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Hotel Platform";

  if (!apiKey || !senderEmail) {
    throw new Error(
      "BREVO_API_KEY and BREVO_SENDER_EMAIL must be configured to send email",
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    throw new Error("BREVO_SENDER_EMAIL must be a valid email address");
  }
  return { apiKey, senderEmail, senderName };
}

function getFrontendConfiguration() {
  const frontendUrl = process.env.FRONTEND_URL?.trim();
  if (!frontendUrl) {
    throw new Error("FRONTEND_URL must be configured to send password-reset emails");
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

  return frontend;
}

function getEmailConfiguration() {
  return {
    ...getEmailSenderConfiguration(),
    frontend: getFrontendConfiguration(),
  };
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
  const { apiKey, senderEmail, senderName } = getEmailSenderConfiguration();
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

async function sendVerificationEmail(user, code) {
  if (!/^\d{6}$/.test(code)) {
    throw new TypeError("Verification code must contain exactly six digits");
  }
  const name = escapeHtml(user.name);
  const escapedCode = escapeHtml(code);
  await sendBrevoEmail({
    to: { email: user.email, name: user.name },
    subject: "Your email verification code",
    text: `Hello ${user.name}, your email verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Hello ${name},</p><p>Your email verification code is:</p><p><strong>${escapedCode}</strong></p><p>This code expires in 10 minutes. If you did not create an account, you can ignore this email.</p>`,
  });
}

async function sendPasswordResetEmail(user, token) {
  const frontend = getFrontendConfiguration();
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
