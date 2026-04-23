import { Linkedin, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function LinkedInCard() {
  return (
    <Card className="flex flex-col bg-card/50 border-border/50 shadow-sm backdrop-blur-sm transition-all hover:bg-card hover:border-border opacity-80">
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-md ring-1 bg-[#0077B5]/10 ring-[#0077B5]/30">
            <Linkedin className="w-6 h-6 text-[#0077B5]" />
          </div>
          <div>
            <CardTitle className="text-base font-bold tracking-tight">LinkedIn Ads</CardTitle>
            <CardDescription className="text-xs font-mono text-muted-foreground mt-1">
              Lead Gen Forms · Sponsored Content · B2B Targeting
            </CardDescription>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Badge variant="outline" className="text-amber-400 border-amber-400/20 bg-amber-400/5 font-mono text-[10px] uppercase tracking-wider">
            Coming Soon
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-grow pt-0 pb-3 space-y-3">
        <div className="flex flex-wrap gap-1.5 mt-1">
          {["Lead Gen Forms", "Sponsored InMail", "Company Targeting", "Conversion Tracking"].map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-medium border border-border/30 bg-secondary/10 text-muted-foreground opacity-60"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#0077B5]/40" />
              {tag}
            </span>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Sync LinkedIn Lead Gen Form submissions into your pipeline. Track CPL per company size, job title,
          and industry. Push qualified lead signals back to Campaign Manager for smarter audience targeting.
        </p>

        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-400/15 bg-amber-400/5 text-[10px] font-mono text-amber-400/70">
          <Sparkles className="w-3 h-3 shrink-0" />
          Native integration in development — available in the next release.
        </div>
      </CardContent>

      <CardFooter className="pt-3 border-t border-border/50 flex flex-wrap gap-2 justify-end">
        <button
          disabled
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono border border-border/30 text-muted-foreground/50 bg-secondary/10 cursor-not-allowed"
        >
          <Linkedin className="w-3.5 h-3.5" />
          Connect LinkedIn
        </button>
      </CardFooter>
    </Card>
  );
}
