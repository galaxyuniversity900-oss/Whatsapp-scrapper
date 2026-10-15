# Universal AI + MCP Connector Layer (5.7)

This layer extends the existing AI Provider Hub without making AI a requirement. Existing deterministic features keep working when no provider is configured.

## Connection types
- `api`: authenticated JSON HTTP endpoints.
- `openai-compatible`: OpenAI-compatible endpoints, including NVIDIA NIM, DeepSeek, Groq, OpenRouter, Together, Fireworks, Ollama, LM Studio, vLLM and llama.cpp.
- `mcp`: MCP Streamable HTTP endpoints with initialize, tools/list and explicit tools/call.
- `session`: user-authorized bearer session token.
- `cookie`: user-authorized cookie for an endpoint they own or are permitted to integrate.
- `agent`: an HTTP endpoint exposed by an agent runtime such as LangGraph, CrewAI, AutoGen, Google ADK, Semantic Kernel, LlamaIndex, Dify or Flowise.
- `webhook`: outbound requests to a configured webhook.

Credentials are encrypted at rest with AES-256-GCM. The connector API never returns secrets. Use a stable `AI_MASTER_KEY` or `WA_MASTER_KEY` before adding credentials; changing the key later makes stored credentials unreadable. Do not commit keys, cookies, tokens, or session files to GitHub. Never paste a browser cookie from a third-party service to bypass its official API, access controls, or terms.

## API
All routes are behind the app's existing administrator login and API-token authorization.

- `GET /api/connectors/catalog`
- `GET /api/connectors`
- `POST /api/connectors`
- `DELETE /api/connectors?id=...`
- `POST /api/connectors/health` with `{ "id": "..." }`
- `POST /api/connectors/request` with `{ "id": "...", "method": "POST", "body": {} }`
- `GET /api/connectors/mcp/tools?id=...`
- `POST /api/connectors/mcp/call` with `{ "id": "...", "name": "tool_name", "arguments": {} }`

For `POST /api/connectors`, provide fields such as:
```json
{
  "id": "nvidia-nim",
  "name": "NVIDIA NIM",
  "type": "openai-compatible",
  "protocol": "openai-compatible",
  "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
  "credentialMode": "bearer",
  "credentials": { "token": "YOUR_NVIDIA_API_KEY" },
  "enabled": true
}
```

The universal connector stores endpoints and credentials; it does not claim that every provider's proprietary API or every agent framework is natively implemented. Use the correct provider endpoint and request schema. MCP tool calls are explicit, logged by the caller where applicable, and never auto-run simply because a server advertises a tool.

## No-AI mode
AI routes are optional. The CRM, import/export, contact policies, deterministic validation, local reporting and core server continue to work without API keys or external AI services. Local inference endpoints are optional and must already be running on the device/network.

## VERITAS Control Center
The deterministic control center provides:
- `GET /api/control-center/health`: runtime preflight, writable data directory, optional spreadsheet module check, and AI-optional status.
- `GET /api/control-center/playbooks`: safe, reviewable operational playbooks.
- `POST /api/control-center/mission`: turn a plain-language goal into a plan; does not execute side effects.
- `POST /api/control-center/data-quality`: report missing/invalid/duplicate contact fields and opt-outs.
- `POST /api/control-center/change-radar`: compare before/after arrays and report added, removed and changed records.
- `POST /api/control-center/opportunities`: rank repeated topics in supplied records; frequency is not proof of demand.
- `POST /api/control-center/simulate`: deterministic consent, opt-out, duplicate and phone checks; sending count is always zero.

All Control Center endpoints are behind the existing admin and API-token protections. Reports do not mutate source records.
