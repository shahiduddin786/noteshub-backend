import { BrevoClient } from "@getbrevo/brevo";
import "dotenv/config";
import { escapeHtml } from "../utils/recovery.js";

const wrap = (body) => `
  <div style="background:#f1f5f9;padding:30px;font-family:Arial,sans-serif">
    <div style="max-width:520px;margin:auto;background:#ffffff;padding:30px;border-radius:10px">
      <div style="text-align:center;margin-bottom:20px">
        <h2 style="color:#0A58CA;margin:0">NotesHub</h2>
      </div>
      ${body}
      <hr style="margin:25px 0;border:none;border-top:1px solid #e5e7eb"/>
      <p style="font-size:12px;color:#64748b;text-align:center">
        &copy; ${new Date().getFullYear()} NotesHub. All rights reserved.
      </p>
    </div>
  </div>
`;

const approvedBody = ({ username, noteTitle, reference, resolvedAt }) => `
  <p style="color:#0f172a;font-size:15px">Hi ${escapeHtml(username || "there")},</p>
  <p style="color:#0f172a;font-size:15px">
    Your device recovery request for <b>${escapeHtml(noteTitle)}</b> has been
    <b style="color:#16a34a">approved</b>, and access to your purchased notes has been
    restored on the browser you requested from.
  </p>
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin:18px 0">
    <p style="margin:0;color:#166534;font-size:14px;font-weight:bold">How to reopen your notes</p>
    <p style="margin:6px 0 0;color:#166534;font-size:13px">
      Open NotesHub in this browser, go back to the paid note and open it as usual.
      Your existing purchase is still valid — you do not need to pay again.
    </p>
  </div>
  <p style="color:#334155;font-size:13px">Request reference: <b>${escapeHtml(reference)}</b></p>
  <p style="color:#334155;font-size:13px">Resolved on: ${escapeHtml(resolvedAt)}</p>
  <p style="color:#334155;font-size:13px">
    If you still cannot open the note, please contact us from the Contact page.
  </p>
`;

const rejectedBody = ({ username, noteTitle, reference, reason, resolvedAt }) => `
  <p style="color:#0f172a;font-size:15px">Hi ${escapeHtml(username || "there")},</p>
  <p style="color:#0f172a;font-size:15px">
    Your device recovery request for <b>${escapeHtml(noteTitle)}</b> has been
    <b style="color:#dc2626">rejected</b> after review.
  </p>
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin:18px 0">
    <p style="margin:0;color:#991b1b;font-size:14px;font-weight:bold">Reason</p>
    <p style="margin:6px 0 0;color:#991b1b;font-size:13px">${escapeHtml(reason)}</p>
  </div>
  <p style="color:#334155;font-size:13px">Request reference: <b>${escapeHtml(reference)}</b></p>
  <p style="color:#334155;font-size:13px">Resolved on: <b>${escapeHtml(resolvedAt)}</b></p>
  <p style="color:#334155;font-size:13px">
    If you believe this decision is a mistake, you can submit a new request from the
    paid note page or reach us from the Contact page.
  </p>
`;

export const sendRecoveryDecisionMail = async ({
  to,
  username,
  noteTitle,
  reference,
  status,
  reason,
  resolvedAt,
}) => {
  if (!to) {
    throw new Error("Recipient email is required");
  }

  const approved = status === "APPROVED";
  const subject = approved
    ? `Device recovery approved - access restored (${reference})`
    : `Device recovery request rejected (${reference})`;

  const body = approved
    ? approvedBody({ username, noteTitle, reference, resolvedAt })
    : rejectedBody({ username, noteTitle, reference, reason, resolvedAt });

  const brevo = new BrevoClient({
    apiKey: process.env.BREVO_API_KEY,
    timeoutInSeconds: 30,
    maxRetries: 2,
  });

  try {
    await brevo.transactionalEmails.sendTransacEmail({
      sender: {
        name: "NotesHub",
        email: process.env.NOTESHUB_SENDER_EMAIL,
      },
      to: [{ email: to }],
      subject,
      htmlContent: wrap(body),
    });
  } catch (err) {
    const status = err?.statusCode ?? err?.status;
    if (status === 401) {
      console.error("Brevo: Invalid API key");
      throw new Error("Email service authentication failed");
    }
    if (status === 429) {
      console.error("Brevo: Rate limit hit");
      throw new Error("Email service rate limit exceeded, try again later");
    }
    if (status) {
      console.error("Brevo API error:", err.message);
      throw new Error("Email service error");
    }
    console.error("Unexpected error sending recovery decision email:", err.message);
    throw new Error("Failed to send recovery decision email");
  }
};
