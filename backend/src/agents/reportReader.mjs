import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  Agent,
  AgentSession,
  ServerOptions,
  cli,
  defineAgent,
  inference,
} from "@livekit/agents";

const agentFile = fileURLToPath(import.meta.url);
dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

export default defineAgent({
  entry: async (ctx) => {
    let dispatch;
    try {
      dispatch = JSON.parse(ctx.job.metadata || "{}");
    } catch (error) {
      throw new Error("Report-reading dispatch metadata is invalid.", { cause: error });
    }

    if (dispatch.type !== "report-reading" || typeof dispatch.report !== "string" || !dispatch.report.trim()) {
      throw new Error("This worker only accepts report-reading calls with non-empty report text.");
    }

    const session = new AgentSession({
      tts: new inference.TTS({
        model: process.env.REPORT_TTS_MODEL || "deepgram/aura-2",
      }),
    });
    await session.start({
      agent: new Agent({
        instructions: "Read the provided report aloud exactly as written. Do not add, summarize, or interpret anything.",
      }),
      room: ctx.room,
      record: false,
    });
    await session.say(dispatch.report, {
      allowInterruptions: false,
      addToChatCtx: false,
    }).waitForPlayout();
  },
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli.runApp(new ServerOptions({
    agent: agentFile,
    agentName: process.env.LIVEKIT_REPORT_AGENT_NAME,
  }));
}
