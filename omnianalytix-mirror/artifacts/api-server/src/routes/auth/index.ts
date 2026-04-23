import { Router } from "express";
import shopifyOauthRouter from "./shopify-oauth";
import googleOauthRouter from "./google-oauth";
import metaOauthRouter from "./meta-oauth";
import hubspotOauthRouter from "./hubspot-oauth";
import salesforceOauthRouter from "./salesforce-oauth";
import bingOauthRouter from "./bing-oauth";
import zohoOauthRouter from "./zoho-oauth";
import gateRouter from "./gate";

const router = Router();

router.use("/shopify", shopifyOauthRouter);
router.use("/google", googleOauthRouter);
router.use("/meta", metaOauthRouter);
router.use("/hubspot", hubspotOauthRouter);
router.use("/salesforce", salesforceOauthRouter);
router.use("/bing", bingOauthRouter);
router.use("/zoho", zohoOauthRouter);
router.use("/gate", gateRouter);

export default router;
