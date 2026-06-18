import { createServerApp } from "./app";

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";
const app = createServerApp();

app.listen({ hostname, port });

console.log(`Gemini Live Group Interpreter listening on http://${hostname}:${port}`);
