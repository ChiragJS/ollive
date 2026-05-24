import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { chat } from "../api/chat";
import type { ChatMessage, Conversation } from "../types";
import { Sidebar } from "../components/Sidebar";
import { Composer, type ComposerSettings } from "../components/Composer";
import { MessageBubble } from "../components/MessageBubble";
import { Icon } from "../components/Icon";

interface LocationState {
  initialDraft?: string;
  settings?: ComposerSettings;
}

export function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const initialState = (location.state as LocationState | null) ?? null;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveAssistantId, setLiveAssistantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [settings, setSettings] = useState<ComposerSettings>(
    initialState?.settings ?? {
      streaming: true,
      provider: "mock",
      model: "mock-chat",
      temperature: 0.2,
      max_tokens: 512,
    }
  );

  // Typewriter machinery: deltas land in streamBufRef; an rAF loop drains
  // them into streamDisplay at a smooth, adaptive cps so the assistant text
  // appears continuously regardless of how chunked the server stream is.
  const streamBufRef = useRef<string>("");
  const streamFinalRef = useRef<ChatMessage | null>(null);
  const [streamDisplay, setStreamDisplay] = useState("");
  const [streamPhase, setStreamPhase] = useState<"idle" | "streaming" | "draining">("idle");

  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const initialDraftHandled = useRef(false);
  // Guards a one-shot auto-title call per conversation id. Reset when the
  // route changes to a different conversation.
  const autoTitleAttempted = useRef(false);
  const stoppedAssistantRef = useRef<string | null>(null);

  const refreshConversation = useCallback(async () => {
    if (!id) return;
    try {
      const r = await chat.getConversation(id);
      setConversation(r.conversation);
      setMessages(r.messages);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [id]);

  useEffect(() => {
    initialDraftHandled.current = false;
    autoTitleAttempted.current = false;
    void refreshConversation();
  }, [id, refreshConversation]);

  // Auto-title: once per conversation, after the first assistant message has
  // landed and the typewriter has settled. The endpoint itself is idempotent
  // (it bails if the title is already non-default), so this is safe to fire
  // even if the conversation was titled elsewhere.
  useEffect(() => {
    if (autoTitleAttempted.current) return;
    if (!id) return;
    if (streamPhase !== "idle") return;
    if (!conversation || conversation.title !== "New conversation") return;
    const hasCompletedAssistant = messages.some(
      (m) => m.role === "assistant" && m.status === "completed" && m.content.length > 0
    );
    if (!hasCompletedAssistant) return;
    autoTitleAttempted.current = true;
    chat
      .autoTitle(id, { provider: settings.provider, model: settings.model })
      .then((r) => {
        setConversation(r.conversation);
        setRefreshKey((k) => k + 1);
      })
      .catch(() => {
        // Allow a future trigger to retry if the page state changes.
        autoTitleAttempted.current = false;
      });
  }, [id, conversation, messages, streamPhase, settings.provider, settings.model]);

  // Auto-scroll — also depends on streamDisplay so the view follows the
  // typewriter, not just whole-message arrivals.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, liveAssistantId, streamDisplay]);

  // Typewriter rAF loop. Drains streamBufRef into streamDisplay at an
  // adaptive chars-per-second. Pacing scales with how far the buffer is
  // ahead of the displayed text — if the server is way ahead we accelerate
  // to catch up; when the stream ends we drain remaining text quickly so the
  // user isn't left waiting on an animation.
  useEffect(() => {
    if (streamPhase === "idle") return;
    let raf = 0;
    let lastT = performance.now();
    const step = (t: number) => {
      const dt = Math.min(64, t - lastT); // clamp huge frame gaps
      lastT = t;
      setStreamDisplay((prev) => {
        const target = streamBufRef.current;
        if (prev.length >= target.length) return prev;
        const gap = target.length - prev.length;
        let cps: number;
        if (streamPhase === "draining") cps = 900;
        else if (gap > 240) cps = 360;
        else if (gap > 80)  cps = 200;
        else if (gap > 25)  cps = 110;
        else                cps = 65;
        const add = Math.max(1, Math.ceil((cps * dt) / 1000));
        return target.slice(0, Math.min(target.length, prev.length + add));
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [streamPhase]);

  // Finalize: once the typewriter has caught up to the buffer and we are in
  // the draining phase, install the canonical final message (from the
  // terminal SSE event) and reset typewriter state.
  useEffect(() => {
    if (streamPhase !== "draining") return;
    if (streamDisplay.length < streamBufRef.current.length) return;
    const finalAm = streamFinalRef.current;
    const liveId = liveAssistantId;
    if (finalAm) {
      setMessages((prev) => prev.map((m) => (m.id === finalAm.id ? finalAm : m)));
    } else if (liveId) {
      // No terminal event (stream aborted) — preserve whatever we displayed
      // so the bubble doesn't flash empty before refreshConversation lands.
      const buf = streamBufRef.current;
      setMessages((prev) =>
        prev.map((m) => (m.id === liveId ? { ...m, content: buf } : m))
      );
    }
    streamBufRef.current = "";
    streamFinalRef.current = null;
    setStreamDisplay("");
    setLiveAssistantId(null);
    setStreamPhase("idle");
  }, [streamPhase, streamDisplay, liveAssistantId]);

  const send = useCallback(
    async (override?: string) => {
      if (!id) return;
      const content = (override ?? draft).trim();
      if (!content || busy) return;
      setDraft("");
      setBusy(true);
      setError(null);
      const body = {
        content,
        provider: settings.provider,
        model: settings.model,
        temperature: settings.temperature,
        max_tokens: settings.max_tokens,
      };
      if (!settings.streaming) {
        try {
          const r = await chat.sendMessage(id, body);
          setMessages((prev) => [...prev, r.user_message, r.assistant_message]);
          setConversation(r.conversation);
          setRefreshKey((k) => k + 1);
        } catch (e) {
          setError(String((e as Error).message ?? e));
        } finally {
          setBusy(false);
        }
        return;
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await chat.streamMessage(id, body, {
          signal: ctrl.signal,
          onEvent: (ev) => {
            let payload: any;
            try {
              payload = JSON.parse(ev.data);
            } catch {
              return;
            }
            if (ev.event === "message.created") {
              // Reset typewriter for the new stream.
              stoppedAssistantRef.current = null;
              streamBufRef.current = "";
              streamFinalRef.current = null;
              setStreamDisplay("");
              setStreamPhase("streaming");
              setLiveAssistantId(payload.assistant_message.id);
              // The assistant message starts with content === "" — the
              // typewriter renders streamDisplay on top of it.
              setMessages((prev) => [...prev, payload.user_message, payload.assistant_message]);
              return;
            }
            if (ev.event === "message.delta") {
              // Append to buffer only — the rAF loop drains it into the DOM.
              streamBufRef.current += payload.delta as string;
              return;
            }
            if (
              ev.event === "message.completed" ||
              ev.event === "message.cancelled" ||
              ev.event === "error"
            ) {
              // Stash the canonical final message; the finalize effect
              // installs it once the typewriter has caught up to the buffer.
              if (payload.assistant_message) {
                streamFinalRef.current = payload.assistant_message as ChatMessage;
              }
              setStreamPhase("draining");
              if (ev.event === "error") {
                setError(String(payload.detail || payload.message || "Stream failed"));
              }
            }
          },
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError(String((e as Error).message ?? e));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
        setRefreshKey((k) => k + 1);
        if (stoppedAssistantRef.current) {
          return;
        }
        // If the stream ended without a terminal event (network drop,
        // abort), still kick the typewriter into drain so it can finish
        // and clean up.
        setStreamPhase((p) => (p === "streaming" ? "draining" : p));
        void refreshConversation();
      }
    },
    [busy, draft, id, refreshConversation, settings]
  );

  // Auto-send initial draft from HomePage
  useEffect(() => {
    if (!initialState?.initialDraft) return;
    if (initialDraftHandled.current) return;
    if (!id || messages.length > 0) return;
    initialDraftHandled.current = true;
    void send(initialState.initialDraft);
    // We intentionally only depend on id/messages.length so the initial send fires once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, messages.length]);

  const stopGeneration = () => {
    // Stop only the in-flight assistant message. The conversation remains
    // active so the user can continue the thread after a bad/long response.
    // Abort first: waiting for the cancel request can be delayed behind the
    // active streaming fetch in the browser/proxy connection pool.
    const messageId = liveAssistantId;
    const frozenContent = streamDisplay;
    if (messageId) {
      stoppedAssistantRef.current = messageId;
      streamBufRef.current = frozenContent;
      streamFinalRef.current = null;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, content: frozenContent, status: "cancelled" } : m
        )
      );
      setLiveAssistantId(null);
      setStreamDisplay("");
      setStreamPhase("idle");
    }
    abortRef.current?.abort();
    setBusy(false);
    if (id && messageId) {
      void chat
        .cancelMessage(id, messageId)
        .then((r) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === r.message.id ? { ...m, status: r.message.status } : m
            )
          );
          setRefreshKey((k) => k + 1);
        })
        .catch(() => {
          // The aborted stream path also finalises the assistant message
          // server-side; this request is a best-effort explicit signal.
        })
    }
  };

  const cancelConversation = async () => {
    abortRef.current?.abort();
    if (!id) return;
    try {
      const r = await chat.cancelConversation(id);
      setConversation(r.conversation);
      await refreshConversation();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const closed = conversation?.status === "cancelled";

  return (
    <div className="app">
      <Sidebar refreshKey={refreshKey} />
      <main className="main">
        <div className="topbar">
          <div className="topbar__title">
            {conversation?.title || <span className="muted">Loading…</span>}
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
          {closed ? (
            <span className="closed-pill">Cancelled</span>
          ) : (
            <button
              className="icon-btn icon-btn--danger"
              onClick={() => void cancelConversation()}
              title="Cancel this conversation"
            >
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>

        {error ? (
          <div className="banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        ) : null}

        <div className="thread-wrap" ref={bodyRef}>
          <div className="thread">
            {messages.length === 0 && !busy ? (
              <div style={{ textAlign: "center", color: "var(--ink-faint)", padding: "32px 0" }}>
                Empty conversation — type a message below to begin.
              </div>
            ) : (
              messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  isStreaming={m.id === liveAssistantId}
                  streamingContent={m.id === liveAssistantId ? streamDisplay : undefined}
                />
              ))
            )}
          </div>
        </div>

        <div className="composer-wrap composer-wrap--bottom">
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => void send()}
            onStop={stopGeneration}
            busy={busy}
            disabled={closed}
            settings={settings}
            onSettings={setSettings}
            placeholder={closed ? "This conversation is closed." : "Reply to Ollive…"}
            autoFocus={messages.length > 0}
          />
        </div>
      </main>
    </div>
  );
}
