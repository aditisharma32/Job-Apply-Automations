'use strict';

// Sends via the Gmail API (compile MIME locally with nodemailer's buffer
// transport, then POST it over HTTPS). No SMTP.
const nodemailer = require('nodemailer');
const config = require('../config');
const gmailApi = require('./gmailApi');

const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

async function verifyTransport() {
  const r = await gmailApi.verify();
  if (!r || !r.ok) throw new Error('Gmail API verify failed');
  return r;
}

async function sendMail({ to, subject, html, text }) {
  const from = config.gmail.fromName
    ? `"${config.gmail.fromName}" <${config.gmail.user}>`
    : config.gmail.user;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    html,
    text,
    replyTo: config.gmail.replyTo || undefined,
  });
  const sent = await gmailApi.sendRaw(info.message);
  return { messageId: info.messageId, gmailId: sent.id, threadId: sent.threadId };
}

module.exports = { verifyTransport, sendMail };
