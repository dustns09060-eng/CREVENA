import { redirect } from "next/navigation";

// STEP33 merged the standalone photo-blog screen into the unified content
// studio at /collaborations/[id]/content; STEP35.5 lifted PhotoBlogStudio's
// photo state into a shared hook that only the unified studio wires up
// (usePhotoManager + PhotoSection). Keeping this route's own duplicate copy
// of that wiring alive would mean maintaining two implementations of the
// same feature, so it now forwards to the one that's actually maintained —
// no capability is lost, since everything this page offered lives there.
export default async function CollaborationPhotosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/collaborations/${id}/content`);
}
