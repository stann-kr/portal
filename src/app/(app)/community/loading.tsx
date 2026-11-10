import { RouteSkeleton } from "@/components/ui/route-skeletons";

export default function CommunityLoading() {
  return <RouteSkeleton kind="thread-list" label="커뮤니티를 불러오는 중" />;
}
