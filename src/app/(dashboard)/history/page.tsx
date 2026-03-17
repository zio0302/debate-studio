// 히스토리 페이지 - Drizzle 버전
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { sessions, projects, finalSummaries } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import Link from "next/link";

export default async function HistoryPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const sessionList = await db.select({
    id: sessions.id,
    title: sessions.title,
    status: sessions.status,
    rounds: sessions.rounds,
    createdAt: sessions.createdAt,
    projectId: sessions.projectId,
  }).from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt))
    .limit(50);

  // 프로젝트명 조회
  const projectIds = [...new Set(sessionList.map((s) => s.projectId))];
  const projectList = projectIds.length > 0
    ? await db.select({ id: projects.id, title: projects.title }).from(projects)
    : [];
  const projectMap = Object.fromEntries(projectList.map((p) => [p.id, p.title]));

  // 최종안 스냅샷 조회
  const sessionIds = sessionList.map((s) => s.id);
  const summaryList = sessionIds.length > 0
    ? await db.select({ sessionId: finalSummaries.sessionId, finalBrief: finalSummaries.finalBrief }).from(finalSummaries)
    : [];
  const summaryMap = Object.fromEntries(summaryList.map((s) => [s.sessionId, s.finalBrief]));

  const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
    pending: { label: "대기", cls: "bg-gray-500/20 text-gray-400" },
    running: { label: "실행 중", cls: "bg-yellow-500/20 text-yellow-400" },
    completed: { label: "완료", cls: "bg-green-500/20 text-green-400" },
    failed: { label: "실패", cls: "bg-red-500/20 text-red-400" },
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">히스토리</h1>
        <p className="text-gray-400 text-sm mt-1">최근 50개의 토론 세션</p>
      </div>

      {sessionList.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-gray-400">기록된 세션이 없습니다.</p>
          <Link href="/projects" className="mt-3 inline-block text-sm text-indigo-400 hover:text-indigo-300">새 토론 시작하기 →</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sessionList.map((s) => {
            const st = STATUS_LABELS[s.status ?? "pending"] ?? STATUS_LABELS.pending;
            return (
              <Link key={s.id} href={`/sessions/${s.id}`} className="glass rounded-2xl p-5 card-hover block">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-200 truncate">{s.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      📁 {projectMap[s.projectId] ?? s.projectId} · {s.rounds}라운드 · {new Date(s.createdAt!).toLocaleDateString("ko-KR")}
                    </p>
                    {summaryMap[s.id] && (
                      <p className="text-xs text-gray-500 mt-2 line-clamp-1">💡 {summaryMap[s.id]}</p>
                    )}
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${st.cls}`}>{st.label}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
