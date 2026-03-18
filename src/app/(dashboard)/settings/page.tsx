"use client";
// 설정 페이지 - API 키, 모델 선택, 페르소나 커스터마이징
import { useState, useEffect } from "react";
import { DEFAULT_PERSONAS } from "@/lib/prompts";
import type { PersonaConfig } from "@/lib/orchestrator";

// localStorage 키 상수
const STORAGE_KEY_API      = "debate_gemini_api_key";
const STORAGE_KEY_MODEL    = "debate_gemini_model";   // 선택된 모델 ID
const STORAGE_KEY_VER      = "debate_gemini_version"; // 선택된 API 버전
const STORAGE_KEY_PERSONAS = "debate_personas";

const PERSONA_COLORS: Record<string, string> = {
  a: "bg-violet-500/20 text-violet-300 border-violet-500/40",
  b: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  c: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  d: "bg-amber-500/20 text-amber-300 border-amber-500/40",
};

interface ModelOption { id: string; displayName: string; version: string; }

export default function SettingsPage() {
  const [apiKey,        setApiKey]        = useState("");
  const [savedApiKey,   setSavedApiKey]   = useState(false);
  const [personas,      setPersonas]      = useState<PersonaConfig[]>(DEFAULT_PERSONAS);
  const [activeTab,     setActiveTab]     = useState<"api" | "personas">("api");
  const [editingPersona,setEditingPersona]= useState<string | null>(null);
  const [savedPersonas, setSavedPersonas] = useState(false);

  // 모델 선택 관련 상태
  const [models,        setModels]        = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelVersion,  setModelVersion]  = useState("");
  const [modelLoading,  setModelLoading]  = useState(false);
  const [modelError,    setModelError]    = useState("");

  // 로컬스토리지에서 설정 불러오기
  useEffect(() => {
    const storedKey = localStorage.getItem(STORAGE_KEY_API) ?? "";
    setApiKey(storedKey);
    setSelectedModel(localStorage.getItem(STORAGE_KEY_MODEL) ?? "");
    setModelVersion(localStorage.getItem(STORAGE_KEY_VER) ?? "");
    const storedPersonas = localStorage.getItem(STORAGE_KEY_PERSONAS);
    if (storedPersonas) {
      try { setPersonas(JSON.parse(storedPersonas)); } catch { /* 기본값 유지 */ }
    }
  }, []);

  // API 키 저장
  function saveApiKey() {
    localStorage.setItem(STORAGE_KEY_API, apiKey);
    // 키 바뀌면 모델 캐시 초기화
    setSelectedModel(""); setModelVersion(""); setModels([]);
    localStorage.removeItem(STORAGE_KEY_MODEL);
    localStorage.removeItem(STORAGE_KEY_VER);
    setSavedApiKey(true);
    setTimeout(() => setSavedApiKey(false), 2000);
  }

  // 사용 가능한 모델 조회
  async function fetchModels() {
    if (!apiKey) { setModelError("먼저 API 키를 입력하고 저장해주세요."); return; }
    setModelLoading(true); setModelError(""); setModels([]);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (!data.success) { setModelError(data.error ?? "모델 조회 실패"); return; }
      setModels(data.models);
      // 이미 선택된 모델이 목록에 없으면 첫 번째로 초기화
      if (!data.models.find((m: ModelOption) => m.id === selectedModel)) {
        setSelectedModel(data.models[0]?.id ?? "");
        setModelVersion(data.models[0]?.version ?? "");
      }
    } catch (e) {
      setModelError(String(e));
    } finally {
      setModelLoading(false);
    }
  }

  // 선택한 모델 저장
  function saveModel() {
    localStorage.setItem(STORAGE_KEY_MODEL, selectedModel);
    localStorage.setItem(STORAGE_KEY_VER, modelVersion);
    setSavedApiKey(true);
    setTimeout(() => setSavedApiKey(false), 2000);
  }

  // 페르소나 저장
  function savePersonas() {
    localStorage.setItem(STORAGE_KEY_PERSONAS, JSON.stringify(personas));
    setSavedPersonas(true); setEditingPersona(null);
    setTimeout(() => setSavedPersonas(false), 2000);
  }

  function updatePersona(id: string, field: keyof PersonaConfig, value: string | boolean) {
    setPersonas((prev) => prev.map((p) => p.id === id ? { ...p, [field]: value } : p));
  }

  function resetPersonas() {
    if (confirm("모든 페르소나 설정을 기본값으로 초기화할까요?")) {
      setPersonas(DEFAULT_PERSONAS);
      localStorage.removeItem(STORAGE_KEY_PERSONAS);
    }
  }

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
          { key: "api",      label: "🔑 API & 모델" },
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

      {/* API & 모델 탭 */}
      {activeTab === "api" && (
        <div className="space-y-4">
          {/* API 키 섹션 */}
          <div className="glass rounded-2xl p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-white mb-1">Gemini API 키</h2>
              <p className="text-xs text-gray-400">
                <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer"
                   className="text-indigo-400 hover:underline">aistudio.google.com</a>
                {" "}에서 발급받은 키를 입력하세요.
              </p>
            </div>

            <div className="flex gap-3">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white
                           placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition font-mono text-sm"
              />
              <button
                onClick={saveApiKey}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition whitespace-nowrap"
              >
                {savedApiKey ? "✅ 저장됨" : "저장"}
              </button>
              {apiKey && (
                <button
                  onClick={() => { setApiKey(""); localStorage.removeItem(STORAGE_KEY_API); }}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 text-sm transition"
                >
                  삭제
                </button>
              )}
            </div>
          </div>

          {/* 모델 선택 섹션 */}
          <div className="glass rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white mb-1">AI 모델 선택</h2>
                <p className="text-xs text-gray-400">이 API 키로 사용 가능한 모델을 조회하고 선택하세요.</p>
              </div>
              <button
                onClick={fetchModels}
                disabled={modelLoading || !apiKey}
                className="px-4 py-2 rounded-xl bg-indigo-600/80 hover:bg-indigo-500 disabled:opacity-40
                           text-white text-sm font-medium transition whitespace-nowrap"
              >
                {modelLoading ? "조회 중..." : "🔍 모델 조회"}
              </button>
            </div>

            {/* 에러 */}
            {modelError && (
              <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{modelError}</p>
            )}

            {/* 현재 선택된 모델 표시 */}
            {selectedModel && !models.length && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <span className="text-emerald-400 text-sm">✅ 현재 사용 중:</span>
                <code className="text-emerald-300 text-sm font-mono">{selectedModel}</code>
                <span className="text-gray-500 text-xs">({modelVersion})</span>
              </div>
            )}

            {/* 모델 목록 */}
            {models.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">{models.length}개 모델 사용 가능</p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {models.map((m) => (
                    <label
                      key={m.id}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition ${
                        selectedModel === m.id
                          ? "border-indigo-500 bg-indigo-500/10"
                          : "border-white/10 bg-white/5 hover:border-white/20"
                      }`}
                    >
                      <input
                        type="radio"
                        name="model"
                        value={m.id}
                        checked={selectedModel === m.id}
                        onChange={() => { setSelectedModel(m.id); setModelVersion(m.version); }}
                        className="accent-indigo-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{m.displayName}</p>
                        <p className="text-gray-500 text-xs font-mono">{m.id} · {m.version}</p>
                      </div>
                      {selectedModel === m.id && (
                        <span className="text-indigo-400 text-xs">선택됨</span>
                      )}
                    </label>
                  ))}
                </div>
                <button
                  onClick={saveModel}
                  disabled={!selectedModel}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40
                             text-white text-sm font-medium transition"
                >
                  이 모델로 저장
                </button>
              </div>
            )}

            {/* 모델 미선택 상태 */}
            {!selectedModel && !models.length && (
              <p className="text-amber-400 text-xs bg-amber-400/10 rounded-lg px-3 py-2">
                ⚠️ 모델이 선택되지 않았습니다. "모델 조회"를 눌러 선택해주세요.
              </p>
            )}
          </div>
        </div>
      )}

      {/* 페르소나 탭 */}
      {activeTab === "personas" && (
        <div className="space-y-4">
          <div className="glass rounded-2xl p-4 flex items-center justify-between">
            <div>
              <span className="text-white text-sm font-medium">활성화된 페르소나: </span>
              <span className="text-indigo-400 font-bold">{activeCount}명</span>
              <span className="text-gray-500 text-xs ml-2">(최소 2명 이상 필요)</span>
            </div>
            <div className="flex gap-2">
              <button onClick={resetPersonas}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs transition">
                기본값 초기화
              </button>
              <button onClick={savePersonas} disabled={activeCount < 2}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900
                           disabled:text-indigo-600 text-white text-sm font-medium transition">
                {savedPersonas ? "✅ 저장됨" : "저장"}
              </button>
            </div>
          </div>

          {personas.map((persona) => (
            <div key={persona.id}
              className={`glass rounded-2xl border transition ${persona.active ? "border-white/10" : "border-white/5 opacity-60"}`}>
              <div className="flex items-center justify-between p-5">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${PERSONA_COLORS[persona.id]}`}>
                    PERSONA {persona.id.toUpperCase()}
                  </span>
                  {editingPersona === persona.id ? (
                    <input value={persona.name} onChange={(e) => updatePersona(persona.id, "name", e.target.value)}
                      className="bg-white/10 text-white px-3 py-1 rounded-lg text-sm border border-white/20 focus:outline-none focus:border-indigo-500" />
                  ) : (
                    <span className="text-white font-medium">{persona.name}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => updatePersona(persona.id, "active", !persona.active)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${persona.active ? "bg-indigo-600" : "bg-white/20"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${persona.active ? "left-5" : "left-0.5"}`} />
                  </button>
                  <button onClick={() => setEditingPersona(editingPersona === persona.id ? null : persona.id)}
                    className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs transition">
                    {editingPersona === persona.id ? "접기" : "수정"}
                  </button>
                </div>
              </div>
              {editingPersona === persona.id && (
                <div className="px-5 pb-5 space-y-3">
                  <label className="text-xs text-gray-400">시스템 프롬프트</label>
                  <textarea value={persona.systemPrompt} onChange={(e) => updatePersona(persona.id, "systemPrompt", e.target.value)}
                    rows={12}
                    className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-gray-200
                               text-xs font-mono focus:outline-none focus:border-indigo-500 transition resize-y" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
