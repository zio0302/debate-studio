"use client";
// 세션 상세 페이지 - 프롬프트 생성기 버전
// API 호출 없이 Gemini 웹에 붙여넣을 프롬프트를 만들어줌
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// localStorage 키 (설정 페이지와 동일)
const STORAGE_KEY_PERSONAS = "debate_personas";

// ─── 타입 정의 ───────────────────────────────────

interface Session {
  id: string;
  title: string;
  status: string;
  rawInput: string;
  additionalConstraints: string | null;
  rounds: number;
  outputTone: string;
}

interface PersonaConfig {
  id: "a" | "b" | "c" | "d";
  name: string;
  systemPrompt: string;
  active: boolean;
}

// 기본 페르소나 (설정 없을 때 fallback)
const DEFAULT_PERSONAS: PersonaConfig[] = [
  {
    id: "a",
    name: "전략 기획가 A",
    systemPrompt:
      "당신은 냉철한 전략 기획가입니다. 시장성, 수익성, 경쟁 우위를 최우선으로 분석합니다. 감성적 표현보다 데이터와 논리로 말합니다.",
    active: true,
  },
  {
    id: "b",
    name: "실행 책임자 B",
    systemPrompt:
      "당신은 실행력을 중시하는 프로젝트 매니저입니다. 리소스, 일정, 기술 실현 가능성을 검토합니다. 이상적인 계획보다 실제로 만들 수 있는 것에 집중합니다.",
    active: true,
  },
  {
    id: "c",
    name: "사용자 경험 전문가 C",
    systemPrompt:
      "당신은 UX 전문가입니다. 실제 사용자 관점에서 제품을 바라봅니다. 기능보다 경험, 복잡함보다 단순함을 추구합니다.",
    active: true,
  },
  {
    id: "d",
    name: "데이터 분석가 D",
    systemPrompt:
      "당신은 데이터 중심 분석가입니다. 모든 주장을 수치와 근거로 검증합니다. 가설이 아닌 측정 가능한 지표로 판단합니다.",
    active: true,
  },
];

// 어몽어스 크루메이트 색상
const CREWMATE_COLORS: Record<string, string> = {
  a: "#ff4455",
  b: "#4488ff",
  c: "#44cc66",
  d: "#ffaa00",
};

// 크루메이트 SVG
function Crewmate({ colorId, size = 36 }: { colorId: string; size?: number }) {
  const color = CREWMATE_COLORS[colorId] ?? "#888";
  const darkColor = color + "bb";
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 40 50" fill="none">
      <ellipse cx="20" cy="34" rx="13" ry="13" fill={color} />
      <ellipse cx="20" cy="17" rx="12" ry="11" fill={color} />
      <ellipse cx="21" cy="14" rx="7.5" ry="6" fill="#aadefc" opacity="0.92" />
      <ellipse cx="18" cy="12" rx="2.5" ry="1.8" fill="white" opacity="0.5" />
      <rect x="31" y="26" width="6" height="10" rx="3" fill={darkColor} />
      <rect x="13" y="44" width="6" height="5" rx="2.5" fill={darkColor} />
      <rect x="21" y="44" width="6" height="5" rx="2.5" fill={darkColor} />
    </svg>
  );
}

// ─── 핵심: 프롬프트 생성 함수 ────────────────────────
// 페르소나 설정 + 기획안 → Gemini 웹에 붙여넣을 완성형 프롬프트 생성
function buildDebatePrompt(session: Session, personas: PersonaConfig[]): string {
  const activePersonas = personas.filter((p) => p.active);
  const toneLabel =
    session.outputTone === "formal"
      ? "격식체 (공식 문서)"
      : session.outputTone === "startup"
      ? "스타트업 캐주얼 (활기차고 간결)"
      : "표준 (전문적이지만 읽기 쉬운)";

  // 페르소나 정의 블록
  const personaBlock = activePersonas
    .map(
      (p, i) =>
        `### 참가자 ${i + 1}: ${p.name}\n${p.systemPrompt}`
    )
    .join("\n\n");

  // 라운드별 발언 지시
  const roundInstructions = Array.from({ length: session.rounds }, (_, i) => {
    const round = i + 1;
    if (round === 1) {
      return `**[라운드 ${round}]** 각 참가자는 기획안을 자신의 관점에서 처음으로 분석합니다. 문제점뿐 아니라 구체적인 개선 방향까지 제시하세요.`;
    }
    return `**[라운드 ${round}]** 각 참가자는 다른 참가자들의 이전 발언을 참고하여 논점을 발전시키고 더 구체적인 대안을 제시합니다.`;
  }).join("\n");

  const constraints = session.additionalConstraints
    ? `\n## 추가 제약사항 / 방향성\n${session.additionalConstraints}\n`
    : "";

  return `# AI 토론 시뮬레이션 프롬프트
# Debate Studio에서 생성됨

당신은 아래 ${activePersonas.length}명의 전문가와 중재자 역할을 동시에 수행하는 토론 시뮬레이터입니다.
각 전문가의 관점을 완전히 체화하여 ${session.rounds}라운드의 깊이 있는 토론을 진행하고,
최종적으로 중재자가 모든 의견을 통합한 발전된 기획서를 작성하세요.

---

## 토론 참가자 정의

${personaBlock}

### 최종 중재자 (Moderator)
당신은 공정한 시각을 가진 전략 컨설턴트입니다.
모든 참가자의 토론을 종합하여 실제 실행 가능한 완성 기획서를 작성합니다.
단순 요약이 아닌, 각 관점의 장점을 통합하여 원본보다 훨씬 구체적이고 발전된 기획서여야 합니다.

---

## 원본 기획안

${session.rawInput}
${constraints}
---

## 토론 진행 규칙

${roundInstructions}

- 각 참가자의 발언은 **[참가자명]: (발언 내용)** 형식으로 작성하세요
- 모든 발언은 충분히 상세하게 작성하세요 (글자수 제한 없음)
- 다른 참가자의 발언에 실제로 반응하고 논쟁하세요
- 단순 동의보다 건설적인 비판과 대안 제시를 우선하세요

## 최종 출력 형식

토론이 끝나면 반드시 아래 형식으로 최종 기획안을 작성하세요:

---
## ✅ 최종 기획안 (Moderator 작성)

**문서 톤:** ${toneLabel}

### 1. 핵심 컨셉 및 가치 제안
### 2. 주요 기능 명세
### 3. 타겟 사용자 및 시장 분석
### 4. 기술 구현 방향
### 5. MVP 범위 정의
### 6. 리스크 및 대응 방안
### 7. 단계별 로드맵
### 8. 성공 지표 (KPI)
---

지금 바로 시작하세요. 라운드 1부터 순서대로 모든 참가자가 발언하고,
${session.rounds}라운드를 마친 후 최종 기획안을 작성하세요.`;
}

