import {
  cleanName,
  createNewRoom,
  jsonError,
  readBody,
  viewRoom,
} from "../../../lib/server";

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const { room, token } = await createNewRoom(cleanName(body.name), request);
    return Response.json(
      { code: room.code, token, room: viewRoom(room, room.players[0]) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
