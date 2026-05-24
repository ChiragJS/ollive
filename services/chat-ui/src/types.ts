export type ConversationStatus = "active" | "cancelled" | "archived";
export type MessageStatus = "pending" | "completed" | "failed" | "cancelled";
export type MessageRole = "user" | "assistant" | "system";

export interface Conversation {
  id: string;
  title: string;
  status: ConversationStatus;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

export interface ConversationListItem extends Conversation {
  message_count: number;
  last_message_preview: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  provider: string | null;
  model: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
