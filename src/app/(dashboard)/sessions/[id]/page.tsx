"use client";
// 세션 상세 페이지 - 토론 로그 + 최종안 표시
// running=true 쿼리 파라미터가 있으면 자동으로 AI 토론 실행
import { useState, useEffect } from "react";
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

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [copied, setCopied] = useState(false);

  async function fetchSession() {
    const res = await fetch(`/api/sessions/${id}`);
    const data = await res.json();
    if (data.success) setSession(data.data);
  }

  // 페이지 진입 시 running=true면 자동 실행
  useEffect(() => {
    fetchSession().then(() => {
      if (searchParams.get("running") === "true") {
        runDebate();
      }
    });
  }, [id]);

  // AI 토론 실행
  async function runDebate() {
    setRunning(true);
    setRunError("");

    const res = await fetch(`/api/sessions/${id}/run`, { method: "POST" });
    const data = await res.json();

    if (!data.success) {
      setRunError(data.error || "AI 토론 실행 중 오류가 발생했습니다.");
    }

    setRunning(false);
    fetchSession(); // 결과 새로고침
  }

  // 최종안 클립보드 복사
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

      {/* 대기 상태 - 수동 실행 버튼 */}
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

      {/* 토론 로그 */}
      {session.messages.length > 0 && !running && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">토론 로그</h2>

          {/* 입력 원문 */}
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

          {/* A/B 메시지 */}
          {session.messages.map((msg) => {
            const style = ROLE_STYLES[msg.roleType] ?? ROLE_STYLES.persona_a;
            return (
              <div key={msg.id} className={`glass rounded-2xl p-5 border ${style.border}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span>{style.icon}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.badge}`}>
                    {msg.speaker}
                  </span>
                  {msg.roundNo > 0 && (
                    <span className="text-xs text-gray-600">Round {msg.roundNo}</span>
                  )}
                </div>
                <div className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 최종 요약 */}
      {isCompleted && session.finalSummary && !running && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">⚖️ Moderator 최종 기획안</h2>
            <button
              onClick={copyFinalSummary}
              className="px-4 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm transition flex items-center gap-1.5"
            >
              {copied ? "✅ 복사됨" : "📋 복사"}
            </button>
          </div>
          <div className="moderator rounded-2xl p-6 border">
            <p className="text-gray-300 text-base font-medium mb-2">
              {session.finalSummary.finalBrief}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-purple-400 font-medium mb-1">🚀 추천 MVP</p>
                <p className="text-gray-400 whitespace-pre-wrap">{session.finalSummary.recommendedMvp}</p>
              </div>
              <div>
                <p className="text-purple-400 font-medium mb-1">⚠️ 리스크</p>
                <ul className="text-gray-400 space-y-1">
                  {(JSON.parse(session.finalSummary.risks) as string[]).map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>
            </div>
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
