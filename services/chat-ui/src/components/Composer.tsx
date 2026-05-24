import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

export interface ComposerSettings {
  streaming: boolean;
  provider: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  settings: ComposerSettings;
  onSettings: (s: ComposerSettings) => void;
  autoFocus?: boolean;
  showHint?: boolean;
}

const PROVIDERS: { value: string; label: string; defaultModel: string }[] = [
  { value: "mock", label: "Mock", defaultModel: "mock-chat" },
  { value: "openai", label: "OpenAI", defaultModel: "gpt-4.1-mini" },
  { value: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat" },
  { value: "groq", label: "Groq", defaultModel: "llama-3.1-8b-instant" },
  { value: "openrouter", label: "OpenRouter", defaultModel: "openai/gpt-oss-120b:free" },
];

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy = false,
  disabled = false,
  placeholder = "Reply to Ollive…",
  settings,
  onSettings,
  autoFocus = false,
  showHint = false,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // autosize
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [value]);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  return (
    <>
      <div className="composer">
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy && value.trim()) onSend();
            }
          }}
        />
        <div className="composer__bottom">
          <button
            className={`chip ${settings.streaming ? "is-on" : ""}`}
            onClick={() => onSettings({ ...settings, streaming: !settings.streaming })}
            title="Toggle streaming"
            type="button"
          >
            <Icon name="spark" size={13} />
            <span>{settings.streaming ? "Streaming" : "Streaming off"}</span>
          </button>
          <label className="chip" title="Provider" style={{ paddingRight: 6 }}>
            <span style={{ color: "var(--ink-faint)" }}>Provider</span>
            <select
              value={settings.provider}
              onChange={(e) => {
                const p = PROVIDERS.find((x) => x.value === e.target.value);
                onSettings({
                  ...settings,
                  provider: e.target.value,
                  model: p ? p.defaultModel : settings.model,
                });
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <span className="spacer" />
          {busy ? (
            <button
              className="send-btn send-btn--stop"
              onClick={onStop}
              title="Stop generating"
              type="button"
            >
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={onSend}
              disabled={disabled || !value.trim()}
              title="Send"
              type="button"
            >
              <Icon name="send" size={16} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
      {showHint ? (
        <div className="compose-hint">
          Press <b>Enter</b> to send · <b>Shift + Enter</b> for a new line
        </div>
      ) : null}
    </>
  );
}
