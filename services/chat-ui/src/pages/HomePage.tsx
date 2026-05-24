import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { chat } from "../api/chat";
import { Sidebar } from "../components/Sidebar";
import { Composer, type ComposerSettings } from "../components/Composer";
import { greeting } from "../lib/format";

const SUGGESTIONS = [
  { lead: "Explain inference logging", body: "in one paragraph, for a new engineer." },
  { lead: "Compare streaming vs batch", body: "telemetry for LLM apps." },
  { lead: "Draft a release note", body: "for our latency p95 improvement." },
  { lead: "Sketch a schema", body: "for storing prompt/response previews safely." },
];

export function HomePage() {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ComposerSettings>({
    streaming: true,
    provider: "mock",
    model: "mock-chat",
    temperature: 0.2,
    max_tokens: 512,
  });
  const navigate = useNavigate();

  async function start(initial?: string) {
    const content = (initial ?? draft).trim();
    if (!content) return;
    setBusy(true);
    setError(null);
    try {
      const conv = await chat.createConversation();
      navigate(`/c/${conv.id}`, { state: { initialDraft: content, settings } });
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <div className="topbar">
          <div className="topbar__title">
            <span className="muted">New conversation</span>
          </div>
          <div className="model-pick">
            <span className="model-pick__dot" />
            <select
              value={settings.provider}
              onChange={(e) => setSettings({ ...settings, provider: e.target.value })}
            >
              <option value="mock">Ollive Mock</option>
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="groq">Groq</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>
        </div>

        {error ? (
          <div className="banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        ) : null}

        <div className="welcome">
          <div className="welcome__inner">
            <div className="hero">
              {greeting()}. <em>What shall we look at today?</em>
              <div className="hero__sub">
                Ollive is a thin chat surface over a logged inference pipeline. Every reply is
                traced for latency, tokens, and cost.
              </div>
            </div>

            <Composer
              value={draft}
              onChange={setDraft}
              onSend={() => start()}
              busy={busy}
              settings={settings}
              onSettings={setSettings}
              placeholder="Pose a question to begin a new conversation…"
              autoFocus
              showHint
            />

            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s.lead} className="suggestion" onClick={() => start(`${s.lead} ${s.body}`)}>
                  <span className="suggestion__lead">{s.lead}</span>
                  <span>{s.body}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
