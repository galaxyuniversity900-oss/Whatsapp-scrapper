'use strict';

/**
 * AI Capability Foundation
 * Provider-neutral execution contract for local/cloud models.
 * No messaging side effects: callers must explicitly authorize actions.
 */
class CapabilityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CapabilityError';
    this.code = code;
    this.details = details;
  }
}

const TASKS = Object.freeze({
  chat: { required: ['messages'] },
  generate: { required: ['prompt'] },
  analyze: { required: ['input'] },
  code: { required: ['prompt'] }
});

class CapabilityFoundation {
  constructor({ hub, audit = null, policy = {} } = {}) {
    if (!hub) throw new Error('AIProviderHub is required');
    this.hub = hub;
    this.audit = audit;
    this.policy = {
      maxProviders: 30,
      timeoutMs: 120000,
      allowExternal: true,
      allowLocal: true,
      ...policy
    };
  }

  catalog() {
    return {
      version: '1.0.0',
      tasks: Object.keys(TASKS),
      models: this.hub.models(),
      policy: { ...this.policy }
    };
  }

  async health(providerId) {
    const started = Date.now();
    try {
      const models = await this.hub.discover(providerId);
      return { provider: providerId, ok: true, latencyMs: Date.now() - started, models };
    } catch (error) {
      return { provider: providerId, ok: false, latencyMs: Date.now() - started, error: String(error.message || error) };
    }
  }

  async execute(request = {}) {
    const task = String(request.task || 'chat');
    if (!TASKS[task]) throw new CapabilityError('TASK_UNSUPPORTED', 'Unsupported AI task', { task });
    const provider = String(request.provider || '').trim();
    if (!provider) throw new CapabilityError('PROVIDER_REQUIRED', 'Provider is required');
    const started = Date.now();
    const payload = this._payload(task, request);
    try {
      const result = await this.hub.chat(provider, payload);
      const output = {
        ok: true,
        task,
        provider,
        model: result.model,
        text: result.text,
        usage: result.usage,
        latencyMs: Date.now() - started
      };
      this._audit('ai_capability_execute', { task, provider, model: result.model, latencyMs: output.latencyMs });
      return output;
    } catch (error) {
      this._audit('ai_capability_error', { task, provider, error: String(error.message || error) });
      throw new CapabilityError('EXECUTION_FAILED', String(error.message || error), { task, provider });
    }
  }

  async fallback(request = {}) {
    const providers = Array.isArray(request.providers) ? request.providers.slice(0, this.policy.maxProviders) : [];
    if (!providers.length) throw new CapabilityError('FALLBACK_EMPTY', 'At least one provider is required');
    const errors = [];
    for (const provider of providers) {
      try { return await this.execute({ ...request, provider }); }
      catch (error) { errors.push({ provider, error: String(error.message || error) }); }
    }
    throw new CapabilityError('ALL_PROVIDERS_FAILED', 'All AI providers failed', { errors });
  }

  async compare(request = {}) {
    const providers = Array.isArray(request.providers) ? request.providers.slice(0, this.policy.maxProviders) : [];
    return this.hub.compare({ ...request, providers });
  }

  _payload(task, request) {
    if (task === 'chat') return { ...request, messages: request.messages };
    if (task === 'generate' || task === 'analyze' || task === 'code') {
      return { ...request, prompt: request.prompt || request.input };
    }
    return request;
  }

  _audit(event, data) {
    try { if (this.audit?.append) this.audit.append(event, data); } catch {}
  }
}

module.exports = { CapabilityFoundation, CapabilityError, TASKS };
