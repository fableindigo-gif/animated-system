import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, ShoppingCart, Users, Layers } from "lucide-react";

const TOTAL_STEPS = 5;

const STEP_LABELS = ["Email", "Website", "Revenue Model", "Attribution", "Schedule"];

const GOALS = [
  {
    id: "ecom" as const,
    label: "E-Commerce",
    desc: "Direct-to-consumer sales, Shopify, Amazon, product catalog",
    icon: ShoppingCart,
    gradient: "from-emerald-50 to-emerald-100/60",
    border: "border-emerald-200/60",
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
    activeBorder: "border-emerald-400",
    activeRing: "ring-emerald-200",
  },
  {
    id: "leadgen" as const,
    label: "Lead Generation",
    desc: "B2B pipeline, CRM integrations, form leads, CPL tracking",
    icon: Users,
    gradient: "from-violet-50 to-violet-100/60",
    border: "border-violet-200/60",
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
    activeBorder: "border-violet-400",
    activeRing: "ring-violet-200",
  },
  {
    id: "hybrid" as const,
    label: "Hybrid",
    desc: "Full funnel — sales revenue plus lead pipeline analytics",
    icon: Layers,
    gradient: "from-amber-50 to-amber-100/60",
    border: "border-amber-200/60",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    activeBorder: "border-amber-400",
    activeRing: "ring-amber-200",
  },
];

const ATTRIBUTION_OPTIONS = [
  "ChatGPT / AI",
  "Google Search",
  "Referral from a colleague",
  "Social Media",
  "Conference / Event",
  "Other",
];

function generateTimeSlots() {
  const slots: string[] = [];
  for (let h = 9; h <= 16; h++) {
    const suffix = h < 12 ? "AM" : "PM";
    const display = h > 12 ? h - 12 : h;
    slots.push(`${display}:00 ${suffix}`);
    if (h < 16) slots.push(`${display}:30 ${suffix}`);
  }
  return slots;
}

function getNextNDays(n: number) {
  const days: Date[] = [];
  const today = new Date();
  let d = new Date(today);
  d.setDate(d.getDate() + 1);
  while (days.length < n) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      days.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return days;
}

const TIME_SLOTS = generateTimeSlots();

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
};

