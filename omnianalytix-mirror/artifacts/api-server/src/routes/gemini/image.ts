import { Router } from "express";
import { generateImage } from "@workspace/integrations-gemini-ai/image";
import { GenerateGeminiImageBody } from "@workspace/api-zod";

const router = Router();

router.post("/", async (req, res) => {
  const result = GenerateGeminiImageBody.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  try {
    const { b64_json, mimeType } = await generateImage(result.data.prompt);
    res.json({ b64_json, mimeType });
  } catch (err) {
    req.log.error({ err }, "Failed to generate image");
    res.status(500).json({ error: "Failed to generate image" });
  }
});

export default router;
