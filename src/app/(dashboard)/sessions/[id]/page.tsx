"use client";
// 세션 상세 페이지 - SSE 스트리밍 실시간 렌더링 + Moderator 채팅
// fetch + ReadableStream 방식으로 SSE 수신 (POST body로 personas/apiKey 전달 가능)
import { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

// localStorage 키 (설정 페이지와 동일한 상수사용)
const STORAGE_KEY_API = "debate_gemini_api_key";
const STORAGE_KEY_PERSONAS = "debate_personas";

// ─── 타입 정의 ───────────────────────────────────

interface Message {
  id: string;
  roleType: string;
  speaker: string;
  roundNo: number;
  content: string;
}

interface FinalSummary {
  finalBrief: string;
  keyIssues: string;
  recommendedMvp: string;
  risks: string;
  nextActions: string;
}

interface Session {
  id: string;
  title: string;
  status: string;
  rawInput: string;
  additionalConstraints: string | null;
  rounds: number;
  outputTone: string;
  messages: Message[];
  finalSummary: FinalSummary | null;
}

// SSE 스트리밍 중인 메시지 (DB 저장 전 클라이언트 임시 상태)
interface StreamingMessage {
  speaker: string;
  roundNo: number;
  roleType: string;
  content: string; // 청크가 쌓이는 버퍼
  isDone: boolean; // 해당 발언자 발언 완료 여부
}

// Moderator 채팅 메시지
interface ChatMessage {
  role: "user" | "moderator";
  content: string;
  isStreaming?: boolean;
}

// ─── 스타일 상수 ─────────────────────────────────

const ROLE_STYLES: Record<string, { border: string; badge: string; icon: string }> = {
  persona_a: { border: "border-yellow-500/40 bg-yellow-500/5", badge: "bg-yellow-500/20 text-yellow-400", icon: "🎯" },
  persona_b: { border: "border-green-500/40 bg-green-500/5", badge: "bg-green-500/20 text-green-400", icon: "🔧" },
  persona_c: { border: "border-blue-500/40 bg-blue-500/5", badge: "bg-blue-500/20 text-blue-400", icon: "👤" },
  persona_d: { border: "border-orange-500/40 bg-orange-500/5", badge: "bg-orange-500/20 text-orange-400", icon: "📊" },
  moderator: { border: "border-purple-500/40 bg-purple-500/5", badge: "bg-purple-500/20 text-purple-400", icon: "⚖️" },
};

// ─── 컴포넌트 ────────────────────────────────────

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  // 서버에서 불러온 세션 데이터
  const [session, setSession] = useState<Session | null>(null);
  // SSE 스트리밍 중인 메시지들 (토론 진행 중에만 활성)
  const [streamingMessages, setStreamingMessages] = useState<StreamingMessage[]>([]);
  // 현재 스트리밍 중인 발언자 인덱스
  const [currentStreamIndex, setCurrentStreamIndex] = useState<number>(-1);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [copied, setCopied] = useState(false);
  // 접힌/펼쳙 상태 (message id Set)
  const [collapsedMessages, setCollapsedMessages] = useState<Set<string>>(new Set());

  // Moderator 채팅 상태
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // 자동 스크롤용 ref
  const bottomRef = useRef<HTMLDivElement>(null);
  // 토론 정지용 AbortController ref (fetch 스트림 중단에 사용)
  const abortControllerRef = useRef<AbortController | null>(null);

  async function fetchSession() {
    const res = await fetch(`/api/sessions/${id}`);
    const data = await res.json();
    if (data.success) {
      setSession(data.data);
      // 토론 완료 후 페르소나 메시지는 기본 접힘 상태로 설정 (moderator 기획안은 펼침 유지)
      const msgs: Message[] = data.data?.messages ?? [];
      const personaIds = new Set(msgs.filter((m: Message) => m.roleType !== "moderator").map((m: Message) => m.id));
      setCollapsedMessages(personaIds);
    }
  }

  useEffect(() => {
    fetchSession().then(() => {
      if (searchParams.get("running") === "true") {
        runDebate();
      }
    });
  }, [id]);

  // 스트리밍 메시지 추가 시 자동 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingMessages, currentStreamIndex]);

  // 메시지 접기/펼치기 토글
  function toggleCollapse(id: string) {
    setCollapsedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * SSE 기반 AI 토론 실행
   * fetch + ReadableStream으로 POST 요청 후 SSE 이벤트 수신
   * localStorage에서 API 키와 페르소나 설정 읽어 전달
   */
  /** 토론 강제 정지 - AbortController로 SSE fetch 스트림 중단 */
  function stopDebate() {
    abortControllerRef.current?.abort();
  }

  async function runDebate() {
    setRunning(true);
    setRunError("");
    setStreamingMessages([]);
    setCurrentStreamIndex(-1);
    // 새 AbortController 생성 - 정지 버튼 클릭 시 이걸 abort()
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // 설정 페이지에서 저장한 API 키 및 페르소나 읽기
    const savedApiKey = localStorage.getItem(STORAGE_KEY_API) || undefined;
    const savedPersonas = localStorage.getItem(STORAGE_KEY_PERSONAS);
    const personas = savedPersonas ? JSON.parse(savedPersonas) : undefined;

    try {
      // POST로 personas, apiKey 전달하면서 SSE 스트림 연결
      const response = await fetch(`/api/sessions/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: savedApiKey, personas }),
        // AbortController signal 연결 - 정지 시 fetch 연결 끊김
        signal: controller.signal,
      });

      if (!response.body) throw new Error("스트림을 받을 수 없습니다.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // SSE 이벤트 스트림 읽기
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE는 "\n\n"으로 이벤트를 구분
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? ""; // 마지막은 불완전한 청크일 수 있음

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const { type, data } = JSON.parse(line.slice(6));
            handleSseEvent(type, data);
          } catch {
            // JSON 파싱 실패 무시
          }
        }
      }
    } catch (err) {
      // AbortError는 사용자가 정지 버튼을 누른 것 - 오류 메시지 표시 안 함
      if (err instanceof Error && err.name === "AbortError") {
        setRunError("");
      } else {
        const message = err instanceof Error ? err.message : "연결 오류가 발생했습니다.";
        setRunError(message);
      }
    } finally {
      // 토론 완료 후 DB에서 최신 데이터 로드
      await fetchSession();
      setRunning(false);
      setStreamingMessages([]);
      setCurrentStreamIndex(-1);
    }
  }

  /**
   * SSE 이벤트 핸들러 - 이벤트 타입별 상태 업데이트
   */
  function handleSseEvent(type: string, data: Record<string, unknown>) {
    switch (type) {
      case "start": {
        // 새 발언자 말풍선 생성
        const newMsg: StreamingMessage = {
          speaker: data.speaker as string,
          roundNo: data.roundNo as number,
          roleType: data.roleType as string,
          content: "",
          isDone: false,
        };
        setStreamingMessages((prev) => {
          const next = [...prev, newMsg];
          setCurrentStreamIndex(next.length - 1);
          return next;
        });
        break;
      }

      case "chunk": {
        // 현재 발언자의 말풍선에 텍스트 추가 (타이핑 효과)
        const text = data.text as string;
        setStreamingMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) {
            next[next.length - 1] = { ...last, content: last.content + text };
          }
          return next;
        });
        break;
      }

      case "message_done": {
        // 발언 완료 표시
        setStreamingMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) {
            next[next.length - 1] = { ...last, isDone: true };
          }
          return next;
        });
        break;
      }

      case "done": {
        // 전체 토론 완료 - fetchSession에서 처리됨
        break;
      }

      case "error": {
        setRunError(data.message as string);
        break;
      }
    }
  }

  /**
   * Moderator 채팅 전송 - localStorage에서 API 키 읽어 함께 전달
   */
  async function sendChatMessage() {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setChatLoading(true);

    // 설정 페이지에서 저장한 API 키 읽기
    const savedApiKey = localStorage.getItem(STORAGE_KEY_API) || undefined;

    // 사용자 메시지 추가
    setChatMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    // Moderator 응답 자리 확보 (스트리밍 중 표시)
    setChatMessages((prev) => [...prev, { role: "moderator", content: "", isStreaming: true }]);

    try {
      const response = await fetch(`/api/sessions/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // API 키를 서버에 함께 전달
        body: JSON.stringify({ message: userMessage, apiKey: savedApiKey }),
      });

      if (!response.body) throw new Error("스트림을 받을 수 없습니다.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const { type, data } = JSON.parse(line.slice(6));
            if (type === "chunk") {
              // Moderator 응답 말풍선에 청크 추가
              setChatMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "moderator") {
                  next[next.length - 1] = { ...last, content: last.content + (data.text as string) };
                }
                return next;
              });
            } else if (type === "done" || type === "error") {
              // 스트리밍 완료
              setChatMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "moderator") {
                  next[next.length - 1] = { ...last, isStreaming: false };
                }
                return next;
              });
            }
          } catch {
            // JSON 파싱 실패 무시
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "오류가 발생했습니다.";
      setChatMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "moderator") {
          next[next.length - 1] = { ...last, content: `❌ ${message}`, isStreaming: false };
        }
        return next;
      });
    } finally {
      setChatLoading(false);
    }
  }

  // 최종안 클립보드 복사
  async function copyFinalSummary() {
    const content = session?.messages.find((m) => m.roleType === "moderator")?.content ?? "";
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!session) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  const isCompleted = session.status === "completed";
  const isFailed = session.status === "failed";
  // 토론 중에 보여줄 메시지: 스트리밍 중이면 streamingMessages, 완료 후엔 session.messages
  const displayMessages = running ? streamingMessages : session.messages;

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      {/* 헤더 */}
      <div>
        <Link href="/projects" className="text-gray-500 hover:text-gray-400 text-sm">← 프로젝트로</Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-bold text-white flex-1">{session.title}</h1>
          {/* 진행 중일 때 정지 버튼 표시 */}
          {running && (
            <button
              onClick={stopDebate}
              className="px-4 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 text-sm font-medium transition flex items-center gap-2"
            >
              ⏹ 정지
            </button>
          )}
          <span className={`text-xs px-3 py-1 rounded-full font-medium ${
            isCompleted ? "bg-green-500/20 text-green-400" :
            isFailed ? "bg-red-500/20 text-red-400" :
            running ? "bg-yellow-500/20 text-yellow-400 animate-pulse" :
            "bg-gray-500/20 text-gray-400"
          }`}>
            {running ? "🔄 토론 진행 중..." : isCompleted ? "✅ 완료" : isFailed ? "❌ 실패" : "⏳ 대기"}
          </span>
        </div>
        <p className="text-gray-500 text-sm mt-1">{session.rounds}라운드 · {session.outputTone} 톤</p>
      </div>

      {/* 에러 상태 */}
      {isFailed && !running && (
        <div className="glass rounded-2xl p-5 border border-red-500/30">
          <p className="text-red-400 font-medium">❌ AI 토론 실행 중 오류가 발생했습니다.</p>
          <button onClick={runDebate} className="mt-3 px-4 py-2 rounded-xl bg-red-600/30 hover:bg-red-600/50 text-red-300 text-sm transition">
            다시 시도
          </button>
        </div>
      )}

      {/* 대기 상태 - 수동 실행 버튼 */}
      {session.status === "pending" && !running && (
        <div className="glass rounded-2xl p-6 text-center border border-indigo-500/20">
          <p className="text-gray-300 mb-4">AI 토론을 시작할 준비가 되었습니다.</p>
          <button onClick={runDebate} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition">
            ⚡ 토론 시작
          </button>
        </div>
      )}

      {/* ─── 토론 메시지 (실시간 스트리밍 OR 완료 후 DB 로드) ─── */}
      {(displayMessages.length > 0 || session.messages.length > 0) && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">토론 로그</h2>

          {/* 원문 기획안 */}
          <div className="glass rounded-2xl p-5 border border-white/10">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-medium text-gray-400">📝 기획 원문</span>
            </div>
            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{session.rawInput}</p>
            {session.additionalConstraints && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <p className="text-xs text-gray-500 mb-1">추가 조건</p>
                <p className="text-gray-400 text-sm">{session.additionalConstraints}</p>
              </div>
            )}
          </div>

          {/* 토론 진행 중: 스트리밍 메시지 */}
          {running && streamingMessages.map((msg, idx) => {
            const style = ROLE_STYLES[msg.roleType] ?? ROLE_STYLES.persona_a;
            const isCurrentlySteaming = idx === currentStreamIndex && !msg.isDone;
            return (
              <div key={idx} className={`glass rounded-2xl p-5 border ${style.border} transition-all`}>
                <div className="flex items-center gap-2 mb-3">
                  <span>{style.icon}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.badge}`}>
                    {msg.speaker}
                  </span>
                  {msg.roundNo > 0 && (
                    <span className="text-xs text-gray-600">Round {msg.roundNo}</span>
                  )}
                  {isCurrentlySteaming && (
                    <span className="flex gap-0.5 ml-auto">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </span>
                  )}
                </div>
                <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                  {/* 커서 깜빡임 효과 */}
                  {isCurrentlySteaming && (
                    <span className="inline-block w-0.5 h-4 bg-indigo-400 ml-0.5 animate-pulse align-middle" />
                  )}
                </div>
              </div>
            );
          })}

          {/* 토론 완료 후: DB에서 로드한 메시지 */}
          {!running && session.messages.map((msg) => {
            const style = ROLE_STYLES[msg.roleType] ?? ROLE_STYLES.persona_a;
            const isCollapsed = collapsedMessages.has(msg.id);
            // 요약: 첫 80자
            const preview = msg.content.replace(/\n/g, " ").substring(0, 80);
            return (
              <div key={msg.id} className={`glass rounded-2xl border ${style.border}`}>
                {/* 헤더 영역 - 클릭하면 접기/펼치기 */}
                <div
                  className="flex items-center gap-2 p-5 cursor-pointer select-none"
                  onClick={() => toggleCollapse(msg.id)}
                >
                  <span>{style.icon}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.badge}`}>
                    {msg.speaker}
                  </span>
                  {msg.roundNo > 0 && (
                    <span className="text-xs text-gray-600">Round {msg.roundNo}</span>
                  )}
                  <span className="ml-auto text-gray-600 text-xs flex items-center gap-1">
                    {isCollapsed ? (
                      <>▼ 펼치기</>
                    ) : (
                      <>▲ 접기</>
                    )}
                  </span>
                </div>
                {/* 취소 시 요약, 펼치면 전체 */}
                {isCollapsed ? (
                  <p className="px-5 pb-4 text-gray-500 text-xs truncate">{preview}...</p>
                ) : (
                  <div className="px-5 pb-5 text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                )}
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>
      )}

      {/* 실행 에러 */}
      {runError && (
        <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
          {runError}
        </p>
      )}

      {/* ─── Moderator 최종 기획안 요약 카드 ─── */}
      {isCompleted && session.finalSummary && !running && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">⚖️ Moderator 최종 기획안</h2>
            <button
              onClick={copyFinalSummary}
              className="px-4 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm transition flex items-center gap-1.5"
            >
              {copied ? "✅ 복사됨" : "📋 전체 복사"}
            </button>
          </div>
          <div className="glass rounded-2xl p-6 border border-purple-500/30">
            <p className="text-gray-200 text-base font-medium mb-4">
              {session.finalSummary.finalBrief}
            </p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-purple-400 font-medium mb-2">🚀 MVP 범위</p>
                <p className="text-gray-400 whitespace-pre-wrap">{session.finalSummary.recommendedMvp}</p>
              </div>
              <div>
                <p className="text-purple-400 font-medium mb-2">⚠️ 핵심 리스크</p>
                <ul className="text-gray-400 space-y-1">
                  {(JSON.parse(session.finalSummary.risks) as string[]).map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-purple-400 font-medium mb-2">⚡ 핵심 기능</p>
                <ul className="text-gray-400 space-y-1">
                  {(JSON.parse(session.finalSummary.keyIssues) as string[]).map((k, i) => (
                    <li key={i}>• {k}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-purple-400 font-medium mb-2">🗺️ 로드맵</p>
                <ul className="text-gray-400 space-y-1">
                  {(JSON.parse(session.finalSummary.nextActions) as string[]).map((a, i) => (
                    <li key={i}>• {a}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Moderator 채팅 UI (완료 후에만 표시) ─── */}
      {isCompleted && !running && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-white">💬 Moderator에게 추가 질문</h2>
            <p className="text-gray-500 text-sm mt-1">
              최종 기획안을 기반으로 Moderator에게 수정 요청이나 추가 질문을 할 수 있습니다.
            </p>
          </div>

          {/* 채팅 예시 힌트 (채팅이 없을 때만) */}
          {chatMessages.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {["MVP 범위를 더 좁혀줘", "비용 구조 더 구체적으로", "기술 스택 추천해줘", "경쟁사 분석 추가해줘"].map((hint) => (
                <button
                  key={hint}
                  onClick={() => setChatInput(hint)}
                  className="px-3 py-1.5 rounded-xl border border-white/10 text-gray-400 text-xs hover:border-purple-500/50 hover:text-purple-300 transition"
                >
                  {hint}
                </button>
              ))}
            </div>
          )}

          {/* 채팅 메시지 목록 */}
          {chatMessages.length > 0 && (
            <div className="space-y-3">
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`${
                  msg.role === "user"
                    ? "flex justify-end"
                    : "flex justify-start"
                }`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-indigo-600/30 border border-indigo-500/30 text-gray-200"
                      : "glass border border-purple-500/20 text-gray-300"
                  }`}>
                    {msg.role === "moderator" && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-xs">⚖️</span>
                        <span className="text-xs font-medium text-purple-400">Moderator</span>
                        {msg.isStreaming && (
                          <span className="flex gap-0.5 ml-1">
                            {[0, 1, 2].map((i) => (
                              <span key={i} className="w-1 h-1 rounded-full bg-purple-400 animate-bounce"
                                style={{ animationDelay: `${i * 0.15}s` }} />
                            ))}
                          </span>
                        )}
                      </div>
                    )}
                    {msg.content || (msg.isStreaming ? "" : "...")}
                    {msg.isStreaming && msg.content && (
                      <span className="inline-block w-0.5 h-3.5 bg-purple-400 ml-0.5 animate-pulse align-middle" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 채팅 입력창 */}
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
              placeholder="Moderator에게 질문하세요... (예: MVP 범위를 더 좁혀줘)"
              disabled={chatLoading}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 disabled:opacity-50 transition"
            />
            <button
              onClick={sendChatMessage}
              disabled={chatLoading || !chatInput.trim()}
              className="px-4 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition"
            >
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
