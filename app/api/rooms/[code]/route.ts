import {
  cleanCode,
  cleanName,
  commandRoom,
  getAuthenticatedRoom,
  joinRoom,
  jsonError,
  readBody,
  viewRoom,
} from "../../../../lib/server";

type Context = { params: Promise<{ code: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const code = cleanCode((await context.params).code);
    const { room, player } = await getAuthenticatedRoom(
      code,
      request.headers.get("x-player-token") ?? "",
    );
    return Response.json(viewRoom(room, player), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const code = cleanCode((await context.params).code);
    const body = await readBody(request);
    if (body.type === "join") {
      const { room, token, playerId } = await joinRoom(
        code,
        cleanName(body.name),
        request,
      );
      return Response.json(
        {
          code,
          token,
          room: viewRoom(room, room.players.find((p) => p.id === playerId)!),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const token = request.headers.get("x-player-token") ?? "";
    const room = await commandRoom(code, token, body);
    const { player } = await getAuthenticatedRoom(code, token);
    return Response.json(viewRoom(room, player), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
