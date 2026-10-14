import { createDb } from "@/db/client";
import { findActiveProfileById } from "@/lib/active-profile";
import {
  parseOpaqueCalendarFeedTokenDigest,
} from "@/lib/calendar-feed";
import { createCalendarFeedResponse } from "@/lib/calendar-feed-response";
import { findCalendarFeedOwnerByDigest } from "@/lib/calendar-feed-store";

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  const digest = parseOpaqueCalendarFeedTokenDigest(token);
  if (!digest) return new Response("Feed not found", { status: 404 });

  const db = createDb();
  const ownerId = await findCalendarFeedOwnerByDigest(digest, db);
  if (!ownerId) return new Response("Feed not found", { status: 404 });
  const student = await findActiveProfileById(ownerId, db);
  if (!student || student.role !== "student") {
    return new Response("Feed not found", { status: 404 });
  }
  return createCalendarFeedResponse(student, db);
}
