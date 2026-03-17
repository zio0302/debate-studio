"use client";
// 세션 상세 페이지 - 토론 로그 + 최종안 표시 (아코디언 접기/펼치기 지원)
// running=true 쿼리 파라미터가 있으면 자동으로 AI 토론 실행
import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

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

// 페르소나별 색상 스타일
const ROLE_STYLES: Record<string, { border: string; badge: string; icon: string }> = {
  persona_a: { border: "border-yellow-500/40 bg-yellow-500/5", badge: "bg-yellow-500/20 text-yellow-400", icon: "🎯" },
  persona_b: { border: "border-green-500/40 bg-green-500/5", badge: "bg-green-500/20 text-green-400", icon: "🔧" },
  moderator: { border: "border-purple-500/40 bg-purple-500/5", badge: "bg-purple-500/20 text-purple-400", icon: "⚖️" },
};

// 콘텐츠 미리보기 글자 수 제한 (접힌 상태)
const PREVIEW_LENGTH = 150;

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [copied, setCopied] = useState(false);

  // 왜: 각 항목의 펼침/접힘 상태를 개별 관리 (key = "rawInput" | message id | "moderator")
  // 기본값은 "moderator"만 펼침 → 사용자가 가장 중요한 결과를 바로 볼 수 있음
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(["moderator"]));

  const toggleItem = useCallback((itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  // 전체 펼치기/접기
  const toggleAll = useCallback(() => {
    if (!session) return;
    const allIds = ["rawInput", ...session.messages.map((m) => m.id), "moderator"];
    const allExpanded = allIds.every((id) => expandedItems.has(id));
    if (allExpanded) {
      // 모두 접기 (moderator만 유지)
      setExpandedItems(new Set(["moderator"]));
    } else {
      // 모두 펼치기
      setExpandedItems(new Set(allIds));
    }
  }, [session, expandedItems]);

  async function fetchSession() {
    const res = await fetch(`/api/sessions/${id}`);
    const data = await res.json();
    if (data.success) setSession(data.data);
  }

  useEffect(() => {
    fetchSession().then(() => {
      if (searchParams.get("running") === "true") {
        runDebate();
      }
    });
  }, [id]);

  async function runDebate() {
    setRunning(true);
    setRunError("");

    const apiKey = localStorage.getItem("debate_gemini_api_key") || undefined;
    const globalDirective = localStorage.getItem("debate_global_directive") || undefined;
    let personas;
    try {
      const stored = localStorage.getItem("debate_personas");
      if (stored) personas = JSON.parse(stored);
    } catch { /* 기본값 사용 */ }

    const res = await fetch(`/api/sessions/${id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, personas, globalDirective }),
    });
    const data = await res.json();

    if (!data.success) {
      setRunError(data.error || "AI 토론 실행 중 오류가 발생했습니다.");
    }

    setRunning(false);
    fetchSession();
  }

  async function copyFinalSummary() {
    if (!session?.finalSummary) return;
    const text = session.messages
      .find((m) => m.roleType === "moderator")?.content ?? "";
    await navigator.clipboard.writeText(text);
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

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      {/* 헤더 */}
      <div>
        <Link href={`/projects`} className="text-gray-500 hover:text-gray-400 text-sm">← 프로젝트로</Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-bold text-white flex-1">{session.title}</h1>
          <span className={`text-xs px-3 py-1 rounded-full font-medium ${
            isCompleted ? "bg-green-500/20 text-green-400" :
            isFailed ? "bg-red-500/20 text-red-400" :
            running ? "bg-yellow-500/20 text-yellow-400" :
            "bg-gray-500/20 text-gray-400"
          }`}>
            {running ? "🔄 토론 중..." : isCompleted ? "✅ 완료" : isFailed ? "❌ 실패" : "⏳ 대기"}
          </span>
        </div>
        <p className="text-gray-500 text-sm mt-1">{session.rounds}라운드 · {session.outputTone} 톤</p>
      </div>

      {/* 실행 중 로딩 */}
      {running && (
        <div className="glass rounded-2xl p-8 text-center border border-indigo-500/30">
          <div className="flex justify-center gap-4 mb-4">
            <span className="text-3xl animate-bounce" style={{ animationDelay: "0ms" }}>🎯</span>
            <span className="text-3xl animate-bounce" style={{ animationDelay: "200ms" }}>⚔️</span>
            <span className="text-3xl animate-bounce" style={{ animationDelay: "400ms" }}>🔧</span>
          </div>
          <p className="text-gray-300 font-medium">AI 전문가들이 기획안을 검토하고 있습니다...</p>
          <p className="text-gray-500 text-sm mt-1">라운드 수에 따라 30초~2분 소요될 수 있습니다.</p>
          <div className="mt-4 flex justify-center gap-1">
            {[0.1, 0.2, 0.3, 0.4, 0.5].map((delay) => (
              <div
                key={delay}
                className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"
                style={{ animationDelay: `${delay}s` }}
              />
            ))}
          </div>
        </div>
      )}

      {/* 에러 상태 */}
      {isFailed && !running && (
        <div className="glass rounded-2xl p-5 border border-red-500/30">
          <p className="text-red-400 font-medium">❌ AI 토론 실행 중 오류가 발생했습니다.</p>
          <button
            onClick={runDebate}
            className="mt-3 px-4 py-2 rounded-xl bg-red-600/30 hover:bg-red-600/50 text-red-300 text-sm transition"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 대기 상태 */}
      {session.status === "pending" && !running && (
        <div className="glass rounded-2xl p-6 text-center border border-indigo-500/20">
          <p className="text-gray-300 mb-4">AI 토론을 시작할 준비가 되었습니다.</p>
          <button
            onClick={runDebate}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition"
          >
            ⚡ 토론 시작
          </button>
        </div>
      )}

      {/* 토론 로그 (아코디언) */}
      {session.messages.length > 0 && !running && (
        <div className="space-y-3">
          {/* 토론 로그 헤더 + 전체 토글 버튼 */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">토론 로그</h2>
            <button
              onClick={toggleAll}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 transition"
            >
              {session.messages.every((m) => expandedItems.has(m.id)) ? "📁 전체 접기" : "📂 전체 펼치기"}
            </button>
          </div>

          {/* 기획 원문 - 아코디언 */}
          <div className="glass rounded-2xl border border-white/10 overflow-hidden">
            <button
              onClick={() => toggleItem("rawInput")}
              className="w-full flex items-center gap-2 p-4 hover:bg-white/5 transition text-left"
            >
              <span className="text-gray-500 text-xs transition-transform duration-200" style={{
                display: "inline-block",
                transform: expandedItems.has("rawInput") ? "rotate(90deg)" : "rotate(0deg)",
              }}>▶</span>
              <span className="text-sm font-medium text-gray-400">📝 기획 원문</span>
              {!expandedItems.has("rawInput") && (
                <span className="text-xs text-gray-600 ml-auto truncate max-w-[50%]">
                  {session.rawInput.slice(0, 60)}...
                </span>
              )}
            </button>
            {expandedItems.has("rawInput") && (
              <div className="px-5 pb-5 border-t border-white/5">
                <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap mt-3">{session.rawInput}</p>
                {session.additionalConstraints && (
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <p className="text-xs text-gray-500 mb-1">추가 조건</p>
                    <p className="text-gray-400 text-sm">{session.additionalConstraints}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 페르소나 메시지 - 아코디언 */}
          {session.messages.map((msg) => {
            const style = ROLE_STYLES[msg.roleType] ?? ROLE_STYLES.persona_a;
            const isExpanded = expandedItems.has(msg.id);
            return (
              <div key={msg.id} className={`glass rounded-2xl border ${style.border} overflow-hidden`}>
                <button
                  onClick={() => toggleItem(msg.id)}
                  className="w-full flex items-center gap-2 p-4 hover:bg-white/5 transition text-left"
                >
                  <span className="text-gray-500 text-xs transition-transform duration-200" style={{
                    display: "inline-block",
                    transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  }}>▶</span>
                  <span>{style.icon}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.badge}`}>
                    {msg.speaker}
                  </span>
                  {msg.roundNo > 0 && (
                    <span className="text-xs text-gray-600">Round {msg.roundNo}</span>
                  )}
                  {!isExpanded && (
                    <span className="text-xs text-gray-600 ml-auto truncate max-w-[40%]">
                      {msg.content.slice(0, PREVIEW_LENGTH).replace(/\n/g, " ")}...
                    </span>
                  )}
                </button>
                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-white/5">
                    <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap mt-3">
                      {msg.content}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 최종 요약 - 항상 펼쳐진 상태이나 토글 가능 */}
      {isCompleted && session.finalSummary && !running && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">⚖️ Moderator 최종 기획안</h2>
            <button
              onClick={copyFinalSummary}
              className="px-4 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm transition flex items-center gap-1.5"
            >
              {copied ? "✅ 복사됨" : "📋 복사"}
            </button>
          </div>
          <div className="glass rounded-2xl border border-purple-500/30 overflow-hidden">
            <button
              onClick={() => toggleItem("moderator")}
              className="w-full flex items-center gap-2 p-4 hover:bg-white/5 transition text-left"
            >
              <span className="text-gray-500 text-xs transition-transform duration-200" style={{
                display: "inline-block",
                transform: expandedItems.has("moderator") ? "rotate(90deg)" : "rotate(0deg)",
              }}>▶</span>
              <span className="text-sm font-medium text-purple-400">최종 기획서</span>
              {!expandedItems.has("moderator") && (
                <span className="text-xs text-gray-600 ml-auto">클릭하여 펼치기</span>
              )}
            </button>
            {expandedItems.has("moderator") && (
              <div className="px-5 pb-5 border-t border-white/5">
                <p className="text-gray-300 text-base font-medium mb-2 mt-3">
                  {session.finalSummary.finalBrief}
                </p>
                {/* Moderator 전문 표시 */}
                {session.messages.find((m) => m.roleType === "moderator") && (
                  <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap mt-3 pt-3 border-t border-white/10">
                    {session.messages.find((m) => m.roleType === "moderator")!.content}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {runError && (
        <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
          {runError}
        </p>
      )}
    </div>
  );
}
