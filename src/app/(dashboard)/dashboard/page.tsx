// 대시보드 - Drizzle 버전
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { projects, sessions, finalSummaries } from "@/lib/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import Link from "next/link";

// 30초 캐시: 매번 DB를 조회하지 않고 ISR로 빠르게 응답
export const revalidate = 30;

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const recentProjects = await db.select().from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.deletedAt)))
    .orderBy(desc(projects.updatedAt)).limit(5);

  const recentSessions = await db.select({
    id: sessions.id,
    title: sessions.title,
    status: sessions.status,
    completedAt: sessions.completedAt,
    projectId: sessions.projectId,
  }).from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.status, "completed")))
    .orderBy(desc(sessions.completedAt)).limit(5);

  // 프로젝트명 매핑
  const projectMap = Object.fromEntries(recentProjects.map((p) => [p.id, p.title]));

  const [totalCountRow] = await db.select({ count: sql<number>`count(*)` }).from(sessions).where(eq(sessions.userId, userId));
  const [completedCountRow] = await db.select({ count: sql<number>`count(*)` }).from(sessions).where(and(eq(sessions.userId, userId), eq(sessions.status, "completed")));

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">
          안녕하세요, <span className="text-gradient">{session?.user?.name ?? "사용자"}</span>님 👋
        </h1>
        <p className="text-gray-400 mt-1">AI 토론 기획 검토 워크스페이스에 오신 것을 환영합니다.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "전체 프로젝트", value: recentProjects.length, icon: "📁" },
          { label: "전체 세션", value: totalCountRow?.count ?? 0, icon: "💬" },
          { label: "완료된 토론", value: completedCountRow?.count ?? 0, icon: "✅" },
        ].map((stat) => (
          <div key={stat.label} className="glass rounded-2xl p-5 card-hover">
            <div className="text-2xl mb-2">{stat.icon}</div>
            <div className="text-3xl font-bold text-white">{stat.value}</div>
            <div className="text-gray-400 text-sm mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="glass rounded-2xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-white">최근 프로젝트</h2>
            <Link href="/projects" className="text-indigo-400 hover:text-indigo-300 text-sm">전체 보기 →</Link>
          </div>
          {recentProjects.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">프로젝트가 없습니다.</p>
              <Link href="/projects" className="mt-3 inline-block text-sm text-indigo-400">첫 프로젝트 만들기 →</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentProjects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition group">
                  <div>
                    <p className="text-sm font-medium text-gray-200 group-hover:text-white">{p.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{new Date(p.createdAt!).toLocaleDateString("ko-KR")}</p>
                  </div>
                  <span className="text-gray-600 group-hover:text-gray-400 text-sm">→</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="glass rounded-2xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-white">최근 완료 토론</h2>
            <Link href="/history" className="text-indigo-400 hover:text-indigo-300 text-sm">전체 보기 →</Link>
          </div>
          {recentSessions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">완료된 토론이 없습니다.</p>
              <p className="text-xs text-gray-600 mt-1">기획안을 입력하고 AI 토론을 시작해보세요!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentSessions.map((s) => (
                <Link key={s.id} href={`/sessions/${s.id}`} className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition group">
                  <div>
                    <p className="text-sm font-medium text-gray-200 group-hover:text-white">{s.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {projectMap[s.projectId] ?? ""} · {s.completedAt ? new Date(s.completedAt).toLocaleDateString("ko-KR") : ""}
                    </p>
                  </div>
                  <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">완료</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