// ─── 컴포넌트 ────────────────────────────────────

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // 생성된 프롬프트 상태
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [isRawInputOpen, setIsRawInputOpen] = useState(false);

  // 세션 데이터 로드
  async function fetchSession() {
    const res = await fetch(`/api/sessions/${id}`);
    const data = await res.json();
    if (data.success) {
      setSession(data.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchSession();
  }, [id]);

  // 프롬프트 생성 함수
  function generatePrompt() {
    if (!session) return;

    // localStorage에서 페르소나 설정 읽기
    const savedPersonas = localStorage.getItem(STORAGE_KEY_PERSONAS);
    const personas: PersonaConfig[] = savedPersonas
      ? JSON.parse(savedPersonas)
      : DEFAULT_PERSONAS;

    const prompt = buildDebatePrompt(session, personas);
    setGeneratedPrompt(prompt);

    // 생성 후 자동 스크롤
    setTimeout(() => {
      document.getElementById("prompt-output")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }

  // 클립보드 복사
  async function copyPrompt() {
    await navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // ─── 로딩 ────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-spin">⚙️</div>
          <p className="text-gray-400">세션 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-400">세션을 찾을 수 없습니다.</p>
        <Link href="/projects" className="text-indigo-400 hover:underline mt-4 inline-block">
          ← 프로젝트로
        </Link>
      </div>
    );
  }

  // ─── 로드된 페르소나 ──────────────────────────
  const savedPersonas = typeof window !== "undefined"
    ? (() => {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY_PERSONAS) || "null"); }
        catch { return null; }
      })()
    : null;
  const personas: PersonaConfig[] = savedPersonas ?? DEFAULT_PERSONAS;
  const activePersonas = personas.filter((p) => p.active);

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* 헤더 */}
      <div>
        <Link href="/projects" className="text-gray-500 hover:text-gray-400 text-sm">
          ← 프로젝트로
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-bold text-white flex-1">{session.title}</h1>
          <span className="text-xs px-3 py-1 rounded-full font-medium bg-indigo-500/20 text-indigo-400">
            🤖 프롬프트 생성기
          </span>
        </div>
        <p className="text-gray-500 text-sm mt-1">
          {session.rounds}라운드 · {session.outputTone} 톤 · 참가자 {activePersonas.length}명
        </p>
      </div>

      {/* 참가자 미리보기 */}
      <div className="glass rounded-2xl p-5 border border-white/10">
        <h2 className="text-sm font-semibold text-gray-400 mb-4">토론 참가자</h2>
        <div className="flex flex-wrap gap-4">
          {activePersonas.map((p) => (
            <div key={p.id} className="flex items-center gap-2">
              <Crewmate colorId={p.id} size={32} />
              <span className="text-sm text-gray-300">{p.name}</span>
            </div>
          ))}
          {/* 모더레이터 */}
          <div className="flex items-center gap-2">
            <div
              className="rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-lg"
              style={{ width: 32, height: 32 }}
            >
              ⚖️
            </div>
            <span className="text-sm text-gray-300">중재자</span>
          </div>
        </div>
      </div>

      {/* 원본 기획안 (접기/펼치기) */}
      <div className="glass rounded-2xl border border-white/10">
        <button
          onClick={() => setIsRawInputOpen((v) => !v)}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <span className="text-sm font-semibold text-gray-300">📄 원본 기획안</span>
          <span className="text-gray-500 text-xs">{isRawInputOpen ? "▲ 접기" : "▼ 펼치기"}</span>
        </button>
        {isRawInputOpen && (
          <div className="px-5 pb-5">
            <div
              className="text-gray-400 text-sm whitespace-pre-wrap leading-relaxed bg-black/20 rounded-xl p-4"
              style={{ maxHeight: "20rem", overflowY: "auto" }}
            >
              {session.rawInput}
            </div>
            {session.additionalConstraints && (
              <div className="mt-3 text-xs text-gray-500 bg-black/10 rounded-xl p-3">
                <span className="text-indigo-400 font-medium">추가 제약: </span>
                {session.additionalConstraints}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 프롬프트 생성 버튼 */}
      {!generatedPrompt && (
        <div className="glass rounded-2xl p-8 text-center border border-indigo-500/20">
          <div className="text-5xl mb-4">✨</div>
          <p className="text-gray-300 mb-2 font-medium">Gemini 웹용 프롬프트를 생성합니다</p>
          <p className="text-gray-500 text-sm mb-6">
            버튼을 누르면 4명의 페르소나가 {session.rounds}라운드 토론하는 완성형 프롬프트가 만들어집니다.<br />
            생성된 프롬프트를 복사해서{" "}
            <a
              href="https://gemini.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:underline"
            >
              gemini.google.com
            </a>
            에 붙여넣으세요.
          </p>
          <button
            onClick={generatePrompt}
            className="px-8 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition text-lg"
          >
            🚀 프롬프트 생성하기
          </button>
        </div>
      )}

      {/* 생성된 프롬프트 출력 */}
      {generatedPrompt && (
        <div id="prompt-output" className="glass rounded-2xl border border-green-500/20 overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center justify-between px-5 py-4 bg-green-500/5 border-b border-green-500/20">
            <div>
              <span className="text-green-400 font-semibold text-sm">✅ 프롬프트 생성 완료!</span>
              <p className="text-gray-500 text-xs mt-0.5">
                아래 프롬프트를 복사해서 Gemini에 붙여넣으세요
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={generatePrompt}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs transition"
              >
                🔄 재생성
              </button>
              <button
                onClick={copyPrompt}
                className={`px-4 py-1.5 rounded-lg font-medium text-sm transition ${
                  copied
                    ? "bg-green-600 text-white"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white"
                }`}
              >
                {copied ? "✅ 복사됨!" : "📋 복사"}
              </button>
              <a
                href="https://gemini.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition"
              >
                Gemini 열기 →
              </a>
            </div>
          </div>

          {/* 프롬프트 본문 - 스크롤 가능한 영역 */}
          <div className="relative">
            <textarea
              readOnly
              value={generatedPrompt}
              className="w-full bg-black/30 text-gray-300 text-sm font-mono leading-relaxed p-5 resize-none focus:outline-none"
              style={{ minHeight: "28rem", maxHeight: "60vh", overflowY: "auto" }}
            />
            {/* 글자수 표시 */}
            <div className="absolute bottom-3 right-4 text-xs text-gray-600 bg-black/60 px-2 py-1 rounded">
              {generatedPrompt.length.toLocaleString()}자
            </div>
          </div>

          {/* 하단 복사 버튼 (큰 버튼) */}
          <div className="p-4 bg-black/20 border-t border-white/5 flex gap-3 justify-center">
            <button
              onClick={copyPrompt}
              className={`px-8 py-2.5 rounded-xl font-semibold text-sm transition ${
                copied
                  ? "bg-green-600 text-white"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }`}
            >
              {copied ? "✅ 클립보드에 복사됨!" : "📋 전체 복사"}
            </button>
            <a
              href="https://gemini.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-semibold transition"
            >
              🌐 Gemini에서 열기
            </a>
          </div>
        </div>
      )}

      {/* 사용 가이드 */}
      <div className="glass rounded-2xl p-5 border border-white/5">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">📖 사용 방법</h2>
        <ol className="space-y-2 text-sm text-gray-400">
          <li className="flex gap-2">
            <span className="text-indigo-400 font-bold">1.</span>
            위 "프롬프트 생성하기" 버튼 클릭
          </li>
          <li className="flex gap-2">
            <span className="text-indigo-400 font-bold">2.</span>
            "전체 복사" 버튼으로 클립보드 복사
          </li>
          <li className="flex gap-2">
            <span className="text-indigo-400 font-bold">3.</span>
            <a
              href="https://gemini.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              gemini.google.com
            </a>{" "}
            접속 → 대화창에 붙여넣기 (Ctrl+V)
          </li>
          <li className="flex gap-2">
            <span className="text-indigo-400 font-bold">4.</span>
            Gemini가 토론 시뮬레이션 + 최종 기획안 자동 생성
          </li>
        </ol>
        <div className="mt-3 pt-3 border-t border-white/5 text-xs text-gray-600">
          💡 페르소나 설정은{" "}
          <Link href="/settings" className="text-indigo-400 hover:underline">
            설정 페이지
          </Link>
          에서 변경할 수 있습니다.
        </div>
      </div>
    </div>
  );
}
