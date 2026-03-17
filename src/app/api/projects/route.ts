// 프로젝트 목록/생성 API - PostgreSQL 버전
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { projects, sessions } from "@/lib/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";

const createProjectSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  defaultMode: z.string().default("strategy_vs_execution"),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, data: null, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const projectList = await db
    .select({
      id: projects.id,
      title: projects.title,
      description: projects.description,
      defaultMode: projects.defaultMode,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(and(eq(projects.userId, session.user.id), isNull(projects.deletedAt)))
    .orderBy(desc(projects.updatedAt));

  const projectsWithCount = await Promise.all(
    projectList.map(async (p) => {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(sessions)
        .where(eq(sessions.projectId, p.id));
      return { ...p, _count: { sessions: Number(count) } };
    })
  );

  return NextResponse.json({ success: true, data: projectsWithCount, error: null });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, data: null, error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = createProjectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, data: null, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const [project] = await db.insert(projects).values({
      userId: session.user.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      defaultMode: parsed.data.defaultMode,
    }).returning();

    return NextResponse.json({ success: true, data: project, error: null }, { status: 201 });
  } catch (err) {
    console.error("[API] 프로젝트 생성 오류:", err);
    return NextResponse.json({ success: false, data: null, error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
