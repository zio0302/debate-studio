// 프로젝트 상세/수정/삭제 API - Drizzle 버전
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/prisma";
import { projects, sessions } from "@/lib/schema";
import { eq, and, isNull, desc } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

async function getOwnedProject(projectId: string, userId: string) {
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId), isNull(projects.deletedAt)))
    .limit(1);
  return p ?? null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, data: null, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const project = await getOwnedProject(id, session.user.id);
  if (!project) {
    return NextResponse.json({ success: false, data: null, error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  }

  const sessionList = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      status: sessions.status,
      rounds: sessions.rounds,
      outputTone: sessions.outputTone,
      createdAt: sessions.createdAt,
      completedAt: sessions.completedAt,
    })
    .from(sessions)
    .where(eq(sessions.projectId, id))
    .orderBy(desc(sessions.createdAt));

  return NextResponse.json({ success: true, data: { ...project, sessions: sessionList }, error: null });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, data: null, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const project = await getOwnedProject(id, session.user.id);
  if (!project) {
    return NextResponse.json({ success: false, data: null, error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json();
  await db.update(projects).set({
    title: body.title ?? project.title,
    description: body.description ?? project.description,
    updatedAt: new Date().toISOString(),
  }).where(eq(projects.id, id));

  const [updated] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return NextResponse.json({ success: true, data: updated, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, data: null, error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const project = await getOwnedProject(id, session.user.id);
  if (!project) {
    return NextResponse.json({ success: false, data: null, error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  }

  await db.update(projects).set({ deletedAt: new Date().toISOString() }).where(eq(projects.id, id));
  return NextResponse.json({ success: true, data: null, error: null });
}
