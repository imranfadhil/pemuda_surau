import { config } from '../config.js';

/**
 * Send an SMS. Providers are pluggable; the default "console" provider
 * just logs the message so local development needs no external service.
 */
export async function sendSms(to, message) {
  switch (config.sms.provider) {
    case 'twilio':
      return sendViaTwilio(to, message);
    case 'vonage':
      return sendViaVonage(to, message);
    case 'console':
    default:
      console.log(`[sms:console] to=${to} message="${message}"`);
      return { provider: 'console', ok: true };
  }
}

async function sendViaTwilio(to, message) {
  const [accountSid, authToken] = config.sms.apiKey.split(':');
  if (!accountSid || !authToken) {
    throw new Error('SMS_API_KEY must be "accountSid:authToken" for Twilio');
  }
  const body = new URLSearchParams({
    To: to,
    From: config.sms.senderId,
    Body: message,
  });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );
  if (!res.ok) {
    throw new Error(`Twilio error: ${res.status} ${await res.text()}`);
  }
  return { provider: 'twilio', ok: true };
}

async function sendViaVonage(to, message) {
  const res = await fetch('https://rest.nexmo.com/sms/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.sms.apiKey,
      api_secret: config.sms.senderId,
      to,
      from: config.sms.senderId,
      text: message,
    }),
  });
  if (!res.ok) {
    throw new Error(`Vonage error: ${res.status} ${await res.text()}`);
  }
  return { provider: 'vonage', ok: true };
}
