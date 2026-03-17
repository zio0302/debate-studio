"use client";
// 상위 지침 전용 페이지 - 모든 AI 페르소나에 최우선으로 적용되는 최상위 지시사항
import { useState, useEffect } from "react";

// localStorage 키: 전체 앱에서 공통으로 사용
const STORAGE_KEY_DIRECTIVE = "debate_global_directive";

export default function DirectivePage() {
  const [directive, setDirective] = useState("");
  const [saved, setSaved] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // 로컬스토리지에서 저장된 상위 지침 불러오기
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY_DIRECTIVE) ?? "";
    setDirective(stored);
    setIsLoaded(true);
  }, []);

  // 상위 지침 저장
  function handleSave() {
    localStorage.setItem(STORAGE_KEY_DIRECTIVE, directive);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // 상위 지침 삭제
  function handleClear() {
    if (confirm("상위 지침을 삭제하시겠습니까? 모든 토론에서 적용이 해제됩니다.")) {
      setDirective("");
      localStorage.removeItem(STORAGE_KEY_DIRECTIVE);
    }
  }

  if (!isLoaded) return null;

  return (
    <div className="p-8 max-w-3xl space-y-6">
      {/* 헤더 */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <span className="text-2xl">📌</span>
          <h1 className="text-2xl font-bold text-white">상위 지침</h1>
        </div>
        <p className="text-gray-400 text-sm">
          모든 AI 페르소나에 <strong className="text-indigo-400">최우선으로 적용</strong>되는 최상위 지시사항입니다.
        </p>
      </div>

      {/* 설명 카드 */}
      <div className="glass rounded-2xl p-5 border border-indigo-500/20">
        <h2 className="text-sm font-semibold text-indigo-400 mb-2">💡 상위 지침이란?</h2>
        <ul className="text-xs text-gray-400 space-y-1.5">
          <li>• 각 페르소나의 개별 역할/성향보다 <strong className="text-white">상위에서 작동</strong>하는 지시사항입니다.</li>
          <li>• 여기에 입력한 내용은 <strong className="text-white">모든 AI 전문가가 반드시 최우선으로 따릅니다.</strong></li>
          <li>• 비즈니스 맥락, 예산 제약, 기술 스택, 조직 원칙 등을 설정하세요.</li>
          <li>• 토론 실행 시 각 페르소나는 이 지침 위에서 자신의 전문성을 발휘합니다.</li>
        </ul>
      </div>

      {/* 입력 영역 */}
      <div className="glass rounded-2xl p-6 border border-white/10 space-y-4">
        <label className="block text-sm font-medium text-gray-200">
          상위 지침 입력
        </label>
        <textarea
          value={directive}
          onChange={(e) => setDirective(e.target.value)}
          placeholder={`예시:\n\n1. 우리 회사는 B2B SaaS 스타트업이며, 현재 시리즈 A 단계입니다.\n2. 타겟 고객은 직원 50명 이하의 중소기업 대표/CTO입니다.\n3. 기술 스택은 React + Node.js + PostgreSQL로 제한합니다.\n4. 개발 예산은 5천만 원, 기간은 3개월 이내입니다.\n5. 모든 기획 평가는 ROI와 시장 진입 속도를 최우선으로 판단하세요.\n6. 한국 시장을 1차 타겟으로 하며, 글로벌 확장은 2차입니다.\n7. 법률/규제 리스크가 있는 기능은 반드시 별도 언급해주세요.`}
          rows={12}
          className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white
                     placeholder-gray-600 text-sm leading-relaxed focus:outline-none focus:border-indigo-500
                     focus:ring-1 focus:ring-indigo-500/50 transition resize-y"
        />

        {/* 글자 수 표시 */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {directive.length > 0 ? `${directive.length}자 입력됨` : "지침을 입력하세요"}
          </span>
        </div>

        {/* 버튼 */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={!directive.trim()}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900
                       disabled:text-indigo-600 text-white text-sm font-medium transition-all duration-200
                       flex items-center gap-2"
          >
            {saved ? "✅ 저장 완료!" : "💾 저장"}
          </button>
          {directive && (
            <button
              onClick={handleClear}
              className="px-5 py-2.5 rounded-xl bg-white/5 hover:bg-red-500/20
                         text-gray-400 hover:text-red-400 text-sm transition"
            >
              🗑️ 삭제
            </button>
          )}
        </div>
      </div>

      {/* 상태 표시 */}
      <div className={`rounded-2xl px-5 py-4 text-sm ${
        directive.trim()
          ? "bg-emerald-500/10 border border-emerald-500/30"
          : "bg-amber-500/10 border border-amber-500/30"
      }`}>
        {directive.trim() ? (
          <div>
            <p className="text-emerald-400 font-medium mb-1">
              ✅ 상위 지침이 활성화되어 있습니다
            </p>
            <p className="text-emerald-400/70 text-xs">
              다음 토론부터 모든 AI 페르소나가 이 지침을 최우선으로 따릅니다.
              개별 페르소나의 전문 역할은 이 지침의 범위 안에서 수행됩니다.
            </p>
          </div>
        ) : (
          <div>
            <p className="text-amber-400 font-medium mb-1">
              ⚠️ 상위 지침이 설정되지 않았습니다
            </p>
            <p className="text-amber-400/70 text-xs">
              상위 지침 없이도 토론은 가능하지만, 비즈니스 맥락이나 제약 조건을 설정하면
              더 현실적이고 정확한 기획 검토를 받을 수 있습니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
