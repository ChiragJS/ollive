import type { ChatMessage, Conversation, ConversationListItem } from "../types";
import { streamSsePost, type SseEvent } from "../lib/sse";

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(errorMessageFromResponseText(detail, `${res.status} ${res.statusText}`));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const chat = {
  createConversation(title?: string): Promise<Conversation> {
    return req("/v1/conversations", {
      method: "POST",
      body: JSON.stringify({ title: title ?? null }),
    });
  },
  listConversations(limit = 80): Promise<{ items: ConversationListItem[] }> {
    return req(`/v1/conversations?limit=${limit}`);
  },
  getConversation(
    id: string
  ): Promise<{ conversation: Conversation; messages: ChatMessage[] }> {
    return req(`/v1/conversations/${id}`);
  },
  sendMessage(
    id: string,
    body: {
      content: string;
      provider?: string;
      model?: string;
      temperature?: number;
      max_tokens?: number;
    }
  ): Promise<{
    conversation: Conversation;
    user_message: ChatMessage;
    assistant_message: ChatMessage;
  }> {
    return req(`/v1/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  cancelConversation(id: string): Promise<{ conversation: Conversation }> {
    return req(`/v1/conversations/${id}/cancel`, { method: "POST" });
  },
  cancelMessage(id: string, messageId: string): Promise<{ message: ChatMessage }> {
    return req(`/v1/conversations/${id}/messages/${messageId}/cancel`, { method: "POST" });
  },
  autoTitle(
    id: string,
    body?: { provider?: string; model?: string }
  ): Promise<{ conversation: Conversation }> {
    return req(`/v1/conversations/${id}/auto-title`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    });
  },
  streamMessage(
    id: string,
    body: {
      content: string;
      provider?: string;
      model?: string;
      temperature?: number;
      max_tokens?: number;
    },
    handlers: {
      onEvent: (event: SseEvent) => void;
      signal?: AbortSignal;
    }
  ): Promise<void> {
    return streamSsePost({
      url: `${BASE}/v1/conversations/${id}/messages/stream`,
      body,
      onEvent: handlers.onEvent,
      signal: handlers.signal,
    });
  },
};

function errorMessageFromResponseText(text: string, fallback: string): string {
  if (!text.trim()) return fallback;
  try {
    const payload = JSON.parse(text);
    if (typeof payload?.detail === "string") return payload.detail;
    if (typeof payload?.detail?.message === "string") return payload.detail.message;
    if (typeof payload?.message === "string") return payload.message;
  } catch {
    return text;
  }
  return fallback;
}
