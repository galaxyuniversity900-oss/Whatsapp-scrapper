'use strict';

const crypto = require('crypto');

function required(value, name) {
  const out = String(value || '').trim();
  if (!out) throw new Error(name + ' is required.');
  return out;
}
function safePhone(value) {
  const phone = String(value || '').replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(phone)) throw new Error('Recipient phone must be in international digits format.');
  return phone;
}
function timingSafeHexEqual(a, b) {
  const left = Buffer.from(String(a || '').toLowerCase(), 'utf8');
  const right = Buffer.from(String(b || '').toLowerCase(), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

class WhatsAppCloudApi {
  constructor({ token = process.env.WHATSAPP_CLOUD_TOKEN, phoneNumberId = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID, appSecret = process.env.WHATSAPP_CLOUD_APP_SECRET, graphVersion = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0', fetchImpl = globalThis.fetch, audit = null } = {}) {
    this.token = String(token || '').trim();
    this.phoneNumberId = String(phoneNumberId || '').trim();
    this.appSecret = String(appSecret || '').trim();
    this.graphVersion = String(graphVersion || 'v23.0').trim();
    this.fetch = fetchImpl;
    this.audit = audit;
    this.enabled = false;
  }
  status() {
    return { provider: 'whatsapp-cloud-api', configured: !!(this.token && this.phoneNumberId && this.appSecret && typeof this.fetch === 'function'), enabled: this.enabled, sendsEnabled: false, mode: 'template-only-until-explicitly-enabled' };
  }
  enableSending(confirmation) {
    if (confirmation !== 'ENABLE CLOUD API SENDING') throw new Error('Explicit confirmation text is required.');
    if (!this.token || !this.phoneNumberId || !this.appSecret) throw new Error('Cloud API token, phone number ID, and app secret must be configured.');
    this.enabled = true;
    return this.status();
  }
  disableSending() { this.enabled = false; return this.status(); }
  verifyWebhookSignature(rawBody, signatureHeader) {
    if (!this.appSecret) return false;
    const header = String(signatureHeader || '');
    if (!header.startsWith('sha256=')) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', this.appSecret).update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''))).digest('hex');
    return timingSafeHexEqual(expected, header);
  }
  verifyWebhookChallenge({ mode, token, challenge }, expectedToken) {
    if (mode !== 'subscribe' || !expectedToken || !timingSafeHexEqual(token, expectedToken)) return null;
    return String(challenge || '');
  }
  parseWebhook(payload) {
    const events = [];
    for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const value = change?.value || {};
        for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
          events.push({ type: 'message_status', id: String(status.id || ''), recipientId: String(status.recipient_id || ''), status: String(status.status || 'unknown'), timestamp: String(status.timestamp || ''), errors: Array.isArray(status.errors) ? status.errors.map(e => ({ code: e.code, title: e.title, message: e.message })) : [] });
        }
        for (const message of Array.isArray(value.messages) ? value.messages : []) {
          events.push({ type: 'inbound_message', id: String(message.id || ''), from: String(message.from || ''), timestamp: String(message.timestamp || ''), messageType: String(message.type || 'unknown'), text: message.text?.body == null ? null : String(message.text.body).slice(0, 10000), phoneNumberId: String(value.metadata?.phone_number_id || '') });
        }
      }
    }
    return events;
  }
  async sendTemplate({ to, templateName, language = 'en_US', components = [] } = {}) {
    if (!this.enabled) throw new Error('Cloud API sending is disabled; explicitly enable it after configuration and policy review.');
    const recipient = safePhone(to);
    const name = required(templateName, 'Approved template name');
    const lang = required(language, 'Template language');
    if (!Array.isArray(components)) throw new TypeError('components must be an array.');
    if (components.length > 10) throw new Error('Too many template components.');
    if (typeof this.fetch !== 'function') throw new Error('Fetch is unavailable in this runtime.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetch('https://graph.facebook.com/' + encodeURIComponent(this.graphVersion) + '/' + encodeURIComponent(this.phoneNumberId) + '/messages', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'template', template: { name, language: { code: lang }, components } }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error('WhatsApp Cloud API request failed with HTTP ' + response.status + (data.error?.code ? ' (provider code ' + data.error.code + ')' : '') + '.');
        error.status = response.status;
        error.providerCode = data.error?.code || null;
        throw error;
      }
      this.audit?.append?.('whatsapp_cloud_template_accepted', { recipientMasked: recipient.replace(/.(?=.{4})/g, '*'), templateName: name, messageId: data.messages?.[0]?.id || null });
      return { ok: true, messageId: data.messages?.[0]?.id || null, recipientMasked: recipient.replace(/.(?=.{4})/g, '*'), provider: 'whatsapp-cloud-api' };
    } catch (error) {
      this.audit?.append?.('whatsapp_cloud_template_failed', { recipientMasked: recipient.replace(/.(?=.{4})/g, '*'), templateName: name, error: String(error.message || error).slice(0, 240) });
      throw error;
    } finally { clearTimeout(timeout); }
  }
}
module.exports = { WhatsAppCloudApi, safePhone };
