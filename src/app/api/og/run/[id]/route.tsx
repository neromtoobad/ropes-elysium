import { climberOr, getRunCard } from "@/lib/runcard";
import { runCardImage } from "../../runCardImage";

/**
 * The run card as an image: what X (and anything else that unfurls links)
 * shows for /run/<id>. ?c=<climber> picks the character: the run does not
 * store it (it is the player's choice in the browser), so the share link
 * carries it.
 */
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const climber = climberOr(new URL(req.url).searchParams.get("c"));
  const card = await getRunCard(id).catch(() => null);
  return runCardImage(card, climber);
}