export default function LeadCapturePage({ onBack }: { onBack?: () => void }) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);

  const [email, setEmail] = useState(() => {
    const prefill = sessionStorage.getItem("omni_prefill_email") ?? "";
    if (prefill) sessionStorage.removeItem("omni_prefill_email");
    return prefill;
  });
  const [website, setWebsite] = useState("");
  const [goal, setGoal] = useState<"ecom" | "leadgen" | "hybrid" | "">("");
  const [attribution, setAttribution] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [calendarWeekOffset, setCalendarWeekOffset] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [step]);

  const canAdvance = useCallback(() => {
    if (step === 0) return email.includes("@") && email.includes(".");
    if (step === 1) return website.trim().length > 0;
    if (step === 2) return goal !== "";
    if (step === 3) return attribution !== "";
    if (step === 4) return selectedDate !== null && selectedTime !== "";
    return false;
  }, [step, email, website, goal, attribution, selectedDate, selectedTime]);

  const advance = useCallback(async () => {
    if (!canAdvance()) return;
    if (step === 4) {
      setSubmitting(true);
      try {
        const base = import.meta.env.BASE_URL ?? "/";
        const apiBase = base.endsWith("/") ? base : base + "/";
        const resp = await fetch(`${apiBase}api/leads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            website,
            revenueModel: goal,
            attribution,
            scheduledDate: selectedDate?.toISOString() ?? "",
            scheduledTime: selectedTime,
          }),
        });
        if (!resp.ok) throw new Error("Request failed");
        setConfirmed(true);
      } catch {
        setSubmitError("Something went wrong — please try again or email us directly.");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setDirection(1);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }, [step, canAdvance, email, website, goal, attribution, selectedDate, selectedTime]);

  const goBack = useCallback(() => {
    if (step === 0) {
      onBack?.();
      return;
    }
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }, [step, onBack]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && canAdvance() && !confirmed) {
        e.preventDefault();
        advance();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, canAdvance, confirmed]);

  const availableDays = getNextNDays(20);
  const visibleDays = availableDays.slice(calendarWeekOffset * 5, calendarWeekOffset * 5 + 5);
  const maxWeekOffset = Math.max(0, Math.ceil(availableDays.length / 5) - 1);

  const fmt = new Intl.DateTimeFormat("en-US", { weekday: "short" });
  const fmtDay = new Intl.DateTimeFormat("en-US", { day: "numeric" });
  const fmtMonth = new Intl.DateTimeFormat("en-US", { month: "short" });

  if (confirmed) {
    return (
      <div className="min-h-screen bg-[#F2F2F7] flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="bg-white rounded-3xl shadow-xl shadow-zinc-200/50 w-full max-w-md p-10 text-center"
        >
          <div className="relative mx-auto mb-6 w-20 h-20">
            <motion.div
              className="absolute inset-0 rounded-full bg-emerald-100"
              animate={{ scale: [1, 1.25, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="relative w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center">
              <Check className="w-10 h-10 text-white" strokeWidth={3} />
            </div>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
            Meeting Confirmed
          </h2>
          <p className="text-[#737686] font-medium text-base leading-relaxed mb-8">
            Check your inbox for the calendar invite. We can't wait to show you what OmniAnalytix can do.
          </p>
          <button
            onClick={() => onBack?.()}
            className="px-8 py-3.5 bg-[#2563EB] text-white rounded-2xl font-bold text-base hover:bg-[#1e40af] active:scale-[0.97] transition-all shadow-lg shadow-blue-500/20"
          >
            Back to Home
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F2F2F7] flex flex-col items-center justify-center p-4 sm:p-6 relative">

      <button
        onClick={goBack}
        className="absolute top-6 left-6 sm:top-8 sm:left-8 w-10 h-10 rounded-full bg-white shadow-md shadow-zinc-200/40 flex items-center justify-center hover:bg-[#F2F2F7] transition-colors z-10"
        aria-label="Go back"
      >
        <ArrowLeft className="w-5 h-5 text-[#434655]" />
      </button>

      <div className="w-full max-w-lg mb-8">
        <div className="flex items-center justify-center gap-2 mb-3">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className="flex flex-col items-center">
                <div
                  className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                    i < step
                      ? "bg-[#2563EB] scale-100"
                      : i === step
                        ? "bg-[#2563EB] scale-125 ring-4 ring-[#2563EB]/15"
                        : "bg-[#D1D5DB]"
                  }`}
                />
                <span
                  className={`text-[10px] font-semibold mt-1.5 transition-colors duration-300 hidden sm:block ${
                    i <= step ? "text-[#2563EB]" : "text-[#9CA3AF]"
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div
                  className={`w-8 sm:w-12 h-0.5 rounded-full transition-colors duration-300 ${
                    i < step ? "bg-[#2563EB]" : "bg-[#E5E7EB]"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-xl shadow-zinc-200/50 w-full max-w-lg overflow-hidden">
        <div className="relative min-h-[340px] sm:min-h-[380px] flex flex-col">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex-1 flex flex-col p-8 sm:p-10"
            >

              {step === 0 && (
                <div className="flex-1 flex flex-col justify-center">
                  <p className="text-sm font-semibold text-[#2563EB] tracking-wide uppercase mb-3">Step 1 of 5</p>
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
                    Let's start with your work email.
                  </h1>
                  <p className="text-[#737686] font-medium text-sm mb-8">We'll use this to set up your account and send your calendar invite.</p>
                  <input
                    ref={inputRef}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full bg-[#F2F2F7] border-2 border-transparent rounded-2xl px-5 py-4 text-lg font-medium outline-none focus:border-[#2563EB] focus:bg-white placeholder:text-[#9CA3AF] transition-all"
                    autoFocus
                  />
                </div>
              )}

              {step === 1 && (
                <div className="flex-1 flex flex-col justify-center">
                  <p className="text-sm font-semibold text-[#2563EB] tracking-wide uppercase mb-3">Step 2 of 5</p>
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
                    What is your agency's website?
                  </h1>
                  <p className="text-[#737686] font-medium text-sm mb-8">This helps us tailor the demo to your brand.</p>
                  <input
                    ref={inputRef}
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://youragency.com"
                    className="w-full bg-[#F2F2F7] border-2 border-transparent rounded-2xl px-5 py-4 text-lg font-medium outline-none focus:border-[#2563EB] focus:bg-white placeholder:text-[#9CA3AF] transition-all"
                    autoFocus
                  />
                </div>
              )}

              {step === 2 && (
                <div className="flex-1 flex flex-col justify-center">
                  <p className="text-sm font-semibold text-[#2563EB] tracking-wide uppercase mb-3">Step 3 of 5</p>
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
                    How do you drive revenue?
                  </h1>
                  <p className="text-[#737686] font-medium text-sm mb-6">Select the model that best matches your business.</p>
                  <div className="space-y-3">
                    {GOALS.map((g) => {
                      const Icon = g.icon;
                      const active = goal === g.id;
                      return (
                        <button
                          key={g.id}
                          onClick={() => {
                            setGoal(g.id);
                            setTimeout(() => {
                              setDirection(1);
                              setStep(3);
                            }, 250);
                          }}
                          className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all duration-200 bg-gradient-to-r ${g.gradient} ${
                            active
                              ? `${g.activeBorder} ring-4 ${g.activeRing}`
                              : `${g.border} hover:shadow-md hover:scale-[1.01]`
                          }`}
                        >
                          <div className={`w-12 h-12 rounded-xl ${g.iconBg} flex items-center justify-center shrink-0`}>
                            <Icon className={`w-6 h-6 ${g.iconColor}`} />
                          </div>
                          <div>
                            <span className="text-base font-bold tracking-tight block">{g.label}</span>
                            <span className="text-xs text-[#737686] font-medium">{g.desc}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="flex-1 flex flex-col justify-center">
                  <p className="text-sm font-semibold text-[#2563EB] tracking-wide uppercase mb-3">Step 4 of 5</p>
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
                    How did you hear about us?
                  </h1>
                  <p className="text-[#737686] font-medium text-sm mb-6">Just curious — helps us improve.</p>
                  <div className="relative">
                    <select
                      value={attribution}
                      onChange={(e) => setAttribution(e.target.value)}
                      className="w-full bg-[#F2F2F7] border-2 border-transparent rounded-2xl px-5 py-4 text-lg font-medium outline-none focus:border-[#2563EB] focus:bg-white appearance-none transition-all cursor-pointer"
                    >
                      <option value="" disabled>Select an option</option>
                      {ATTRIBUTION_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9CA3AF] rotate-90 pointer-events-none" />
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="flex-1 flex flex-col">
                  <p className="text-sm font-semibold text-[#2563EB] tracking-wide uppercase mb-2">Step 5 of 5</p>
                  <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight mb-1" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
                    Schedule your 1:1 onboarding session.
                  </h1>
                  <p className="text-[#737686] font-medium text-xs mb-4">Pick a day and time that works for you (EST).</p>

                  <div className="flex items-center justify-between mb-3">
                    <button
                      onClick={() => setCalendarWeekOffset((o) => Math.max(0, o - 1))}
                      disabled={calendarWeekOffset === 0}
                      className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center hover:bg-[#E5E7EB] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-semibold text-[#737686]">
                      {visibleDays.length > 0 &&
                        `${fmtMonth.format(visibleDays[0])} ${fmtDay.format(visibleDays[0])} — ${fmtMonth.format(visibleDays[visibleDays.length - 1])} ${fmtDay.format(visibleDays[visibleDays.length - 1])}`}
                    </span>
                    <button
                      onClick={() => setCalendarWeekOffset((o) => Math.min(maxWeekOffset, o + 1))}
                      disabled={calendarWeekOffset >= maxWeekOffset}
                      className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center hover:bg-[#E5E7EB] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-5 gap-1.5 mb-4">
                    {visibleDays.map((d) => {
                      const active = selectedDate?.toDateString() === d.toDateString();
                      return (
                        <button
                          key={d.toISOString()}
                          onClick={() => { setSelectedDate(d); setSelectedTime(""); }}
                          className={`flex flex-col items-center py-2.5 rounded-xl text-center transition-all duration-200 ${
                            active
                              ? "bg-[#2563EB] text-white shadow-lg shadow-blue-500/20"
                              : "bg-[#F2F2F7] hover:bg-[#E5E7EB] text-[#434655]"
                          }`}
                        >
                          <span className={`text-[10px] font-semibold uppercase ${active ? "text-blue-100" : "text-[#9CA3AF]"}`}>
                            {fmt.format(d)}
                          </span>
                          <span className="text-base font-bold">{fmtDay.format(d)}</span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedDate && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-3 gap-1.5 max-h-[140px] overflow-y-auto pr-1">
                        {TIME_SLOTS.map((t) => (
                          <button
                            key={t}
                            onClick={() => setSelectedTime(t)}
                            className={`py-2 rounded-xl text-xs font-semibold transition-all duration-150 ${
                              selectedTime === t
                                ? "bg-[#2563EB] text-white shadow-md shadow-blue-500/20"
                                : "bg-[#F2F2F7] text-[#434655] hover:bg-[#E5E7EB]"
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {step !== 2 && (
          <div className="px-8 sm:px-10 pb-8 sm:pb-10">
            <button
              onClick={advance}
              disabled={!canAdvance() || submitting}
              className="w-full py-4 bg-[#2563EB] text-white rounded-2xl font-bold text-base flex items-center justify-center gap-2 hover:bg-[#1e40af] active:scale-[0.97] transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
            >
              {step === 4 ? (
                submitting ? (
                  <>
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Booking...
                  </>
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    Confirm Booking
                  </>
                )
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
            {submitError && (
              <p className="text-center text-sm text-red-600 font-medium mt-3">{submitError}</p>
            )}
            <p className="text-center text-[11px] text-[#9CA3AF] font-medium mt-3">
              {step === 0
                ? "Press Enter to continue"
                : step === 4
                  ? "You'll receive a calendar invite at your email"
                  : "Press Enter to continue"}
            </p>
          </div>
        )}
      </div>

      <p className="text-xs text-[#9CA3AF] font-medium mt-6">
        By continuing you agree to our <a href={`${import.meta.env.BASE_URL ?? "/"}privacy-policy`} className="underline hover:text-[#737686]">Privacy Policy</a>.
      </p>
    </div>
  );
}
