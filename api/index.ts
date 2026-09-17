// Vercel owns the HTTP listener. The API bundle exports Express only, without
// starting Socket.IO or the standalone DB bootstrap jobs on a cold start.
// @ts-expect-error Generated during build; Vercel traces this runtime artifact.
export { default } from "../artifacts/api-server/dist/serverless.mjs";
