// Vercel owns the HTTP listener. Importing the standalone index would start
// Socket.IO and run DB bootstrap jobs on every cold start; export only Express.
export { default } from "../artifacts/api-server/src/app";
