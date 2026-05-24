import type { ChatMessage } from "../types";

interface Props {
  message: ChatMessage;
  isStreaming: boolean;
  /**
   * While streaming, the bubble renders this typewriter-paced text instead of
   * the message's raw content. The raw content is the canonical server state;
   * the displayed text lags slightly behind so the user sees smooth output.
   */
  streamingContent?: string;
}

export function MessageBubble({ message, isStreaming, streamingContent }: Props) {
  if (message.role === "user") {
    return (
      <div className="msg msg--user">
        <span className="msg__role">You</span>
        <div className="msg__bubble--user">{message.content}</div>
      </div>
    );
  }
  const failed = message.status === "failed";
  const cancelled = message.status === "cancelled";
  const display =
    isStreaming && streamingContent !== undefined ? streamingContent : message.content;
  return (
    <div className="msg msg--assistant">
      <span className="msg__role">Ollive · {message.model || "model"}</span>
      <div className="msg__body">
        {display || (isStreaming ? "" : <span style={{ color: "var(--ink-faint)" }}>(no response)</span>)}
        {isStreaming ? <span className="msg__caret" /> : null}
      </div>
      {failed ? (
        <div className="msg__footnote">
          <span className="err">Failed</span>
          <span>·</span>
          <span className="err">{message.content.slice(0, 200)}</span>
        </div>
      ) : cancelled ? (
        <div className="msg__footnote">
          <span>Cancelled</span>
        </div>
      ) : null}
    </div>
  );
}
