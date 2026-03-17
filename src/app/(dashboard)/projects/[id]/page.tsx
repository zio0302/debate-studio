"use client";
// 프로젝트 상세 페이지 - 세션 목록 + 새 세션 생성 폼 (4명 페르소나 선택 지원)
import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DEFAULT_PERSONAS } from "@/lib/prompts";
import type { PersonaConfig } from "@/lib/orchestrator";

const STORAGE_KEY_API = "debate_gemini_api_key";
const STORAGE_KEY_PERSONAS = "debate_personas";

interface Session {
  id: string;
  title: string;
  status: string;
  rounds: number;
  outputTone: string;
  createdAt: string;
  completedAt: string | null;
}

interface Project {
  id: string;
  title: string;
  description: string | null;
  sessions: Session[];
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: "대기", cls: "bg-gray-500/20 text-gray-400" },
  running: { label: "실행 중", cls: "bg-yellow-500/20 text-yellow-400" },
  completed: { label: "완료", cls: "bg-green-500/20 text-green-400" },
  failed: { label: "실패", cls: "bg-red-500/20 text-red-400" },
};

const PERSONA_COLORS: Record<string, string> = {
  a: "border-violet-500/50 bg-violet-500/10 text-violet-300",
  b: "border-blue-500/50 bg-blue-500/10 text-blue-300",
  c: "border-emerald-500/50 bg-emerald-500/10 text-emerald-300",
  d: "border-amber-500/50 bg-amber-500/10 text-amber-300",
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "",
    rawInput: "",
    additionalConstraints: "",
    rounds: 2,
    outputTone: "standard" as "concise" | "standard" | "detailed",
  });
  const [personas, setPersonas] = useState<PersonaConfig[]>(DEFAULT_PERSONAS);
  const [creating, setCreating] = useState(false);

  async function fetchProject() {
    const res = await fetch(`/api/projects/${id}`);
    const data = await res.json();
    if (data.success) setProject(data.data);
  }

  // 로컬스토리지에서 페르소나 설정 불러오기
  useEffect(() => {
    fetchProject();
    const stored = localStorage.getItem(STORAGE_KEY_PERSONAS);
    if (stored) {
      try { setPersonas(JSON.parse(stored)); } catch { /* 기본값 유지 */ }
    }
  }, [id]);

  // 페르소나 활성화 토글
  function togglePersona(personaId: string) {
    setPersonas((prev) => {
      const updated = prev.map((p) => p.id === personaId ? { ...p, active: !p.active } : p);
      // 최소 2명 유지
      const activeCount = updated.filter((p) => p.active).length;
      if (activeCount < 2) return prev;
      return updated;
    });
  }

  // 세션 생성 + AI 토론 즉시 실행
  async function handleCreateSession(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);

    // 1단계: 세션 생성
    const createRes = await fetch(`/api/projects/${id}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const createData = await createRes.json();

    if (!createData.success) {
      alert(createData.error);
      setCreating(false);
      return;
    }

    const sessionId = createData.data.id;

    // 2단계: AI 토론 실행 (페르소나+API키 전달)
    const apiKey = localStorage.getItem(STORAGE_KEY_API) || undefined;
    fetch(`/api/sessions/${sessionId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personas, apiKey }),
    }).catch(() => {}); // 비동기 실행 - 결과는 세션 페이지에서 폴링

    // 즉시 세션 결과 페이지로 이동
    router.push(`/sessions/${sessionId}?running=true`);
  }

  if (!project) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  const activePersonas = personas.filter((p) => p.active);

  return (
    <div className="p-8 space-y-6">
      {/* 헤더 */}
      <div className="flex justify-between items-start">
        <div>
          <Link href="/projects" className="text-gray-500 hover:text-gray-400 text-sm">← 프로젝트 목록</Link>
          <h1 className="text-2xl font-bold text-white mt-2">{project.title}</h1>
          {project.description && <p className="text-gray-400 text-sm mt-1">{project.description}</p>}
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition flex-shrink-0"
        >
          ⚡ 새 토론 시작
        </button>
      </div>

      {/* 새 세션 생성 폼 */}
      {showForm && (
        <div className="glass rounded-2xl p-6 border border-indigo-500/30 space-y-4">
          <h2 className="text-base font-semibold text-white">기획안 입력</h2>
          <form onSubmit={handleCreateSession} className="space-y-4">
            {/* 기본 입력 */}
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">세션 제목 *</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="예: 커피챗 앱 MVP 1차 검토"
                required
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500
                           focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1.5">기획안 원문 *</label>
              <textarea
                value={form.rawInput}
                onChange={(e) => setForm({ ...form, rawInput: e.target.value })}
                placeholder="검토받고 싶은 기획안, 아이디어, 사업안을 자유롭게 입력하세요..."
                required
                rows={8}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500
                           focus:outline-none focus:border-indigo-500 transition resize-none"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1.5">추가 조건/제약 (선택)</label>
              <textarea
                value={form.additionalConstraints}
                onChange={(e) => setForm({ ...form, additionalConstraints: e.target.value })}
                placeholder="예: 예산 3천만 원 이하, 3개월 내 런칭, 팀원 3명..."
                rows={2}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500
                           focus:outline-none focus:border-indigo-500 transition resize-none"
              />
            </div>

            {/* 페르소나 선택 UI */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-gray-300">토론 참가 페르소나</label>
                <Link href="/settings" className="text-xs text-indigo-400 hover:underline">
                  ⚙️ 성향 편집
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {personas.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePersona(p.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm transition ${
                      p.active
                        ? PERSONA_COLORS[p.id]
                        : "border-white/10 bg-white/3 text-gray-500 opacity-50"
                    }`}
                  >
                    <span className={`w-3 h-3 rounded-full flex-shrink-0 ${p.active ? "bg-current" : "bg-gray-600"}`} />
                    <span className="truncate">{p.name}</span>
                    {p.active && <span className="ml-auto text-xs opacity-70">✓</span>}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                활성: {activePersonas.length}명 · {activePersonas.map((p) => p.name).join(", ")}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1.5">토론 라운드 수</label>
                <select
                  value={form.rounds}
                  onChange={(e) => setForm({ ...form, rounds: Number(e.target.value) })}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white
                             focus:outline-none focus:border-indigo-500 transition"
                >
                  <option value={1}>1라운드 (빠른 검토)</option>
                  <option value={2}>2라운드 (균형 검토)</option>
                  <option value={3}>3라운드 (심층 검토)</option>
                  <option value={4}>4라운드 (최대)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1.5">결과 톤</label>
                <select
                  value={form.outputTone}
                  onChange={(e) => setForm({ ...form, outputTone: e.target.value as typeof form.outputTone })}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white
                             focus:outline-none focus:border-indigo-500 transition"
                >
                  <option value="concise">간결 (회의 전 빠른 점검)</option>
                  <option value="standard">표준 (기본 검토)</option>
                  <option value="detailed">상세 (완전한 분석)</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={creating || activePersonas.length < 2}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900
                           disabled:text-indigo-600 text-white font-medium transition flex items-center justify-center gap-2"
              >
                {creating ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    세션 생성 중...
                  </>
                ) : (
                  `⚡ ${activePersonas.length}명 AI 토론 시작`
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-6 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 transition"
              >
                취소
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 세션 목록 */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">토론 세션 목록</h2>
        {project.sessions.length === 0 ? (
          <div className="text-center py-16 glass rounded-2xl">
            <div className="text-4xl mb-3">💬</div>
            <p className="text-gray-400">세션이 없습니다. 토론을 시작해보세요!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {project.sessions.map((s) => {
              const st = STATUS_LABELS[s.status] ?? STATUS_LABELS.pending;
              return (
                <Link
                  key={s.id}
                  href={`/sessions/${s.id}`}
                  className="glass rounded-2xl p-5 flex items-center justify-between card-hover block"
                >
                  <div>
                    <p className="font-medium text-gray-200">{s.title}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {s.rounds}라운드 · {s.outputTone} · {new Date(s.createdAt).toLocaleDateString("ko-KR")}
                    </p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
