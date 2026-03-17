"use client";
// 프로젝트 목록 + 새 프로젝트 생성 페이지
import { useState, useEffect } from "react";
import Link from "next/link";

interface Project {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  _count: { sessions: number };
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "" });
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  // 프로젝트 목록 불러오기
  async function fetchProjects() {
    const res = await fetch("/api/projects");
    const data = await res.json();
    if (data.success) setProjects(data.data);
    setFetching(false);
  }

  useEffect(() => { fetchProjects(); }, []);

  // 새 프로젝트 생성
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (res.ok) {
      setForm({ title: "", description: "" });
      setShowForm(false);
      fetchProjects();
    }
    setLoading(false);
  }

  return (
    <div className="p-8 space-y-6">
      {/* 헤더 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">프로젝트</h1>
          <p className="text-gray-400 text-sm mt-1">기획안을 프로젝트 단위로 관리하세요.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition"
        >
          + 새 프로젝트
        </button>
      </div>

      {/* 새 프로젝트 생성 폼 */}
      {showForm && (
        <div className="glass rounded-2xl p-6 border border-indigo-500/30">
          <h2 className="text-base font-semibold text-white mb-4">새 프로젝트 만들기</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">프로젝트명 *</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="예: 커피챗 매칭 앱 기획 검토"
                required
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500
                           focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">설명 (선택)</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="이 프로젝트에 대한 간단한 설명..."
                rows={2}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500
                           focus:outline-none focus:border-indigo-500 transition resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800
                           text-white text-sm font-medium transition flex items-center gap-2"
              >
                {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                생성
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-6 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm transition"
              >
                취소
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 프로젝트 목록 */}
      {fetching ? (
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass rounded-2xl p-6 h-32 animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">🗂️</div>
          <p className="text-gray-400">아직 프로젝트가 없습니다.</p>
          <p className="text-gray-600 text-sm mt-1">위의 "새 프로젝트" 버튼으로 시작하세요!</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="glass rounded-2xl p-6 card-hover block"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-semibold text-white text-base leading-snug">{project.title}</h3>
                <span className="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full flex-shrink-0 ml-2">
                  {project._count.sessions}개 세션
                </span>
              </div>
              {project.description && (
                <p className="text-gray-500 text-sm line-clamp-2 mb-3">{project.description}</p>
              )}
              <p className="text-xs text-gray-600">
                {new Date(project.createdAt).toLocaleDateString("ko-KR")}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
