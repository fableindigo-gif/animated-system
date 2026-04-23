import { Router } from "express";
import conversationsRouter from "./conversations";
import imageRouter from "./image";

const geminiRouter = Router();

geminiRouter.use("/conversations", conversationsRouter);
geminiRouter.use("/generate-image", imageRouter);

export default geminiRouter;
