"use client";
// 설정 페이지 - API 키 및 페르소나 4명 커스터마이징
import { useState, useEffect } from "react";
import { DEFAULT_PERSONAS } from "@/lib/prompts";
import type { PersonaConfig } from "@/lib/orchestrator";

// localStorage 키 상수
const STORAGE_KEY_API = "debate_gemini_api_key";
const STORAGE_KEY_PERSONAS = "debate_personas";

// 페르소나별 색상 배지
const PERSONA_COLORS: Record<string, string> = {
  a: "bg-violet-500/20 text-violet-300 border-violet-500/40",
  b: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  c: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  d: "bg-amber-500/20 text-amber-300 border-amber-500/40",
};

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [savedApiKey, setSavedApiKey] = useState(false);
  const [personas, setPersonas] = useState<PersonaConfig[]>(DEFAULT_PERSONAS);
  const [activeTab, setActiveTab] = useState<"api" | "personas">("api");
  const [editingPersona, setEditingPersona] = useState<string | null>(null);
  const [savedPersonas, setSavedPersonas] = useState(false);

  // 로컬스토리지에서 설정 불러오기
  useEffect(() => {
    const storedKey = localStorage.getItem(STORAGE_KEY_API) ?? "";
    setApiKey(storedKey);
    const storedPersonas = localStorage.getItem(STORAGE_KEY_PERSONAS);
    if (storedPersonas) {
      try { setPersonas(JSON.parse(storedPersonas)); } catch { /* 파싱 실패시 기본값 유지 */ }
    }
  }, []);

  // API 키 저장
  function saveApiKey() {
    localStorage.setItem(STORAGE_KEY_API, apiKey);
    setSavedApiKey(true);
    setTimeout(() => setSavedApiKey(false), 2000);
  }

  // 페르소나 설정 저장
  function savePersonas() {
    localStorage.setItem(STORAGE_KEY_PERSONAS, JSON.stringify(personas));
    setSavedPersonas(true);
    setEditingPersona(null);
    setTimeout(() => setSavedPersonas(false), 2000);
  }

  // 페르소나 필드 업데이트
  function updatePersona(id: string, field: keyof PersonaConfig, value: string | boolean) {
    setPersonas((prev) => prev.map((p) => p.id === id ? { ...p, [field]: value } : p));
  }

  // 기본값으로 초기화
  function resetPersonas() {
    if (confirm("모든 페르소나 설정을 기본값으로 초기화할까요?")) {
      setPersonas(DEFAULT_PERSONAS);
      localStorage.removeItem(STORAGE_KEY_PERSONAS);
    }
  }

  // 활성화된 페르소나 수
  const activeCount = personas.filter((p) => p.active).length;

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">설정</h1>
        <p className="text-gray-400 text-sm mt-1">API 키와 AI 페르소나 성향을 커스터마이징하세요.</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-2 border-b border-white/10 pb-0">
        {[
          { key: "api", label: "🔑 API 키" },
          { key: "personas", label: "🎭 페르소나 설정" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as "api" | "personas")}
            className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition border-b-2 -mb-px ${
              activeTab === tab.key
                ? "text-white border-indigo-500 bg-white/5"
                : "text-gray-400 border-transparent hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* API 키 탭 */}
      {activeTab === "api" && (
        <div className="glass rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-white mb-1">Gemini API 키</h2>
            <p className="text-xs text-gray-400">
              <a href="https://ai.google.dev" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
                ai.google.dev
              </a>
              에서 발급받은 API 키를 입력하세요. 브라우저 로컬 스토리지에만 저장되며 서버에 전송되지 않습니다.
            </p>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white
                           placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition font-mono text-sm"
              />
              {apiKey && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                  {apiKey.substring(0, 8)}...
                </span>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={saveApiKey}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition"
              >
                {savedApiKey ? "✅ 저장됨" : "저장"}
              </button>
              {apiKey && (
                <button
                  onClick={() => { setApiKey(""); localStorage.removeItem(STORAGE_KEY_API); }}
                  className="px-5 py-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 text-sm transition"
                >
                  삭제
                </button>
              )}
            </div>
          </div>

          {/* 상태 표시 */}
          <div className={`rounded-xl px-4 py-3 text-sm ${
            apiKey ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400" 
                   : "bg-amber-500/10 border border-amber-500/30 text-amber-400"
          }`}>
            {apiKey ? "✅ API 키가 설정되어 있습니다. 토론 실행 시 이 키가 사용됩니다." 
                    : "⚠️ API 키가 없습니다. 서버 환경변수의 키가 사용됩니다."}
          </div>
        </div>
      )}

      {/* 페르소나 설정 탭 */}
      {activeTab === "personas" && (
        <div className="space-y-4">
          {/* 활성화 현황 */}
          <div className="glass rounded-2xl p-4 flex items-center justify-between">
            <div>
              <span className="text-white text-sm font-medium">활성화된 페르소나: </span>
              <span className="text-indigo-400 font-bold">{activeCount}명</span>
              <span className="text-gray-500 text-xs ml-2">(최소 2명 이상 활성화 필요)</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={resetPersonas}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs transition"
              >
                기본값 초기화
              </button>
              <button
                onClick={savePersonas}
                disabled={activeCount < 2}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 
                           disabled:text-indigo-600 text-white text-sm font-medium transition"
              >
                {savedPersonas ? "✅ 저장됨" : "저장"}
              </button>
            </div>
          </div>

          {/* 페르소나 카드 */}
          {personas.map((persona) => (
            <div
              key={persona.id}
              className={`glass rounded-2xl border transition ${
                persona.active ? "border-white/10" : "border-white/5 opacity-60"
              }`}
            >
              {/* 헤더 */}
              <div className="flex items-center justify-between p-5">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${PERSONA_COLORS[persona.id]}`}>
                    PERSONA {persona.id.toUpperCase()}
                  </span>
                  {editingPersona === persona.id ? (
                    <input
                      value={persona.name}
                      onChange={(e) => updatePersona(persona.id, "name", e.target.value)}
                      className="bg-white/10 text-white px-3 py-1 rounded-lg text-sm border border-white/20 focus:outline-none focus:border-indigo-500"
                    />
                  ) : (
                    <span className="text-white font-medium">{persona.name}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* 활성화 토글 */}
                  <button
                    onClick={() => updatePersona(persona.id, "active", !persona.active)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      persona.active ? "bg-indigo-600" : "bg-white/20"
                    }`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                      persona.active ? "left-5" : "left-0.5"
                    }`} />
                  </button>
                  <button
                    onClick={() => setEditingPersona(editingPersona === persona.id ? null : persona.id)}
                    className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs transition"
                  >
                    {editingPersona === persona.id ? "접기" : "수정"}
                  </button>
                </div>
              </div>

              {/* 시스템 프롬프트 편집 영역 */}
              {editingPersona === persona.id && (
                <div className="px-5 pb-5 space-y-3">
                  <label className="text-xs text-gray-400">시스템 프롬프트 (역할 및 성향 정의)</label>
                  <textarea
                    value={persona.systemPrompt}
                    onChange={(e) => updatePersona(persona.id, "systemPrompt", e.target.value)}
                    rows={12}
                    className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-gray-200
                               text-xs font-mono focus:outline-none focus:border-indigo-500 transition resize-y"
                  />
                  <p className="text-xs text-gray-500">
                    💡 출력 형식(## 섹션)을 유지하면 Moderator가 더 잘 종합할 수 있습니다.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
